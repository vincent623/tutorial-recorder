const $ = (id) => document.getElementById(id);
const DEFAULT_OUTPUT_DIR = 'tutorial-recorder';
const MAX_DETAIL_IMAGE_SIDE = 2000;
const PROVIDER_LABELS = {
  volcengineArk: '火山方舟',
  siliconFlow: '硅基流动',
  aliyunDashScope: '阿里云百炼',
  openRouter: 'OpenRouter',
  googleGemini: 'Google Gemini',
  anthropicClaude: 'Claude',
  openai: 'OpenAI',
  openaiCompatible: 'OpenAI Compatible',
  custom: '自定义'
};

const PROMPT_PRESET_LABELS = {
  default: '默认（平衡）',
  actionFirst: '动作优先',
  controlFocused: '控件定位',
  concise: '简洁短句',
  custom: '自定义'
};

const CAPTURE_MODE_HINTS = {
  displayMedia: '开始录制时会弹出共享画面选择，并额外请求麦克风权限。',
  tabCapture: '直接录制当前标签页，适合自动化验证或兼容场景，通常不会弹出共享选择。'
};

const elements = {
  status: $('status'),
  statusText: $('status').querySelector('.status-text'),
  btnStart: $('btnStart'),
  btnPause: $('btnPause'),
  btnStop: $('btnStop'),
  btnCapture: $('btnCapture'),
  screenshotCount: $('screenshotCount'),
  recordTime: $('recordTime'),
  mediaStatus: $('mediaStatus'),
  btnOpenSettings: $('btnOpenSettings'),
  captureMode: $('captureMode'),
  captureModeHint: $('captureModeHint'),
  interval: $('interval'),
  autoScreenshot: $('autoScreenshot'),
  providerSummary: $('providerSummary'),
  promptSummary: $('promptSummary'),
  outputDirSummary: $('outputDirSummary'),
  historyList: $('historyList'),
  detailPanel: $('detailPanel'),
  detailStatus: $('detailStatus'),
  detailContent: $('detailContent'),
  detailTitle: $('detailTitle'),
  detailMeta: $('detailMeta'),
  detailExportPath: $('detailExportPath'),
  detailSteps: $('detailSteps'),
  detailImageInput: $('detailImageInput'),
  btnAddStepAtStart: $('btnAddStepAtStart'),
  btnCloseDetail: $('btnCloseDetail'),
  btnSaveDetail: $('btnSaveDetail'),
  btnDetailExport: $('btnDetailExport')
};

let state = createIdleState();
let historyItems = [];
let detailState = createDetailState();
let timer = null;
let currentSettings = {};

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
    mediaStatus: '待启动',
    recordingId: null,
    captureMode: 'displayMedia',
    audioStarted: false,
    videoStarted: false
  };
}

function createDetailState() {
  return {
    openId: null,
    loading: false,
    saving: false,
    original: null,
    draft: null,
    statusMessage: '',
    imageTarget: null,
    importingImage: false
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
    mediaStatus: snapshot.runtime?.isGenerating
      ? '处理中'
      : snapshot.runtime?.isPaused
        ? '已暂停'
        : snapshot.runtime?.isRecording
          ? snapshot.runtime?.mediaStatus || '录制中'
          : '待启动'
  };

  historyItems = snapshot.history || [];
  renderHistory(historyItems);
  renderDetailPanel();
  updateUi();
}

function bindEvents() {
  elements.captureMode.addEventListener('change', handleCaptureModeChange);
  elements.interval.addEventListener('change', saveSettings);
  elements.autoScreenshot.addEventListener('change', saveSettings);
  elements.btnOpenSettings.addEventListener('click', openSettingsPage);

  elements.btnStart.addEventListener('click', startRecording);
  elements.btnPause.addEventListener('click', togglePause);
  elements.btnStop.addEventListener('click', stopRecording);
  elements.btnCapture.addEventListener('click', captureManually);
  elements.historyList.addEventListener('click', handleHistoryAction);

  elements.btnCloseDetail.addEventListener('click', closeDetail);
  elements.btnAddStepAtStart.addEventListener('click', () => queueDetailImageSelection({ mode: 'insert', index: 0 }));
  elements.btnSaveDetail.addEventListener('click', saveDetail);
  elements.btnDetailExport.addEventListener('click', exportDetail);
  elements.detailTitle.addEventListener('input', handleDetailInput);
  elements.detailSteps.addEventListener('input', handleDetailInput);
  elements.detailSteps.addEventListener('click', handleDetailStepAction);
  elements.detailImageInput.addEventListener('change', handleDetailImageSelection);
}

async function saveSettings() {
  const result = await sendAction('saveSettings', {
    settings: readSettingsFromForm()
  });

  if (result?.ok && result.settings) {
    applySettingsToForm(result.settings);
  }

  return result;
}

