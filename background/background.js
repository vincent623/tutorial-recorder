import { strToU8, zipSync } from '../lib/fflate.js';
import { deleteRecording, getRecording, putRecording } from './asset-store.js';

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'recordings';
const RUNTIME_KEY = 'recordingRuntime';
const OFFSCREEN_PATH = 'offscreen/offscreen.html';
const OFFSCREEN_MESSAGE_TIMEOUT_MS = 120_000;
const AI_ANALYZE_TIMEOUT_MS = 45_000;
const CDP_PROTOCOL_VERSION = '1.3';

const PROVIDER_PRESETS = {
  volcengineArk: {
    label: '火山方舟',
    apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiStyle: 'chatCompletions'
  },
  siliconFlow: {
    label: '硅基流动',
    apiBaseUrl: 'https://api.siliconflow.cn/v1',
    apiStyle: 'chatCompletions'
  },
  aliyunDashScope: {
    label: '阿里云百炼',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiStyle: 'chatCompletions'
  },
  openRouter: {
    label: 'OpenRouter',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    apiStyle: 'chatCompletions'
  },
  googleGemini: {
    label: 'Google Gemini',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiStyle: 'chatCompletions'
  },
  anthropicClaude: {
    label: 'Claude',
    apiBaseUrl: 'https://api.anthropic.com/v1',
    apiStyle: 'anthropicMessages'
  },
  openai: {
    label: 'OpenAI',
    apiBaseUrl: 'https://api.openai.com/v1',
    apiStyle: 'responses'
  },
  openaiCompatible: {
    label: 'OpenAI Compatible',
    apiBaseUrl: 'https://api.openai.com/v1',
    apiStyle: 'chatCompletions'
  },
  custom: {
    label: '自定义',
    apiBaseUrl: '',
    apiStyle: 'chatCompletions'
  }
};

const PROMPT_PRESETS = {
  default: {
    label: '默认（平衡）',
    description: '平衡页面上下文和最近交互，适合大多数教程场景。',
    systemPrompt:
      '你是教程录制助手。请优先根据页面上下文和最近交互，写出用户正在进行的具体操作步骤。不要只做静态截图描述。',
    userPromptTemplate: [
      '当前是教程第 {{stepIndex}} 步，共 {{totalSteps}} 步。',
      '页面标题：{{pageTitle}}。',
      '{{pageUrlLine}}',
      '最近一次用户交互：{{interactionSummary}}。',
      '上一步说明：{{previousDescription}}。',
      '请输出 1 句自然中文步骤说明，优先描述“用户正在做什么”，用动词开头，尽量点明按钮、输入框、菜单或页面区域。',
      '如果截图信息不足，请优先参考最近一次用户交互，而不是泛泛描述页面长什么样。'
    ].join('\n')
  },
  actionFirst: {
    label: '动作优先',
    description: '更强调用户动作本身，尽量避免泛泛描述页面外观。',
    systemPrompt:
      '你是教程步骤生成器。请把截图和交互记录转成可执行的操作步骤，优先写动作，不要罗列静态界面元素。',
    userPromptTemplate: [
      '当前是教程第 {{stepIndex}} 步，共 {{totalSteps}} 步。',
      '页面标题：{{pageTitle}}。',
      '{{pageUrlLine}}',
      '最近一次用户交互：{{interactionSummary}}。',
      '上一步说明：{{previousDescription}}。',
      '请只输出 1 句中文步骤，以“点击 / 输入 / 选择 / 切换 / 打开 / 提交”等动词开头。',
      '如果截图与最近交互不一致，优先采用最近交互，不要描述颜色、布局或装饰风格。'
    ].join('\n')
  },
  controlFocused: {
    label: '控件定位',
    description: '更强调按钮、输入框、菜单和页面区域，适合工具型产品教程。',
    systemPrompt:
      '你是教程录制助手，擅长把截图转成别人可以复现的操作步骤。请尽量点出具体控件名或页面区域。',
    userPromptTemplate: [
      '当前是教程第 {{stepIndex}} 步，共 {{totalSteps}} 步。',
      '页面标题：{{pageTitle}}。',
      '{{pageUrlLine}}',
      '最近一次用户交互：{{interactionSummary}}。',
      '上一步说明：{{previousDescription}}。',
      '请输出 1 句教程步骤，格式尽量接近“动词 + 控件 / 区域 + 目的或结果”。',
      '优先提到按钮、输入框、标签页、面板、菜单或表单区域，不要只说“页面发生变化”。'
    ].join('\n')
  },
  concise: {
    label: '简洁短句',
    description: '输出更短更干净，适合希望后续自己再编辑的场景。',
    systemPrompt:
      '你是教程录制助手。请输出简洁、可执行的中文步骤句子，优先描述动作，不要展开解释。',
    userPromptTemplate: [
      '当前是教程第 {{stepIndex}} 步，共 {{totalSteps}} 步。',
      '页面标题：{{pageTitle}}。',
      '{{pageUrlLine}}',
      '最近一次用户交互：{{interactionSummary}}。',
      '上一步说明：{{previousDescription}}。',
      '请输出 1 句 18 到 28 个字左右的中文步骤说明，用动词开头，只保留最关键的动作和对象。'
    ].join('\n')
  },
  custom: {
    label: '自定义',
    description: '完全自定义系统提示词和用户提示词模板。',
    systemPrompt: '',
    userPromptTemplate: ''
  }
};

const DEFAULT_SETTINGS = {
  providerPreset: 'volcengineArk',
  apiStyle: PROVIDER_PRESETS.volcengineArk.apiStyle,
  apiBaseUrl: PROVIDER_PRESETS.volcengineArk.apiBaseUrl,
  apiKey: '',
  modelId: '',
  extraHeadersJson: '',
  promptPreset: 'default',
  customSystemPrompt: '',
  customUserPrompt: '',
  captureMode: 'displayMedia',
  outputDir: 'tutorial-recorder',
  promptForSaveAs: false,
  screenshotInterval: 5,
  autoScreenshot: true,
  screenshotEngine: 'standard',
  cdpCropEnabled: false,
  cdpCropX: 0,
  cdpCropY: 0,
  cdpCropWidth: 0,
  cdpCropHeight: 0
};

let currentRecording = null;
let currentRuntime = createIdleRuntime();
let initPromise = null;
let offscreenCreationPromise = null;

console.log('[Background] Service worker booted');

