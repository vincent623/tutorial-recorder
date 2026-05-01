import { strToU8, zipSync } from '../lib/fflate.js';
import { deleteRecording, getRecording, putRecording } from './asset-store.js';

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'recordings';
const RUNTIME_KEY = 'recordingRuntime';
const OFFSCREEN_PATH = 'offscreen/offscreen.html';
const OFFSCREEN_MESSAGE_TIMEOUT_MS = 120_000;
const AI_ANALYZE_TIMEOUT_MS = 45_000;
const CDP_PROTOCOL_VERSION = '1.3';
const AI_AGENT_MAX_STEPS = 50;
const AI_AGENT_MAX_DURATION_MS = 10 * 60 * 1000;
const AI_AGENT_STEP_DELAY_MS = 800;
const OPERATION_RESULT_TTL_MS = 5 * 60 * 1000;

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
  realtimeSuggestions: false,
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
let realtimeSuggestionQueue = {
  active: false,
  pending: null
};
let operationSequence = 0;
const operationLocks = new Map();
const operationSerialQueues = new Map();
const recentOperationResults = new Map();

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
      case 'startAiRecording':
        await startAiRecording(message.tabId, message.targetDescription || '');
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
      case 'pauseAiAgent':
        await pauseAiAgent();
        sendResponse({ ok: true });
        break;
      case 'resumeAiAgent':
        await resumeAiAgent();
        sendResponse({ ok: true });
        break;
      case 'takeoverRecording':
        await takeoverRecording();
        sendResponse({ ok: true });
        break;
      case 'stopRecording':
        await stopRecording(message.operationId);
        sendResponse({ ok: true });
        break;
      case 'manualCapture':
        sendResponse(
          await captureScreenshot({
            trigger: 'manual',
            allowWhenPaused: true,
            operationId: message.operationId
          })
        );
        break;
      case 'recordInteraction':
        await recordInteraction(message.payload || {}, sender);
        sendResponse({ ok: true });
        break;
      case 'downloadRecording':
        await exportRecording(message.id, message.operationId);
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
      case 'updateRealtimeSuggestion':
        sendResponse({
          ok: true,
          suggestion: await updateRealtimeSuggestionOverride(message)
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
    screenshotSequence: 0,
    recordingMode: 'manual',
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
    lastInteraction: null,
    realtimeSuggestion: createRealtimeSuggestionState(),
    aiAgent: createAiAgentState()
  };
}

function createOperationId(prefix = 'op') {
  operationSequence += 1;
  return `${sanitizeOperationId(prefix)}-${Date.now().toString(36)}-${operationSequence}-${createRandomSuffix()}`;
}

function createRandomSuffix() {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0].toString(36).slice(0, 8);
  }

  return Math.random().toString(36).slice(2, 10);
}

function sanitizeOperationId(value) {
  return sanitizeTextValue(value, 160).replace(/[^a-zA-Z0-9:._-]/g, '-');
}

function buildIdempotencyKey(scope, operationId) {
  const sanitizedOperationId = sanitizeOperationId(operationId);
  if (!sanitizedOperationId) {
    return '';
  }

  return `${scope}:${sanitizedOperationId}`;
}

function pruneRecentOperationResults() {
  const now = Date.now();

  for (const [key, item] of recentOperationResults.entries()) {
    if (!item || item.expiresAt <= now) {
      recentOperationResults.delete(key);
    }
  }
}

async function runExclusiveOperation(lockKey, operation) {
  if (operationLocks.has(lockKey)) {
    return operationLocks.get(lockKey);
  }

  const promise = Promise.resolve()
    .then(operation)
    .finally(() => {
      operationLocks.delete(lockKey);
    });

  operationLocks.set(lockKey, promise);
  return promise;
}

async function runSerializedOperation(queueKey, operation) {
  const previous = operationSerialQueues.get(queueKey) || Promise.resolve();
  const promise = previous
    .catch(() => {})
    .then(operation)
    .finally(() => {
      if (operationSerialQueues.get(queueKey) === promise) {
        operationSerialQueues.delete(queueKey);
      }
    });

  operationSerialQueues.set(queueKey, promise);
  return promise;
}

async function runIdempotentOperation(scope, operationId, operation) {
  const idempotencyKey = buildIdempotencyKey(scope, operationId);
  if (!idempotencyKey) {
    return operation();
  }

  pruneRecentOperationResults();

  const cached = recentOperationResults.get(idempotencyKey);
  if (cached) {
    return cached.result;
  }

  return runExclusiveOperation(idempotencyKey, async () => {
    const cachedAfterLock = recentOperationResults.get(idempotencyKey);
    if (cachedAfterLock) {
      return cachedAfterLock.result;
    }

    const result = await operation();
    recentOperationResults.set(idempotencyKey, {
      result,
      expiresAt: Date.now() + OPERATION_RESULT_TTL_MS
    });
    pruneRecentOperationResults();
    return result;
  });
}

function createAiAgentState(overrides = {}) {
  return {
    status: 'idle',
    goal: '',
    steps: [],
    iteration: 0,
    maxSteps: AI_AGENT_MAX_STEPS,
    startedAt: null,
    deadlineAt: null,
    paused: false,
    awaitingTakeover: false,
    lastAction: '',
    message: '',
    updatedAt: 0,
    ...overrides
  };
}

