import { strToU8, zipSync } from '../lib/fflate.js';
import { deleteRecording, getRecording, putRecording } from './asset-store.js';

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'recordings';
const RUNTIME_KEY = 'recordingRuntime';
const OFFSCREEN_PATH = 'offscreen/offscreen.html';
const OFFSCREEN_MESSAGE_TIMEOUT_MS = 120_000;

const PROVIDER_PRESETS = {
  volcengineArk: {
    label: '火山方舟',
    apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiStyle: 'chatCompletions'
  },
  siliconFlow: {
    label: '硅基流动',
    apiBaseUrl: 'https://api.siliconflow.com/v1',
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

const DEFAULT_SETTINGS = {
  providerPreset: 'volcengineArk',
  apiStyle: PROVIDER_PRESETS.volcengineArk.apiStyle,
  apiBaseUrl: PROVIDER_PRESETS.volcengineArk.apiBaseUrl,
  apiKey: '',
  modelId: '',
  extraHeadersJson: '',
  captureMode: 'displayMedia',
  outputDir: 'tutorial-recorder',
  promptForSaveAs: false,
  screenshotInterval: 5,
  autoScreenshot: true
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
        sendResponse(await captureScreenshot({ trigger: 'manual' }));
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
    captureIntervalMs: DEFAULT_SETTINGS.screenshotInterval * 1000,
    autoScreenshot: DEFAULT_SETTINGS.autoScreenshot,
    audioStarted: false,
    videoStarted: false,
    mediaStatus: '待启动'
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
    apiBaseUrl: sanitizeApiBaseUrl(settings.apiBaseUrl || preset.apiBaseUrl),
    outputDir: sanitizeOutputDir(settings.outputDir),
    modelId,
    extraHeadersJson: normalizeHeadersJson(settings.extraHeadersJson),
    captureMode: normalizeCaptureMode(settings.captureMode),
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

function sanitizeApiBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return '';
  }

  return raw.replace(/\/+$/, '');
}

function normalizeHeadersJson(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  const nextSettings = normalizeSettings(settings);
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
    captureIntervalMs: settings.screenshotInterval * 1000,
    autoScreenshot: settings.autoScreenshot,
    mediaStatus: '正在请求授权...'
  };

  await putRecording(currentRecording);
  await persistRuntime();
  await updateBadge();

  try {
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
      audioStarted: currentRuntime.audioStarted,
      videoStarted: currentRuntime.videoStarted,
      mediaStatus: currentRuntime.mediaStatus
    });
    notifyContent('recordingStarted');
  } catch (error) {
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
  const dataUrl = await chrome.tabs.captureVisibleTab(currentRuntime.windowId, {
    format: 'png'
  });

  const timestamp = Date.now();
  currentRecording.screenshots.push({
    id: timestamp.toString(),
    data: dataUrl,
    timestamp,
    timeOffsetMs: getElapsedMs(timestamp),
    trigger,
    description: ''
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
          currentRecording.screenshots[index].data,
          settings
        );
      } catch (error) {
        console.error('[Background] Analyze error:', error);
        currentRecording.screenshots[index].description = `步骤 ${index + 1}`;
      }
    }
  } else {
    notifyPopup('generating', {
      message: '未配置 AI，正在使用默认步骤说明生成教程...'
    });

    currentRecording.screenshots = currentRecording.screenshots.map((screenshot, index) => ({
      ...screenshot,
      description: screenshot.description || `步骤 ${index + 1}`
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

async function analyzeImage(imageData, settings) {
  const request = buildVisionRequest(imageData, settings);
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body)
  });

  if (!response.ok) {
    throw new Error((await response.text()).slice(0, 200));
  }

  const data = await response.json();
  return extractVisionText(data, settings.apiStyle) || '未命名步骤';
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
  const nextScreenshots = Array.isArray(updates.screenshots) ? updates.screenshots : [];

  recording.title = nextTitle || buildRecordingTitle(recording);
  recording.screenshots = recording.screenshots.map((screenshot, index) => ({
    ...screenshot,
    description:
      sanitizeEditableText(nextScreenshots[index]?.description, 400) ||
      screenshot.description ||
      `步骤 ${index + 1}`
  }));
  recording.updatedAt = Date.now();

  await putRecording(recording);
  await upsertHistoryEntry(buildHistoryEntry(recording));
  notifyPopup('historyUpdated', { history: await getHistory() });
  return buildRecordingDetail(recording);
}

function sanitizeEditableText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
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

function buildVisionRequest(imageData, settings) {
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

  if (apiStyle === 'anthropicMessages') {
    const { mediaType, base64 } = parseImageDataUrl(imageData);

    return {
      url,
      headers,
      body: {
        model: settings.modelId,
        system: '你是教程录制助手。请用简洁中文总结截图里的当前操作步骤，不要重复截图里不重要的细节。',
        max_tokens: 160,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '请用一句话描述这个截图代表的操作步骤。' },
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
        instructions: '你是教程录制助手。请用简洁中文总结截图里的当前操作步骤，不要重复截图里不重要的细节。',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: '请用一句话描述这个截图代表的操作步骤。' },
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
          content: '你是教程录制助手。请用简洁中文总结截图里的当前操作步骤，不要重复截图里不重要的细节。'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请用一句话描述这个截图代表的操作步骤。' },
            { type: 'image_url', image_url: { url: imageData } }
          ]
        }
      ],
      max_tokens: 120
    }
  };
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