chrome.runtime.onInstalled.addListener(() => {
  initPromise = initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initPromise = initialize();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.action) {
    return false;
  }

  (async () => {
    await ensureInitialized();

    switch (message.action) {
      case 'getPopupState':
        sendResponse({
          ok: true,
          settings: await getSettings(),
          runtime: serializeRuntimeForUi(),
          history: await getHistory()
        });
        break;
      case 'saveSettings':
        sendResponse({ ok: true, settings: await saveSettings(message.settings || {}) });
        break;
      case 'startRecording':
        await startRecording(message.tabId);
        sendResponse({ ok: true });
        break;
      case 'pauseRecording':
        await pauseRecording();
        sendResponse({ ok: true });
        break;
      case 'resumeRecording':
        await resumeRecording();
        sendResponse({ ok: true });
        break;
      case 'stopRecording':
        await stopRecording();
        sendResponse({ ok: true });
        break;
      case 'manualCapture':
        sendResponse(await captureScreenshot({ trigger: 'manual', allowWhenPaused: true }));
        break;
      case 'recordInteraction':
        await recordInteraction(message.payload || {}, sender);
        sendResponse({ ok: true });
        break;
      case 'downloadRecording':
        await exportRecording(message.id);
        sendResponse({ ok: true });
        break;
      case 'getRecordingDetail':
        sendResponse({ ok: true, recording: await getRecordingDetail(message.id) });
        break;
      case 'updateRecording':
        sendResponse({
          ok: true,
          recording: await updateRecordingDetails(message.id, message.updates || {}),
          history: await getHistory()
        });
        break;
      case 'deleteRecording':
        await deleteRecordingById(message.id);
        sendResponse({ ok: true });
        break;
      case 'offscreenCaptureTick':
        sendResponse(await captureScreenshot({ trigger: 'auto' }));
        break;
      case 'offscreenMediaUpdated':
        await handleOffscreenMediaUpdated(message.payload || {});
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown action' });
    }
  })().catch((error) => {
    console.error('[Background] Action failed:', message.action, error);
    notifyPopup('error', { message: error.message || '发生未知错误' });
    sendResponse({ ok: false, error: error.message || 'Unknown error' });
  });

  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-screenshot') {
    ensureInitialized()
      .then(() => captureScreenshot({ trigger: 'manual' }))
      .catch((error) => console.error('[Background] Command failed:', error));
  }
});

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = initialize();
  }

  await initPromise;
}

async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

  const { [SETTINGS_KEY]: storedSettings, [HISTORY_KEY]: storedHistory } = await chrome.storage.local.get([
    SETTINGS_KEY,
    HISTORY_KEY
  ]);

  if (!storedSettings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  } else {
    await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(storedSettings) });
  }

  if (!Array.isArray(storedHistory)) {
    await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  }

  await restoreRuntimeState();
  await updateBadge();
}

function createIdleRuntime() {
  return {
    isRecording: false,
    isPaused: false,
    isGenerating: false,
    count: 0,
    startTime: null,
    pausedDurationMs: 0,
    pauseStartedAt: null,
    durationMs: 0,
    tabId: null,
    windowId: null,
    recordingId: null,
    captureMode: DEFAULT_SETTINGS.captureMode,
    screenshotEngine: DEFAULT_SETTINGS.screenshotEngine,
    cdpAttached: false,
    cdpWarningShown: false,
    cdpCrop: null,
    captureIntervalMs: DEFAULT_SETTINGS.screenshotInterval * 1000,
    autoScreenshot: DEFAULT_SETTINGS.autoScreenshot,
    audioStarted: false,
    videoStarted: false,
    mediaStatus: '待启动',
    lastInteraction: null
  };
}

function normalizeSettings(settings = {}) {
  const preset = getProviderPreset(settings.providerPreset);
  const apiStyle = normalizeApiStyle(settings.apiStyle ?? preset.apiStyle);
  const modelId = sanitizeTextValue(settings.modelId ?? settings.endpointId ?? '', 120);

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    providerPreset: getProviderPresetKey(settings.providerPreset),
    apiStyle,
    apiBaseUrl: sanitizeApiBaseUrl(settings.apiBaseUrl || preset.apiBaseUrl, getProviderPresetKey(settings.providerPreset)),
    outputDir: sanitizeOutputDir(settings.outputDir),
    modelId,
    extraHeadersJson: normalizeHeadersJson(settings.extraHeadersJson),
    promptPreset: getPromptPresetKey(settings.promptPreset),
    customSystemPrompt: sanitizePromptValue(
      settings.customSystemPrompt,
      PROMPT_PRESETS.default.systemPrompt.length * 8
    ),
    customUserPrompt: sanitizePromptValue(
      settings.customUserPrompt,
      PROMPT_PRESETS.default.userPromptTemplate.length * 8
    ),
    captureMode: normalizeCaptureMode(settings.captureMode),
    screenshotEngine: normalizeScreenshotEngine(settings.screenshotEngine),
    cdpCropEnabled: settings.cdpCropEnabled === true,
    cdpCropX: sanitizeNonNegativeInteger(settings.cdpCropX),
    cdpCropY: sanitizeNonNegativeInteger(settings.cdpCropY),
    cdpCropWidth: sanitizeNonNegativeInteger(settings.cdpCropWidth),
    cdpCropHeight: sanitizeNonNegativeInteger(settings.cdpCropHeight),
    promptForSaveAs: settings.promptForSaveAs === true,
    screenshotInterval: clampInterval(settings.screenshotInterval ?? DEFAULT_SETTINGS.screenshotInterval),
    autoScreenshot: settings.autoScreenshot !== false
  };
}

function getProviderPresetKey(value) {
  return Object.hasOwn(PROVIDER_PRESETS, value) ? value : DEFAULT_SETTINGS.providerPreset;
}

function getProviderPreset(value) {
  return PROVIDER_PRESETS[getProviderPresetKey(value)];
}

function getPromptPresetKey(value) {
  return Object.hasOwn(PROMPT_PRESETS, value) ? value : DEFAULT_SETTINGS.promptPreset;
}

function getPromptPreset(value) {
  return PROMPT_PRESETS[getPromptPresetKey(value)];
}

function normalizeApiStyle(value) {
  if (value === 'responses') {
    return 'responses';
  }

  if (value === 'anthropicMessages') {
    return 'anthropicMessages';
  }

  return 'chatCompletions';
}

function normalizeCaptureMode(value) {
  return value === 'tabCapture' ? 'tabCapture' : 'displayMedia';
}

function normalizeScreenshotEngine(value) {
  return value === 'cdp' ? 'cdp' : 'standard';
}

function sanitizeNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(parsed, 100_000);
}

function buildCdpCropFromSettings(settings = {}) {
  if (
    settings.cdpCropEnabled !== true ||
    !settings.cdpCropWidth ||
    !settings.cdpCropHeight
  ) {
    return null;
  }

  return {
    x: sanitizeNonNegativeInteger(settings.cdpCropX),
    y: sanitizeNonNegativeInteger(settings.cdpCropY),
    width: sanitizeNonNegativeInteger(settings.cdpCropWidth),
    height: sanitizeNonNegativeInteger(settings.cdpCropHeight),
    scale: 1
  };
}

