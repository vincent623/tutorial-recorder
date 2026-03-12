const $ = (id) => document.getElementById(id);
const DEFAULT_OUTPUT_DIR = 'tutorial-recorder';

const elements = {
  status: $('status'),
  statusText: $('status').querySelector('.status-text'),
  btnStart: $('btnStart'),
  btnPause: $('btnPause'),
  btnStop: $('btnStop'),
  btnCapture: $('btnCapture'),
  screenshotCount: $('screenshotCount'),
  recordTime: $('recordTime'),
  audioStatus: $('audioStatus'),
  apiKey: $('apiKey'),
  endpointId: $('endpointId'),
  outputDir: $('outputDir'),
  outputPreviewValue: $('outputPreviewValue'),
  outputPreviewHint: $('outputPreviewHint'),
  btnResetDir: $('btnResetDir'),
  promptForSaveAs: $('promptForSaveAs'),
  interval: $('interval'),
  autoScreenshot: $('autoScreenshot'),
  historyList: $('historyList')
};

let state = createIdleState();
let historyItems = [];
let timer = null;

document.addEventListener('DOMContentLoaded', async () => {
  await hydrate();
  bindEvents();
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
});

function createIdleState() {
  return {
    isRecording: false,
    isPaused: false,
    isGenerating: false,
    count: 0,
    startTime: null,
    pausedDurationMs: 0,
    pauseStartedAt: null,
    elapsedMs: 0,
    audioStatus: '待启动',
    recordingId: null
  };
}

async function hydrate() {
  const snapshot = await sendAction('getPopupState');

  if (!snapshot?.ok) {
    elements.statusText.textContent = '初始化失败';
    return;
  }

  applySettingsToForm(snapshot.settings);

  state = {
    ...createIdleState(),
    ...snapshot.runtime,
    audioStatus: snapshot.runtime?.isGenerating
      ? '处理中'
      : snapshot.runtime?.isPaused
        ? '已暂停'
        : snapshot.runtime?.isRecording
          ? '录音中'
          : '待启动'
  };

  historyItems = snapshot.history || [];
  renderHistory(historyItems);
  updateUi();
}

function bindEvents() {
  elements.apiKey.addEventListener('change', saveSettings);
  elements.endpointId.addEventListener('change', saveSettings);
  elements.outputDir.addEventListener('input', updateOutputPreview);
  elements.outputDir.addEventListener('change', saveSettings);
  elements.btnResetDir.addEventListener('click', resetOutputDir);
  elements.promptForSaveAs.addEventListener('change', handlePromptForSaveAsChange);
  elements.interval.addEventListener('change', saveSettings);
  elements.autoScreenshot.addEventListener('change', saveSettings);

  elements.btnStart.addEventListener('click', startRecording);
  elements.btnPause.addEventListener('click', togglePause);
  elements.btnStop.addEventListener('click', stopRecording);
  elements.btnCapture.addEventListener('click', captureManually);
  elements.historyList.addEventListener('click', handleHistoryAction);
}

async function saveSettings() {
  const result = await sendAction('saveSettings', {
    settings: {
      apiKey: elements.apiKey.value.trim(),
      endpointId: elements.endpointId.value.trim(),
      outputDir: elements.outputDir.value.trim(),
      promptForSaveAs: elements.promptForSaveAs.checked,
      screenshotInterval: parseInt(elements.interval.value, 10),
      autoScreenshot: elements.autoScreenshot.checked
    }
  });

  if (result?.ok && result.settings) {
    applySettingsToForm(result.settings);
  }

  return result;
}

async function handlePromptForSaveAsChange() {
  updateOutputPreview();
  await saveSettings();
}

async function startRecording() {
  await saveSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    alert('未找到当前活动标签页');
    return;
  }

  const result = await sendAction('startRecording', { tabId: tab.id });
  if (!result?.ok) {
    alert(`开始录制失败：${result?.error || '未知错误'}`);
  }
}

async function togglePause() {
  const action = state.isPaused ? 'resumeRecording' : 'pauseRecording';
  const result = await sendAction(action);

  if (!result?.ok) {
    alert(`${state.isPaused ? '恢复' : '暂停'}录制失败：${result?.error || '未知错误'}`);
  }
}