function readSettingsFromForm() {
  return {
    captureMode: elements.captureMode.value,
    screenshotInterval: parseInt(elements.interval.value, 10),
    autoScreenshot: elements.autoScreenshot.checked
  };
}

async function handleCaptureModeChange() {
  updateCaptureModeHint();
  await saveSettings();
}

async function startRecording() {
  const saveResult = await saveSettings();
  if (!saveResult?.ok) {
    return;
  }
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

function openSettingsPage() {
  chrome.runtime.openOptionsPage();
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
    statusMessage: '可直接修改标题、步骤文案和每一步截图，保存后导出新的 ZIP。',
    imageTarget: null,
    importingImage: false
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

function handleDetailStepAction(event) {
  const button = event.target.closest('button[data-step-action]');
  if (!button || !detailState.draft || detailState.saving || state.isGenerating || detailState.importingImage) {
    return;
  }

  const stepIndex = Number.parseInt(button.dataset.stepIndex || '', 10);
  if (Number.isNaN(stepIndex)) {
    return;
  }

  const action = button.dataset.stepAction;
  if (action === 'preview') {
    openStepPreview(stepIndex);
    return;
  }

  if (action === 'replace') {
    queueDetailImageSelection({ mode: 'replace', stepIndex });
    return;
  }

  if (action === 'insert-after') {
    queueDetailImageSelection({ mode: 'insert', index: stepIndex + 1 });
    return;
  }

  if (action === 'delete') {
    deleteDraftScreenshot(stepIndex);
  }
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
        id: screenshot.id,
        description: screenshot.description,
        data: screenshot.data,
        timeOffsetMs: screenshot.timeOffsetMs,
        timestamp: screenshot.timestamp
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
      state.captureMode = message.captureMode || state.captureMode;
      state.audioStarted = message.audioStarted === true;
      state.videoStarted = message.videoStarted === true;
      state.mediaStatus = message.mediaStatus || getMediaStatusLabel(state.audioStarted, state.videoStarted);
      break;
    case 'screenshot':
      state.count = message.count ?? state.count;
      state.elapsedMs = message.elapsedMs ?? state.elapsedMs;
      break;
    case 'paused':
      state.isPaused = true;
      state.pauseStartedAt = Date.now();
      state.mediaStatus = '已暂停';
      break;
    case 'resumed':
      if (state.pauseStartedAt) {
        state.pausedDurationMs += Date.now() - state.pauseStartedAt;
      }
      state.isPaused = false;
      state.pauseStartedAt = null;
      state.mediaStatus = getMediaStatusLabel(state.audioStarted, state.videoStarted);
      break;
    case 'stopped':
      state.elapsedMs = getElapsedMs();
      state.isRecording = false;
      state.isPaused = false;
      state.mediaStatus = '处理中';
      break;
    case 'mediaUpdated':
      state.audioStarted = message.audioStarted === true;
      state.videoStarted = message.videoStarted === true;
      state.mediaStatus = message.mediaStatus || getMediaStatusLabel(state.audioStarted, state.videoStarted);
      break;
    case 'generating':
      state.isGenerating = true;
      elements.status.className = 'status processing';
      elements.statusText.textContent = message.message || '正在生成教程...';
      break;
    case 'complete':
      state = createIdleState();
      state.mediaStatus = '已导出';
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
      if ((message.message || '').includes('视频未启动')) {
        state.videoStarted = false;
        state.mediaStatus = getMediaStatusLabel(state.audioStarted, state.videoStarted);
      }
      if ((message.message || '').includes('音频未启动')) {
        state.audioStarted = false;
        state.mediaStatus = getMediaStatusLabel(state.audioStarted, state.videoStarted);
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
  elements.mediaStatus.textContent = state.mediaStatus;
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
  updateSettingsSummary();
  updateDetailBusyState();
  restartTimer();
}

function applySettingsToForm(settings = {}) {
  currentSettings = { ...settings };
  elements.captureMode.value = settings.captureMode || 'displayMedia';
  elements.interval.value = settings.screenshotInterval || 5;
  elements.autoScreenshot.checked = settings.autoScreenshot !== false;
  updateCaptureModeHint();
  updateSettingsSummary();
}

function updateCaptureModeHint() {
  elements.captureModeHint.textContent =
    CAPTURE_MODE_HINTS[elements.captureMode.value] || CAPTURE_MODE_HINTS.displayMedia;
}

function updateSettingsSummary() {
  const providerKey = currentSettings.providerPreset || 'volcengineArk';
  const promptPresetKey = currentSettings.promptPreset || 'default';
  elements.providerSummary.textContent = PROVIDER_LABELS[providerKey] || PROVIDER_LABELS.custom;
  elements.promptSummary.textContent =
    PROMPT_PRESET_LABELS[promptPresetKey] || PROMPT_PRESET_LABELS.default;
  elements.outputDirSummary.textContent = currentSettings.outputDir || DEFAULT_OUTPUT_DIR;
}

function getMediaStatusLabel(audioStarted, videoStarted) {
  if (audioStarted && videoStarted) {
    return '音频+视频';
  }

  if (videoStarted) {
    return '仅视频';
  }

  if (audioStarted) {
    return '仅音频';
  }

  return state.isGenerating ? '处理中' : '待启动';
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
                ${new Date(item.createdAt).toLocaleString()} · ${item.screenshotCount} 张截图 · ${formatDuration(item.durationMs || 0)} · ${escapeHtml(getHistoryMediaLabel(item))}
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

function getHistoryMediaLabel(item) {
  if (item.hasAudio && item.hasVideo) {
    return '音频 + 视频';
  }

  if (item.hasVideo) {
    return '仅视频';
  }

  if (item.hasAudio) {
    return '仅音频';
  }

  return '仅截图';
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
    elements.detailImageInput.value = '';
    return;
  }

  if (detailState.loading || !detailState.draft) {
    elements.detailContent.hidden = true;
    elements.detailStatus.textContent = detailState.statusMessage || '正在加载教程详情...';
    return;
  }

  elements.detailContent.hidden = false;
  elements.detailStatus.textContent = detailState.statusMessage || '可直接修改标题、步骤文案和每一步截图，保存后导出新的 ZIP。';
  elements.detailTitle.value = detailState.draft.title || '';
  elements.detailMeta.innerHTML = renderDetailMeta(detailState.draft);
  elements.detailExportPath.textContent = renderDetailExportPath(detailState.draft);
  const busy = detailState.saving || state.isGenerating || detailState.importingImage;
  elements.detailSteps.innerHTML = detailState.draft.screenshots
    .map(
      (screenshot, index) => `
        <article class="detail-step">
          <div class="detail-step-head">
            <div class="detail-step-title">步骤 ${index + 1}</div>
            <div class="detail-step-time">${escapeHtml(screenshot.timestampLabel || formatDuration(screenshot.timeOffsetMs || 0))}</div>
          </div>
          <button type="button" class="detail-preview-btn" data-step-action="preview" data-step-index="${index}" ${
            busy ? 'disabled' : ''
          }>
            <img src="${escapeHtml(screenshot.data)}" alt="步骤 ${index + 1} 截图">
          </button>
          <textarea data-step-index="${index}" placeholder="为这一步写一句清晰说明">${escapeHtml(
            screenshot.description || `步骤 ${index + 1}`
          )}</textarea>
          <div class="detail-step-actions">
            <button type="button" class="btn-inline btn-inline-light" data-step-action="preview" data-step-index="${index}" ${
              busy ? 'disabled' : ''
            }>查看原图</button>
            <button type="button" class="btn-inline btn-inline-light" data-step-action="replace" data-step-index="${index}" ${
              busy ? 'disabled' : ''
            }>替换截图</button>
            <button type="button" class="btn-inline btn-inline-light" data-step-action="insert-after" data-step-index="${index}" ${
              busy ? 'disabled' : ''
            }>在后面添加</button>
            <button type="button" class="btn-inline btn-inline-danger" data-step-action="delete" data-step-index="${index}" ${
              busy ? 'disabled' : ''
            }>删除</button>
          </div>
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
    ['步骤数量', String(detail.screenshots?.length || detail.screenshotCount || 0)],
    ['录制模式', detail.captureMode === 'tabCapture' ? '当前标签页兼容模式' : '共享屏幕 / 标签页'],
    ['媒体导出', getHistoryMediaLabel(detail)]
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
  } else if (detailState.importingImage) {
    detailState.statusMessage = '正在处理截图，请稍候...';
  } else if (state.isGenerating) {
    detailState.statusMessage = '正在生成文件，请稍候。';
  } else if (detailState.statusMessage.startsWith('ZIP 导出完成')) {
    detailState.statusMessage = 'ZIP 导出完成，可以直接发出。';
  } else if (isDetailDirty()) {
    detailState.statusMessage = '已修改，记得保存后再导出。';
  } else {
    detailState.statusMessage = '可直接修改标题、步骤文案和每一步截图，保存后导出新的 ZIP。';
  }

  elements.detailStatus.textContent = detailState.statusMessage;
  const busy = detailState.saving || state.isGenerating || detailState.importingImage;
  elements.btnSaveDetail.disabled = busy || !isDetailDirty();
  elements.btnDetailExport.disabled = busy || !detailState.openId;
  elements.btnAddStepAtStart.disabled = busy || !detailState.openId;
  elements.detailImageInput.disabled = busy;
  elements.detailTitle.disabled = busy;
  elements.detailSteps
    .querySelectorAll('textarea, button[data-step-action]')
    .forEach((element) => {
      element.disabled = busy;
    });
}

function isDetailDirty() {
  if (!detailState.original || !detailState.draft) {
    return false;
  }

  if ((detailState.original.title || '') !== (detailState.draft.title || '')) {
    return true;
  }

  if (detailState.original.screenshots.length !== detailState.draft.screenshots.length) {
    return true;
  }

  return detailState.draft.screenshots.some(
    (screenshot, index) =>
      (detailState.original.screenshots[index]?.description || '') !== (screenshot.description || '') ||
      (detailState.original.screenshots[index]?.data || '') !== (screenshot.data || '') ||
      (detailState.original.screenshots[index]?.timeOffsetMs || 0) !== (screenshot.timeOffsetMs || 0)
  );
}

function openStepPreview(stepIndex) {
  const screenshot = detailState.draft?.screenshots?.[stepIndex];
  if (!screenshot?.data) {
    return;
  }

  window.open(screenshot.data, '_blank', 'noopener,noreferrer');
}

function queueDetailImageSelection(target) {
  if (!detailState.draft || detailState.saving || state.isGenerating || detailState.importingImage) {
    return;
  }

  detailState.imageTarget = target;
  elements.detailImageInput.value = '';
  elements.detailImageInput.click();
}

async function handleDetailImageSelection(event) {
  const file = event.target.files?.[0];
  const target = detailState.imageTarget;
  detailState.imageTarget = null;
  elements.detailImageInput.value = '';

  if (!file || !target || !detailState.draft) {
    return;
  }

  detailState.importingImage = true;
  syncDetailActionState('正在处理截图，请稍候...');

  try {
    const dataUrl = await readImageFileAsPngDataUrl(file);
    if (target.mode === 'replace') {
      replaceDraftScreenshot(target.stepIndex, dataUrl);
    } else if (target.mode === 'insert') {
      insertDraftScreenshot(target.index, dataUrl);
    }
  } catch (error) {
    alert(`处理图片失败：${error.message || '未知错误'}`);
  } finally {
    detailState.importingImage = false;
    renderDetailPanel();
  }
}

function insertDraftScreenshot(index, dataUrl) {
  if (!detailState.draft) {
    return;
  }

  const stepIndex = Math.max(0, Math.min(index, detailState.draft.screenshots.length));
  detailState.draft.screenshots.splice(stepIndex, 0, createDraftScreenshot(dataUrl, stepIndex));
  syncDetailActionState('已添加新截图，记得保存后再导出。');
}

function replaceDraftScreenshot(stepIndex, dataUrl) {
  const screenshot = detailState.draft?.screenshots?.[stepIndex];
  if (!screenshot) {
    return;
  }

  screenshot.data = dataUrl;
  syncDetailActionState('已替换截图，记得保存后再导出。');
}

function deleteDraftScreenshot(stepIndex) {
  if (!detailState.draft?.screenshots?.[stepIndex]) {
    return;
  }

  if (detailState.draft.screenshots.length <= 1) {
    alert('至少保留一张截图。若需要重做，请先添加新截图再删除旧步骤。');
    return;
  }

  const confirmed = window.confirm(`确定删除步骤 ${stepIndex + 1} 吗？`);
  if (!confirmed) {
    return;
  }

  detailState.draft.screenshots.splice(stepIndex, 1);
  syncDetailActionState('已删除截图，记得保存后再导出。');
  renderDetailPanel();
}

function createDraftScreenshot(dataUrl, insertIndex) {
  const timeOffsetMs = computeInsertedTimeOffsetMs(detailState.draft?.screenshots || [], insertIndex);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    data: dataUrl,
    description: '',
    timeOffsetMs,
    timestamp: (detailState.draft?.createdAt || Date.now()) + timeOffsetMs,
    timestampLabel: formatDuration(timeOffsetMs)
  };
}

function computeInsertedTimeOffsetMs(screenshots, insertIndex) {
  const previous = screenshots[insertIndex - 1] || null;
  const next = screenshots[insertIndex] || null;
  const previousOffset = previous?.timeOffsetMs || 0;
  const nextOffset = next?.timeOffsetMs;

  if (previous && next) {
    const gap = nextOffset - previousOffset;
    return gap > 1 ? Math.floor(previousOffset + gap / 2) : previousOffset + 1;
  }

  if (next) {
    return Math.max(0, Math.floor(nextOffset / 2));
  }

  if (previous) {
    return previousOffset + 1000;
  }

  return 0;
}

async function readImageFileAsPngDataUrl(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) {
    throw new Error('请选择一张图片文件');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DETAIL_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    bitmap.close();
    throw new Error('浏览器无法处理这张图片');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL('image/png');
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

function formatDownloadsPath(relativePath) {
  return `Downloads/${relativePath}`;
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