function sanitizeApiBaseUrl(value, providerPreset = DEFAULT_SETTINGS.providerPreset) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return '';
  }

  let normalized = raw.replace(/\/+$/, '');

  try {
    const parsed = new URL(normalized);
    const isSiliconFlow =
      providerPreset === 'siliconFlow' || /^api\.siliconflow\.(cn|com)$/i.test(parsed.hostname);

    if (isSiliconFlow && !/\/v\d+$/i.test(parsed.pathname)) {
      normalized = `${parsed.origin}/v1`;
    }
  } catch (error) {
    if (providerPreset === 'siliconFlow' && !/\/v\d+$/i.test(normalized)) {
      normalized = `${normalized}/v1`.replace(/\/+$/, '/v1');
    }
  }

  return normalized;
}

function normalizeHeadersJson(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizePromptValue(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\r\n?/g, '\n').trim().slice(0, maxLength);
}

function sanitizeTextValue(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function clampInterval(seconds) {
  const value = Number.parseInt(seconds, 10);
  if (Number.isNaN(value)) {
    return DEFAULT_SETTINGS.screenshotInterval;
  }

  return Math.min(60, Math.max(1, value));
}

function sanitizeOutputDir(value) {
  const raw = typeof value === 'string' ? value : DEFAULT_SETTINGS.outputDir;
  const normalized = raw.replaceAll('\\', '/').trim();
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[<>:"|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return segments.join('/') || DEFAULT_SETTINGS.outputDir;
}

async function getSettings() {
  const { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(settings);
}

async function saveSettings(settings) {
  const currentSettings = await getSettings();
  const nextSettings = normalizeSettings({
    ...currentSettings,
    ...settings
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });

  if (currentRuntime.isRecording) {
    currentRuntime.captureIntervalMs = nextSettings.screenshotInterval * 1000;
    currentRuntime.autoScreenshot = nextSettings.autoScreenshot;
    await persistRuntime();

    await sendOffscreenMessage('updateSession', {
      intervalMs: currentRuntime.captureIntervalMs,
      autoCapture: currentRuntime.autoScreenshot,
      paused: currentRuntime.isPaused
    }).catch(() => {});
  }

  return nextSettings;
}

async function restoreRuntimeState() {
  const { [RUNTIME_KEY]: runtime } = await chrome.storage.session.get(RUNTIME_KEY);

  if (!runtime?.recordingId) {
    currentRuntime = createIdleRuntime();
    currentRecording = null;
    return;
  }

  currentRuntime = { ...createIdleRuntime(), ...runtime };
  currentRecording = await getRecording(currentRuntime.recordingId);

  if (!currentRecording) {
    currentRuntime = createIdleRuntime();
    await persistRuntime();
  }
}

async function persistRuntime() {
  await chrome.storage.session.set({ [RUNTIME_KEY]: currentRuntime });
}

function serializeRuntimeForUi() {
  const now = Date.now();
  const elapsedMs = currentRuntime.isRecording ? getElapsedMs(now) : currentRuntime.durationMs || 0;

  return {
    ...currentRuntime,
    elapsedMs
  };
}

function getElapsedMs(now = Date.now()) {
  if (!currentRuntime.startTime) {
    return 0;
  }

  let elapsed = now - currentRuntime.startTime - (currentRuntime.pausedDurationMs || 0);

  if (currentRuntime.isPaused && currentRuntime.pauseStartedAt) {
    elapsed -= now - currentRuntime.pauseStartedAt;
  }

  return Math.max(0, elapsed);
}

async function startRecording(tabId) {
  if (currentRuntime.isRecording) {
    return;
  }

  const settings = await getSettings();
  const tab = await chrome.tabs.get(tabId);
  const startedAt = Date.now();

  currentRecording = {
    id: startedAt.toString(),
    startTime: startedAt,
    title: '',
    status: 'recording',
    captureMode: settings.captureMode,
    screenshots: [],
    audioDataUrl: null,
    audioMeta: null,
    videoDataUrl: null,
    videoMeta: null,
    exportBaseName: '',
    lastExportAt: null,
    lastExportPrompted: false
  };

  currentRuntime = {
    ...createIdleRuntime(),
    isRecording: true,
    startTime: startedAt,
    tabId: tab.id,
    windowId: tab.windowId,
    recordingId: currentRecording.id,
    captureMode: settings.captureMode,
    screenshotEngine: settings.screenshotEngine,
    cdpAttached: false,
    cdpWarningShown: false,
    cdpCrop: buildCdpCropFromSettings(settings),
    captureIntervalMs: settings.screenshotInterval * 1000,
    autoScreenshot: settings.autoScreenshot,
    mediaStatus: '正在请求授权...'
  };

  await putRecording(currentRecording);
  await persistRuntime();
  await updateBadge();

  try {
    if (settings.screenshotEngine === 'cdp') {
      await attachCdpDebugger(tab.id).catch(async (error) => {
        currentRuntime.screenshotEngine = 'standard';
        currentRuntime.cdpAttached = false;
        currentRuntime.cdpWarningShown = true;
        currentRuntime.cdpCrop = null;
        await persistRuntime();
        notifyPopup('warning', {
          message: `CDP 截图启动失败，已回退到标准模式：${error.message || '未知错误'}`
        });
      });
    }

    let captureStreamId = '';

    if (settings.captureMode === 'tabCapture') {
      captureStreamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tab.id
      });
    }

    const offscreenState = await ensureOffscreenDocument()
      .then(() =>
        sendOffscreenMessage('startSession', {
          captureMode: settings.captureMode,
          captureStreamId,
          tabId: tab.id,
          windowId: tab.windowId,
          intervalMs: currentRuntime.captureIntervalMs,
          autoCapture: currentRuntime.autoScreenshot
        })
      )
      .catch((error) => ({
        audioStarted: false,
        videoStarted: false,
        error: error.message || '无法启动媒体录制'
      }));

    currentRuntime.audioStarted = offscreenState?.audioStarted === true;
    currentRuntime.videoStarted = offscreenState?.videoStarted === true;
    currentRuntime.mediaStatus = summarizeMediaState(currentRuntime.audioStarted, currentRuntime.videoStarted);
    await persistRuntime();

    if (offscreenState?.error) {
      notifyPopup('warning', { message: `媒体未完整启动：${offscreenState.error}` });
    }

    await captureScreenshot({ trigger: 'initial', allowWhenPaused: true });

    notifyPopup('started', {
      startTime: currentRuntime.startTime,
      recordingId: currentRuntime.recordingId,
      count: currentRuntime.count,
      captureMode: currentRuntime.captureMode,
      screenshotEngine: currentRuntime.screenshotEngine,
      cdpAttached: currentRuntime.cdpAttached,
      audioStarted: currentRuntime.audioStarted,
      videoStarted: currentRuntime.videoStarted,
      mediaStatus: currentRuntime.mediaStatus
    });
    notifyContent('recordingStarted');
  } catch (error) {
    await detachCdpDebugger();
    await closeOffscreenDocument();
    await deleteRecording(currentRecording.id).catch(() => {});
    currentRecording = null;
    currentRuntime = createIdleRuntime();
    await persistRuntime();
    await updateBadge();
    throw error;
  }
}

async function pauseRecording() {
  if (!currentRuntime.isRecording || currentRuntime.isPaused) {
    return;
  }

  currentRuntime.isPaused = true;
  currentRuntime.pauseStartedAt = Date.now();
  await persistRuntime();
  await updateBadge();

  await sendOffscreenMessage('pauseSession').catch((error) => {
    notifyPopup('warning', { message: `媒体暂停失败：${error.message}` });
  });

  notifyPopup('paused');
  notifyContent('recordingPaused');
}

async function resumeRecording() {
  if (!currentRuntime.isRecording || !currentRuntime.isPaused) {
    return;
  }

  if (currentRuntime.pauseStartedAt) {
    currentRuntime.pausedDurationMs += Date.now() - currentRuntime.pauseStartedAt;
  }

  currentRuntime.pauseStartedAt = null;
  currentRuntime.isPaused = false;
  await persistRuntime();
  await updateBadge();

  await sendOffscreenMessage('resumeSession', {
    intervalMs: currentRuntime.captureIntervalMs,
    autoCapture: currentRuntime.autoScreenshot
  }).catch((error) => {
    notifyPopup('warning', { message: `媒体恢复失败：${error.message}` });
  });

  notifyPopup('resumed');
  notifyContent('recordingResumed');
}

async function stopRecording() {
  if (!currentRuntime.isRecording || !currentRecording) {
    return;
  }

  const stoppedAt = Date.now();

  if (currentRuntime.isPaused && currentRuntime.pauseStartedAt) {
    currentRuntime.pausedDurationMs += stoppedAt - currentRuntime.pauseStartedAt;
  }

  currentRuntime.isPaused = true;
  currentRuntime.pauseStartedAt = null;
  currentRuntime.isGenerating = true;
  currentRuntime.durationMs = getElapsedMs(stoppedAt);
  await persistRuntime();
  await updateBadge();

  try {
    await captureScreenshot({ trigger: 'final', allowWhenPaused: true });
  } catch (error) {
    console.warn('[Background] Final capture failed:', error);
  }

  notifyPopup('stopped');
  notifyContent('recordingStopped');
  notifyPopup('generating', { message: '正在整理音频、视频和截图...' });

  const mediaResult = await sendOffscreenMessage('stopSession').catch((error) => ({
    audioDataUrl: null,
    videoDataUrl: null,
    error: error.message || '媒体停止失败',
    durationMs: currentRuntime.durationMs
  }));

  applyMediaResult(currentRecording, mediaResult, currentRuntime.durationMs);

  await putRecording(currentRecording);
  await detachCdpDebugger();

  try {
    await generateTutorial();
  } catch (error) {
    currentRecording.status = 'failed';
    await putRecording(currentRecording);
    currentRuntime = createIdleRuntime();
    await persistRuntime();
    await updateBadge();
    currentRecording = null;
    throw error;
  } finally {
    await detachCdpDebugger();
    await closeOffscreenDocument();
  }
}

async function captureScreenshot({ trigger = 'manual', allowWhenPaused = false } = {}) {
  if (!currentRuntime.isRecording || !currentRecording || !currentRuntime.tabId) {
    return { ok: false, captured: false };
  }

  if (currentRuntime.isPaused && !allowWhenPaused) {
    return { ok: false, captured: false };
  }

  const tab = await chrome.tabs.get(currentRuntime.tabId).catch(() => null);
  if (!tab) {
    throw new Error('录制页面已经关闭，无法继续截图');
  }

  currentRuntime.windowId = tab.windowId;
  const dataUrl = await captureScreenshotDataUrl(tab);

  const timestamp = Date.now();
  currentRecording.screenshots.push({
    id: timestamp.toString(),
    data: dataUrl,
    timestamp,
    timeOffsetMs: getElapsedMs(timestamp),
    trigger,
    description: '',
    pageContext: {
      title: tab.title || '',
      url: tab.url || '',
      interaction: getRelevantInteraction(timestamp)
    }
  });

  currentRuntime.count = currentRecording.screenshots.length;
  await putRecording(currentRecording);
  await persistRuntime();
  await updateBadge();

  notifyPopup('screenshot', {
    count: currentRuntime.count,
    elapsedMs: getElapsedMs(timestamp)
  });
  notifyContent('screenshotFeedback', { count: currentRuntime.count });

  return { ok: true, captured: true, count: currentRuntime.count };
}

async function captureScreenshotDataUrl(tab) {
  if (currentRuntime.screenshotEngine === 'cdp' && currentRuntime.cdpAttached) {
    try {
      return await captureVisibleTabWithCdp(tab.id);
    } catch (error) {
      currentRuntime.screenshotEngine = 'standard';
      currentRuntime.cdpAttached = false;
      currentRuntime.cdpCrop = null;
      await persistRuntime();
      notifyPopup('warning', {
        message: `CDP 截图失败，已回退到标准模式：${error.message || '未知错误'}`
      });
      await detachCdpDebugger(tab.id);
    }
  }

  return chrome.tabs.captureVisibleTab(currentRuntime.windowId, {
    format: 'png'
  });
}

async function attachCdpDebugger(tabId) {
  const target = { tabId };
  await chrome.debugger.attach(target, CDP_PROTOCOL_VERSION);
  currentRuntime.cdpAttached = true;
  currentRuntime.screenshotEngine = 'cdp';
  await chrome.debugger.sendCommand(target, 'Page.enable').catch(() => {});
  await chrome.debugger.sendCommand(target, 'DOM.enable').catch(() => {});
  await persistRuntime();
  notifyPopup('cdpStatus', {
    active: true,
    message: '录制中使用 CDP 精确截图，Chrome 可能显示调试提示，录制结束后会自动消失。'
  });
}

async function detachCdpDebugger(tabId = currentRuntime.tabId) {
  if (!tabId || !currentRuntime.cdpAttached) {
    return;
  }

  await chrome.debugger.detach({ tabId }).catch(() => {});
  currentRuntime.cdpAttached = false;
  await persistRuntime().catch(() => {});
  notifyPopup('cdpStatus', { active: false });
}

async function captureVisibleTabWithCdp(tabId) {
  const target = { tabId };
  const params = {
    format: 'png',
    fromSurface: true
  };

  if (currentRuntime.cdpCrop) {
    params.clip = currentRuntime.cdpCrop;
  }

  const result = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', params);
  if (!result?.data) {
    throw new Error('CDP 未返回截图数据');
  }

  return `data:image/png;base64,${result.data}`;
}

async function generateTutorial() {
  if (!currentRecording?.screenshots.length) {
    throw new Error('没有可导出的截图');
  }

  const settings = await getSettings();
  const canAnalyze = Boolean(settings.apiKey && settings.modelId && settings.apiBaseUrl);

  if (canAnalyze) {
    for (let index = 0; index < currentRecording.screenshots.length; index += 1) {
      notifyPopup('generating', {
        message: `正在分析步骤 ${index + 1}/${currentRecording.screenshots.length}...`
      });

      try {
        currentRecording.screenshots[index].description = await analyzeImage(
          currentRecording.screenshots[index],
          settings,
          index,
          currentRecording.screenshots
        );
      } catch (error) {
        console.error('[Background] Analyze error:', error);
        notifyPopup('warning', {
          message: `步骤 ${index + 1} ${describeAiFailureForUser(error)}，已改用默认说明继续导出。`
        });
        currentRecording.screenshots[index].description = getFallbackDescription(
          currentRecording.screenshots[index],
          index
        );
      }
    }
  } else {
    notifyPopup('generating', {
      message: '未配置 AI，正在使用默认步骤说明生成教程...'
    });

    currentRecording.screenshots = currentRecording.screenshots.map((screenshot, index) => ({
      ...screenshot,
      description: screenshot.description || getFallbackDescription(screenshot, index)
    }));
  }

  currentRecording.title = buildRecordingTitle(currentRecording);
  currentRecording.status = 'ready';
  await putRecording(currentRecording);

  notifyPopup('generating', { message: '正在生成 PDF 和 Markdown...' });

  const markdown = buildMarkdown(currentRecording);
  const pdfResult = await sendOffscreenMessage('generatePdf', {
    recording: buildPdfPayload(currentRecording)
  }).catch((error) => ({ pdfDataUrl: null, error: error.message || 'PDF 生成失败' }));

  if (pdfResult?.error) {
    notifyPopup('warning', { message: `PDF 生成失败：${pdfResult.error}` });
  }

  const exportBaseName = await downloadRecordingBundle(
    currentRecording,
    markdown,
    pdfResult?.pdfDataUrl || null,
    settings.outputDir,
    settings.promptForSaveAs
  );

  currentRecording.exportBaseName = exportBaseName;
  currentRecording.lastExportAt = Date.now();
  currentRecording.lastExportPrompted = settings.promptForSaveAs;
  await putRecording(currentRecording);

  await upsertHistoryEntry(buildHistoryEntry(currentRecording));

  currentRuntime = createIdleRuntime();
  await persistRuntime();
  await updateBadge();
  currentRecording = null;

  notifyPopup('complete', {
    history: await getHistory()
  });
}

async function analyzeImage(screenshot, settings, index, screenshots) {
  const request = buildVisionRequest(screenshot, settings, index, screenshots);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_ANALYZE_TIMEOUT_MS);

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    });

    if (!response.ok) {
      const responseText = (await response.text()).slice(0, 200).trim();
      const statusText = response.statusText ? ` ${response.statusText}` : '';
      throw new Error(`HTTP ${response.status}${statusText}${responseText ? `: ${responseText}` : ''}`);
    }

    const data = await response.json();
    return extractVisionText(data, settings.apiStyle) || '未命名步骤';
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createAiTimeoutError();
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildRecordingTitle(recording) {
  const firstDescription = recording.screenshots.find((item) => item.description)?.description || '教程录制';
  return firstDescription.slice(0, 36);
}