async function stopRecording() {
  const result = await sendAction('stopRecording');
  if (!result?.ok) {
    alert(`停止录制失败：${result?.error || '未知错误'}`);
  }
}

async function captureManually() {
  const result = await sendAction('manualCapture');
  if (!result?.ok) {
    alert(`截图失败：${result?.error || '当前没有活动录制'}`);
  }
}

async function resetOutputDir() {
  elements.outputDir.value = DEFAULT_OUTPUT_DIR;
  await saveSettings();
}

async function handleHistoryAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const { id, action } = button.dataset;
  if (!id || !action) {
    return;
  }

  if (action === 'delete') {
    const confirmed = window.confirm('确定删除这条历史记录吗？');
    if (!confirmed) {
      return;
    }
  }

  const result = await sendAction(action === 'export' ? 'downloadRecording' : 'deleteRecording', { id });
  if (!result?.ok) {
    alert(`${action === 'export' ? '重新导出' : '删除'}失败：${result?.error || '未知错误'}`);
  }
}

function handleRuntimeMessage(message) {
  switch (message.action) {
    case 'started':
      state.isRecording = true;
      state.isPaused = false;
      state.isGenerating = false;
      state.count = message.count || 0;
      state.startTime = message.startTime || Date.now();
      state.recordingId = message.recordingId || state.recordingId;
      state.pausedDurationMs = 0;
      state.pauseStartedAt = null;
      state.audioStatus = message.audioStarted === false ? '未授权' : '录音中';
      break;
    case 'screenshot':
      state.count = message.count ?? state.count;
      state.elapsedMs = message.elapsedMs ?? state.elapsedMs;
      break;
    case 'paused':
      state.isPaused = true;
      state.pauseStartedAt = Date.now();
      state.audioStatus = '已暂停';
      break;
    case 'resumed':
      if (state.pauseStartedAt) {
        state.pausedDurationMs += Date.now() - state.pauseStartedAt;
      }
      state.isPaused = false;
      state.pauseStartedAt = null;
      state.audioStatus = '录音中';
      break;
    case 'stopped':
      state.elapsedMs = getElapsedMs();
      state.isRecording = false;
      state.isPaused = false;
      state.audioStatus = '处理中';
      break;
    case 'generating':
      state.isGenerating = true;
      elements.status.className = 'status processing';
      elements.statusText.textContent = message.message || '正在生成教程...';
      break;
    case 'complete':
      state = createIdleState();
      state.audioStatus = '已导出';
      historyItems = message.history || [];
      renderHistory(historyItems);
      break;
    case 'historyUpdated':
      historyItems = message.history || [];
      renderHistory(historyItems);
      break;
    case 'warning':
      if ((message.message || '').includes('录音')) {
        state.audioStatus = '未授权';
      }
      elements.statusText.textContent = message.message || '提示';
      break;
    case 'error':
      alert(`错误：${message.message || '未知错误'}`);
      break;
    default:
      return;
  }

  updateUi();
}

function updateUi() {
  elements.screenshotCount.textContent = String(state.count || 0);
  elements.audioStatus.textContent = state.audioStatus;
  elements.recordTime.textContent = formatDuration(getElapsedMs());

  elements.status.className = 'status';

  if (state.isGenerating) {
    elements.status.classList.add('processing');
    elements.statusText.textContent = '正在生成教程...';
  } else if (state.isRecording && state.isPaused) {
    elements.status.classList.add('paused');
    elements.statusText.textContent = '已暂停';
  } else if (state.isRecording) {
    elements.status.classList.add('recording');
    elements.statusText.textContent = '录制中';
  } else {
    elements.statusText.textContent = '等待开始';
  }

  elements.btnStart.disabled = state.isRecording || state.isGenerating;
  elements.btnPause.disabled = !state.isRecording || state.isGenerating;
  elements.btnStop.disabled = !state.isRecording || state.isGenerating;
  elements.btnCapture.disabled = !state.isRecording || state.isPaused || state.isGenerating;
  elements.btnPause.textContent = state.isPaused ? '继续' : '暂停';

  renderHistory(historyItems);
  updateOutputPreview();
  restartTimer();
}

