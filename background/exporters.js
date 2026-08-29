import { strToU8, Zip, ZipDeflate } from '../lib/fflate.js';
import { notifyPopup } from './notify.js';
import { getDataUrlDetails } from './recording-assets.js';
import { DEFAULT_SETTINGS, sanitizeOutputDir } from './settings-schema.js';

// Tutorial export builders: Markdown, standalone HTML, PDF payload, ZIP bundle.

export const EXPORT_PDF_MAX_SCREENSHOTS = 150;

export const EXPORT_PDF_MAX_IMAGE_BYTES = 200 * 1024 * 1024;

export const EXPORT_PROGRESS_STEP_FILES = 10;

export function buildRecordingTitle(recording) {
  const firstDescription = recording.screenshots.find((item) => item.description)?.description || '教程录制';
  return firstDescription.slice(0, 36);
}

export function getPdfGenerationPlan(recording) {
  const screenshotCount = recording?.screenshots?.length || 0;
  if (screenshotCount > EXPORT_PDF_MAX_SCREENSHOTS) {
    return {
      shouldGenerate: false,
      reason: `截图数量 ${screenshotCount} 超过 PDF 保护阈值 ${EXPORT_PDF_MAX_SCREENSHOTS}`
    };
  }

  const imageBytes = estimateScreenshotPayloadBytes(recording);
  if (imageBytes > EXPORT_PDF_MAX_IMAGE_BYTES) {
    return {
      shouldGenerate: false,
      reason: `截图体积约 ${formatBytes(imageBytes)} 超过 PDF 保护阈值 ${formatBytes(EXPORT_PDF_MAX_IMAGE_BYTES)}`
    };
  }

  return { shouldGenerate: true, reason: '' };
}

export function buildPdfPayload(recording) {
  return {
    id: recording.id,
    title: recording.title,
    createdAt: recording.startTime,
    durationMs: getRecordingDuration(recording),
    audioAvailable: hasRecordingAudio(recording),
    videoAvailable: hasRecordingVideo(recording),
    recordingMode: recording.recordingMode || 'manual',
    screenshots: recording.screenshots.map((screenshot, index) => ({
      index: index + 1,
      description: screenshot.description || `步骤 ${index + 1}`,
      timestampLabel: formatDuration(screenshot.timeOffsetMs || 0),
      data: screenshot.data
    }))
  };
}

export function buildMarkdown(recording) {
  const lines = [
    `# ${recording.title}`,
    '',
    `> 创建时间：${new Date(recording.startTime).toLocaleString()}`,
    `> 录制时长：${formatDuration(getRecordingDuration(recording))}`,
    `> 截图数量：${recording.screenshots.length}`,
    `> 录制模式：${formatRecordingMode(recording)}`,
    `> 音频文件：${hasRecordingAudio(recording) ? 'audio/tutorial-audio.webm' : '未生成'}`,
    `> 视频文件：${hasRecordingVideo(recording) ? 'video/tutorial-video.webm' : '未生成'}`,
    ''
  ];

  for (let index = 0; index < recording.screenshots.length; index += 1) {
    const screenshot = recording.screenshots[index];
    const screenshotName = `screenshots/step-${String(index + 1).padStart(2, '0')}.png`;

    lines.push(`## 步骤 ${index + 1} (${formatDuration(screenshot.timeOffsetMs || 0)})`);
    lines.push('');
    lines.push(screenshot.description || `步骤 ${index + 1}`);
    lines.push('');
    lines.push(`![步骤 ${index + 1}](${screenshotName})`);
    lines.push('');
  }

  return lines.join('\n');
}

export function formatRecordingMode(recording) {
  if (recording.recordingMode === 'ai' || recording.captureMode === 'agent') {
    return 'AI 自动录制';
  }

  return recording.captureMode === 'tabCapture' ? '直接录制当前标签页' : '共享屏幕/标签页';
}

export function hasRecordingAudio(recording = {}) {
  return Boolean(recording.audioDataUrl || recording.audioAssetId);
}

export function hasRecordingVideo(recording = {}) {
  return Boolean(recording.videoDataUrl || recording.videoAssetId);
}

