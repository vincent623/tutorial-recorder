let audioRecorder = null;
let videoRecorder = null;
let microphoneStream = null;
let captureStream = null;
let audioChunks = [];
let videoChunks = [];
let audioChunkBytes = 0;
let videoChunkBytes = 0;
let captureTimer = null;
let sessionStartAt = null;
let sessionRecordingId = '';
let pausedDurationMs = 0;
let pauseStartedAt = null;
let autoCaptureEnabled = true;
let captureIntervalMs = 5000;
let captureMode = 'displayMedia';
let audioStartError = '';
let videoStartError = '';
let audioLimitWarning = '';
let videoLimitWarning = '';
let isStoppingSession = false;

const MAX_MEDIA_CHUNK_BYTES = Object.freeze({
  audio: 100 * 1024 * 1024,
  video: 400 * 1024 * 1024
});
const MEDIA_DB_NAME = 'tutorialRecorder';
const MEDIA_DB_VERSION = 2;
const MEDIA_ASSETS_STORE = 'assets';
const MEDIA_ASSETS_RECORDING_INDEX = 'recordingId';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.action !== 'offscreenMessage') {
    return false;
  }

  (async () => {
    switch (message.type) {
      case 'startSession':
        sendResponse(await startSession(message.payload));
        break;
      case 'pauseSession':
        pauseSession();
        sendResponse({ ok: true });
        break;
      case 'resumeSession':
        resumeSession(message.payload);
        sendResponse({ ok: true });
        break;
      case 'updateSession':
        updateSession(message.payload);
        sendResponse({ ok: true });
        break;
      case 'stopSession':
        sendResponse(await stopSession());
        break;
      case 'generatePdf':
        sendResponse(await generatePdf(message.payload.recording));
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown offscreen message' });
    }
  })().catch((error) => {
    console.error('[Offscreen] Action failed:', message.type, error);
    sendResponse({ ok: false, error: error.message || 'Unknown offscreen error' });
  });

  return true;
});

async function startSession(payload = {}) {
  captureMode = payload.captureMode === 'tabCapture' ? 'tabCapture' : 'displayMedia';
  captureIntervalMs = payload.intervalMs || 5000;
  autoCaptureEnabled = payload.autoCapture !== false;
  sessionStartAt = Date.now();
  sessionRecordingId = String(payload.recordingId || '').slice(0, 80);
  pausedDurationMs = 0;
  pauseStartedAt = null;
  audioStartError = '';
  videoStartError = '';
  audioLimitWarning = '';
  videoLimitWarning = '';
  audioChunks = [];
  videoChunks = [];
  audioChunkBytes = 0;
  videoChunkBytes = 0;
  isStoppingSession = false;

  await stopRecordersAndTracks();

  try {
    captureStream = await startCaptureStream(payload);
    attachTrackEndListeners(captureStream, 'video');
    videoRecorder = createRecorder(captureStream, 'video');
    if (videoRecorder) {
      videoRecorder.start(1000);
    }
  } catch (error) {
    videoStartError = describeCaptureError(error, captureMode);
    captureStream = null;
    videoRecorder = null;
  }

  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    attachTrackEndListeners(microphoneStream, 'audio');
    audioRecorder = createRecorder(microphoneStream, 'audio');
    if (audioRecorder) {
      audioRecorder.start(1000);
    } else {
      audioStartError = '当前浏览器无法启动音频录制';
    }
  } catch (error) {
    audioStartError = describeMicrophoneError(error);
    microphoneStream = null;
    audioRecorder = null;
  }

  startCaptureTimer();

  const audioStarted = Boolean(audioRecorder);
  const videoStarted = Boolean(videoRecorder);
  return {
    ok: true,
    audioStarted,
    videoStarted,
    captureMode,
    error: buildSessionWarning(audioStarted, videoStarted, audioStartError, videoStartError)
  };
}

function pauseSession() {
  pauseStartedAt = Date.now();
  stopCaptureTimer();

  pauseRecorder(audioRecorder);
  pauseRecorder(videoRecorder);
}

