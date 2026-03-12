let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let captureTimer = null;
let sessionStartAt = null;
let pausedDurationMs = 0;
let pauseStartedAt = null;
let autoCaptureEnabled = true;
let captureIntervalMs = 5000;
let audioStartError = '';

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
  captureIntervalMs = payload.intervalMs || 5000;
  autoCaptureEnabled = payload.autoCapture !== false;
  sessionStartAt = Date.now();
  pausedDurationMs = 0;
  pauseStartedAt = null;
  audioStartError = '';
  audioChunks = [];

  await stopMediaRecorder();
  await stopRecorderTracks();
  startCaptureTimer();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });
    mediaRecorder.start(1000);

    return { ok: true, audioStarted: true };
  } catch (error) {
    audioStartError = error.message || '麦克风权限被拒绝';
    mediaRecorder = null;
    await stopRecorderTracks();
    return { ok: true, audioStarted: false, error: audioStartError };
  }
}

function pauseSession() {
  pauseStartedAt = Date.now();
  stopCaptureTimer();

  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.pause();
  }
}

function resumeSession(payload = {}) {
  if (pauseStartedAt) {
    pausedDurationMs += Date.now() - pauseStartedAt;
  }

  pauseStartedAt = null;
  captureIntervalMs = payload.intervalMs || captureIntervalMs;
  autoCaptureEnabled = payload.autoCapture !== false;
  startCaptureTimer();

  if (mediaRecorder?.state === 'paused') {
    mediaRecorder.resume();
  }
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
  const mimeType = mediaRecorder?.mimeType || 'audio/webm';
  const audioBlob = await stopMediaRecorder();
  await stopRecorderTracks();

  sessionStartAt = null;
  pausedDurationMs = 0;
  pauseStartedAt = null;

  return {
    ok: true,
    audioDataUrl: audioBlob ? await blobToDataUrl(audioBlob) : null,
    mimeType,
    durationMs,
    size: audioBlob?.size || 0,
    error: audioBlob ? '' : audioStartError
  };
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

async function stopMediaRecorder() {
  if (!mediaRecorder) {
    return null;
  }

  const recorder = mediaRecorder;
  mediaRecorder = null;

  const blob = await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      resolve(audioChunks.length ? new Blob(audioChunks, { type: recorder.mimeType || 'audio/webm' }) : null);
    }, 4000);

    const handleStop = () => {
      clearTimeout(timeoutId);
      resolve(new Blob(audioChunks, { type: recorder.mimeType || 'audio/webm' }));
    };
    const handleError = (event) => reject(event.error || new Error('录音失败'));

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
    console.error('[Offscreen] Stop media recorder failed:', error);
    return null;
  });

  audioChunks = [];

  if (!blob || !blob.size) {
    return null;
  }

  return blob;
}

async function stopRecorderTracks() {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
  }

  mediaStream = null;
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
  const margin = 48;

  drawCoverPage(pdf, recording, { pageWidth, pageHeight, margin });

  for (let index = 0; index < recording.screenshots.length; index += 1) {
    pdf.addPage();
    drawStepPage(pdf, recording, recording.screenshots[index], {
      pageWidth,
      pageHeight,
      margin
    });
  }

  return {
    ok: true,
    pdfDataUrl: pdf.output('datauristring')
  };
}