function buildRecordingDetail(recording) {
  if (!recording) {
    return null;
  }

  return {
    id: recording.id,
    title: recording.title || buildRecordingTitle(recording),
    createdAt: recording.startTime,
    durationMs: getRecordingDuration(recording),
    screenshotCount: recording.screenshots.length,
    hasAudio: Boolean(recording.audioDataUrl),
    hasVideo: Boolean(recording.videoDataUrl),
    captureMode: recording.captureMode || DEFAULT_SETTINGS.captureMode,
    exportBaseName: recording.exportBaseName || '',
    lastExportPrompted: recording.lastExportPrompted === true,
    screenshots: recording.screenshots.map((screenshot, index) => ({
      id: screenshot.id,
      index: index + 1,
      description: screenshot.description || `步骤 ${index + 1}`,
      timeOffsetMs: screenshot.timeOffsetMs || 0,
      timestamp: screenshot.timestamp || recording.startTime + (screenshot.timeOffsetMs || 0),
      timestampLabel: formatDuration(screenshot.timeOffsetMs || 0),
      data: screenshot.data
    }))
  };
}

function buildPdfPayload(recording) {
  return {
    id: recording.id,
    title: recording.title,
    createdAt: recording.startTime,
    durationMs: getRecordingDuration(recording),
    audioAvailable: Boolean(recording.audioDataUrl),
    videoAvailable: Boolean(recording.videoDataUrl),
    screenshots: recording.screenshots.map((screenshot, index) => ({
      index: index + 1,
      description: screenshot.description || `步骤 ${index + 1}`,
      timestampLabel: formatDuration(screenshot.timeOffsetMs || 0),
      data: screenshot.data
    }))
  };
}