function resumeSession(payload = {}) {
  if (pauseStartedAt) {
    pausedDurationMs += Date.now() - pauseStartedAt;
  }

  pauseStartedAt = null;
  captureIntervalMs = payload.intervalMs || captureIntervalMs;
  autoCaptureEnabled = payload.autoCapture !== false;
  startCaptureTimer();

  resumeRecorder(audioRecorder);
  resumeRecorder(videoRecorder);
}

function updateSession(payload = {}) {
  captureIntervalMs = payload.intervalMs || captureIntervalMs;
  autoCaptureEnabled = payload.autoCapture !== false;

  if (payload.paused) {
    stopCaptureTimer();
  } else {
    startCaptureTimer();
  }
}

async function stopSession() {
  stopCaptureTimer();

  if (pauseStartedAt) {
    pausedDurationMs += Date.now() - pauseStartedAt;
    pauseStartedAt = null;
  }

  const durationMs = sessionStartAt ? Math.max(0, Date.now() - sessionStartAt - pausedDurationMs) : 0;
  const recordingId = sessionRecordingId;
  isStoppingSession = true;
  const audioMimeType = audioRecorder?.mimeType || 'audio/webm';
  const videoMimeType = videoRecorder?.mimeType || 'video/webm';
  const [audioBlob, videoBlob] = await Promise.all([
    stopRecorder(audioRecorder, audioChunks, 'audio/webm'),
    stopRecorder(videoRecorder, videoChunks, 'video/webm')
  ]);
  audioRecorder = null;
  videoRecorder = null;
  await stopRecordersAndTracks();
  isStoppingSession = false;

  sessionStartAt = null;
  sessionRecordingId = '';
  pausedDurationMs = 0;
  pauseStartedAt = null;

  const audioAsset = audioBlob
    ? await writeMediaAsset(recordingId, 'audio', audioBlob, durationMs).catch((error) => {
        console.error('[Offscreen] Persist audio asset failed:', error);
        return null;
      })
    : null;
  const videoAsset = videoBlob
    ? await writeMediaAsset(recordingId, 'video', videoBlob, durationMs).catch((error) => {
        console.error('[Offscreen] Persist video asset failed:', error);
        return null;
      })
    : null;

  const audioError = audioAsset ? '' : audioStartError || audioLimitWarning || (audioBlob ? '音频写入本地存储失败' : '');
  const videoError = videoAsset ? '' : videoStartError || videoLimitWarning || (videoBlob ? '视频写入本地存储失败' : '');

  return {
    ok: true,
    audioAssetId: audioAsset?.id || '',
    audioMimeType: audioAsset?.mimeType || audioMimeType,
    audioDurationMs: durationMs,
    audioSize: audioAsset?.size || audioBlob?.size || 0,
    audioError,
    audioLimitWarning,
    videoAssetId: videoAsset?.id || '',
    videoMimeType: videoAsset?.mimeType || videoMimeType,
    videoDurationMs: durationMs,
    videoSize: videoAsset?.size || videoBlob?.size || 0,
    videoError,
    videoLimitWarning
  };
}

async function writeMediaAsset(recordingId, kind, blob, durationMs) {
  if (!recordingId) {
    throw new Error('缺少录制 ID，无法保存媒体');
  }

  const dataUrl = await blobToDataUrl(blob);
  const now = Date.now();
  const asset = {
    id: [
      recordingId,
      'asset',
      kind,
      now.toString(36),
      Math.random().toString(36).slice(2, 10)
    ].join(':'),
    recordingId,
    kind,
    dataUrl,
    mimeType: blob.type || (kind === 'audio' ? 'audio/webm' : 'video/webm'),
    size: blob.size,
    durationMs,
    createdAt: now,
    updatedAt: now
  };

  await putMediaAsset(asset);
  return asset;
}