function createRealtimeSuggestionState(overrides = {}) {
  return {
    enabled: DEFAULT_SETTINGS.realtimeSuggestions,
    status: DEFAULT_SETTINGS.realtimeSuggestions ? 'idle' : 'disabled',
    screenshotId: '',
    stepIndex: 0,
    text: '',
    message: '',
    updatedAt: 0,
    ...overrides
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
    autoScreenshot: settings.autoScreenshot !== false,
    realtimeSuggestions: settings.realtimeSuggestions === true
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
    currentRuntime.realtimeSuggestion = normalizeRealtimeSuggestionForSettings(
      currentRuntime.realtimeSuggestion,
      nextSettings
    );
    await persistRuntime();
    notifyRealtimeSuggestion();

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
    recordingMode: 'manual',
    captureMode: settings.captureMode,
    screenshots: [],
    audioDataUrl: null,
    audioMeta: null,
    videoDataUrl: null,
    videoMeta: null,
    realtimeSuggestionsEnabled: settings.realtimeSuggestions === true,
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
    recordingMode: 'manual',
    captureMode: settings.captureMode,
    screenshotEngine: settings.screenshotEngine,
    cdpAttached: false,
    cdpWarningShown: false,
    cdpCrop: buildCdpCropFromSettings(settings),
    captureIntervalMs: settings.screenshotInterval * 1000,
    autoScreenshot: settings.autoScreenshot,
    realtimeSuggestion: createRealtimeSuggestionStateForSettings(settings),
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
      recordingMode: currentRuntime.recordingMode,
      count: currentRuntime.count,
      captureMode: currentRuntime.captureMode,
      screenshotEngine: currentRuntime.screenshotEngine,
      cdpAttached: currentRuntime.cdpAttached,
      audioStarted: currentRuntime.audioStarted,
      videoStarted: currentRuntime.videoStarted,
      mediaStatus: currentRuntime.mediaStatus,
      realtimeSuggestion: currentRuntime.realtimeSuggestion,
      aiAgent: currentRuntime.aiAgent
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

async function startAiRecording(tabId, targetDescription) {
  if (currentRuntime.isRecording) {
    return;
  }

  const goal = sanitizeEditableText(targetDescription, 500);
  if (!goal) {
    throw new Error('请先填写 AI 录制目标');
  }

  const settings = await getSettings();
  if (!hasVisionAnalysisConfig(settings)) {
    throw new Error('请先在完整设置中配置 AI Provider、API Key 和模型');
  }

  const tab = await chrome.tabs.get(tabId);
  const startedAt = Date.now();

  currentRecording = {
    id: startedAt.toString(),
    startTime: startedAt,
    title: goal.slice(0, 36),
    status: 'recording',
    recordingMode: 'ai',
    captureMode: 'agent',
    screenshots: [],
    audioDataUrl: null,
    audioMeta: null,
    videoDataUrl: null,
    videoMeta: null,
    aiGoal: goal,
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
    recordingMode: 'ai',
    captureMode: 'agent',
    screenshotEngine: 'cdp',
    captureIntervalMs: settings.screenshotInterval * 1000,
    autoScreenshot: false,
    mediaStatus: 'AI 录制中',
    aiAgent: createAiAgentState({
      status: 'running',
      goal,
      startedAt,
      deadlineAt: startedAt + AI_AGENT_MAX_DURATION_MS,
      message: 'AI 正在观察页面...'
    })
  };

  await putRecording(currentRecording);
  await persistRuntime();
  await updateBadge();

  try {
    await attachCdpDebugger(tab.id);
    notifyPopup('started', {
      startTime: currentRuntime.startTime,
      recordingId: currentRuntime.recordingId,
      recordingMode: currentRuntime.recordingMode,
      count: currentRuntime.count,
      captureMode: currentRuntime.captureMode,
      screenshotEngine: currentRuntime.screenshotEngine,
      cdpAttached: currentRuntime.cdpAttached,
      audioStarted: false,
      videoStarted: false,
      mediaStatus: currentRuntime.mediaStatus,
      realtimeSuggestion: currentRuntime.realtimeSuggestion,
      aiAgent: currentRuntime.aiAgent
    });
    notifyContent('recordingStarted');
    notifyAiStatus();

    runAiAgentLoop(settings).catch((error) => {
      handleAiAgentFailure(error).catch((failureError) => {
        console.error('[Background] AI failure handling failed:', failureError);
      });
    });
  } catch (error) {
    await detachCdpDebugger(tab.id);
    await deleteRecording(currentRecording.id).catch(() => {});
    currentRecording = null;
    currentRuntime = createIdleRuntime();
    await persistRuntime();
    await updateBadge();
    throw error;
  }
}

async function pauseRecording() {
  if (currentRuntime.recordingMode === 'ai') {
    await pauseAiAgent();
    return;
  }

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
  if (currentRuntime.recordingMode === 'ai') {
    await resumeAiAgent();
    return;
  }

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

async function stopRecording(operationId = '') {
  const recordingId = currentRuntime.recordingId || currentRecording?.id || '';
  const fallbackOperationId = recordingId ? `stop-${recordingId}` : '';
  return runExclusiveOperation('stopRecording', () =>
    runIdempotentOperation('stopRecording', operationId || fallbackOperationId, performStopRecording)
  );
}

async function performStopRecording() {
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
  if (currentRuntime.recordingMode === 'ai') {
    currentRuntime.aiAgent = {
      ...currentRuntime.aiAgent,
      status: 'stopping',
      paused: false,
      message: '正在停止 AI 录制并生成教程...',
      updatedAt: Date.now()
    };
  }
  realtimeSuggestionQueue.pending = null;
  currentRuntime.durationMs = getElapsedMs(stoppedAt);
  await persistRuntime();
  await updateBadge();

  if (currentRuntime.recordingMode === 'ai') {
    await detachCdpDebugger();
    currentRuntime.screenshotEngine = 'standard';
    await persistRuntime();
  }

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

async function captureScreenshot({ trigger = 'manual', allowWhenPaused = false, operationId = '' } = {}) {
  const recordingId = currentRuntime.recordingId || currentRecording?.id || 'idle';
  const queueKey = `captureScreenshot:${recordingId}`;

  return runSerializedOperation(queueKey, () =>
    runIdempotentOperation(queueKey, operationId, () =>
      performCaptureScreenshot({ trigger, allowWhenPaused, operationId })
    )
  );
}

async function performCaptureScreenshot({ trigger = 'manual', allowWhenPaused = false, operationId = '' } = {}) {
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
  const sequence = getNextScreenshotSequence();
  const resolvedOperationId = sanitizeOperationId(operationId) || createOperationId(`capture-${trigger}`);
  const screenshot = {
    id: createScreenshotId(currentRecording.id, sequence),
    sequence,
    operationId: resolvedOperationId,
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
  };

  currentRecording.screenshots.push(screenshot);

  currentRuntime.count = currentRecording.screenshots.length;
  await putRecording(currentRecording);
  await persistRuntime();
  await updateBadge();

  notifyPopup('screenshot', {
    count: currentRuntime.count,
    elapsedMs: getElapsedMs(timestamp)
  });
  notifyContent('screenshotFeedback', { count: currentRuntime.count });

  if (!currentRuntime.isGenerating && currentRuntime.recordingMode !== 'ai' && trigger !== 'agent') {
    queueRealtimeSuggestion(currentRecording.id, screenshot.id).catch((error) => {
      console.warn('[Background] Realtime suggestion queue failed:', error);
    });
  }

  return { ok: true, captured: true, count: currentRuntime.count };
}

function getNextScreenshotSequence() {
  const currentSequence = Number.parseInt(currentRuntime.screenshotSequence, 10) || 0;
  const existingCount = currentRecording?.screenshots?.length || 0;
  const nextSequence = Math.max(currentSequence, existingCount) + 1;
  currentRuntime.screenshotSequence = nextSequence;
  return nextSequence;
}

function createScreenshotId(recordingId, sequence) {
  const safeRecordingId = sanitizeOperationId(recordingId) || 'recording';
  const safeSequence = String(sequence).padStart(5, '0');
  return `${safeRecordingId}-shot-${safeSequence}-${createRandomSuffix()}`;
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

async function pauseAiAgent() {
  if (!currentRuntime.isRecording || currentRuntime.recordingMode !== 'ai') {
    return;
  }

  if (!currentRuntime.isPaused) {
    currentRuntime.isPaused = true;
    currentRuntime.pauseStartedAt = Date.now();
  }

  await updateAiAgentState({
    status: 'paused',
    paused: true,
    message: 'AI 已暂停，等待继续或接管。'
  });
  await updateBadge();
  notifyPopup('paused');
  notifyContent('recordingPaused');
}

async function resumeAiAgent() {
  if (!currentRuntime.isRecording || currentRuntime.recordingMode !== 'ai') {
    return;
  }

  if (currentRuntime.aiAgent?.status === 'failed') {
    throw new Error('AI 已失败，请接管操作或停止导出');
  }

  if (currentRuntime.pauseStartedAt) {
    currentRuntime.pausedDurationMs += Date.now() - currentRuntime.pauseStartedAt;
  }

  currentRuntime.isPaused = false;
  currentRuntime.pauseStartedAt = null;
  await updateAiAgentState({
    status: 'running',
    paused: false,
    awaitingTakeover: false,
    message: 'AI 正在继续执行...'
  });
  await updateBadge();
  notifyPopup('resumed');
  notifyContent('recordingResumed');
}

async function takeoverRecording() {
  if (!currentRuntime.isRecording || currentRuntime.recordingMode !== 'ai') {
    return;
  }

  if (currentRuntime.pauseStartedAt) {
    currentRuntime.pausedDurationMs += Date.now() - currentRuntime.pauseStartedAt;
  }

  currentRuntime.recordingMode = 'manual';
  currentRuntime.isPaused = false;
  currentRuntime.pauseStartedAt = null;
  currentRuntime.mediaStatus = '人工接管';
  await updateAiAgentState({
    status: 'takeover',
    paused: false,
    awaitingTakeover: false,
    message: '已切换为人工接管，可继续截图或停止导出。'
  });
  await updateBadge();
  notifyPopup('resumed');
  notifyContent('recordingResumed');
}

async function runAiAgentLoop(initialSettings) {
  let settings = initialSettings;

  while (isAiAgentLoopActive()) {
    await waitForAiAgentResume();
    if (!isAiAgentLoopActive()) {
      return;
    }

    if (isAiAgentLimitReached()) {
      await updateAiAgentState({
        status: 'limit',
        message: '已达到 AI 录制上限，正在保留已完成步骤并导出。'
      });
      await stopRecording();
      return;
    }

    await updateAiAgentState({
      status: 'running',
      message: `正在执行第 ${currentRuntime.aiAgent.iteration + 1} 步...`
    });

    const captureResult = await captureScreenshot({ trigger: 'agent', allowWhenPaused: true });
    if (!captureResult?.captured) {
      throw new Error('AI 录制无法截取当前页面');
    }

    const screenshot = currentRecording.screenshots[currentRecording.screenshots.length - 1];
    settings = await getSettings();
    const action = await decideNextAgentAction(screenshot, settings);

    if (!isAiAgentLoopActive()) {
      return;
    }

    const description = action.description || describeAgentAction(action);
    await updateAgentScreenshotDescription(screenshot.id, description);
    await appendAiAgentStep(action, screenshot.id, description);

    await waitForAiAgentResume();
    if (!isAiAgentLoopActive()) {
      return;
    }

    if (action.action === 'finish') {
      await updateAiAgentState({
        status: 'finishing',
        message: 'AI 已完成目标，正在生成教程。'
      });
      await stopRecording();
      return;
    }

    await executeAiAgentAction(action);
    await updateAiAgentState({
      iteration: currentRuntime.aiAgent.iteration + 1,
      lastAction: action.action,
      message: `已执行：${description}`
    });
    await delay(AI_AGENT_STEP_DELAY_MS);
  }
}

async function decideNextAgentAction(screenshot, settings) {
  if (!hasVisionAnalysisConfig(settings)) {
    throw new Error('AI 配置不完整，无法继续 AI 录制');
  }

  const request = buildAgentDecisionRequest(screenshot, settings);
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
    return extractAgentAction(data, settings.apiStyle);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createAiTimeoutError();
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildAgentDecisionRequest(screenshot, settings) {
  const apiStyle = normalizeApiStyle(settings.apiStyle);
  const extraHeaders = parseExtraHeaders(settings.extraHeadersJson);
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
  const prompt = buildAgentDecisionPrompt(screenshot);
  const tools = buildAgentToolSchema(apiStyle);

  if (apiStyle === 'anthropicMessages') {
    const { mediaType, base64 } = parseImageDataUrl(screenshot.data);

    return {
      url,
      headers,
      body: {
        model: settings.modelId,
        system: '你是浏览器操作 Agent。你必须选择一个安全、具体、单步的浏览器动作。',
        max_tokens: 360,
        tools,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
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
        instructions: '你是浏览器操作 Agent。你必须选择一个安全、具体、单步的浏览器动作。',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: screenshot.data }
            ]
          }
        ],
        tools,
        max_output_tokens: 360
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
          content: '你是浏览器操作 Agent。你必须选择一个安全、具体、单步的浏览器动作。'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: screenshot.data } }
          ]
        }
      ],
      tools,
      tool_choice: 'auto',
      max_tokens: 360
    }
  };
}

