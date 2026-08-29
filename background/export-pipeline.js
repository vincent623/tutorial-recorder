import { getRecording } from './asset-store.js';
import { blobToDataUrl, buildBundleName, buildMarkdown, buildPdfPayload, buildRecordingZipBlob, getArchiveRootName, getPdfGenerationPlan } from './exporters.js';
import { buildHistoryEntry, getHistory, upsertHistoryEntry } from './history-service.js';
import { closeOffscreenDocument, ensureOffscreenDocument, sendOffscreenMessage } from './media-orchestrator.js';
import { notifyPopup } from './notify.js';
import { COMMIT_STATES, createOperationId, markRecordingRecoverableFailure, runExclusiveOperation, runIdempotentOperation, updateRecordingCommitState } from './op-safety.js';
import { hydrateRecordingAssets } from './recording-assets.js';
import { S } from './runtime-state.js';
import { getSettings } from './settings-store.js';
import { sanitizeOperationId, sanitizeTextValue } from './text-utils.js';

export async function generatePdfForRecording(recording) {
  const plan = getPdfGenerationPlan(recording);

  if (!plan.shouldGenerate) {
    notifyPopup('warning', {
      message: `${plan.reason}，已跳过 PDF；ZIP 仍包含 Markdown、全部截图和可用音视频。`
    });
    return { pdfDataUrl: null, skipped: true, reason: plan.reason };
  }

  notifyPopup('generating', { message: '正在生成 PDF...' });
  return ensureOffscreenDocument()
    .then(() => sendOffscreenMessage('generatePdf', { recording: buildPdfPayload(recording) }))
    .catch((error) => ({ pdfDataUrl: null, error: error.message || 'PDF 生成失败' }));
}









export async function downloadRecordingBundle(recording, markdown, pdfDataUrl, outputDir, promptForSaveAs) {
  const bundleName = buildBundleName(recording, outputDir);
  const archiveRoot = getArchiveRootName(bundleName);
  const zipFilename = `${bundleName}.zip`;
  const zipBlob = await buildRecordingZipBlob(recording, markdown, pdfDataUrl, archiveRoot);

  await downloadBlob(zipFilename, zipBlob, promptForSaveAs);
  return zipFilename;
}








export async function downloadText(filename, content, mimeType, promptForSaveAs = false) {
  const blob = new Blob([content], { type: mimeType });
  await downloadBlob(filename, blob, promptForSaveAs);
}

export async function downloadUrl(filename, url, promptForSaveAs = false) {
  await chrome.downloads.download({
    url,
    filename,
    saveAs: promptForSaveAs
  });
}

export async function downloadBlob(filename, blob, promptForSaveAs = false) {
  const dataUrl = await blobToDataUrl(blob);
  await downloadUrl(filename, dataUrl, promptForSaveAs);
}




export async function exportRecording(id, operationId = '') {
  const recordingId = sanitizeTextValue(id, 80);
  const resolvedOperationId = operationId || `export-${recordingId}`;
  return runExclusiveOperation(`exportRecording:${recordingId}`, () =>
    runIdempotentOperation(`exportRecording:${recordingId}`, resolvedOperationId, () =>
      performExportRecording(recordingId, resolvedOperationId)
    )
  );
}

export async function performExportRecording(id, operationId = '') {
  const recording = await hydrateRecordingAssets(await getRecording(id));

  if (!recording) {
    throw new Error('这条历史记录已不存在');
  }

  try {
    notifyPopup('generating', { message: '正在重新导出文件...' });
    const markdown = buildMarkdown(recording);
    const settings = await getSettings();

    const pdfResult = await generatePdfForRecording(recording);

    if (pdfResult?.error) {
      notifyPopup('warning', { message: `PDF 生成失败：${pdfResult.error}` });
    }

    const exportBaseName = await downloadRecordingBundle(
      recording,
      markdown,
      pdfResult?.pdfDataUrl || null,
      settings.outputDir,
      settings.promptForSaveAs
    );

    recording.exportBaseName = exportBaseName;
    recording.lastExportAt = Date.now();
    recording.lastExportPrompted = settings.promptForSaveAs;
    recording.lastExportOperationId = sanitizeOperationId(operationId) || createOperationId('export');
    await updateRecordingCommitState(recording, COMMIT_STATES.DOWNLOAD_REQUESTED, {
      type: 'exportRecording',
      operationId,
      status: 'ready'
    });
    await upsertHistoryEntry(buildHistoryEntry(recording));
    await updateRecordingCommitState(recording, COMMIT_STATES.HISTORY_UPDATED, {
      type: 'upsertHistoryEntry',
      operationId,
      status: 'ready'
    });
    await updateRecordingCommitState(recording, COMMIT_STATES.COMPLETE, {
      type: 'exportRecording',
      operationId,
      status: 'ready'
    });
    await upsertHistoryEntry(buildHistoryEntry(recording));
  } catch (error) {
    await markRecordingRecoverableFailure(recording, error, 'exportRecording');
    throw error;
  }

  if (!S.currentRuntime.isRecording) {
    await closeOffscreenDocument();
  }
  notifyPopup('exported', { history: await getHistory() });
}
