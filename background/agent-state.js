import { notifyPopup } from './notify.js';
import { findCurrentScreenshot } from './realtime-suggestions.js';
import { persistRecording } from './recording-assets.js';
import { S, createAiAgentState, persistRuntime, updateBadge } from './runtime-state.js';
import { detachCdpDebugger } from './screenshot-engine.js';
import { AI_AGENT_MAX_DURATION_MS, AI_AGENT_MAX_STEPS } from './settings-schema.js';
import { createRandomSuffix, delay, sanitizeEditableText, sanitizeOperationId } from './text-utils.js';

export async function updateAgentScreenshotDescription(screenshotId, description) {
  const located = findCurrentScreenshot(S.currentRecording.id, screenshotId);
  if (!located) {
    return;
  }

  located.screenshot.description = sanitizeEditableText(description, 400) || `步骤 ${located.index + 1}`;
  located.screenshot.descriptionSource = 'agent-ai';
  located.screenshot.descriptionUpdatedAt = Date.now();
  await persistRecording(S.currentRecording);
}

export async function appendAiAgentStep(action, screenshotId, description) {
  const steps = Array.isArray(S.currentRuntime.aiAgent.steps) ? S.currentRuntime.aiAgent.steps : [];
  const stepId = createAgentStepId(S.currentRecording.id, screenshotId, action.action);
  const existingStep = steps.find((step) => step.id === stepId || step.screenshotId === screenshotId);

  if (existingStep) {
    return existingStep;
  }

  const step = {
    id: stepId,
    operationId: stepId,
    index: steps.length + 1,
    action: action.action,
    ...(Number.isFinite(action.x) ? { x: action.x } : {}),
    ...(Number.isFinite(action.y) ? { y: action.y } : {}),
    ...(Number.isFinite(action.requestedX) ? { requestedX: action.requestedX } : {}),
    ...(Number.isFinite(action.requestedY) ? { requestedY: action.requestedY } : {}),
    ...(action.targetText ? { targetText: sanitizeEditableText(action.targetText, 160) } : {}),
    ...(action.targetContext ? { targetContext: sanitizeEditableText(action.targetContext, 160) } : {}),
    ...(action.sourceUrl ? { sourceUrl: sanitizeEditableText(action.sourceUrl, 500) } : {}),
    ...(action.targetType ? { targetType: sanitizeOperationId(action.targetType) } : {}),
    ...(action.targetRole ? { targetRole: sanitizeOperationId(action.targetRole) } : {}),
    ...(action.targetHref ? { targetHref: sanitizeEditableText(action.targetHref, 500) } : {}),
    ...(action.targetFormAction ? { targetFormAction: sanitizeEditableText(action.targetFormAction, 500) } : {}),
    ...(action.targetFormMethod ? { targetFormMethod: sanitizeOperationId(action.targetFormMethod) } : {}),
    ...(action.submit === true ? { submit: true } : {}),
    ...(action.allowRepeat === true ? { allowRepeat: true } : {}),
    ...(action.repeatReason ? { repeatReason: sanitizeEditableText(action.repeatReason, 240) } : {}),
    ...(action.matchedText ? { matchedText: sanitizeEditableText(action.matchedText, 160) } : {}),
    ...(action.coordinateSource ? { coordinateSource: sanitizeOperationId(action.coordinateSource) } : {}),
    description,
    screenshotId,
    timestamp: Date.now()
  };

  await updateAiAgentState({
    steps: [...steps, step].slice(-(S.currentRuntime.aiAgent.maxSteps || AI_AGENT_MAX_STEPS)),
    message: description
  });
  notifyPopup('agentStep', { step, aiAgent: S.currentRuntime.aiAgent });
  return step;
}

export function createAgentStepId(recordingId, screenshotId, actionName) {
  return [
    sanitizeOperationId(recordingId) || 'recording',
    'agent-step',
    sanitizeOperationId(screenshotId) || createRandomSuffix(),
    sanitizeOperationId(actionName) || 'action'
  ].join(':');
}

export async function updateAiAgentState(patch = {}) {
  S.currentRuntime.aiAgent = {
    ...createAiAgentState(),
    ...S.currentRuntime.aiAgent,
    ...patch,
    updatedAt: Date.now()
  };

  await persistRuntime().catch(() => {});
  notifyAiStatus();
  return S.currentRuntime.aiAgent;
}

export function notifyAiStatus() {
  notifyPopup('aiStatus', {
    isRecording: S.currentRuntime.isRecording,
    isPaused: S.currentRuntime.isPaused,
    isGenerating: S.currentRuntime.isGenerating,
    startTime: S.currentRuntime.startTime,
    recordingId: S.currentRuntime.recordingId,
    recordingMode: S.currentRuntime.recordingMode,
    aiAgent: S.currentRuntime.aiAgent || createAiAgentState()
  });
}

export function isAiAgentLoopActive() {
  return (
    S.currentRuntime.isRecording &&
    S.currentRuntime.recordingMode === 'ai' &&
    S.currentRecording &&
    !S.currentRuntime.isGenerating &&
    !['failed', 'takeover', 'stopping', 'finishing', 'limit'].includes(S.currentRuntime.aiAgent?.status)
  );
}

export function isAiAgentLimitReached() {
  const now = Date.now();
  const maxSteps = S.currentRuntime.aiAgent?.maxSteps || AI_AGENT_MAX_STEPS;
  const maxDurationMs = S.currentRuntime.aiAgent?.maxDurationMs || AI_AGENT_MAX_DURATION_MS;
  const deadlineAt = S.currentRuntime.aiAgent?.deadlineAt || S.currentRuntime.startTime + maxDurationMs;
  return S.currentRuntime.aiAgent.iteration >= maxSteps || now >= deadlineAt;
}

export async function waitForAiAgentResume() {
  while (
    S.currentRuntime.isRecording &&
    S.currentRuntime.recordingMode === 'ai' &&
    !S.currentRuntime.isGenerating &&
    (S.currentRuntime.isPaused || S.currentRuntime.aiAgent?.paused)
  ) {
    await delay(500);
  }
}

export async function handleAiAgentFailure(error) {
  if (!S.currentRuntime.isRecording || S.currentRuntime.recordingMode !== 'ai' || !S.currentRecording) {
    return;
  }

  console.error('[Background] AI agent failed:', error);
  await detachCdpDebugger();
  S.currentRuntime.screenshotEngine = 'standard';
  S.currentRuntime.isPaused = true;
  S.currentRuntime.pauseStartedAt = S.currentRuntime.pauseStartedAt || Date.now();
  await updateAiAgentState({
    status: 'failed',
    paused: true,
    awaitingTakeover: true,
    message: `AI 调用失败：${sanitizeEditableText(error?.message || '未知错误', 180)}。可接管操作或停止导出。`
  });
  await updateBadge();
  notifyPopup('warning', { message: S.currentRuntime.aiAgent.message });
}