function buildMarkdown(recording) {
  const lines = [
    `# ${recording.title}`,
    '',
    `> 创建时间：${new Date(recording.startTime).toLocaleString()}`,
    `> 录制时长：${formatDuration(getRecordingDuration(recording))}`,
    `> 截图数量：${recording.screenshots.length}`,
    `> 录制模式：${recording.captureMode === 'tabCapture' ? '直接录制当前标签页' : '共享屏幕/标签页'}`,
    `> 音频文件：${recording.audioDataUrl ? 'audio/tutorial-audio.webm' : '未生成'}`,
    `> 视频文件：${recording.videoDataUrl ? 'video/tutorial-video.webm' : '未生成'}`,
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

async function downloadRecordingBundle(recording, markdown, pdfDataUrl, outputDir, promptForSaveAs) {
  const bundleName = buildBundleName(recording, outputDir);
  const archiveRoot = getArchiveRootName(bundleName);
  const archiveEntries = {
    [`${archiveRoot}/tutorial.md`]: strToU8(markdown)
  };

  if (pdfDataUrl) {
    archiveEntries[`${archiveRoot}/tutorial.pdf`] = dataUrlToUint8Array(pdfDataUrl);
  }

  if (recording.audioDataUrl) {
    archiveEntries[`${archiveRoot}/audio/tutorial-audio.webm`] = dataUrlToUint8Array(recording.audioDataUrl);
  }

  if (recording.videoDataUrl) {
    archiveEntries[`${archiveRoot}/video/tutorial-video.webm`] = dataUrlToUint8Array(recording.videoDataUrl);
  }

  for (let index = 0; index < recording.screenshots.length; index += 1) {
    archiveEntries[
      `${archiveRoot}/screenshots/step-${String(index + 1).padStart(2, '0')}.png`
    ] = dataUrlToUint8Array(recording.screenshots[index].data);
  }

  const zipBytes = zipSync(archiveEntries, { level: 6 });
  const zipFilename = `${bundleName}.zip`;
  await downloadBlob(zipFilename, new Blob([zipBytes], { type: 'application/zip' }), promptForSaveAs);
  return zipFilename;
}

function buildBundleName(recording, outputDir = DEFAULT_SETTINGS.outputDir) {
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

async function downloadText(filename, content, mimeType, promptForSaveAs = false) {
  const blob = new Blob([content], { type: mimeType });
  await downloadBlob(filename, blob, promptForSaveAs);
}

async function downloadUrl(filename, url, promptForSaveAs = false) {
  await chrome.downloads.download({
    url,
    filename,
    saveAs: promptForSaveAs
  });
}

async function downloadBlob(filename, blob, promptForSaveAs = false) {
  const dataUrl = await blobToDataUrl(blob);
  await downloadUrl(filename, dataUrl, promptForSaveAs);
}

function dataUrlToUint8Array(dataUrl) {
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

function getArchiveRootName(bundleName) {
  return bundleName.split('/').filter(Boolean).pop() || bundleName;
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

async function getHistory() {
  const { [HISTORY_KEY]: history } = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(history) ? history : [];
}

async function upsertHistoryEntry(entry) {
  const history = await getHistory();
  const nextHistory = [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, 20);
  await chrome.storage.local.set({ [HISTORY_KEY]: nextHistory });
}

function buildHistoryEntry(recording) {
  return {
    id: recording.id,
    title: recording.title || buildRecordingTitle(recording),
    createdAt: recording.startTime,
    screenshotCount: recording.screenshots.length,
    durationMs: getRecordingDuration(recording),
    hasAudio: Boolean(recording.audioDataUrl),
    hasVideo: Boolean(recording.videoDataUrl),
    captureMode: recording.captureMode || DEFAULT_SETTINGS.captureMode,
    exportedAt: recording.lastExportAt || Date.now(),
    exportBaseName: recording.exportBaseName || '',
    lastExportPrompted: recording.lastExportPrompted === true
  };
}

async function exportRecording(id) {
  const recording = await getRecording(id);

  if (!recording) {
    throw new Error('这条历史记录已不存在');
  }

  notifyPopup('generating', { message: '正在重新导出文件...' });
  const markdown = buildMarkdown(recording);
  const settings = await getSettings();

  const pdfResult = await ensureOffscreenDocument()
    .then(() => sendOffscreenMessage('generatePdf', { recording: buildPdfPayload(recording) }))
    .catch((error) => ({ pdfDataUrl: null, error: error.message || 'PDF 生成失败' }));

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
  await putRecording(recording);
  await upsertHistoryEntry(buildHistoryEntry(recording));

  if (!currentRuntime.isRecording) {
    await closeOffscreenDocument();
  }
  notifyPopup('exported', { history: await getHistory() });
}

async function getRecordingDetail(id) {
  const recording = await getRecording(id);

  if (!recording) {
    throw new Error('这条历史记录已不存在');
  }

  return buildRecordingDetail(recording);
}

async function updateRecordingDetails(id, updates) {
  const recording = await getRecording(id);

  if (!recording) {
    throw new Error('这条历史记录已不存在');
  }

  const nextTitle = sanitizeEditableText(updates.title, 80);
  const nextScreenshots = Array.isArray(updates.screenshots) ? updates.screenshots : null;

  if (nextScreenshots) {
    recording.screenshots = sanitizeUpdatedScreenshots(recording, nextScreenshots);
  }

  recording.title = nextTitle || buildRecordingTitle(recording);
  recording.updatedAt = Date.now();

  await putRecording(recording);
  await upsertHistoryEntry(buildHistoryEntry(recording));
  notifyPopup('historyUpdated', { history: await getHistory() });
  return buildRecordingDetail(recording);
}

function sanitizeUpdatedScreenshots(recording, screenshotUpdates) {
  const existingById = new Map(
    recording.screenshots
      .filter((screenshot) => typeof screenshot?.id === 'string' && screenshot.id)
      .map((screenshot) => [screenshot.id, screenshot])
  );

  const nextScreenshots = screenshotUpdates
    .map((screenshot, index) =>
      sanitizeUpdatedScreenshot(
        screenshot,
        index,
        recording.startTime,
        existingById,
        recording.screenshots[index] || null
      )
    )
    .filter(Boolean);

  if (!nextScreenshots.length) {
    throw new Error('至少保留一张截图');
  }

  return nextScreenshots;
}

function sanitizeUpdatedScreenshot(screenshot, index, startTime, existingById, fallbackExisting) {
  if (!screenshot || typeof screenshot !== 'object') {
    return null;
  }

  const nextId = sanitizeTextValue(screenshot.id || '', 80);
  const existing = nextId ? existingById.get(nextId) || null : fallbackExisting || null;
  const data = sanitizeImageDataUrl(screenshot.data) || existing?.data || '';
  if (!data) {
    return null;
  }

  const timeOffsetMs = sanitizeTimeOffsetMs(screenshot.timeOffsetMs, existing?.timeOffsetMs ?? index * 1000);
  const timestamp = sanitizeTimestampValue(screenshot.timestamp, startTime + timeOffsetMs);

  return {
    ...existing,
    id: nextId || existing?.id || `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    data,
    timestamp,
    timeOffsetMs,
    description:
      sanitizeEditableText(screenshot.description, 400) ||
      existing?.description ||
      `步骤 ${index + 1}`,
    trigger: existing?.trigger || 'manual-edit',
    pageContext: existing?.pageContext || null
  };
}

function sanitizeEditableText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function sanitizeImageDataUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return /^data:image\/[-+\w.]+;base64,/i.test(trimmed) ? trimmed : '';
}

function sanitizeTimeOffsetMs(value, fallbackValue = 0) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return Math.max(0, Number.parseInt(fallbackValue, 10) || 0);
  }

  return Math.min(parsed, 24 * 60 * 60 * 1000);
}

function sanitizeTimestampValue(value, fallbackValue) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return parsed;
}

async function deleteRecordingById(id) {
  await deleteRecording(id);
  const history = await getHistory();
  await chrome.storage.local.set({
    [HISTORY_KEY]: history.filter((item) => item.id !== id)
  });

  notifyPopup('historyUpdated', { history: await getHistory() });
}

function notifyPopup(action, payload = {}) {
  chrome.runtime.sendMessage({ action, ...payload }).catch(() => {});
}

function notifyContent(action, payload = {}) {
  if (!currentRuntime.tabId) {
    return;
  }

  chrome.tabs.sendMessage(currentRuntime.tabId, { action, ...payload }).catch(() => {});
}

async function handleOffscreenMediaUpdated(payload = {}) {
  if (!currentRuntime.isRecording) {
    return;
  }

  currentRuntime.audioStarted = payload.audioStarted === true;
  currentRuntime.videoStarted = payload.videoStarted === true;
  currentRuntime.mediaStatus = summarizeMediaState(currentRuntime.audioStarted, currentRuntime.videoStarted);
  await persistRuntime();

  notifyPopup('mediaUpdated', {
    audioStarted: currentRuntime.audioStarted,
    videoStarted: currentRuntime.videoStarted,
    mediaStatus: currentRuntime.mediaStatus
  });

  if (payload.message) {
    notifyPopup('warning', { message: payload.message });
  }
}

function summarizeMediaState(audioStarted, videoStarted) {
  if (audioStarted && videoStarted) {
    return '音频+视频';
  }

  if (videoStarted) {
    return '仅视频';
  }

  if (audioStarted) {
    return '仅音频';
  }

  return '未授权';
}

function applyMediaResult(recording, mediaResult, fallbackDurationMs) {
  if (mediaResult?.audioDataUrl) {
    recording.audioDataUrl = mediaResult.audioDataUrl;
    recording.audioMeta = {
      mimeType: mediaResult.audioMimeType || 'audio/webm',
      size: mediaResult.audioSize || 0,
      durationMs: mediaResult.audioDurationMs || fallbackDurationMs
    };
  } else if (mediaResult?.audioError) {
    recording.audioMeta = {
      mimeType: '',
      size: 0,
      durationMs: fallbackDurationMs,
      error: mediaResult.audioError
    };
    notifyPopup('warning', { message: `音频未导出：${mediaResult.audioError}` });
  }

  if (mediaResult?.videoDataUrl) {
    recording.videoDataUrl = mediaResult.videoDataUrl;
    recording.videoMeta = {
      mimeType: mediaResult.videoMimeType || 'video/webm',
      size: mediaResult.videoSize || 0,
      durationMs: mediaResult.videoDurationMs || fallbackDurationMs
    };
  } else if (mediaResult?.videoError) {
    recording.videoMeta = {
      mimeType: '',
      size: 0,
      durationMs: fallbackDurationMs,
      error: mediaResult.videoError
    };
    notifyPopup('warning', { message: `视频未导出：${mediaResult.videoError}` });
  }
}

async function recordInteraction(payload, sender) {
  if (!currentRuntime.isRecording || !currentRecording) {
    return;
  }

  if (sender.tab?.id && currentRuntime.tabId && sender.tab.id !== currentRuntime.tabId) {
    return;
  }

  const cdpElement = await locateElementWithCdp(payload).catch(() => null);
  const cdpSummary = cdpElement ? buildCdpInteractionSummary(payload.type, cdpElement) : '';

  currentRuntime.lastInteraction = {
    type: sanitizeEditableText(payload.type, 40) || 'interaction',
    summary: sanitizeEditableText(cdpSummary || payload.summary, 160),
    target: sanitizeEditableText(cdpElement?.target || payload.target, 160),
    cdpElement,
    timestamp: Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now()
  };

  await persistRuntime();
}

async function locateElementWithCdp(payload = {}) {
  if (
    currentRuntime.screenshotEngine !== 'cdp' ||
    !currentRuntime.cdpAttached ||
    !Number.isFinite(payload.clientX) ||
    !Number.isFinite(payload.clientY) ||
    payload.type !== 'click'
  ) {
    return null;
  }

  const target = { tabId: currentRuntime.tabId };
  const location = await chrome.debugger.sendCommand(target, 'DOM.getNodeForLocation', {
    x: Math.round(payload.clientX),
    y: Math.round(payload.clientY),
    includeUserAgentShadowDOM: true,
    ignorePointerEventsNone: true
  });

  const nodeRef = location?.backendNodeId
    ? { backendNodeId: location.backendNodeId }
    : location?.nodeId
      ? { nodeId: location.nodeId }
      : null;

  if (!nodeRef) {
    return null;
  }

  const described = await chrome.debugger.sendCommand(target, 'DOM.describeNode', nodeRef);
  return describeCdpNode(described?.node);
}

function describeCdpNode(node) {
  if (!node?.nodeName) {
    return null;
  }

  const attributes = {};
  const rawAttributes = Array.isArray(node.attributes) ? node.attributes : [];
  for (let index = 0; index < rawAttributes.length; index += 2) {
    attributes[String(rawAttributes[index] || '').toLowerCase()] = String(rawAttributes[index + 1] || '');
  }

  const tagName = String(node.nodeName || '').toLowerCase();
  const label = sanitizeEditableText(
    attributes['aria-label'] ||
      attributes.title ||
      attributes.placeholder ||
      attributes.name ||
      attributes['data-testid'] ||
      attributes.role ||
      '',
    60
  );
  const kind = getCdpNodeKind(tagName, attributes.role);
  const target = label ? `“${label}”${kind}` : kind || tagName || '页面元素';

  return {
    tagName,
    role: sanitizeEditableText(attributes.role, 40),
    label,
    target
  };
}

function getCdpNodeKind(tagName, role) {
  if (role === 'button' || tagName === 'button') {
    return '按钮';
  }

  if (tagName === 'input' || tagName === 'textarea') {
    return '输入框';
  }

  if (tagName === 'select') {
    return '下拉框';
  }

  if (tagName === 'a') {
    return '链接';
  }

  return '页面元素';
}

function buildCdpInteractionSummary(type, element) {
  if (!element?.target) {
    return '';
  }

  if (type === 'click') {
    return `点击${element.target}`;
  }

  return '';
}

function getRelevantInteraction(timestamp) {
  const interaction = currentRuntime.lastInteraction;
  if (!interaction?.summary) {
    return null;
  }

  if (Math.abs(timestamp - interaction.timestamp) > 15_000) {
    return null;
  }

  return interaction;
}

function getFallbackDescription(screenshot, index) {
  const interactionSummary = screenshot?.pageContext?.interaction?.summary;
  if (interactionSummary) {
    return interactionSummary;
  }

  const pageTitle = sanitizePageTitle(screenshot?.pageContext?.title);
  if (pageTitle) {
    return `查看 ${pageTitle}`;
  }

  return `步骤 ${index + 1}`;
}

function buildPromptContext(screenshot, index, screenshots) {
  const pageTitle = sanitizePageTitle(screenshot?.pageContext?.title) || '未知页面';
  const pageUrl = summarizeUrlForPrompt(screenshot?.pageContext?.url);
  const interactionSummary = screenshot?.pageContext?.interaction?.summary || '没有可靠的交互记录';
  const previousDescription = screenshots[index - 1]?.description || '无';

  return {
    stepIndex: String(index + 1),
    totalSteps: String(screenshots.length),
    pageTitle,
    pageUrl,
    pageUrlLine: pageUrl ? `页面地址：${pageUrl}。` : '',
    interactionSummary,
    previousDescription
  };
}

function sanitizePageTitle(title) {
  return sanitizeEditableText(title, 120);
}

function summarizeUrlForPrompt(url) {
  if (typeof url !== 'string' || !url) {
    return '';
  }

  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.slice(0, 160);
  } catch (error) {
    return sanitizeEditableText(url, 160);
  }
}

function getEffectivePromptConfig(settings = {}) {
  const presetKey = getPromptPresetKey(settings.promptPreset);
  const preset = getPromptPreset(presetKey);
  if (presetKey !== 'custom') {
    return preset;
  }

  return {
    ...preset,
    systemPrompt: settings.customSystemPrompt || PROMPT_PRESETS.default.systemPrompt,
    userPromptTemplate: settings.customUserPrompt || PROMPT_PRESETS.default.userPromptTemplate
  };
}

function renderPromptTemplate(template, context) {
  const rendered = String(template || '').replace(/{{\s*(\w+)\s*}}/g, (_, key) =>
    Object.hasOwn(context, key) ? String(context[key] ?? '') : ''
  );

  return rendered
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n')
    .trim();
}

function buildVisionRequest(screenshot, settings, index, screenshots) {
  const imageData = screenshot.data;
  const apiStyle = normalizeApiStyle(settings.apiStyle);
  const extraHeaders = parseExtraHeaders(settings.extraHeadersJson);
  const promptConfig = getEffectivePromptConfig(settings);
  const contextPrompt = renderPromptTemplate(
    promptConfig.userPromptTemplate,
    buildPromptContext(screenshot, index, screenshots)
  );
  const headers =
    apiStyle === 'anthropicMessages'
      ? {
          'Content-Type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': '2023-06-01',
          ...extraHeaders
        }
      : {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
          ...extraHeaders
        };
  const url = resolveVisionUrl(settings.apiBaseUrl, apiStyle);

  if (apiStyle === 'anthropicMessages') {
    const { mediaType, base64 } = parseImageDataUrl(imageData);

    return {
      url,
      headers,
      body: {
        model: settings.modelId,
        system: promptConfig.systemPrompt,
        max_tokens: 160,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: contextPrompt },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64
                }
              }
            ]
          }
        ]
      }
    };
  }

  if (apiStyle === 'responses') {
    return {
      url,
      headers,
      body: {
        model: settings.modelId,
        instructions: promptConfig.systemPrompt,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: contextPrompt },
              { type: 'input_image', image_url: imageData }
            ]
          }
        ],
        max_output_tokens: 120
      }
    };
  }

  return {
    url,
    headers,
      body: {
        model: settings.modelId,
        messages: [
          {
            role: 'system',
            content: promptConfig.systemPrompt
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: contextPrompt },
              { type: 'image_url', image_url: { url: imageData } }
            ]
          }
      ],
      max_tokens: 120
    }
  };
}

function createAiTimeoutError() {
  const error = new Error(`AI 识别超时（${Math.round(AI_ANALYZE_TIMEOUT_MS / 1000)} 秒）`);
  error.name = 'AITimeoutError';
  return error;
}

function isAiTimeoutError(error) {
  return error?.name === 'AITimeoutError';
}

function describeAiFailureForUser(error) {
  if (isAiTimeoutError(error)) {
    return 'AI 识别超时';
  }

  const message = sanitizeEditableText(error?.message || 'AI 识别失败', 220);
  return `AI 识别失败：${message}`;
}

function resolveVisionUrl(apiBaseUrl, apiStyle) {
  const base = sanitizeApiBaseUrl(apiBaseUrl || getProviderPreset(DEFAULT_SETTINGS.providerPreset).apiBaseUrl);
  const normalizedBase = base
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/messages$/i, '');

  if (apiStyle === 'responses') {
    return `${normalizedBase}/responses`;
  }

  if (apiStyle === 'anthropicMessages') {
    return `${normalizedBase}/messages`;
  }

  return `${normalizedBase}/chat/completions`;
}

function parseExtraHeaders(extraHeadersJson) {
  if (!extraHeadersJson) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(extraHeadersJson);
  } catch (error) {
    throw new Error(`附加请求头 JSON 无法解析：${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('附加请求头必须是 JSON 对象');
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([key, value]) => typeof key === 'string' && key.trim() && value != null)
      .map(([key, value]) => [key.trim(), String(value)])
  );
}

function extractVisionText(data, apiStyle) {
  if (apiStyle === 'responses') {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
      return data.output_text.trim();
    }

    for (const item of data?.output || []) {
      for (const part of item?.content || []) {
        const text = part?.text || part?.content?.[0]?.text;
        if (typeof text === 'string' && text.trim()) {
          return text.trim();
        }
      }
    }

    return '';
  }

  if (apiStyle === 'anthropicMessages') {
    return (data?.content || [])
      .filter((part) => part?.type === 'text' && typeof part?.text === 'string')
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || '')
      .join('\n')
      .trim();
  }

  return '';
}

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[-+\w.]+);base64,(.*)$/);
  if (!match) {
    throw new Error('无法解析截图数据');
  }

  return {
    mediaType: match[1],
    base64: match[2]
  };
}