function buildAgentDecisionPrompt(screenshot) {
  const goal = currentRuntime.aiAgent.goal || currentRecording?.aiGoal || '完成当前教程任务';
  const stepIndex = currentRuntime.aiAgent.iteration + 1;
  const pageTitle = sanitizePageTitle(screenshot?.pageContext?.title) || '未知页面';
  const pageUrl = summarizeUrlForPrompt(screenshot?.pageContext?.url) || '未知地址';
  const completedSteps = currentRuntime.aiAgent.steps
    .slice(-8)
    .map((step) => `${step.index}. ${step.description}`)
    .join('\n');

  return [
    `教程目标：${goal}`,
    `当前页面：${pageTitle}（${pageUrl}）`,
    `当前步数：${stepIndex}/${AI_AGENT_MAX_STEPS}`,
    completedSteps ? `已完成步骤：\n${completedSteps}` : '已完成步骤：无',
    '请选择下一步工具调用。只能使用 click_at_xy、type_text、scroll、finish。',
    '如果目标已完成，调用 finish。',
    '如果需要点击，给出视口坐标 x/y；如果需要输入，先确保输入框已聚焦；如果需要滚动，给出 deltaY。',
    '每次只执行一个动作，并写出一句中文教程步骤说明 description。',
    '如果不能使用工具调用，请只输出 JSON，例如 {"action":"click_at_xy","x":120,"y":240,"description":"点击提交按钮"}。'
  ].join('\n');
}