function drawCoverPage(pdf, recording, layout) {
  const { pageWidth, margin } = layout;
  let cursorY = margin + 18;

  pdf.setFillColor(232, 241, 255);
  pdf.roundedRect(margin, margin, pageWidth - margin * 2, 150, 24, 24, 'F');

  pdf.setTextColor(22, 119, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text('Tutorial Recorder', margin + 24, cursorY);

  cursorY += 34;
  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(28);
  pdf.text(recording.title, margin + 24, cursorY);

  cursorY += 26;
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(71, 85, 105);
  pdf.setFontSize(13);
  const introLines = pdf.splitTextToSize(
    '自动整理的操作教程，包含步骤截图、时间点和讲解音频。建议和同目录下的 Markdown 与音频文件一起使用。',
    pageWidth - margin * 2 - 48
  );
  pdf.text(introLines, margin + 24, cursorY, { lineHeightFactor: 1.6 });

  cursorY = margin + 190;
  const cardWidth = (pageWidth - margin * 2 - 16) / 2;
  const metrics = [
    ['创建时间', new Date(recording.createdAt).toLocaleString()],
    ['录制时长', formatDuration(recording.durationMs || 0)],
    ['步骤数量', String(recording.screenshots.length)],
    ['音频导出', recording.audioAvailable ? '已包含' : '未生成']
  ];

  metrics.forEach(([label, value], index) => {
    const x = margin + (index % 2) * (cardWidth + 16);
    const y = cursorY + Math.floor(index / 2) * 116;
    drawMetricCard(pdf, x, y, cardWidth, 100, label, value);
  });

  const noteY = cursorY + 248;
  pdf.setFillColor(243, 247, 255);
  pdf.roundedRect(margin, noteY, pageWidth - margin * 2, 88, 18, 18, 'F');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(12);
  pdf.setTextColor(51, 65, 85);
  const noteLines = pdf.splitTextToSize(
    '导出的素材包括 tutorial.pdf、tutorial.md、audio/tutorial-audio.webm 和 screenshots/*.png。',
    pageWidth - margin * 2 - 32
  );
  pdf.text(noteLines, margin + 18, noteY + 28, { lineHeightFactor: 1.7 });
}

function drawStepPage(pdf, recording, screenshot, layout) {
  const { pageWidth, pageHeight, margin } = layout;

  pdf.setFillColor(248, 251, 255);
  pdf.roundedRect(margin, margin, pageWidth - margin * 2, pageHeight - margin * 2, 26, 26, 'F');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(22, 119, 255);
  pdf.text(`STEP ${screenshot.index}`, margin + 24, margin + 32);

  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(22);
  const titleLines = pdf.splitTextToSize(
    screenshot.description,
    pageWidth - margin * 2 - 120
  );
  pdf.text(titleLines, margin + 24, margin + 68, { lineHeightFactor: 1.3 });

  pdf.setFillColor(232, 241, 255);
  pdf.roundedRect(pageWidth - margin - 102, margin + 18, 78, 28, 14, 14, 'F');
  pdf.setTextColor(15, 94, 203);
  pdf.setFontSize(12);
  pdf.text(screenshot.timestampLabel, pageWidth - margin - 63, margin + 37, {
    align: 'center'
  });

  const bodyY = margin + 96 + Math.max(0, titleLines.length - 1) * 18;
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(margin + 24, bodyY, pageWidth - margin * 2 - 48, 64, 18, 18, 'F');
  pdf.setTextColor(71, 85, 105);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(12);
  const descriptionLines = pdf.splitTextToSize(
    screenshot.description,
    pageWidth - margin * 2 - 72
  );
  pdf.text(descriptionLines, margin + 40, bodyY + 24, { lineHeightFactor: 1.6 });

  const imageTop = bodyY + 92;
  const imageBoxX = margin + 24;
  const imageBoxY = imageTop;
  const imageBoxWidth = pageWidth - margin * 2 - 48;
  const imageBoxHeight = pageHeight - imageTop - margin - 58;
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(imageBoxX, imageBoxY, imageBoxWidth, imageBoxHeight, 20, 20, 'F');
  drawImageFit(pdf, screenshot.data, imageBoxX + 16, imageBoxY + 16, imageBoxWidth - 32, imageBoxHeight - 32);

  pdf.setFontSize(11);
  pdf.setTextColor(100, 116, 139);
  pdf.text(`录制时间线：${screenshot.timestampLabel}`, margin + 24, pageHeight - margin - 18);
  pdf.text(recording.title, pageWidth - margin - 24, pageHeight - margin - 18, { align: 'right' });
}

function drawMetricCard(pdf, x, y, width, height, label, value) {
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(219, 231, 255);
  pdf.roundedRect(x, y, width, height, 18, 18, 'FD');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(100, 116, 139);
  pdf.text(label, x + 16, y + 24);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.setTextColor(15, 23, 42);
  const valueLines = pdf.splitTextToSize(value, width - 32);
  pdf.text(valueLines, x + 16, y + 50, { lineHeightFactor: 1.4 });
}

function drawImageFit(pdf, dataUrl, x, y, maxWidth, maxHeight) {
  const { width, height } = pdf.getImageProperties(dataUrl);
  const scale = Math.min(maxWidth / width, maxHeight / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  const offsetX = x + (maxWidth - drawWidth) / 2;
  const offsetY = y + (maxHeight - drawHeight) / 2;
  pdf.addImage(dataUrl, 'PNG', offsetX, offsetY, drawWidth, drawHeight);
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
    reader.onerror = () => reject(reader.error || new Error('无法转换音频数据'));
    reader.readAsDataURL(blob);
  });
}
