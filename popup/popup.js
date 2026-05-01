const $ = (id) => document.getElementById(id);
const DEFAULT_OUTPUT_DIR = 'tutorial-recorder';
const MAX_DETAIL_IMAGE_SIDE = 2000;
const pageParams = new URLSearchParams(window.location.search);
const isWorkspaceMode = pageParams.get('workspace') === '1';
const requestedWorkspaceDetailId = pageParams.get('id') || '';
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
const IDEMPOTENT_ACTIONS = new Set(['stopRecording', 'manualCapture', 'downloadRecording']);

const elements = {
  pageTitle: $('pageTitle'),
  heroCopy: $('heroCopy'),
  heroActions: $('heroActions'),
  status: $('status'),
  statusText: $('status').querySelector('.status-text'),
  btnStart: $('btnStart'),
  btnPause: $('btnPause'),
  btnStop: $('btnStop'),
  btnCapture: $('btnCapture'),
  aiPanel: $('aiPanel'),
  aiStatus: $('aiStatus'),
  aiGoal: $('aiGoal'),
  btnAiStart: $('btnAiStart'),
  btnAiTakeover: $('btnAiTakeover'),
  aiStepList: $('aiStepList'),
  screenshotCount: $('screenshotCount'),
  recordTime: $('recordTime'),
  mediaStatus: $('mediaStatus'),
  cdpBanner: $('cdpBanner'),
  suggestionPanel: $('suggestionPanel'),
  suggestionStatus: $('suggestionStatus'),
  suggestionStepLabel: $('suggestionStepLabel'),
  suggestionText: $('suggestionText'),
  btnSaveSuggestion: $('btnSaveSuggestion'),
  btnOpenWorkspace: $('btnOpenWorkspace'),
  btnOpenSettings: $('btnOpenSettings'),
  btnOpenSettingsHero: $('btnOpenSettingsHero'),
  captureMode: $('captureMode'),
  captureModeHint: $('captureModeHint'),
  interval: $('interval'),
  autoScreenshot: $('autoScreenshot'),
  realtimeSuggestions: $('realtimeSuggestions'),
  providerSummary: $('providerSummary'),
  promptSummary: $('promptSummary'),
  outputDirSummary: $('outputDirSummary'),
  historyTitle: $('historyTitle'),
  historyTip: $('historyTip'),
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
let initialWorkspaceSelectionHandled = false;
const pendingOperationIds = new Map();

document.addEventListener('DOMContentLoaded', async () => {
  applyPageMode();
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
    recordingMode: 'manual',
    captureMode: 'displayMedia',
    screenshotEngine: 'standard',
    cdpAttached: false,
    audioStarted: false,
    videoStarted: false,
    realtimeSuggestion: createRealtimeSuggestionState(),
    aiAgent: createAiAgentState()
  };
}

function createAiAgentState(overrides = {}) {
  return {
    status: 'idle',
    goal: '',
    steps: [],
    iteration: 0,
    maxSteps: 50,
    paused: false,
    awaitingTakeover: false,
    message: '',
    updatedAt: 0,
    ...overrides
  };
}

function createRealtimeSuggestionState(overrides = {}) {
  return {
    enabled: false,
    status: 'disabled',
    screenshotId: '',
    stepIndex: 0,
    text: '',
    message: '',
    updatedAt: 0,
    ...overrides
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
    importingImage: false,
    draggingStepIndex: null,
    dropStepIndex: null
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
  state.realtimeSuggestion = normalizeRealtimeSuggestion(snapshot.runtime?.realtimeSuggestion);
  state.aiAgent = normalizeAiAgent(snapshot.runtime?.aiAgent);

  historyItems = snapshot.history || [];
  renderHistory(historyItems);
  renderDetailPanel();
  updateUi();

  if (isWorkspaceMode) {
    queueInitialWorkspaceSelection();
  }
}

function bindEvents() {
  elements.captureMode.addEventListener('change', handleCaptureModeChange);
  elements.interval.addEventListener('change', saveSettings);
  elements.autoScreenshot.addEventListener('change', saveSettings);
  elements.realtimeSuggestions.addEventListener('change', saveSettings);
  elements.suggestionText.addEventListener('input', handleSuggestionInput);
  elements.suggestionText.addEventListener('change', saveRealtimeSuggestion);
  elements.btnSaveSuggestion.addEventListener('click', saveRealtimeSuggestion);
  elements.btnOpenSettings.addEventListener('click', openSettingsPage);
  elements.btnOpenSettingsHero.addEventListener('click', openSettingsPage);
  elements.btnOpenWorkspace.addEventListener('click', () => openWorkspace());

  elements.btnStart.addEventListener('click', startRecording);
  elements.btnPause.addEventListener('click', togglePause);
  elements.btnStop.addEventListener('click', stopRecording);
  elements.btnCapture.addEventListener('click', captureManually);
  elements.btnAiStart.addEventListener('click', startAiRecording);
  elements.btnAiTakeover.addEventListener('click', takeoverRecording);
  elements.historyList.addEventListener('click', handleHistoryAction);

  elements.btnCloseDetail.addEventListener('click', closeDetail);
  elements.btnAddStepAtStart.addEventListener('click', () => queueDetailImageSelection({ mode: 'insert', index: 0 }));
  elements.btnSaveDetail.addEventListener('click', saveDetail);
  elements.btnDetailExport.addEventListener('click', exportDetail);
  elements.detailTitle.addEventListener('input', handleDetailInput);
  elements.detailSteps.addEventListener('input', handleDetailInput);
  elements.detailSteps.addEventListener('click', handleDetailStepAction);
  elements.detailSteps.addEventListener('dragstart', handleDetailStepDragStart);
  elements.detailSteps.addEventListener('dragover', handleDetailStepDragOver);
  elements.detailSteps.addEventListener('drop', handleDetailStepDrop);
  elements.detailSteps.addEventListener('dragend', handleDetailStepDragEnd);
  elements.detailImageInput.addEventListener('change', handleDetailImageSelection);
}

async function saveSettings() {
  const result = await sendAction('saveSettings', {
    settings: readSettingsFromForm()
  });

  if (result?.ok && result.settings) {
    applySettingsToForm(result.settings);
    state.realtimeSuggestion = {
      ...createRealtimeSuggestionState(),
      ...state.realtimeSuggestion,
      enabled: result.settings.realtimeSuggestions === true
    };
    updateUi();
  }

  return result;
}

function readSettingsFromForm() {
  return {
    captureMode: elements.captureMode.value,
    screenshotInterval: parseInt(elements.interval.value, 10),
    autoScreenshot: elements.autoScreenshot.checked,
    realtimeSuggestions: elements.realtimeSuggestions.checked
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
  const isAiRecording = state.recordingMode === 'ai';
  const action = isAiRecording
    ? state.isPaused
      ? 'resumeAiAgent'
      : 'pauseAiAgent'
    : state.isPaused
      ? 'resumeRecording'
      : 'pauseRecording';
  const result = await sendAction(action);

  if (!result?.ok) {
    alert(`${state.isPaused ? '恢复' : '暂停'}录制失败：${result?.error || '未知错误'}`);
  }
}

async function startAiRecording() {
  const saveResult = await saveSettings();
  if (!saveResult?.ok) {
    return;
  }

  const targetDescription = elements.aiGoal.value.trim();
  if (!targetDescription) {
    alert('请先填写 AI 录制目标');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    alert('未找到当前活动标签页');
    return;
  }

  const result = await sendAction('startAiRecording', {
    tabId: tab.id,
    targetDescription
  });
  if (!result?.ok) {
    alert(`AI 录制启动失败：${result?.error || '未知错误'}`);
  }
}

async function takeoverRecording() {
  const result = await sendAction('takeoverRecording');
  if (!result?.ok) {
    alert(`接管失败：${result?.error || '未知错误'}`);
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

function handleSuggestionInput() {
  state.realtimeSuggestion = {
    ...createRealtimeSuggestionState(),
    ...state.realtimeSuggestion,
    status: 'editing',
    text: elements.suggestionText.value
  };
  renderRealtimeSuggestionPanel();
}

async function saveRealtimeSuggestion() {
  const suggestion = state.realtimeSuggestion || createRealtimeSuggestionState();
  if (!suggestion.screenshotId || elements.btnSaveSuggestion.disabled) {
    return;
  }

  elements.btnSaveSuggestion.disabled = true;
  elements.suggestionStatus.textContent = '正在保存';

  const result = await sendAction('updateRealtimeSuggestion', {
    screenshotId: suggestion.screenshotId,
    description: elements.suggestionText.value
  });

  if (!result?.ok || !result.suggestion) {
    elements.suggestionStatus.textContent = result?.error || '保存失败';
    elements.btnSaveSuggestion.disabled = false;
    return;
  }

  state.realtimeSuggestion = normalizeRealtimeSuggestion(result.suggestion);
  renderRealtimeSuggestionPanel();
}

function openSettingsPage() {
  chrome.runtime.openOptionsPage();
}

function openWorkspace(id = '') {
  const params = new URLSearchParams();
  params.set('workspace', '1');
  if (id) {
    params.set('id', id);
  }

  chrome.tabs.create({
    url: chrome.runtime.getURL(`popup/popup.html?${params.toString()}`)
  });
}

function applyPageMode() {
  document.body.classList.add(isWorkspaceMode ? 'workspace-mode' : 'popup-mode');
  document.title = isWorkspaceMode ? '教程工作台' : '教程录制器';
  elements.pageTitle.textContent = isWorkspaceMode ? '教程工作台' : '教程自动录制';
  elements.heroCopy.hidden = !isWorkspaceMode;
  elements.heroActions.hidden = !isWorkspaceMode;
  elements.historyTitle.textContent = isWorkspaceMode ? '全部记录' : '最近记录';
  elements.historyTip.textContent = isWorkspaceMode
    ? '选中一条记录后即可编辑步骤、替换截图并重新导出 ZIP'
    : '最近 3 条记录，可进入工作台继续编辑';
  elements.btnOpenWorkspace.hidden = isWorkspaceMode;
}

function queueInitialWorkspaceSelection() {
  if (!isWorkspaceMode || detailState.loading || detailState.openId) {
    return;
  }

  const requestedId = initialWorkspaceSelectionHandled ? '' : requestedWorkspaceDetailId;
  initialWorkspaceSelectionHandled = true;
  const targetId =
    (requestedId && historyItems.find((item) => item.id === requestedId)?.id) ||
    historyItems[0]?.id;

  if (targetId) {
    openDetail(targetId);
  }
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
    if (!isWorkspaceMode) {
      openWorkspace(id);
      return;
    }

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
    statusMessage: '可直接修改标题、步骤文案、截图内容和步骤顺序，保存后导出新的 ZIP。',
    imageTarget: null,
    importingImage: false,
    draggingStepIndex: null,
    dropStepIndex: null
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

  if (action === 'move-up') {
    moveDraftScreenshot(stepIndex, stepIndex - 1);
    return;
  }

  if (action === 'move-down') {
    moveDraftScreenshot(stepIndex, stepIndex + 1);
    return;
  }

  if (action === 'delete') {
    deleteDraftScreenshot(stepIndex);
  }
}

function handleDetailStepDragStart(event) {
  const handle = event.target.closest('[data-step-action="drag"]');
  if (!handle || !detailState.draft || detailState.saving || state.isGenerating || detailState.importingImage) {
    return;
  }

  const stepIndex = Number.parseInt(handle.dataset.stepIndex || '', 10);
  if (Number.isNaN(stepIndex)) {
    return;
  }

  detailState.draggingStepIndex = stepIndex;
  detailState.dropStepIndex = stepIndex;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(stepIndex));
  updateDragVisualState();
}

function handleDetailStepDragOver(event) {
  if (!detailState.draft || detailState.draggingStepIndex == null) {
    return;
  }

  const stepCard = event.target.closest('.detail-step');
  if (!stepCard) {
    return;
  }

  const stepIndex = Number.parseInt(stepCard.dataset.stepIndex || '', 10);
  if (Number.isNaN(stepIndex)) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  if (detailState.dropStepIndex !== stepIndex) {
    detailState.dropStepIndex = stepIndex;
    updateDragVisualState();
  }
}

function handleDetailStepDrop(event) {
  if (!detailState.draft || detailState.draggingStepIndex == null) {
    return;
  }

  const stepCard = event.target.closest('.detail-step');
  if (!stepCard) {
    return;
  }

  const targetIndex = Number.parseInt(stepCard.dataset.stepIndex || '', 10);
  if (Number.isNaN(targetIndex)) {
    return;
  }

  event.preventDefault();
  const draggingIndex = detailState.draggingStepIndex;
  detailState.draggingStepIndex = null;
  detailState.dropStepIndex = null;
  moveDraftScreenshot(draggingIndex, targetIndex, { shouldRender: true });
}

function handleDetailStepDragEnd() {
  if (detailState.draggingStepIndex == null && detailState.dropStepIndex == null) {
    return;
  }

  detailState.draggingStepIndex = null;
  detailState.dropStepIndex = null;
  updateDragVisualState();
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
      state.recordingMode = message.recordingMode || 'manual';
      state.pausedDurationMs = 0;
      state.pauseStartedAt = null;
      state.captureMode = message.captureMode || state.captureMode;
      state.screenshotEngine = message.screenshotEngine || state.screenshotEngine;
      state.cdpAttached = message.cdpAttached === true;
      state.audioStarted = message.audioStarted === true;
      state.videoStarted = message.videoStarted === true;
      state.mediaStatus = message.mediaStatus || getMediaStatusLabel(state.audioStarted, state.videoStarted);
      state.realtimeSuggestion = normalizeRealtimeSuggestion(message.realtimeSuggestion);
      state.aiAgent = normalizeAiAgent(message.aiAgent);
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
    case 'cdpStatus':
      state.cdpAttached = message.active === true;
      if (message.message) {
        elements.cdpBanner.textContent = message.message;
      }
      break;
    case 'realtimeSuggestion':
      state.realtimeSuggestion = normalizeRealtimeSuggestion(message.suggestion);
      break;
    case 'aiStatus':
      state.recordingMode = message.recordingMode || state.recordingMode;
      state.aiAgent = normalizeAiAgent(message.aiAgent);
      state.mediaStatus =
        state.recordingMode === 'ai' && state.isRecording
          ? getAiStatusText(state.aiAgent)
          : state.mediaStatus;
      break;
    case 'agentStep':
      state.aiAgent = normalizeAiAgent(message.aiAgent);
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
      if (isWorkspaceMode) {
        queueInitialWorkspaceSelection();
      }
      break;
    case 'historyUpdated':
      historyItems = message.history || [];
      if (detailState.openId && !historyItems.some((item) => item.id === detailState.openId)) {
        closeDetail();
      }
      if (isWorkspaceMode) {
        queueInitialWorkspaceSelection();
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
  } else if (state.isRecording && state.recordingMode === 'ai' && state.isPaused) {
    elements.status.classList.add('paused');
    elements.statusText.textContent = 'AI 已暂停';
  } else if (state.isRecording && state.recordingMode === 'ai') {
    elements.status.classList.add('recording');
    elements.statusText.textContent = 'AI 录制中';
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
  elements.btnPause.disabled =
    !state.isRecording || state.isGenerating || (state.recordingMode === 'ai' && state.aiAgent.status === 'failed');
  elements.btnStop.disabled = !state.isRecording || state.isGenerating;
  elements.btnCapture.disabled = !state.isRecording || state.isGenerating;
  elements.btnPause.textContent =
    state.recordingMode === 'ai' ? (state.isPaused ? '继续 AI' : '暂停 AI') : state.isPaused ? '继续' : '暂停';
  elements.cdpBanner.hidden = !(state.isRecording && state.cdpAttached);
  renderAiPanel();
  renderRealtimeSuggestionPanel();

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
  elements.realtimeSuggestions.checked = settings.realtimeSuggestions === true;
  updateCaptureModeHint();
  updateSettingsSummary();
}

function normalizeRealtimeSuggestion(suggestion = {}) {
  return {
    ...createRealtimeSuggestionState(),
    ...suggestion,
    enabled: suggestion?.enabled === true,
    stepIndex: Number.parseInt(suggestion?.stepIndex, 10) || 0,
    text: typeof suggestion?.text === 'string' ? suggestion.text : '',
    message: typeof suggestion?.message === 'string' ? suggestion.message : ''
  };
}

function normalizeAiAgent(aiAgent = {}) {
  return {
    ...createAiAgentState(),
    ...aiAgent,
    steps: Array.isArray(aiAgent?.steps) ? aiAgent.steps : [],
    iteration: Number.parseInt(aiAgent?.iteration, 10) || 0,
    maxSteps: Number.parseInt(aiAgent?.maxSteps, 10) || 50,
    paused: aiAgent?.paused === true,
    awaitingTakeover: aiAgent?.awaitingTakeover === true,
    message: typeof aiAgent?.message === 'string' ? aiAgent.message : ''
  };
}

function renderAiPanel() {
  const aiAgent = normalizeAiAgent(state.aiAgent);
  const isAiRecording = state.isRecording && state.recordingMode === 'ai';
  const aiConfigured = Boolean(currentSettings.apiKey && currentSettings.modelId && currentSettings.apiBaseUrl);

  elements.aiStatus.textContent = isAiRecording
    ? getAiStatusText(aiAgent)
    : aiConfigured
      ? '待启动'
      : '需配置 AI';
  elements.btnAiStart.disabled = state.isRecording || state.isGenerating || !aiConfigured;
  elements.btnAiTakeover.disabled =
    !isAiRecording || state.isGenerating || (!aiAgent.awaitingTakeover && aiAgent.status !== 'running' && aiAgent.status !== 'paused');
  elements.aiGoal.disabled = state.isRecording || state.isGenerating;

  if (!elements.aiGoal.value && aiAgent.goal) {
    elements.aiGoal.value = aiAgent.goal;
  }

  const steps = aiAgent.steps || [];
  elements.aiStepList.hidden = !steps.length;
  elements.aiStepList.innerHTML = steps
    .slice(-8)
    .map(
      (step) => `
        <div class="ai-step">
          <strong>${escapeHtml(String(step.index || ''))}</strong>
          ${escapeHtml(step.description || step.action || '')}
        </div>
      `
    )
    .join('');
}

function getAiStatusText(aiAgent = {}) {
  if (aiAgent.status === 'running') {
    return aiAgent.message || 'AI 录制中';
  }

  if (aiAgent.status === 'paused') {
    return 'AI 已暂停';
  }

  if (aiAgent.status === 'failed') {
    return aiAgent.message || 'AI 异常';
  }

  if (aiAgent.status === 'takeover') {
    return '人工接管';
  }

  if (aiAgent.status === 'limit') {
    return '达到上限';
  }

  if (aiAgent.status === 'finishing' || aiAgent.status === 'stopping') {
    return '正在收尾';
  }

  return aiAgent.message || '待启动';
}

function renderRealtimeSuggestionPanel() {
  const suggestion = normalizeRealtimeSuggestion(state.realtimeSuggestion);
  const hasSuggestion =
    Boolean(suggestion.screenshotId) &&
    suggestion.status !== 'disabled' &&
    suggestion.status !== 'unconfigured';
  const shouldShow = state.isRecording && suggestion.enabled && hasSuggestion;

  elements.suggestionPanel.hidden = !shouldShow;
  if (!shouldShow) {
    return;
  }

  elements.suggestionStatus.textContent = getSuggestionStatusText(suggestion);
  elements.suggestionStepLabel.textContent = suggestion.stepIndex
    ? `步骤 ${suggestion.stepIndex} AI 建议`
    : 'AI 建议';

  if (document.activeElement !== elements.suggestionText) {
    elements.suggestionText.value = suggestion.text || '';
  }

  const isBusy = suggestion.status === 'queued' || suggestion.status === 'analyzing';
  elements.suggestionText.disabled = isBusy;
  elements.btnSaveSuggestion.disabled = isBusy || !suggestion.screenshotId;
}

function getSuggestionStatusText(suggestion) {
  if (suggestion.status === 'queued') {
    return '等待分析';
  }

  if (suggestion.status === 'analyzing') {
    return '正在分析...';
  }

  if (suggestion.status === 'ready') {
    return '已生成';
  }

  if (suggestion.status === 'saved') {
    return '已保存';
  }

  if (suggestion.status === 'editing') {
    return '正在编辑';
  }

  if (suggestion.status === 'error') {
    return suggestion.message || '生成失败';
  }

  return suggestion.message || '等待截图';
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
  const displayHistory = isWorkspaceMode ? history : history.slice(0, 3);

  if (!displayHistory.length) {
    elements.historyList.innerHTML = '<p class="empty">暂无录制记录</p>';
    return;
  }

  const busy = state.isRecording || state.isGenerating;
  const overflowCount = Math.max(0, history.length - displayHistory.length);

  elements.historyList.innerHTML = displayHistory
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
            <button class="btn-view" data-action="details" data-id="${item.id}" ${busy ? 'disabled' : ''}>${isWorkspaceMode ? '编辑' : '继续编辑'}</button>
            <button class="btn-export" data-action="export" data-id="${item.id}" ${busy ? 'disabled' : ''}>导出</button>
            ${
              isWorkspaceMode
                ? `<button class="btn-delete" data-action="delete" data-id="${item.id}" ${busy ? 'disabled' : ''}>删除</button>`
                : ''
            }
          </div>
        </article>
      `
    )
    .join('') +
    (!isWorkspaceMode && overflowCount
      ? `<p class="history-overflow-note">另外还有 ${overflowCount} 条记录，打开工作台可继续编辑或删除。</p>`
      : '');
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
  const hasPanel = isWorkspaceMode || detailState.loading || detailState.draft;
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

  if (isWorkspaceMode && !detailState.loading && !detailState.draft) {
    elements.detailContent.hidden = true;
    elements.detailStatus.textContent = '从左侧选择一条记录后，即可在这里修改标题、步骤文案和截图顺序。';
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
  elements.detailStatus.textContent =
    detailState.statusMessage || '可直接修改标题、步骤文案、截图内容和步骤顺序，保存后导出新的 ZIP。';
  elements.detailTitle.value = detailState.draft.title || '';
  elements.detailMeta.innerHTML = renderDetailMeta(detailState.draft);
  elements.detailExportPath.textContent = renderDetailExportPath(detailState.draft);
  const busy = detailState.saving || state.isGenerating || detailState.importingImage;
  elements.detailSteps.innerHTML = detailState.draft.screenshots
    .map(
      (screenshot, index) => `
        <article class="detail-step ${
          detailState.draggingStepIndex === index ? 'is-dragging' : ''
        } ${detailState.dropStepIndex === index ? 'is-drop-target' : ''}" data-step-index="${index}">
          <div class="detail-step-head">
            <div class="detail-step-title-group">
              <button type="button" class="detail-drag-handle" data-step-action="drag" data-step-index="${index}" ${
                busy ? 'disabled' : ''
              } draggable="${busy ? 'false' : 'true'}" title="拖拽排序">拖动</button>
              <div class="detail-step-title">步骤 ${index + 1}</div>
            </div>
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
            <button type="button" class="btn-inline btn-inline-light" data-step-action="move-up" data-step-index="${index}" ${
              busy || index === 0 ? 'disabled' : ''
            }>上移</button>
            <button type="button" class="btn-inline btn-inline-light" data-step-action="move-down" data-step-index="${index}" ${
              busy || index === detailState.draft.screenshots.length - 1 ? 'disabled' : ''
            }>下移</button>
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
    ['录制模式', formatRecordingModeLabel(detail)],
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

function formatRecordingModeLabel(item = {}) {
  if (item.recordingMode === 'ai' || item.captureMode === 'agent') {
    return 'AI 自动录制';
  }

  return item.captureMode === 'tabCapture' ? '当前标签页兼容模式' : '共享屏幕 / 标签页';
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
  } else if (detailState.draggingStepIndex != null) {
    detailState.statusMessage = '拖拽到目标位置后松手即可调整步骤顺序。';
  } else if (state.isGenerating) {
    detailState.statusMessage = '正在生成文件，请稍候。';
  } else if (detailState.statusMessage.startsWith('ZIP 导出完成')) {
    detailState.statusMessage = 'ZIP 导出完成，可以直接发出。';
  } else if (isDetailDirty()) {
    detailState.statusMessage = '已修改，记得保存后再导出。';
  } else {
    detailState.statusMessage = '可直接修改标题、步骤文案、截图内容和步骤顺序，保存后导出新的 ZIP。';
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
  normalizeDraftScreenshotTimeline();
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
  normalizeDraftScreenshotTimeline();
  syncDetailActionState('已删除截图，记得保存后再导出。');
  renderDetailPanel();
}

function moveDraftScreenshot(fromIndex, toIndex, { shouldRender = true } = {}) {
  if (!detailState.draft?.screenshots?.length) {
    return;
  }

  const lastIndex = detailState.draft.screenshots.length - 1;
  const normalizedFrom = Math.max(0, Math.min(fromIndex, lastIndex));
  const normalizedTo = Math.max(0, Math.min(toIndex, lastIndex));

  if (normalizedFrom === normalizedTo) {
    if (shouldRender) {
      renderDetailPanel();
    }
    return;
  }

  const [moved] = detailState.draft.screenshots.splice(normalizedFrom, 1);
  detailState.draft.screenshots.splice(normalizedTo, 0, moved);
  normalizeDraftScreenshotTimeline();
  syncDetailActionState('已调整步骤顺序，记得保存后再导出。');

  if (shouldRender) {
    renderDetailPanel();
  }
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

function normalizeDraftScreenshotTimeline() {
  if (!detailState.draft?.screenshots?.length) {
    return;
  }

  let previousOffsetMs = 0;
  detailState.draft.screenshots = detailState.draft.screenshots.map((screenshot, index) => {
    const fallbackOffset = index === 0 ? 0 : previousOffsetMs + 1000;
    const currentOffset = Number.parseInt(screenshot.timeOffsetMs, 10);
    const nextOffsetMs =
      index === 0
        ? 0
        : Number.isNaN(currentOffset)
          ? fallbackOffset
          : Math.max(fallbackOffset, currentOffset);

    previousOffsetMs = nextOffsetMs;

    return {
      ...screenshot,
      timeOffsetMs: nextOffsetMs,
      timestamp: (detailState.draft.createdAt || Date.now()) + nextOffsetMs,
      timestampLabel: formatDuration(nextOffsetMs)
    };
  });
}

function updateDragVisualState() {
  elements.detailSteps.querySelectorAll('.detail-step').forEach((stepElement) => {
    const stepIndex = Number.parseInt(stepElement.dataset.stepIndex || '', 10);
    stepElement.classList.toggle('is-dragging', stepIndex === detailState.draggingStepIndex);
    stepElement.classList.toggle('is-drop-target', stepIndex === detailState.dropStepIndex);
  });
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
  if (!IDEMPOTENT_ACTIONS.has(action) || payload.operationId) {
    return chrome.runtime.sendMessage({ action, ...payload });
  }

  const operationKey = buildClientOperationKey(action, payload);
  let operationId = pendingOperationIds.get(operationKey);

  if (!operationId) {
    operationId = createClientOperationId(action);
    pendingOperationIds.set(operationKey, operationId);
  }

  return chrome.runtime
    .sendMessage({ action, ...payload, operationId })
    .finally(() => {
      if (pendingOperationIds.get(operationKey) === operationId) {
        pendingOperationIds.delete(operationKey);
      }
    });
}

function buildClientOperationKey(action, payload = {}) {
  const targetId = payload.id || state.recordingId || detailState.openId || 'active';
  return `${action}:${targetId}`;
}

function createClientOperationId(action) {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);

  return `${action}-${Date.now().toString(36)}-${randomPart}`;
}