function buildAgentToolSchema(apiStyle) {
  const baseTools = [
    {
      name: 'click_at_xy',
      description: 'Click a visible page coordinate in the current viewport.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          description: { type: 'string' }
        },
        required: ['x', 'y', 'description']
      }
    },
    {
      name: 'type_text',
      description: 'Type text into the currently focused input.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['text', 'description']
      }
    },
    {
      name: 'scroll',
      description: 'Scroll the current page.',
      parameters: {
        type: 'object',
        properties: {
          deltaY: { type: 'number' },
          x: { type: 'number' },
          y: { type: 'number' },
          description: { type: 'string' }
        },
        required: ['deltaY', 'description']
      }
    },
    {
      name: 'finish',
      description: 'Finish the tutorial recording when the goal is complete.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string' }
        },
        required: ['description']
      }
    }
  ];

  if (apiStyle === 'anthropicMessages') {
    return baseTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }

  if (apiStyle === 'responses') {
    return baseTools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  return baseTools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

function extractAgentAction(data, apiStyle) {
  const toolCall = extractAgentToolCall(data, apiStyle);
  if (toolCall) {
    return sanitizeAgentAction({
      action: toolCall.name,
      ...toolCall.arguments
    });
  }

  const text = extractVisionText(data, apiStyle);
  return parseAgentActionText(text);
}

function extractAgentToolCall(data, apiStyle) {
  if (apiStyle === 'responses') {
    const output = Array.isArray(data?.output) ? data.output : [];
    const call = output.find((item) => item?.type === 'function_call' && item.name);
    if (!call) {
      return null;
    }

    return {
      name: call.name,
      arguments: parseToolArguments(call.arguments)
    };
  }

  if (apiStyle === 'anthropicMessages') {
    const content = Array.isArray(data?.content) ? data.content : [];
    const call = content.find((item) => item?.type === 'tool_use' && item.name);
    if (!call) {
      return null;
    }

    return {
      name: call.name,
      arguments: call.input && typeof call.input === 'object' ? call.input : {}
    };
  }

  const toolCalls = data?.choices?.[0]?.message?.tool_calls;
  const call = Array.isArray(toolCalls) ? toolCalls[0] : null;
  if (!call?.function?.name) {
    return null;
  }

  return {
    name: call.function.name,
    arguments: parseToolArguments(call.function.arguments)
  };
}

function parseToolArguments(value) {
  if (!value) {
    return {};
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    return {};
  }
}

function parseAgentActionText(text) {
  const raw = String(text || '').trim();
  const jsonText = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw.match(/\{[\s\S]*\}/)?.[0] || raw;

  try {
    return sanitizeAgentAction(JSON.parse(jsonText));
  } catch (error) {
    throw new Error(`AI 未返回可执行动作：${sanitizeEditableText(raw, 160) || '空响应'}`);
  }
}

function sanitizeAgentAction(action = {}) {
  const rawAction = sanitizeEditableText(action.action || action.type || action.name || action.tool, 40);
  const normalizedAction = ['click_at_xy', 'type_text', 'scroll', 'finish'].includes(rawAction)
    ? rawAction
    : '';

  if (!normalizedAction) {
    throw new Error('AI 返回了未知工具动作');
  }

  const description = sanitizeEditableText(action.description, 400) || describeAgentAction({ action: normalizedAction });

  if (normalizedAction === 'click_at_xy') {
    const x = sanitizeCoordinate(action.x);
    const y = sanitizeCoordinate(action.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('AI 点击动作缺少有效坐标');
    }

    return { action: normalizedAction, x, y, description };
  }

  if (normalizedAction === 'type_text') {
    const text = sanitizeEditableText(action.text, 500);
    if (!text) {
      throw new Error('AI 输入动作缺少文本');
    }

    return { action: normalizedAction, text, description };
  }

  if (normalizedAction === 'scroll') {
    return {
      action: normalizedAction,
      deltaY: clampNumber(action.deltaY, -3000, 3000, 700),
      x: sanitizeCoordinate(action.x, 400),
      y: sanitizeCoordinate(action.y, 400),
      description
    };
  }

  return { action: 'finish', description };
}

function sanitizeCoordinate(value, fallback = NaN) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clampNumber(parsed, 0, 100_000, fallback);
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function describeAgentAction(action = {}) {
  if (action.action === 'click_at_xy') {
    return '点击页面中的目标位置';
  }

  if (action.action === 'type_text') {
    return '在当前输入框中输入内容';
  }

  if (action.action === 'scroll') {
    return action.deltaY < 0 ? '向上滚动页面' : '向下滚动页面';
  }

  return '完成当前教程目标';
}

async function executeAiAgentAction(action) {
  const lockKey = `agentAction:${currentRuntime.recordingId || 'idle'}:${currentRuntime.aiAgent?.iteration || 0}`;
  return runExclusiveOperation(lockKey, () => performExecuteAiAgentAction(action));
}

async function performExecuteAiAgentAction(action) {
  if (!currentRuntime.cdpAttached || !currentRuntime.tabId) {
    throw new Error('CDP 未连接，无法执行 AI 操作');
  }

  const target = { tabId: currentRuntime.tabId };

  if (action.action === 'click_at_xy') {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: action.x,
      y: action.y,
      button: 'left',
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: action.x,
      y: action.y,
      button: 'left',
      clickCount: 1
    });
    return;
  }

  if (action.action === 'type_text') {
    await chrome.debugger.sendCommand(target, 'Input.insertText', {
      text: action.text
    });
    return;
  }

  if (action.action === 'scroll') {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: action.x,
      y: action.y,
      deltaY: action.deltaY,
      deltaX: 0
    });
  }
}

