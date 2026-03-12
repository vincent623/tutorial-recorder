import { deleteRecording, getRecording, putRecording } from './asset-store.js';

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'recordings';
const RUNTIME_KEY = 'recordingRuntime';
const OFFSCREEN_PATH = 'offscreen/offscreen.html';
const AI_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

const DEFAULT_SETTINGS = {
  apiKey: '',
  endpointId: '',
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
      case 'deleteRecording':
        await deleteRecordingById(message.id);
        sendResponse({ ok: true });
        break;
      case 'offscreenCaptureTick':
        sendResponse(await captureScreenshot({ trigger: 'auto' }));
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
    captureIntervalMs: DEFAULT_SETTINGS.screenshotInterval * 1000,
    autoScreenshot: DEFAULT_SETTINGS.autoScreenshot
  };
}

function normalizeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    outputDir: sanitizeOutputDir(settings.outputDir),
    promptForSaveAs: settings.promptForSaveAs === true,
    screenshotInterval: clampInterval(settings.screenshotInterval ?? DEFAULT_SETTINGS.screenshotInterval),
    autoScreenshot: settings.autoScreenshot !== false
  };
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
    screenshots: [],
    audioDataUrl: null,
    audioMeta: null,
    exportBaseName: '',
    lastExportAt: null
  };

  currentRuntime = {
    ...createIdleRuntime(),
    isRecording: true,
    startTime: startedAt,
    tabId: tab.id,
    windowId: tab.windowId,
    recordingId: currentRecording.id,
    captureIntervalMs: settings.screenshotInterval * 1000,
    autoScreenshot: settings.autoScreenshot
  };

  await putRecording(currentRecording);
  await persistRuntime();
  await updateBadge();

  try {
    const offscreenState = await ensureOffscreenDocument()
      .then(() =>
        sendOffscreenMessage('startSession', {
          intervalMs: currentRuntime.captureIntervalMs,
          autoCapture: currentRuntime.autoScreenshot
        })
      )
      .catch((error) => ({ audioStarted: false, error: error.message || '无法启动录音' }));

    if (offscreenState?.error) {
      notifyPopup('warning', { message: `录音未启动：${offscreenState.error}` });
    }

    await captureScreenshot({ trigger: 'initial', allowWhenPaused: true });

    notifyPopup('started', {
      startTime: currentRuntime.startTime,
      count: currentRuntime.count,
      audioStarted: offscreenState?.audioStarted !== false
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
    notifyPopup('warning', { message: `录音暂停失败：${error.message}` });
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
    notifyPopup('warning', { message: `录音恢复失败：${error.message}` });
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
  notifyPopup('generating', { message: '正在整理录音和截图...' });

  const audioResult = await sendOffscreenMessage('stopSession').catch((error) => ({
    audioDataUrl: null,
    error: error.message || '录音停止失败',
    durationMs: currentRuntime.durationMs
  }));

  if (audioResult?.audioDataUrl) {
    currentRecording.audioDataUrl = audioResult.audioDataUrl;
    currentRecording.audioMeta = {
      mimeType: audioResult.mimeType || 'audio/webm',
      size: audioResult.size || 0,
      durationMs: audioResult.durationMs || currentRuntime.durationMs
    };
  } else if (audioResult?.error) {
    currentRecording.audioMeta = {
      mimeType: '',
      size: 0,
      durationMs: currentRuntime.durationMs,
      error: audioResult.error
    };
    notifyPopup('warning', { message: `录音未导出：${audioResult.error}` });
  }

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
  const canAnalyze = Boolean(settings.apiKey && settings.endpointId);

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
  const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch(AI_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.endpointId,
      messages: [
        {
          role: 'system',
          content: '你是教程录制助手。请用简洁中文总结截图里的当前操作步骤，不要重复截图里不重要的细节。'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请用一句话描述这个截图代表的操作步骤。' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
          ]
        }
      ],
      max_tokens: 100
    })
  });

  if (!response.ok) {
    throw new Error((await response.text()).slice(0, 200));
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '未命名步骤';
}

function buildRecordingTitle(recording) {
  const firstDescription = recording.screenshots.find((item) => item.description)?.description || '教程录制';
  return firstDescription.slice(0, 36);
}

function buildPdfPayload(recording) {
  return {
    id: recording.id,
    title: recording.title,
    createdAt: recording.startTime,
    durationMs: getRecordingDuration(recording),
    audioAvailable: Boolean(recording.audioDataUrl),
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
    `> 音频文件：${recording.audioDataUrl ? 'audio/tutorial-audio.webm' : '未生成'}`,
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

  await downloadText(
    `${bundleName}/tutorial.md`,
    markdown,
    'text/markdown;charset=utf-8',
    promptForSaveAs
  );

  if (pdfDataUrl) {
    await downloadUrl(`${bundleName}/tutorial.pdf`, pdfDataUrl, promptForSaveAs);
  }

  if (recording.audioDataUrl) {
    await downloadUrl(`${bundleName}/audio/tutorial-audio.webm`, recording.audioDataUrl, promptForSaveAs);
  }

  for (let index = 0; index < recording.screenshots.length; index += 1) {
    await downloadUrl(
      `${bundleName}/screenshots/step-${String(index + 1).padStart(2, '0')}.png`,
      recording.screenshots[index].data,
      promptForSaveAs
    );
  }

  return bundleName;
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
    title: recording.title,
    createdAt: recording.startTime,
    screenshotCount: recording.screenshots.length,
    durationMs: getRecordingDuration(recording),
    hasAudio: Boolean(recording.audioDataUrl),
    exportedAt: recording.lastExportAt || Date.now()
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

  await downloadRecordingBundle(
    recording,
    markdown,
    pdfResult?.pdfDataUrl || null,
    settings.outputDir,
    settings.promptForSaveAs
  );
  if (!currentRuntime.isRecording) {
    await closeOffscreenDocument();
  }
  notifyPopup('historyUpdated', { history: await getHistory() });
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
    reasons: ['USER_MEDIA', 'BLOBS'],
    justification: 'Record microphone audio, manage capture timers, and render tutorial PDFs.'
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
      setTimeout(() => reject(new Error(`Offscreen action timed out: ${type}`)), 20_000);
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
  return (
    recording.audioMeta?.durationMs ||
    recording.screenshots[recording.screenshots.length - 1]?.timeOffsetMs ||
    0
  );
}
