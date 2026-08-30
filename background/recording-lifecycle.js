import { pauseAiAgent, resumeAiAgent, runAiAgentLoop } from './agent-loop.js';
import { handleAiAgentFailure, notifyAiStatus, updateAiAgentState } from './agent-state.js';
import { hasVisionAnalysisConfig } from './ai-vision.js';
import { deleteRecording } from './asset-store.js';
import { notifyContent } from './notify.js';
import { applyMediaResult, closeOffscreenDocument, ensureOffscreenDocument, sendOffscreenMessage, summarizeMediaState } from './media-orchestrator.js';
import { notifyPopup } from './notify.js';
import { COMMIT_STATES, createRecordingOperation, markRecordingRecoverableFailure, runExclusiveOperation, runIdempotentOperation, updateRecordingCommitState } from './op-safety.js';
import { createRealtimeSuggestionStateForSettings } from './realtime-suggestions.js';
import { persistRecording } from './recording-assets.js';
import { activateRecordingTargetTab, createRecordingTargetError, extractFirstRecordableUrl, findBestRecordingStartTargetTab, getRecordingStartTargetTab, isRecordingTargetError, normalizeRecordingTargetOptions } from './recording-target.js';
import { S, createAiAgentState, createIdleRuntime, getElapsedMs, persistRuntime, updateBadge } from './runtime-state.js';
import { attachCdpDebugger, captureScreenshot, detachCdpDebugger, injectContentScript } from './screenshot-engine.js';
import { buildCdpCropFromSettings, normalizeAiAgentMaxDurationMs, normalizeAiAgentMaxSteps } from './settings-schema.js';
import { getSettings } from './settings-store.js';
import { sanitizeEditableText } from './text-utils.js';
import { generateTutorial } from './tutorial-generator.js';