async function updateAgentScreenshotDescription(screenshotId, description) {
  const located = findCurrentScreenshot(currentRecording.id, screenshotId);
  if (!located) {
    return;
  }

  located.screenshot.description = sanitizeEditableText(description, 400) || `步骤 ${located.index + 1}`;
  located.screenshot.descriptionSource = 'agent-ai';
  located.screenshot.descriptionUpdatedAt = Date.now();
  await putRecording(currentRecording);
}

async function appendAiAgentStep(action, screenshotId, description) {
  const steps = Array.isArray(currentRuntime.aiAgent.steps) ? currentRuntime.aiAgent.steps : [];
  const stepId = createAgentStepId(currentRecording.id, screenshotId, action.action);
  const existingStep = steps.find((step) => step.id === stepId || step.screenshotId === screenshotId);

  if (existingStep) {
    return existingStep;
  }

  const step = {
    id: stepId,
    operationId: stepId,
    index: steps.length + 1,
    action: action.action,
    description,
    screenshotId,
    timestamp: Date.now()
  };

  await updateAiAgentState({
    steps: [...steps, step].slice(-AI_AGENT_MAX_STEPS),
    message: description
  });
  notifyPopup('agentStep', { step, aiAgent: currentRuntime.aiAgent });
  return step;
}

