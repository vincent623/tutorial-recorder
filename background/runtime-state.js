import { getRecording } from './asset-store.js';
import { hydrateRecordingAssets } from './recording-assets.js';
import { AI_AGENT_MAX_DURATION_MS, AI_AGENT_MAX_STEPS, DEFAULT_SETTINGS } from './settings-schema.js';

export const SETTINGS_KEY = 'settings';
export const HISTORY_KEY = 'recordings';
export const RUNTIME_KEY = 'recordingRuntime';

export const S = {
  currentRecording: null,
  currentRuntime: createIdleRuntime(),
  initPromise: null,
  offscreenCreationPromise: null,
  realtimeSuggestionQueue: { active: false, pending: null },
  operationSequence: 0,
  operationLocks: new Map(),
  operationSerialQueues: new Map(),
  recentOperationResults: new Map(),
  aiAgentLoopPromise: null
};

export function createIdleRuntime() {
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

export function createAiAgentState(overrides = {}) {
  return {
    status: 'idle',
    goal: '',
    steps: [],
    iteration: 0,
    maxSteps: AI_AGENT_MAX_STEPS,
    maxDurationMs: AI_AGENT_MAX_DURATION_MS,
    startedAt: null,
    deadlineAt: null,
    paused: false,
    awaitingTakeover: false,
    pendingApproval: null,
    lastAction: '',
    message: '',
    updatedAt: 0,
    ...overrides
  };
}

export function createRealtimeSuggestionState(overrides = {}) {
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




















export async function restoreRuntimeState() {
  const { [RUNTIME_KEY]: runtime } = await chrome.storage.session.get(RUNTIME_KEY);

  if (!runtime?.recordingId) {
    S.currentRuntime = createIdleRuntime();
    S.currentRecording = null;
    return;
  }

  S.currentRuntime = { ...createIdleRuntime(), ...runtime };
  S.currentRecording = await hydrateRecordingAssets(await getRecording(S.currentRuntime.recordingId));

  if (!S.currentRecording) {
    S.currentRuntime = createIdleRuntime();
    await persistRuntime();
  }
}

export async function persistRuntime() {
  await chrome.storage.session.set({ [RUNTIME_KEY]: S.currentRuntime });
}

export function serializeRuntimeForUi() {
  const now = Date.now();
  const elapsedMs = S.currentRuntime.isRecording ? getElapsedMs(now) : S.currentRuntime.durationMs || 0;

  return {
    ...S.currentRuntime,
    elapsedMs
  };
}

export function getElapsedMs(now = Date.now()) {
  if (!S.currentRuntime.startTime) {
    return 0;
  }

  let elapsed = now - S.currentRuntime.startTime - (S.currentRuntime.pausedDurationMs || 0);

  if (S.currentRuntime.isPaused && S.currentRuntime.pauseStartedAt) {
    elapsed -= now - S.currentRuntime.pauseStartedAt;
  }

  return Math.max(0, elapsed);
}

export async function updateBadge() {
  if (S.currentRuntime.isGenerating) {
    await chrome.action.setBadgeBackgroundColor({ color: '#1677ff' });
    await chrome.action.setBadgeText({ text: '...' });
    await chrome.action.setTitle({ title: '教程录制器：正在生成教程' });
    return;
  }

  if (S.currentRuntime.isRecording && S.currentRuntime.isPaused) {
    await chrome.action.setBadgeBackgroundColor({ color: '#faad14' });
    await chrome.action.setBadgeText({ text: S.currentRuntime.recordingMode === 'ai' ? 'AI' : 'II' });
    await chrome.action.setTitle({ title: S.currentRuntime.recordingMode === 'ai' ? '教程录制器：AI 已暂停' : '教程录制器：已暂停' });
    return;
  }

  if (S.currentRuntime.isRecording) {
    await chrome.action.setBadgeBackgroundColor({ color: S.currentRuntime.recordingMode === 'ai' ? '#7c3aed' : '#f5222d' });
    await chrome.action.setBadgeText({ text: S.currentRuntime.recordingMode === 'ai' ? 'AI' : 'REC' });
    await chrome.action.setTitle({
      title:
        S.currentRuntime.recordingMode === 'ai'
          ? S.currentRuntime.aiAgent?.status === 'starting'
            ? '教程录制器：AI 正在启动'
            : '教程录制器：AI 录制中'
          : '教程录制器：录制中'
    });
    return;
  }

  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: '教程录制器' });
}