export function estimateScreenshotPayloadBytes(recording = {}) {
  return (recording.screenshots || []).reduce((total, screenshot) => {
    const storedSize = Number.parseInt(screenshot?.dataSize, 10) || 0;
    if (storedSize > 0) {
      return total + storedSize;
    }

    return total + getDataUrlDetails(screenshot?.data || '').size;
  }, 0);
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export async function buildRecordingZipBlob(recording, markdown, pdfDataUrl, archiveRoot) {
  const chunks = [];
  const totalEntries = getRecordingZipEntryCount(recording, pdfDataUrl);
  let processedEntries = 0;
  let rejectZip;
  let resolveZip;
  const completion = new Promise((resolve, reject) => {
    resolveZip = resolve;
    rejectZip = reject;
  });
  const zip = new Zip((error, data, final) => {
    if (error) {
      rejectZip(error);
      return;
    }

    if (data?.length) {
      chunks.push(data);
    }

    if (final) {
      resolveZip();
    }
  });

  const addEntry = async (filename, bytes) => {
    const file = new ZipDeflate(filename, { level: 6 });
    zip.add(file);
    file.push(bytes, true);
    processedEntries += 1;
    notifyExportProgress(processedEntries, totalEntries);

    if (processedEntries % EXPORT_PROGRESS_STEP_FILES === 0) {
      await yieldToEventLoop();
    }
  };

  await addEntry(`${archiveRoot}/tutorial.md`, strToU8(markdown));
  await addEntry(`${archiveRoot}/tutorial.html`, strToU8(buildTutorialHtml(recording)));

  if (pdfDataUrl) {
    await addEntry(`${archiveRoot}/tutorial.pdf`, dataUrlToUint8Array(pdfDataUrl));
  }

  if (recording.audioDataUrl) {
    await addEntry(`${archiveRoot}/audio/tutorial-audio.webm`, dataUrlToUint8Array(recording.audioDataUrl));
  }

  if (recording.videoDataUrl) {
    await addEntry(`${archiveRoot}/video/tutorial-video.webm`, dataUrlToUint8Array(recording.videoDataUrl));
  }

  for (let index = 0; index < recording.screenshots.length; index += 1) {
    await addEntry(
      `${archiveRoot}/screenshots/step-${String(index + 1).padStart(2, '0')}.png`,
      dataUrlToUint8Array(recording.screenshots[index].data)
    );
  }

  zip.end();
  await completion;
  return new Blob(chunks, { type: 'application/zip' });
}

export function getRecordingZipEntryCount(recording, pdfDataUrl) {
  return (
    2 +
    (pdfDataUrl ? 1 : 0) +
    (recording.audioDataUrl ? 1 : 0) +
    (recording.videoDataUrl ? 1 : 0) +
    (recording.screenshots?.length || 0)
  );
}

export function escapeHtmlText(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildTutorialHtml(recording) {
  const title = escapeHtmlText(recording.title || '教程录制');
  const createdAt = escapeHtmlText(new Date(recording.startTime).toLocaleString());
  const duration = escapeHtmlText(formatDuration(getRecordingDuration(recording)));
  const mode = escapeHtmlText(formatRecordingMode(recording));

  const mediaTags = [];
  if (hasRecordingAudio(recording)) {
    mediaTags.push(
      `      <figure class="media"><figcaption>讲解音频</figcaption><audio controls preload="metadata" src="audio/tutorial-audio.webm"></audio></figure>`
    );
  }

  if (hasRecordingVideo(recording)) {
    mediaTags.push(
      `      <figure class="media"><figcaption>录制视频</figcaption><video controls preload="metadata" src="video/tutorial-video.webm"></video></figure>`
    );
  }

  const stepSections = recording.screenshots
    .map((screenshot, index) => {
      const description = escapeHtmlText(screenshot.description || `步骤 ${index + 1}`);
      const timeLabel = escapeHtmlText(formatDuration(screenshot.timeOffsetMs || 0));
      return [
        '    <section class="step">',
        `      <div class="step-head"><span class="badge">步骤 ${index + 1}</span><span class="time">${timeLabel}</span></div>`,
        `      <p class="desc">${description}</p>`,
        `      <img src="${screenshot.data}" alt="步骤 ${index + 1} 截图" loading="lazy">`,
        '    </section>'
      ].join('\n');
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; background: #f5f7fb; color: #0f172a; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
  header h1 { font-size: 28px; margin: 0 0 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .meta span { background: #e8f1ff; color: #0f5ecb; border-radius: 999px; padding: 4px 12px; font-size: 13px; }
  .media { margin: 16px 0; }
  .media figcaption { font-size: 13px; color: #64748b; margin-bottom: 6px; }
  .media audio, .media video { width: 100%; }
  .step { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 18px 20px; margin: 18px 0; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.05); }
  .step-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .badge { background: #1677ff; color: #ffffff; border-radius: 8px; padding: 3px 10px; font-size: 13px; font-weight: 600; }
  .time { color: #64748b; font-size: 13px; font-variant-numeric: tabular-nums; }
  .desc { font-size: 16px; line-height: 1.7; margin: 6px 0 12px; }
  .step img { max-width: 100%; height: auto; border-radius: 10px; border: 1px solid #e2e8f0; }
  footer { margin-top: 28px; color: #94a3b8; font-size: 12px; text-align: center; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${title}</h1>
      <div class="meta">
        <span>创建时间：${createdAt}</span>
        <span>录制时长：${duration}</span>
        <span>截图数量：${recording.screenshots.length}</span>
        <span>录制模式：${mode}</span>
      </div>
    </header>
${mediaTags.length ? mediaTags.join('\n') : ''}
    <main>
${stepSections}
    </main>
    <footer>由教程自动录制器生成 · 音频和视频文件与本页面位于同一 ZIP 包内</footer>
  </div>
</body>
</html>
`;
}

export function notifyExportProgress(processedEntries, totalEntries) {
  if (
    processedEntries !== 1 &&
    processedEntries !== totalEntries &&
    processedEntries % EXPORT_PROGRESS_STEP_FILES !== 0
  ) {
    return;
  }

  notifyPopup('generating', {
    message: `正在打包 ZIP ${processedEntries}/${totalEntries}...`
  });
}

export function yieldToEventLoop() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function buildBundleName(recording, outputDir = DEFAULT_SETTINGS.outputDir) {
  const date = new Date(recording.startTime);
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join('');

  const prefix = sanitizeOutputDir(outputDir);
  return `${prefix}/tutorial-${stamp}-${recording.id}`;
}

export function dataUrlToUint8Array(dataUrl) {
  const match = String(dataUrl || '').match(/^data:.*?;base64,(.*)$/);
  if (!match) {
    throw new Error('无法解析导出文件数据');
  }

  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function getArchiveRootName(bundleName) {
  return bundleName.split('/').filter(Boolean).pop() || bundleName;
}

export async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function getRecordingDuration(recording) {
  return Math.max(
    recording.audioMeta?.durationMs || 0,
    recording.videoMeta?.durationMs || 0,
    recording.screenshots[recording.screenshots.length - 1]?.timeOffsetMs || 0
  );
}