function createAgentStepId(recordingId, screenshotId, actionName) {
  return [
    sanitizeOperationId(recordingId) || 'recording',
    'agent-step',
    sanitizeOperationId(screenshotId) || createRandomSuffix(),
    sanitizeOperationId(actionName) || 'action'
  ].join(':');
}

async function updateAiAgentState(patch = {}) {
  currentRuntime.aiAgent = {
    ...createAiAgentState(),
    ...currentRuntime.aiAgent,
    ...patch,
    updatedAt: Date.now()
  };

  await persistRuntime().catch(() => {});
  notifyAiStatus();
  return currentRuntime.aiAgent;
}

function notifyAiStatus() {
  notifyPopup('aiStatus', {
    recordingMode: currentRuntime.recordingMode,
    aiAgent: currentRuntime.aiAgent || createAiAgentState()
  });
}

function isAiAgentLoopActive() {
  return (
    currentRuntime.isRecording &&
    currentRuntime.recordingMode === 'ai' &&
    currentRecording &&
    !currentRuntime.isGenerating &&
    !['failed', 'takeover', 'stopping', 'finishing', 'limit'].includes(currentRuntime.aiAgent?.status)
  );
}

function isAiAgentLimitReached() {
  const now = Date.now();
  const deadlineAt = currentRuntime.aiAgent?.deadlineAt || currentRuntime.startTime + AI_AGENT_MAX_DURATION_MS;
  return currentRuntime.aiAgent.iteration >= AI_AGENT_MAX_STEPS || now >= deadlineAt;
}

async function waitForAiAgentResume() {
  while (
    currentRuntime.isRecording &&
    currentRuntime.recordingMode === 'ai' &&
    !currentRuntime.isGenerating &&
    (currentRuntime.isPaused || currentRuntime.aiAgent?.paused)
  ) {
    await delay(500);
  }
}

