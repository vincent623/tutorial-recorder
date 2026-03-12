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
  historyList: $('historyList'),
  detailPanel: $('detailPanel'),
  detailStatus: $('detailStatus'),
  detailContent: $('detailContent'),
  detailTitle: $('detailTitle'),
  detailMeta: $('detailMeta'),
  detailExportPath: $('detailExportPath'),
  detailSteps: $('detailSteps'),
  btnCloseDetail: $('btnCloseDetail'),
  btnSaveDetail: $('btnSaveDetail'),
  btnDetailExport: $('btnDetailExport')
};

let state = createIdleState();
let historyItems = [];
let detailState = createDetailState();
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

function createDetailState() {
  return {
    openId: null,
    loading: false,
    saving: false,
    original: null,
    draft: null,
    statusMessage: ''
  };
}

function cloneRecordingDetail(recording) {
  if (!recording) {
    return null;
  }

  return {
    ...recording,
    screenshots: Array.isArray(recording.screenshots)
      ? recording.screenshots.map((screenshot) => ({ ...screenshot }))
      : []
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
  renderDetailPanel();
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

  elements.btnCloseDetail.addEventListener('click', closeDetail);
  elements.btnSaveDetail.addEventListener('click', saveDetail);
  elements.btnDetailExport.addEventListener('click', exportDetail);
  elements.detailTitle.addEventListener('input', handleDetailInput);
  elements.detailSteps.addEventListener('input', handleDetailInput);
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
  updateOutputPreview();
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

  if (action === 'details') {
    await openDetail(id);
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
    return;
  }

  if (action === 'delete' && detailState.openId === id) {
    closeDetail();
  }
}

async function openDetail(id) {
  detailState = {
    ...createDetailState(),
    openId: id,
    loading: true,
    statusMessage: '正在加载教程详情...'
  };
  renderHistory(historyItems);
  renderDetailPanel();

  const result = await sendAction('getRecordingDetail', { id });
  if (!result?.ok || !result.recording) {
    detailState = createDetailState();
    renderHistory(historyItems);
    renderDetailPanel();
    alert(`读取历史记录失败：${result?.error || '未知错误'}`);
    return;
  }

  detailState = {
    openId: id,
    loading: false,
    saving: false,
    original: cloneRecordingDetail(result.recording),
    draft: cloneRecordingDetail(result.recording),
    statusMessage: '可直接修改标题和步骤说明，保存后导出新的 ZIP。'
  };
  renderHistory(historyItems);
  renderDetailPanel();
}

function closeDetail() {
  detailState = createDetailState();
  renderHistory(historyItems);
  renderDetailPanel();
}

function handleDetailInput(event) {
  if (!detailState.draft) {
    return;
  }

  if (event.target === elements.detailTitle) {
    detailState.draft.title = event.target.value;
  }

  const stepIndex = Number.parseInt(event.target.dataset.stepIndex || '', 10);
  if (!Number.isNaN(stepIndex) && detailState.draft.screenshots[stepIndex]) {
    detailState.draft.screenshots[stepIndex].description = event.target.value;
  }

  syncDetailActionState('已修改，记得保存后再导出。');
}

async function saveDetail() {
  if (!detailState.draft || !detailState.openId || detailState.saving) {
    return;
  }

  detailState.saving = true;
  syncDetailActionState('正在保存修改...');

  const result = await sendAction('updateRecording', {
    id: detailState.openId,
    updates: {
      title: detailState.draft.title,
      screenshots: detailState.draft.screenshots.map((screenshot) => ({
        description: screenshot.description
      }))
    }
  });

  detailState.saving = false;

  if (!result?.ok || !result.recording) {
    syncDetailActionState('保存失败，请稍后重试。');
    alert(`保存失败：${result?.error || '未知错误'}`);
    return;
  }

  historyItems = result.history || historyItems;
  detailState.original = cloneRecordingDetail(result.recording);
  detailState.draft = cloneRecordingDetail(result.recording);
  detailState.statusMessage = '修改已保存，可直接导出新的 ZIP。';
  renderHistory(historyItems);
  renderDetailPanel();
}

async function exportDetail() {
  if (!detailState.openId) {
    return;
  }

  if (isDetailDirty()) {
    await saveDetail();
    if (isDetailDirty()) {
      return;
    }
  }

  syncDetailActionState('正在导出 ZIP...');
  const result = await sendAction('downloadRecording', { id: detailState.openId });
  if (!result?.ok) {
    syncDetailActionState('导出失败，请稍后重试。');
    alert(`导出失败：${result?.error || '未知错误'}`);
    return;
  }

  detailState.statusMessage = 'ZIP 导出完成，可以直接发出。';
  renderDetailPanel();
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
      if (detailState.openId && !historyItems.some((item) => item.id === detailState.openId)) {
        closeDetail();
      }
      break;
    case 'historyUpdated':
      historyItems = message.history || [];
      if (detailState.openId && !historyItems.some((item) => item.id === detailState.openId)) {
        closeDetail();
      }
      break;
    case 'exported':
      state.isGenerating = false;
      historyItems = message.history || [];
      if (detailState.draft) {
        detailState.statusMessage = 'ZIP 导出完成，可以直接发出。';
      }
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
  updateDetailBusyState();
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
        <article class="history-item ${detailState.openId === item.id ? 'is-selected' : ''}">
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
            <button class="btn-view" data-action="details" data-id="${item.id}" ${busy ? 'disabled' : ''}>查看</button>
            <button class="btn-export" data-action="export" data-id="${item.id}" ${busy ? 'disabled' : ''}>导出</button>
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

  const text = item.lastExportPrompted
    ? `上次导出：手动选择保存位置（默认建议 ${formatDownloadsPath(exportBaseName)}）`
    : `上次导出：${formatDownloadsPath(exportBaseName)}`;

  return `<div class="history-export">${escapeHtml(text)}</div>`;
}

function renderDetailPanel() {
  const hasPanel = detailState.loading || detailState.draft;
  elements.detailPanel.hidden = !hasPanel;

  if (!hasPanel) {
    elements.detailContent.hidden = true;
    elements.detailStatus.textContent = '选择一条历史记录后可查看和编辑教程。';
    elements.detailMeta.innerHTML = '';
    elements.detailExportPath.textContent = '';
    elements.detailSteps.innerHTML = '';
    return;
  }

  if (detailState.loading || !detailState.draft) {
    elements.detailContent.hidden = true;
    elements.detailStatus.textContent = detailState.statusMessage || '正在加载教程详情...';
    return;
  }

  elements.detailContent.hidden = false;
  elements.detailStatus.textContent = detailState.statusMessage || '可直接修改标题和步骤说明，保存后导出新的 ZIP。';
  elements.detailTitle.value = detailState.draft.title || '';
  elements.detailMeta.innerHTML = renderDetailMeta(detailState.draft);
  elements.detailExportPath.textContent = renderDetailExportPath(detailState.draft);
  elements.detailSteps.innerHTML = detailState.draft.screenshots
    .map(
      (screenshot, index) => `
        <article class="detail-step">
          <div class="detail-step-head">
            <div class="detail-step-title">步骤 ${index + 1}</div>
            <div class="detail-step-time">${escapeHtml(screenshot.timestampLabel || formatDuration(screenshot.timeOffsetMs || 0))}</div>
          </div>
          <img src="${escapeHtml(screenshot.data)}" alt="步骤 ${index + 1} 截图">
          <textarea data-step-index="${index}" placeholder="为这一步写一句清晰说明">${escapeHtml(
            screenshot.description || `步骤 ${index + 1}`
          )}</textarea>
        </article>
      `
    )
    .join('');

  syncDetailActionState();
}

function renderDetailMeta(detail) {
  const chips = [
    ['创建时间', new Date(detail.createdAt).toLocaleString()],
    ['录制时长', formatDuration(detail.durationMs || 0)],
    ['步骤数量', String(detail.screenshotCount || detail.screenshots.length || 0)],
    ['音频状态', detail.hasAudio ? '已包含' : '未生成']
  ];

  return chips
    .map(
      ([label, value]) => `
        <div class="detail-chip">
          <span class="detail-chip-label">${escapeHtml(label)}</span>
          <span class="detail-chip-value">${escapeHtml(value)}</span>
        </div>
      `
    )
    .join('');
}

function renderDetailExportPath(detail) {
  const exportBaseName = typeof detail.exportBaseName === 'string' ? detail.exportBaseName.trim() : '';
  if (!exportBaseName) {
    return '尚未导出，保存后可直接生成 ZIP。';
  }

  return detail.lastExportPrompted
    ? `上次导出：手动选择保存位置（默认建议 ${formatDownloadsPath(exportBaseName)}）`
    : `上次导出：${formatDownloadsPath(exportBaseName)}`;
}

function updateDetailBusyState() {
  if (elements.detailPanel.hidden || detailState.loading || !detailState.draft) {
    return;
  }

  syncDetailActionState();
}

function syncDetailActionState(statusMessage = '') {
  if (elements.detailPanel.hidden || detailState.loading || !detailState.draft) {
    return;
  }

  if (statusMessage) {
    detailState.statusMessage = statusMessage;
  } else if (detailState.saving) {
    detailState.statusMessage = '正在保存修改...';
  } else if (state.isGenerating) {
    detailState.statusMessage = '正在生成文件，请稍候。';
  } else if (detailState.statusMessage.startsWith('ZIP 导出完成')) {
    detailState.statusMessage = 'ZIP 导出完成，可以直接发出。';
  } else if (isDetailDirty()) {
    detailState.statusMessage = '已修改，记得保存后再导出。';
  } else {
    detailState.statusMessage = '可直接修改标题和步骤说明，保存后导出新的 ZIP。';
  }

  elements.detailStatus.textContent = detailState.statusMessage;
  elements.btnSaveDetail.disabled = detailState.saving || state.isGenerating || !isDetailDirty();
  elements.btnDetailExport.disabled = detailState.saving || state.isGenerating || !detailState.openId;
}

function isDetailDirty() {
  if (!detailState.original || !detailState.draft) {
    return false;
  }

  if ((detailState.original.title || '') !== (detailState.draft.title || '')) {
    return true;
  }

  return detailState.draft.screenshots.some(
    (screenshot, index) =>
      (detailState.original.screenshots[index]?.description || '') !== (screenshot.description || '')
  );
}

function updateOutputPreview() {
  if (!elements.outputPreviewValue || !elements.outputPreviewHint) {
    return;
  }

  elements.outputPreviewValue.textContent = buildOutputPreviewPath();
  elements.outputPreviewHint.textContent = elements.promptForSaveAs.checked
    ? '开启询问后，Chrome 会只为这个 ZIP 文件弹出一次保存对话框。'
    : '导出时会在下载目录下生成这个 ZIP 文件。';
}

function buildOutputPreviewPath() {
  const outputDir = sanitizeOutputDir(elements.outputDir.value.trim());
  const bundleName = buildPreviewBundleName(outputDir);
  return formatDownloadsPath(`${bundleName}.zip`);
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

function formatDownloadsPath(relativePath) {
  return `Downloads/${relativePath}`;
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