function putMediaAsset(asset) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MEDIA_ASSETS_STORE)) {
        const assetsStore = db.createObjectStore(MEDIA_ASSETS_STORE, { keyPath: 'id' });
        assetsStore.createIndex(MEDIA_ASSETS_RECORDING_INDEX, 'recordingId', { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      let putRequest;

      try {
        const transaction = db.transaction(MEDIA_ASSETS_STORE, 'readwrite');
        putRequest = transaction.objectStore(MEDIA_ASSETS_STORE).put(asset);
      } catch (error) {
        db.close();
        reject(error);
        return;
      }

      putRequest.onsuccess = () => {
        db.close();
        resolve(asset);
      };
      putRequest.onerror = () => {
        db.close();
        reject(putRequest.error || new Error('媒体写入失败'));
      };
    };

    request.onerror = () => reject(request.error || new Error('无法打开本地存储'));
  });
}

function startCaptureTimer() {
  stopCaptureTimer();

  if (!autoCaptureEnabled) {
    return;
  }

  captureTimer = setInterval(() => {
    chrome.runtime.sendMessage({ action: 'offscreenCaptureTick' }).catch((error) => {
      console.warn('[Offscreen] Capture tick failed:', error);
    });
  }, captureIntervalMs);
}

function stopCaptureTimer() {
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }
}

async function stopRecorder(recorder, chunks, fallbackMimeType) {
  if (!recorder) {
    return null;
  }

  const blob = await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || fallbackMimeType }) : null);
    }, 4000);

    const handleStop = () => {
      clearTimeout(timeoutId);
      resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || fallbackMimeType }) : null);
    };
    const handleError = (event) => reject(event.error || new Error('媒体录制失败'));

    recorder.addEventListener('stop', handleStop, { once: true });
    recorder.addEventListener('error', handleError, { once: true });

    if (recorder.state === 'inactive') {
      handleStop();
      return;
    }

    if (recorder.state === 'paused') {
      try {
        recorder.resume();
      } catch (error) {
        console.warn('[Offscreen] Resume before stop failed:', error);
      }
    }

    setTimeout(() => {
      try {
        recorder.requestData();
      } catch (error) {
        console.warn('[Offscreen] requestData failed:', error);
      }

      try {
        recorder.stop();
      } catch (error) {
        reject(error);
      }
    }, 50);
  }).catch((error) => {
    console.error('[Offscreen] Stop recorder failed:', error);
    return null;
  });

  if (!blob || !blob.size) {
    return null;
  }

  return blob;
}

function pauseRecorder(recorder) {
  if (recorder?.state === 'recording') {
    recorder.pause();
  }
}

function resumeRecorder(recorder) {
  if (recorder?.state === 'paused') {
    recorder.resume();
  }
}

function createRecorder(stream, kind) {
  if (!stream) {
    return null;
  }

  const mimeType = getPreferredMimeType(kind);
  let recorder;

  if (mimeType) {
    const options = { mimeType };
    if (kind === 'video') {
      options.videoBitsPerSecond = 1_800_000;
    } else {
      options.audioBitsPerSecond = 128_000;
    }
    recorder = new MediaRecorder(stream, options);
  } else {
    recorder = new MediaRecorder(stream);
  }

  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size <= 0) {
      return;
    }

    if (kind === 'audio') {
      audioChunks.push(event.data);
      audioChunkBytes += event.data.size;
      if (audioChunkBytes > MAX_MEDIA_CHUNK_BYTES.audio) {
        enforceMediaLimit('audio');
      }
      return;
    }

    videoChunks.push(event.data);
    videoChunkBytes += event.data.size;
    if (videoChunkBytes > MAX_MEDIA_CHUNK_BYTES.video) {
      enforceMediaLimit('video');
    }
  });

  return recorder;
}