async function handleAiAgentFailure(error) {
  if (!currentRuntime.isRecording || currentRuntime.recordingMode !== 'ai' || !currentRecording) {
    return;
  }

  console.error('[Background] AI agent failed:', error);
  await detachCdpDebugger();
  currentRuntime.screenshotEngine = 'standard';
  currentRuntime.isPaused = true;
  currentRuntime.pauseStartedAt = currentRuntime.pauseStartedAt || Date.now();
  await updateAiAgentState({
    status: 'failed',
    paused: true,
    awaitingTakeover: true,
    message: `AI 调用失败：${sanitizeEditableText(error?.message || '未知错误', 180)}。可接管操作或停止导出。`
  });
  await updateBadge();
  notifyPopup('warning', { message: currentRuntime.aiAgent.message });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function generateTutorial() {
  const recordingId = currentRecording?.id || 'idle';
  return runExclusiveOperation(`generateTutorial:${recordingId}`, performGenerateTutorial);
}

async function performGenerateTutorial() {
  if (!currentRecording?.screenshots.length) {
    throw new Error('没有可导出的截图');
  }

  const settings = await getSettings();
  const canAnalyze = hasVisionAnalysisConfig(settings);

  if (canAnalyze) {
    for (let index = 0; index < currentRecording.screenshots.length; index += 1) {
      if (hasStepDescription(currentRecording.screenshots[index])) {
        continue;
      }

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
        currentRecording.screenshots[index].descriptionSource = 'batch-ai';
        currentRecording.screenshots[index].descriptionUpdatedAt = Date.now();
      } catch (error) {
        console.error('[Background] Analyze error:', error);
        notifyPopup('warning', {
          message: `步骤 ${index + 1} ${describeAiFailureForUser(error)}，已改用默认说明继续导出。`
        });
        currentRecording.screenshots[index].description = getFallbackDescription(
          currentRecording.screenshots[index],
          index
        );
        currentRecording.screenshots[index].descriptionSource = 'fallback';
        currentRecording.screenshots[index].descriptionUpdatedAt = Date.now();
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

function hasVisionAnalysisConfig(settings = {}) {
  return Boolean(settings.apiKey && settings.modelId && settings.apiBaseUrl);
}

function hasStepDescription(screenshot) {
  return Boolean(sanitizeEditableText(screenshot?.description, 400));
}

function createRealtimeSuggestionStateForSettings(settings = {}) {
  if (settings.realtimeSuggestions !== true) {
    return createRealtimeSuggestionState({
      enabled: false,
      status: 'disabled'
    });
  }

  if (!hasVisionAnalysisConfig(settings)) {
    return createRealtimeSuggestionState({
      enabled: true,
      status: 'unconfigured',
      message: '请先配置 AI Provider、API Key 和模型。'
    });
  }

  return createRealtimeSuggestionState({
    enabled: true,
    status: 'idle'
  });
}

function normalizeRealtimeSuggestionForSettings(currentSuggestion = {}, settings = {}) {
  const base = createRealtimeSuggestionStateForSettings(settings);
  if (settings.realtimeSuggestions !== true || !hasVisionAnalysisConfig(settings)) {
    return {
      ...base,
      updatedAt: Date.now()
    };
  }

  return {
    ...base,
    ...currentSuggestion,
    enabled: true,
    status:
      currentSuggestion.status && currentSuggestion.status !== 'disabled' && currentSuggestion.status !== 'unconfigured'
        ? currentSuggestion.status
        : 'idle',
    updatedAt: Date.now()
  };
}

async function queueRealtimeSuggestion(recordingId, screenshotId) {
  if (!recordingId || !screenshotId || currentRuntime.isGenerating) {
    return;
  }

  const settings = await getSettings();
  currentRuntime.realtimeSuggestion = normalizeRealtimeSuggestionForSettings(
    currentRuntime.realtimeSuggestion,
    settings
  );

  if (settings.realtimeSuggestions !== true) {
    realtimeSuggestionQueue.pending = null;
    await updateRealtimeSuggestionState(currentRuntime.realtimeSuggestion);
    return;
  }

  if (!hasVisionAnalysisConfig(settings)) {
    realtimeSuggestionQueue.pending = null;
    await updateRealtimeSuggestionState(currentRuntime.realtimeSuggestion);
    return;
  }

  const located = findCurrentScreenshot(recordingId, screenshotId);
  if (!located || hasStepDescription(located.screenshot)) {
    return;
  }

  realtimeSuggestionQueue.pending = { recordingId, screenshotId };
  await updateRealtimeSuggestionState({
    enabled: true,
    status: 'queued',
    screenshotId,
    stepIndex: located.index + 1,
    text: '',
    message: '等待 AI 建议...'
  });

  if (!realtimeSuggestionQueue.active) {
    drainRealtimeSuggestionQueue().catch((error) => {
      console.warn('[Background] Realtime suggestion worker failed:', error);
    });
  }
}

async function drainRealtimeSuggestionQueue() {
  if (realtimeSuggestionQueue.active) {
    return;
  }

  realtimeSuggestionQueue.active = true;

  try {
    while (realtimeSuggestionQueue.pending) {
      const job = realtimeSuggestionQueue.pending;
      realtimeSuggestionQueue.pending = null;
      await processRealtimeSuggestion(job);
    }
  } finally {
    realtimeSuggestionQueue.active = false;
  }
}

async function processRealtimeSuggestion(job) {
  if (!job || currentRuntime.isGenerating) {
    return;
  }

  const settings = await getSettings();
  if (settings.realtimeSuggestions !== true || !hasVisionAnalysisConfig(settings)) {
    currentRuntime.realtimeSuggestion = normalizeRealtimeSuggestionForSettings(
      currentRuntime.realtimeSuggestion,
      settings
    );
    await updateRealtimeSuggestionState(currentRuntime.realtimeSuggestion);
    return;
  }

  const located = findCurrentScreenshot(job.recordingId, job.screenshotId);
  if (!located) {
    return;
  }

  if (hasStepDescription(located.screenshot)) {
    await updateRealtimeSuggestionState({
      enabled: true,
      status: 'ready',
      screenshotId: job.screenshotId,
      stepIndex: located.index + 1,
      text: sanitizeEditableText(located.screenshot.description, 400),
      message: '已保存到最终导出。'
    });
    return;
  }

  await updateRealtimeSuggestionState({
    enabled: true,
    status: 'analyzing',
    screenshotId: job.screenshotId,
    stepIndex: located.index + 1,
    text: '',
    message: '正在分析...'
  });

  try {
    const suggestionText =
      sanitizeEditableText(
        await analyzeImage(located.screenshot, settings, located.index, currentRecording.screenshots),
        400
      ) || getFallbackDescription(located.screenshot, located.index);
    const latest = findCurrentScreenshot(job.recordingId, job.screenshotId);
    const latestSettings = await getSettings();

    if (!latest || currentRuntime.isGenerating || latestSettings.realtimeSuggestions !== true) {
      return;
    }

    if (!hasStepDescription(latest.screenshot)) {
      latest.screenshot.description = suggestionText;
      latest.screenshot.descriptionSource = 'realtime-ai';
      latest.screenshot.descriptionUpdatedAt = Date.now();
      await putRecording(currentRecording);
    }

    await updateRealtimeSuggestionState({
      enabled: true,
      status: 'ready',
      screenshotId: job.screenshotId,
      stepIndex: latest.index + 1,
      text: sanitizeEditableText(latest.screenshot.description || suggestionText, 400),
      message: '已保存到最终导出。'
    });
  } catch (error) {
    console.warn('[Background] Realtime suggestion failed:', error);

    if (!findCurrentScreenshot(job.recordingId, job.screenshotId) || currentRuntime.isGenerating) {
      return;
    }

    await updateRealtimeSuggestionState({
      enabled: true,
      status: 'error',
      screenshotId: job.screenshotId,
      stepIndex: located.index + 1,
      text: '',
      message: describeAiFailureForUser(error)
    });
  }
}

function findCurrentScreenshot(recordingId, screenshotId) {
  if (
    !currentRecording ||
    !currentRuntime.isRecording ||
    currentRuntime.recordingId !== recordingId ||
    currentRecording.id !== recordingId
  ) {
    return null;
  }

  const index = currentRecording.screenshots.findIndex((screenshot) => screenshot.id === screenshotId);
  if (index < 0) {
    return null;
  }

  return {
    index,
    screenshot: currentRecording.screenshots[index]
  };
}

async function updateRealtimeSuggestionState(patch = {}) {
  currentRuntime.realtimeSuggestion = {
    ...createRealtimeSuggestionState(),
    ...currentRuntime.realtimeSuggestion,
    ...patch,
    updatedAt: Date.now()
  };

  await persistRuntime().catch(() => {});
  notifyRealtimeSuggestion();
  return currentRuntime.realtimeSuggestion;
}

function notifyRealtimeSuggestion() {
  notifyPopup('realtimeSuggestion', {
    suggestion: currentRuntime.realtimeSuggestion || createRealtimeSuggestionState()
  });
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
    recordingMode: recording.recordingMode || 'manual',
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
    recordingMode: recording.recordingMode || 'manual',
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
    `> 录制模式：${formatRecordingMode(recording)}`,
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

function formatRecordingMode(recording) {
  if (recording.recordingMode === 'ai' || recording.captureMode === 'agent') {
    return 'AI 自动录制';
  }

  return recording.captureMode === 'tabCapture' ? '直接录制当前标签页' : '共享屏幕/标签页';
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
    recordingMode: recording.recordingMode || 'manual',
    captureMode: recording.captureMode || DEFAULT_SETTINGS.captureMode,
    exportedAt: recording.lastExportAt || Date.now(),
    exportBaseName: recording.exportBaseName || '',
    lastExportPrompted: recording.lastExportPrompted === true
  };
}

async function exportRecording(id, operationId = '') {
  const recordingId = sanitizeTextValue(id, 80);
  return runExclusiveOperation(`exportRecording:${recordingId}`, () =>
    runIdempotentOperation(`exportRecording:${recordingId}`, operationId, () =>
      performExportRecording(recordingId, operationId)
    )
  );
}

async function performExportRecording(id, operationId = '') {
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
  recording.lastExportOperationId = sanitizeOperationId(operationId) || createOperationId('export');
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

async function updateRealtimeSuggestionOverride(payload = {}) {
  if (!currentRuntime.isRecording || !currentRecording) {
    throw new Error('当前没有活动录制');
  }

  const screenshotId = sanitizeTextValue(payload.screenshotId, 80);
  const description = sanitizeEditableText(payload.description, 400);
  const located = findCurrentScreenshot(currentRecording.id, screenshotId);

  if (!located) {
    throw new Error('这条实时建议已失效');
  }

  located.screenshot.description = description;
  located.screenshot.descriptionSource = description ? 'realtime-user' : 'realtime-cleared';
  located.screenshot.descriptionUpdatedAt = Date.now();
  await putRecording(currentRecording);

  return updateRealtimeSuggestionState({
    enabled: currentRuntime.realtimeSuggestion?.enabled === true,
    status: description ? 'saved' : 'ready',
    screenshotId,
    stepIndex: located.index + 1,
    text: description,
    message: description ? '已保存到最终导出。' : '已清空，停止后会重新生成。'
  });
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
    await chrome.action.setBadgeText({ text: currentRuntime.recordingMode === 'ai' ? 'AI' : 'II' });
    await chrome.action.setTitle({ title: currentRuntime.recordingMode === 'ai' ? '教程录制器：AI 已暂停' : '教程录制器：已暂停' });
    return;
  }

  if (currentRuntime.isRecording) {
    await chrome.action.setBadgeBackgroundColor({ color: currentRuntime.recordingMode === 'ai' ? '#7c3aed' : '#f5222d' });
    await chrome.action.setBadgeText({ text: currentRuntime.recordingMode === 'ai' ? 'AI' : 'REC' });
    await chrome.action.setTitle({ title: currentRuntime.recordingMode === 'ai' ? '教程录制器：AI 录制中' : '教程录制器：录制中' });
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