export async function startRecording(tabId, options = {}) {
  if (S.currentRuntime.isRecording) {
    return;
  }

  const targetOptions = normalizeRecordingTargetOptions(options);
  let tab = await getRecordingStartTargetTab(tabId, '录制', targetOptions);
  const settings = await getSettings();
  const startedAt = Date.now();

  S.currentRecording = {
    id: startedAt.toString(),
    startTime: startedAt,
    title: '',
    status: 'recording',
    commitState: COMMIT_STATES.RECORDING,
    lastOperation: createRecordingOperation('startRecording', COMMIT_STATES.RECORDING, `start-${startedAt}`),
    recoverableError: null,
    recordingMode: 'manual',
    captureMode: settings.captureMode,
    screenshots: [],
    audioDataUrl: null,
    audioAssetId: '',
    audioMeta: null,
    videoDataUrl: null,
    videoAssetId: '',
    videoMeta: null,
    realtimeSuggestionsEnabled: settings.realtimeSuggestions === true,
    exportBaseName: '',
    lastExportAt: null,
    lastExportPrompted: false
  };

  S.currentRuntime = {
    ...createIdleRuntime(),
    isRecording: true,
    startTime: startedAt,
    tabId: tab.id,
    windowId: tab.windowId,
    recordingId: S.currentRecording.id,
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

  await persistRecording(S.currentRecording);
  await persistRuntime();
  await updateBadge();

  try {
    if (settings.screenshotEngine === 'cdp') {
      await attachCdpDebugger(tab.id, { targetUrl: targetOptions.targetUrl }).catch(async (error) => {
        S.currentRuntime.screenshotEngine = 'standard';
        S.currentRuntime.cdpAttached = false;
        S.currentRuntime.cdpWarningShown = true;
        S.currentRuntime.cdpCrop = null;
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
          recordingId: S.currentRecording.id,
          intervalMs: S.currentRuntime.captureIntervalMs,
          autoCapture: S.currentRuntime.autoScreenshot
        })
      )
      .catch((error) => ({
        audioStarted: false,
        videoStarted: false,
        error: error.message || '无法启动媒体录制'
      }));

    S.currentRuntime.audioStarted = offscreenState?.audioStarted === true;
    S.currentRuntime.videoStarted = offscreenState?.videoStarted === true;
    S.currentRuntime.mediaStatus = summarizeMediaState(S.currentRuntime.audioStarted, S.currentRuntime.videoStarted);
    await persistRuntime();

    if (offscreenState?.error) {
      notifyPopup('warning', { message: `媒体未完整启动：${offscreenState.error}` });
    }

    await captureScreenshot({ trigger: 'initial', allowWhenPaused: true });
    await injectContentScript(tab.id);

    notifyPopup('started', {
      startTime: S.currentRuntime.startTime,
      recordingId: S.currentRuntime.recordingId,
      recordingMode: S.currentRuntime.recordingMode,
      count: S.currentRuntime.count,
      captureMode: S.currentRuntime.captureMode,
      screenshotEngine: S.currentRuntime.screenshotEngine,
      cdpAttached: S.currentRuntime.cdpAttached,
      audioStarted: S.currentRuntime.audioStarted,
      videoStarted: S.currentRuntime.videoStarted,
      mediaStatus: S.currentRuntime.mediaStatus,
      realtimeSuggestion: S.currentRuntime.realtimeSuggestion,
      aiAgent: S.currentRuntime.aiAgent
    });
    notifyContent('recordingStarted');
  } catch (error) {
    await detachCdpDebugger();
    await closeOffscreenDocument();
    await deleteRecording(S.currentRecording.id).catch(() => {});
    S.currentRecording = null;
    S.currentRuntime = createIdleRuntime();
    await persistRuntime();
    await updateBadge();
    throw error;
  }
}

export async function startAiRecording(tabId, targetDescription, options = {}) {
  if (S.currentRuntime.isRecording) {
    return;
  }

  const goal = sanitizeEditableText(targetDescription, 500);
  if (!goal) {
    throw new Error('请先填写 AI 录制目标');
  }

  const targetOptions = normalizeRecordingTargetOptions({
    ...options,
    targetUrl: options.targetUrl || extractFirstRecordableUrl(goal)
  });
  let tab = await getRecordingStartTargetTab(tabId, 'AI 录制', targetOptions);
  const settings = await getSettings();
  if (!hasVisionAnalysisConfig(settings)) {
    throw new Error('请先配置 AI，并明确允许截图发送到所选服务商');
  }

  const startedAt = Date.now();
  const agentMaxSteps = normalizeAiAgentMaxSteps(settings.aiAgentMaxSteps);
  const agentMaxDurationMs = normalizeAiAgentMaxDurationMs(settings.aiAgentMaxDurationMinutes);

  S.currentRecording = {
    id: startedAt.toString(),
    startTime: startedAt,
    title: goal.slice(0, 36),
    status: 'recording',
    commitState: COMMIT_STATES.RECORDING,
    lastOperation: createRecordingOperation('startAiRecording', COMMIT_STATES.RECORDING, `start-ai-${startedAt}`),
    recoverableError: null,
    recordingMode: 'ai',
    captureMode: 'agent',
    screenshots: [],
    audioDataUrl: null,
    audioAssetId: '',
    audioMeta: null,
    videoDataUrl: null,
    videoAssetId: '',
    videoMeta: null,
    aiGoal: goal,
    exportBaseName: '',
    lastExportAt: null,
    lastExportPrompted: false
  };

  S.currentRuntime = {
    ...createIdleRuntime(),
    isRecording: true,
    startTime: startedAt,
    tabId: tab.id,
    windowId: tab.windowId,
    recordingId: S.currentRecording.id,
    recordingMode: 'ai',
    captureMode: 'agent',
    screenshotEngine: 'cdp',
    captureIntervalMs: settings.screenshotInterval * 1000,
    autoScreenshot: false,
    mediaStatus: 'AI 录制中',
    aiAgent: createAiAgentState({
      status: 'starting',
      goal,
      maxSteps: agentMaxSteps,
      maxDurationMs: agentMaxDurationMs,
      startedAt,
      deadlineAt: startedAt + agentMaxDurationMs,
      message: '正在启动 AI...'
    })
  };

  await persistRecording(S.currentRecording);
  await persistRuntime();
  await updateBadge();
  notifyAiStatus();

  try {
    tab = await attachAiCdpDebuggerWithFallback(tab, targetOptions);
    await updateAiAgentState({
      status: 'running',
      message: 'AI 正在观察页面...'
    });
    await injectContentScript(tab.id);
    notifyPopup('started', {
      startTime: S.currentRuntime.startTime,
      recordingId: S.currentRuntime.recordingId,
      recordingMode: S.currentRuntime.recordingMode,
      count: S.currentRuntime.count,
      captureMode: S.currentRuntime.captureMode,
      screenshotEngine: S.currentRuntime.screenshotEngine,
      cdpAttached: S.currentRuntime.cdpAttached,
      audioStarted: false,
      videoStarted: false,
      mediaStatus: S.currentRuntime.mediaStatus,
      realtimeSuggestion: S.currentRuntime.realtimeSuggestion,
      aiAgent: S.currentRuntime.aiAgent
    });
    notifyContent('recordingStarted');
    notifyAiStatus();

    runAiAgentLoop(settings, stopRecording).catch((error) => {
      handleAiAgentFailure(error).catch((failureError) => {
        console.error('[Background] AI failure handling failed:', failureError);
      });
    });
  } catch (error) {
    await detachCdpDebugger(S.currentRuntime.tabId || tab.id);
    await deleteRecording(S.currentRecording.id).catch(() => {});
    S.currentRecording = null;
    S.currentRuntime = createIdleRuntime();
    await persistRuntime();
    await updateBadge();
    throw error;
  }
}

export async function attachAiCdpDebuggerWithFallback(initialTab, options = {}) {
  const targetOptions = normalizeRecordingTargetOptions(options);
  try {
    await attachCdpDebugger(initialTab.id, {
      modeLabel: 'AI 录制',
      targetUrl: targetOptions.targetUrl
    });
    return initialTab;
  } catch (error) {
    if (!targetOptions.allowFallbackTarget || !isRecordingTargetError(error)) {
      throw error;
    }
  }

  const fallbackTab = await findBestRecordingStartTargetTab(initialTab.id, targetOptions);
  if (!fallbackTab) {
    throw createRecordingTargetError('AI 录制');
  }

  const activatedTab = await activateRecordingTargetTab(fallbackTab, 'AI 录制', targetOptions);
  S.currentRuntime.tabId = activatedTab.id;
  S.currentRuntime.windowId = activatedTab.windowId;
  await persistRuntime();
  notifyAiStatus();

  await attachCdpDebugger(activatedTab.id, {
    modeLabel: 'AI 录制',
    targetUrl: targetOptions.targetUrl
  });
  return activatedTab;
}

export async function pauseRecording() {
  if (S.currentRuntime.recordingMode === 'ai') {
    await pauseAiAgent();
    return;
  }

  if (!S.currentRuntime.isRecording || S.currentRuntime.isPaused) {
    return;
  }

  S.currentRuntime.isPaused = true;
  S.currentRuntime.pauseStartedAt = Date.now();
  await persistRuntime();
  await updateBadge();

  await sendOffscreenMessage('pauseSession').catch((error) => {
    notifyPopup('warning', { message: `媒体暂停失败：${error.message}` });
  });

  notifyPopup('paused');
  notifyContent('recordingPaused');
}

export async function resumeRecording() {
  if (S.currentRuntime.recordingMode === 'ai') {
    await resumeAiAgent();
    return;
  }

  if (!S.currentRuntime.isRecording || !S.currentRuntime.isPaused) {
    return;
  }

  if (S.currentRuntime.pauseStartedAt) {
    S.currentRuntime.pausedDurationMs += Date.now() - S.currentRuntime.pauseStartedAt;
  }

  S.currentRuntime.pauseStartedAt = null;
  S.currentRuntime.isPaused = false;
  await persistRuntime();
  await updateBadge();

  await sendOffscreenMessage('resumeSession', {
    intervalMs: S.currentRuntime.captureIntervalMs,
    autoCapture: S.currentRuntime.autoScreenshot
  }).catch((error) => {
    notifyPopup('warning', { message: `媒体恢复失败：${error.message}` });
  });

  notifyPopup('resumed');
  notifyContent('recordingResumed');
}

export async function stopRecording(operationId = '') {
  const recordingId = S.currentRuntime.recordingId || S.currentRecording?.id || '';
  const fallbackOperationId = recordingId ? `stop-${recordingId}` : '';
  const resolvedOperationId = operationId || fallbackOperationId;
  return runExclusiveOperation('stopRecording', () =>
    runIdempotentOperation('stopRecording', resolvedOperationId, () => performStopRecording(resolvedOperationId))
  );
}

export async function performStopRecording(operationId = '') {
  if (!S.currentRuntime.isRecording || !S.currentRecording) {
    return;
  }

  const stoppedAt = Date.now();

  if (S.currentRuntime.isPaused && S.currentRuntime.pauseStartedAt) {
    S.currentRuntime.pausedDurationMs += stoppedAt - S.currentRuntime.pauseStartedAt;
  }

  S.currentRuntime.isPaused = true;
  S.currentRuntime.pauseStartedAt = null;
  S.currentRuntime.isGenerating = true;
  if (S.currentRuntime.recordingMode === 'ai') {
    S.currentRuntime.aiAgent = {
      ...S.currentRuntime.aiAgent,
      status: 'stopping',
      paused: false,
      message: '正在停止 AI 录制并生成教程...',
      updatedAt: Date.now()
    };
  }
  S.realtimeSuggestionQueue.pending = null;
  S.currentRuntime.durationMs = getElapsedMs(stoppedAt);
  await updateRecordingCommitState(S.currentRecording, COMMIT_STATES.STOPPING, {
    type: 'stopRecording',
    operationId,
    status: 'stopping'
  });
  await persistRuntime();
  await updateBadge();

  if (S.currentRuntime.recordingMode === 'ai') {
    await detachCdpDebugger();
    S.currentRuntime.screenshotEngine = 'standard';
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
    audioError: error.message || '媒体停止失败',
    videoError: error.message || '媒体停止失败',
    durationMs: S.currentRuntime.durationMs
  }));

  applyMediaResult(S.currentRecording, mediaResult, S.currentRuntime.durationMs);

  await updateRecordingCommitState(S.currentRecording, COMMIT_STATES.MEDIA_COLLECTED, {
    type: 'stopRecording',
    operationId,
    status: 'stopping'
  });
  await detachCdpDebugger();

  try {
    await generateTutorial(operationId);
  } catch (error) {
    await markRecordingRecoverableFailure(S.currentRecording, error, 'generateTutorial');
    S.currentRuntime = createIdleRuntime();
    await persistRuntime();
    await updateBadge();
    S.currentRecording = null;
    throw error;
  } finally {
    await detachCdpDebugger();
    await closeOffscreenDocument();
  }
}