async function updateBadge() {
  if (currentRuntime.isGenerating) {
    await chrome.action.setBadgeBackgroundColor({ color: '#1677ff' });
    await chrome.action.setBadgeText({ text: '...' });
    await chrome.action.setTitle({ title: '教程录制器：正在生成教程' });
    return;
  }

  if (currentRuntime.isRecording && currentRuntime.isPaused) {
    await chrome.action.setBadgeBackgroundColor({ color: '#faad14' });
    await chrome.action.setBadgeText({ text: 'II' });
    await chrome.action.setTitle({ title: '教程录制器：已暂停' });
    return;
  }

  if (currentRuntime.isRecording) {
    await chrome.action.setBadgeBackgroundColor({ color: '#f5222d' });
    await chrome.action.setBadgeText({ text: 'REC' });
    await chrome.action.setTitle({ title: '教程录制器：录制中' });
    return;
  }

  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: '教程录制器' });
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });

    if (contexts.length) {
      return;
    }
  }

  if (offscreenCreationPromise) {
    return offscreenCreationPromise;
  }

  offscreenCreationPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'BLOBS'],
    justification: 'Record screen, microphone, manage capture timers, and render tutorial PDFs.'
  });

  try {
    await offscreenCreationPromise;
  } finally {
    offscreenCreationPromise = null;
  }
}

async function closeOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
    });

    if (!contexts.length) {
      return;
    }
  }

  await chrome.offscreen.closeDocument().catch(() => {});
}

async function sendOffscreenMessage(type, payload = {}) {
  await ensureOffscreenDocument();
  const response = await Promise.race([
    chrome.runtime.sendMessage({
      action: 'offscreenMessage',
      target: 'offscreen',
      type,
      payload
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Offscreen action timed out: ${type}`)), OFFSCREEN_MESSAGE_TIMEOUT_MS);
    })
  ]);

  if (!response?.ok) {
    throw new Error(response?.error || `Offscreen action failed: ${type}`);
  }

  return response;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getRecordingDuration(recording) {
  return Math.max(
    recording.audioMeta?.durationMs || 0,
    recording.videoMeta?.durationMs || 0,
    recording.screenshots[recording.screenshots.length - 1]?.timeOffsetMs || 0
  );
}