function enforceMediaLimit(kind) {
  const recorder = kind === 'audio' ? audioRecorder : videoRecorder;
  if (!recorder || recorder.state === 'inactive') {
    return;
  }

  const limitLabel = formatMediaLimit(kind);
  if (kind === 'audio') {
    audioLimitWarning = `音频体积超过 ${limitLabel} 保护上限，已提前结束音频录制；截图和其余素材不受影响。`;
  } else {
    videoLimitWarning = `视频体积超过 ${limitLabel} 保护上限，已提前结束视频录制；截图和其余素材不受影响。`;
  }

  try {
    recorder.stop();
  } catch (error) {
    console.warn('[Offscreen] Stop on media limit failed:', error);
  }

  chrome.runtime
    .sendMessage({
      action: 'offscreenMediaUpdated',
      payload: {
        audioStarted: kind === 'audio' ? false : Boolean(audioRecorder && audioRecorder.state !== 'inactive'),
        videoStarted: kind === 'video' ? false : Boolean(videoRecorder && videoRecorder.state !== 'inactive'),
        message: kind === 'audio' ? audioLimitWarning : videoLimitWarning
      }
    })
    .catch(() => {});
}

function formatMediaLimit(kind) {
  const bytes = MAX_MEDIA_CHUNK_BYTES[kind];
  return bytes >= 1024 * 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024 * 1024))}GB`
    : `${Math.round(bytes / (1024 * 1024))}MB`;
}

function getPreferredMimeType(kind) {
  const candidates =
    kind === 'video'
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['audio/webm;codecs=opus', 'audio/webm'];

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

async function startCaptureStream(payload = {}) {
  if (captureMode === 'tabCapture') {
    if (!payload.captureStreamId) {
      throw new Error('未取得当前标签页的录制流 ID');
    }

    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: payload.captureStreamId,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 15
        }
      }
    });
  }

  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: {
        ideal: 12,
        max: 15
      },
      width: {
        ideal: 1440,
        max: 1920
      },
      height: {
        ideal: 900,
        max: 1080
      }
    },
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'include',
    systemAudio: 'include'
  });
}

async function stopRecordersAndTracks() {
  stopStreamTracks(microphoneStream);
  stopStreamTracks(captureStream);
  microphoneStream = null;
  captureStream = null;
  audioChunks = [];
  videoChunks = [];
  audioChunkBytes = 0;
  videoChunkBytes = 0;
}

function stopStreamTracks(stream) {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function describeCaptureError(error, mode) {
  if (error?.name === 'NotAllowedError') {
    return mode === 'tabCapture' ? '当前标签页视频授权被拒绝' : '共享画面授权被取消';
  }

  if (error?.name === 'NotFoundError') {
    return mode === 'tabCapture' ? '没有可录制的标签页画面' : '没有找到可共享的画面';
  }

  return error?.message || '视频录制启动失败';
}

function describeMicrophoneError(error) {
  if (error?.name === 'NotAllowedError') {
    return '麦克风权限被拒绝';
  }

  if (error?.name === 'NotFoundError') {
    return '没有检测到可用麦克风';
  }

  return error?.message || '音频录制启动失败';
}

function buildSessionWarning(audioStarted, videoStarted, audioError, videoError) {
  const issues = [];

  if (!videoStarted && videoError) {
    issues.push(`视频未启动：${videoError}`);
  }

  if (!audioStarted && audioError) {
    issues.push(`音频未启动：${audioError}`);
  }

  return issues.join('；');
}

function attachTrackEndListeners(stream, kind) {
  const sessionToken = sessionStartAt;

  for (const track of stream.getTracks()) {
    track.addEventListener(
      'ended',
      () => {
        handleTrackEnded(kind, sessionToken).catch((error) => {
          console.warn('[Offscreen] Track end handler failed:', error);
        });
      },
      { once: true }
    );
  }
}

async function handleTrackEnded(kind, sessionToken) {
  if (isStoppingSession || sessionToken !== sessionStartAt) {
    return;
  }

  const audioStarted = hasLiveTracks(microphoneStream, 'audio') && Boolean(audioRecorder);
  const videoStarted = hasLiveTracks(captureStream, 'video') && Boolean(videoRecorder);
  const message =
    kind === 'video'
      ? '共享画面已结束，后续会继续记录截图和可用音频。'
      : '麦克风采集已结束，后续会继续记录视频和截图。';

  await chrome.runtime
    .sendMessage({
      action: 'offscreenMediaUpdated',
      payload: {
        audioStarted,
        videoStarted,
        message
      }
    })
    .catch(() => {});
}

function hasLiveTracks(stream, kind) {
  if (!stream) {
    return false;
  }

  const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
  return tracks.some((track) => track.readyState === 'live');
}

async function generatePdf(recording) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const coverCanvas = await renderCoverPage(recording);
  pdf.addImage(coverCanvas, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');

  for (let index = 0; index < recording.screenshots.length; index += 1) {
    pdf.addPage();
    const pageCanvas = await renderStepPage(recording, recording.screenshots[index]);
    pdf.addImage(pageCanvas, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
  }

  return {
    ok: true,
    pdfDataUrl: pdf.output('datauristring')
  };
}

async function renderCoverPage(recording) {
  const { canvas, ctx, width, height } = createPageCanvas();
  const margin = 88;

  drawPageBackground(ctx, width, height);
  drawRoundedRect(ctx, margin, margin, width - margin * 2, 300, 34, '#e8f1ff');

  ctx.fillStyle = '#1677ff';
  ctx.font = `700 28px ${getCanvasFontFamily()}`;
  ctx.fillText('Tutorial Recorder', margin + 40, margin + 58);

  ctx.fillStyle = '#0f172a';
  const coverTitle = recording.title || '教程录制';
  const titleLines = wrapText(ctx, coverTitle, width - margin * 2 - 80, '700 60px');
  drawTextLines(ctx, titleLines, margin + 40, margin + 132, 74, '700 60px', '#0f172a');

  const introLines = wrapText(
    ctx,
    '自动整理的操作教程，包含步骤截图、时间点、讲解音频和录制视频。建议和同目录下的 Markdown、音频、视频文件一起使用。',
    width - margin * 2 - 80,
    '400 28px'
  );
  drawTextLines(ctx, introLines, margin + 40, margin + 210, 42, '400 28px', '#475569');

  const cardTop = margin + 360;
  const cardWidth = (width - margin * 2 - 28) / 2;
  const metrics = [
    ['创建时间', new Date(recording.createdAt).toLocaleString()],
    ['录制时长', formatDuration(recording.durationMs || 0)],
    ['步骤数量', String(recording.screenshots.length)],
    ['媒体导出', recording.videoAvailable ? '音频 + 视频' : recording.audioAvailable ? '仅音频' : '未生成']
  ];

  metrics.forEach(([label, value], index) => {
    const x = margin + (index % 2) * (cardWidth + 28);
    const y = cardTop + Math.floor(index / 2) * 168;
    drawMetricCard(ctx, x, y, cardWidth, 138, label, value);
  });

  const noteY = cardTop + 352;
  drawRoundedRect(ctx, margin, noteY, width - margin * 2, 180, 28, '#f3f7ff');
  const noteLines = wrapText(
    ctx,
    '导出的素材包括 tutorial.pdf、tutorial.md、audio/tutorial-audio.webm、video/tutorial-video.webm 和 screenshots/*.png。',
    width - margin * 2 - 48,
    '400 26px'
  );
  drawTextLines(ctx, noteLines, margin + 28, noteY + 52, 40, '400 26px', '#334155');

  return canvas;
}

async function renderStepPage(recording, screenshot) {
  const { canvas, ctx, width, height } = createPageCanvas();
  const margin = 72;

  drawPageBackground(ctx, width, height);
  drawRoundedRect(ctx, margin, margin, width - margin * 2, height - margin * 2, 34, '#f8fbff');

  ctx.fillStyle = '#1677ff';
  ctx.font = `700 28px ${getCanvasFontFamily()}`;
  ctx.fillText(`STEP ${screenshot.index}`, margin + 38, margin + 52);

  const badgeWidth = 168;
  drawRoundedRect(ctx, width - margin - badgeWidth - 32, margin + 18, badgeWidth, 54, 27, '#e8f1ff');
  ctx.fillStyle = '#0f5ecb';
  ctx.font = `600 24px ${getCanvasFontFamily()}`;
  ctx.textAlign = 'center';
  ctx.fillText(screenshot.timestampLabel, width - margin - badgeWidth / 2 - 32, margin + 53);
  ctx.textAlign = 'left';

  const title = screenshot.description || `步骤 ${screenshot.index}`;
  const titleLines = wrapText(ctx, title, width - margin * 2 - 210, '700 52px');
  drawTextLines(ctx, titleLines, margin + 38, margin + 120, 62, '700 52px', '#0f172a');

  const titleHeight = titleLines.length * 62;
  const summaryY = margin + 150 + titleHeight;
  drawRoundedRect(ctx, margin + 38, summaryY, width - margin * 2 - 76, 126, 28, '#ffffff');
  const summaryLines = wrapText(ctx, title, width - margin * 2 - 132, '400 28px');
  drawTextLines(ctx, summaryLines, margin + 62, summaryY + 42, 40, '400 28px', '#475569');

  const imageBoxX = margin + 38;
  const imageBoxY = summaryY + 156;
  const imageBoxWidth = width - margin * 2 - 76;
  const imageBoxHeight = height - imageBoxY - margin - 80;
  drawRoundedRect(ctx, imageBoxX, imageBoxY, imageBoxWidth, imageBoxHeight, 30, '#ffffff');
  await drawCanvasImageFit(ctx, screenshot.data, imageBoxX + 18, imageBoxY + 18, imageBoxWidth - 36, imageBoxHeight - 36);

  ctx.fillStyle = '#64748b';
  ctx.font = `400 22px ${getCanvasFontFamily()}`;
  ctx.fillText(`录制时间线：${screenshot.timestampLabel}`, margin + 38, height - margin - 24);
  ctx.textAlign = 'right';
  ctx.fillText(recording.title, width - margin - 38, height - margin - 24);
  ctx.textAlign = 'left';

  return canvas;
}

function createPageCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  return {
    canvas,
    ctx: canvas.getContext('2d'),
    width: canvas.width,
    height: canvas.height
  };
}

function drawPageBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#f9fbff');
  gradient.addColorStop(1, '#f2f6fb');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();
}

function drawMetricCard(ctx, x, y, width, height, label, value) {
  drawRoundedRect(ctx, x, y, width, height, 24, '#ffffff');
  ctx.strokeStyle = '#dbe7ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
  ctx.fillStyle = '#64748b';
  ctx.font = `400 22px ${getCanvasFontFamily()}`;
  ctx.fillText(label, x + 22, y + 34);
  const valueLines = wrapText(ctx, value, width - 44, '700 34px');
  drawTextLines(ctx, valueLines, x + 22, y + 82, 46, '700 34px', '#0f172a');
}

function wrapText(ctx, text, maxWidth, fontShorthand) {
  ctx.save();
  ctx.font = `${fontShorthand} ${getCanvasFontFamily()}`;
  const raw = String(text || '').replace(/\s+/g, ' ').trim() || ' ';
  const lines = [];
  let current = '';

  for (const char of raw) {
    const next = current + char;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = char;
  }

  if (current) {
    lines.push(current);
  }

  ctx.restore();
  return lines;
}

function drawTextLines(ctx, lines, x, y, lineHeight, fontShorthand, color) {
  ctx.save();
  ctx.font = `${fontShorthand} ${getCanvasFontFamily()}`;
  ctx.fillStyle = color;
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
  ctx.restore();
}

async function drawCanvasImageFit(ctx, dataUrl, x, y, maxWidth, maxHeight) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = x + (maxWidth - drawWidth) / 2;
  const offsetY = y + (maxHeight - drawHeight) / 2;
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法加载截图用于 PDF 导出'));
    image.src = dataUrl;
  });
}

function getCanvasFontFamily() {
  return '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('无法转换媒体数据'));
    reader.readAsDataURL(blob);
  });
}