function applySettingsToForm(settings = {}) {
  elements.apiKey.value = settings.apiKey || '';
  elements.endpointId.value = settings.endpointId || '';
  elements.outputDir.value = settings.outputDir || DEFAULT_OUTPUT_DIR;
  elements.promptForSaveAs.checked = settings.promptForSaveAs === true;
  elements.interval.value = settings.screenshotInterval || 5;
  elements.autoScreenshot.checked = settings.autoScreenshot !== false;
  updateOutputPreview();
}

function restartTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  if (!state.isRecording || state.isPaused) {
    elements.recordTime.textContent = formatDuration(getElapsedMs());
    return;
  }

  timer = setInterval(() => {
    elements.recordTime.textContent = formatDuration(getElapsedMs());
  }, 1000);
}

function getElapsedMs() {
  if (!state.isRecording || !state.startTime) {
    return state.elapsedMs || 0;
  }

  let elapsed = Date.now() - state.startTime - (state.pausedDurationMs || 0);
  if (state.isPaused && state.pauseStartedAt) {
    elapsed -= Date.now() - state.pauseStartedAt;
  }

  return Math.max(0, elapsed);
}

function renderHistory(history) {
  historyItems = history;

  if (!history.length) {
    elements.historyList.innerHTML = '<p class="empty">暂无录制记录</p>';
    return;
  }

  const busy = state.isRecording || state.isGenerating;

  elements.historyList.innerHTML = history
    .map(
      (item) => `
        <article class="history-item">
          <div class="history-main">
            <div>
              <div class="history-title">${escapeHtml(item.title || '未命名教程')}</div>
              <div class="history-meta">
                ${new Date(item.createdAt).toLocaleString()} · ${item.screenshotCount} 张截图 · ${formatDuration(item.durationMs || 0)}
              </div>
              ${renderExportMeta(item)}
            </div>
          </div>
          <div class="history-actions">
            <button class="btn-export" data-action="export" data-id="${item.id}" ${busy ? 'disabled' : ''}>重新导出</button>
            <button class="btn-delete" data-action="delete" data-id="${item.id}" ${busy ? 'disabled' : ''}>删除</button>
          </div>
        </article>
      `
    )
    .join('');
}

function renderExportMeta(item) {
  const exportBaseName = typeof item.exportBaseName === 'string' ? item.exportBaseName.trim() : '';
  if (!exportBaseName) {
    return '';
  }

  const fullPath = `Downloads/${exportBaseName}`;
  const text = item.lastExportPrompted
    ? `上次导出：手动选择保存位置（默认建议 ${fullPath}）`
    : `上次导出：${fullPath}`;

  return `<div class="history-export">${escapeHtml(text)}</div>`;
}

function updateOutputPreview() {
  if (!elements.outputPreviewValue || !elements.outputPreviewHint) {
    return;
  }

  elements.outputPreviewValue.textContent = buildOutputPreviewPath();
  elements.outputPreviewHint.textContent = elements.promptForSaveAs.checked
    ? '开启询问后，Chrome 会以这个目录作为默认建议位置。'
    : '导出时会在下载目录下创建这一层目录。';
}

function buildOutputPreviewPath() {
  const outputDir = sanitizeOutputDir(elements.outputDir.value.trim());
  const bundleName = buildPreviewBundleName(outputDir);
  return `Downloads/${bundleName}`;
}

function buildPreviewBundleName(outputDir) {
  const prefix = outputDir || DEFAULT_OUTPUT_DIR;
  if (!state.recordingId || !state.startTime) {
    return `${prefix}/tutorial-YYYYMMDD-HHMMSS-录制ID`;
  }

  return `${prefix}/tutorial-${formatBundleStamp(state.startTime)}-${state.recordingId}`;
}

function formatBundleStamp(timestamp) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join('');
}

function sanitizeOutputDir(value) {
  const raw = typeof value === 'string' && value.trim() ? value : DEFAULT_OUTPUT_DIR;
  const normalized = raw.replaceAll('\\', '/').trim();
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[<>:"|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return segments.join('/') || DEFAULT_OUTPUT_DIR;
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

function sendAction(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, ...payload });
}
