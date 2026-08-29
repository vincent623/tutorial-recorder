import { notifyContent } from './background.js';
import { getRelevantInteraction } from './interaction-capture.js';
import { notifyPopup } from './notify.js';
import { createOperationId, runIdempotentOperation, runSerializedOperation } from './op-safety.js';
import { queueRealtimeSuggestion } from './realtime-suggestions.js';
import { ensureScreenshotAsset, persistRecording } from './recording-assets.js';
import { assertRecordingTargetTab, getSettledRecordingTargetTab, normalizeRecordingTargetError, normalizeRecordingTargetOptions } from './recording-target.js';
import { S, getElapsedMs, persistRuntime, updateBadge } from './runtime-state.js';
import { createRandomSuffix, sanitizeEditableText, sanitizeOperationId } from './text-utils.js';

export const CDP_PROTOCOL_VERSION = '1.3';

export async function injectContentScript(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return false;
  }

  const results = await chrome.scripting
    .executeScript({
      target: { tabId },
      files: ['content/content.js']
    })
    .catch((error) => {
      console.warn(
        '[Background] Content script injection skipped:',
        sanitizeEditableText(error?.message || error, 160)
      );
      return null;
    });

  return Array.isArray(results) && results.length > 0;
}

export async function captureScreenshot({ trigger = 'manual', allowWhenPaused = false, operationId = '' } = {}) {
  const recordingId = S.currentRuntime.recordingId || S.currentRecording?.id || 'idle';
  const queueKey = `captureScreenshot:${recordingId}`;

  return runSerializedOperation(queueKey, () =>
    runIdempotentOperation(queueKey, operationId, () =>
      performCaptureScreenshot({ trigger, allowWhenPaused, operationId })
    )
  );
}

export async function performCaptureScreenshot({ trigger = 'manual', allowWhenPaused = false, operationId = '' } = {}) {
  if (!S.currentRuntime.isRecording || !S.currentRecording || !S.currentRuntime.tabId) {
    return { ok: false, captured: false };
  }

  if (S.currentRuntime.isPaused && !allowWhenPaused) {
    return { ok: false, captured: false };
  }

  const tab = await chrome.tabs.get(S.currentRuntime.tabId).catch(() => null);
  if (!tab) {
    throw new Error('录制页面已经关闭，无法继续截图');
  }

  S.currentRuntime.windowId = tab.windowId;
  const dataUrl = await captureScreenshotDataUrl(tab);

  const timestamp = Date.now();
  const sequence = getNextScreenshotSequence();
  const resolvedOperationId = sanitizeOperationId(operationId) || createOperationId(`capture-${trigger}`);
  const screenshot = {
    id: createScreenshotId(S.currentRecording.id, sequence),
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

  S.currentRecording.screenshots.push(screenshot);
  const screenshotAsset = ensureScreenshotAsset(
    S.currentRecording,
    screenshot,
    S.currentRecording.screenshots.length - 1
  );

  S.currentRuntime.count = S.currentRecording.screenshots.length;
  await persistRecording(S.currentRecording, screenshotAsset ? [screenshotAsset] : []);
  await persistRuntime();
  await updateBadge();

  notifyPopup('screenshot', {
    count: S.currentRuntime.count,
    elapsedMs: getElapsedMs(timestamp)
  });
  notifyContent('screenshotFeedback', { count: S.currentRuntime.count });

  if (!S.currentRuntime.isGenerating && S.currentRuntime.recordingMode !== 'ai' && trigger !== 'agent') {
    queueRealtimeSuggestion(S.currentRecording.id, screenshot.id).catch((error) => {
      console.warn('[Background] Realtime suggestion queue failed:', error);
    });
  }

  return { ok: true, captured: true, count: S.currentRuntime.count };
}

export function getNextScreenshotSequence() {
  const currentSequence = Number.parseInt(S.currentRuntime.screenshotSequence, 10) || 0;
  const existingCount = S.currentRecording?.screenshots?.length || 0;
  const nextSequence = Math.max(currentSequence, existingCount) + 1;
  S.currentRuntime.screenshotSequence = nextSequence;
  return nextSequence;
}

export function createScreenshotId(recordingId, sequence) {
  const safeRecordingId = sanitizeOperationId(recordingId) || 'recording';
  const safeSequence = String(sequence).padStart(5, '0');
  return `${safeRecordingId}-shot-${safeSequence}-${createRandomSuffix()}`;
}

export async function captureScreenshotDataUrl(tab) {
  if (S.currentRuntime.screenshotEngine === 'cdp' && S.currentRuntime.cdpAttached) {
    try {
      return await captureVisibleTabWithCdp(tab.id);
    } catch (error) {
      S.currentRuntime.screenshotEngine = 'standard';
      S.currentRuntime.cdpAttached = false;
      S.currentRuntime.cdpCrop = null;
      await persistRuntime();
      notifyPopup('warning', {
        message: `CDP 截图失败，已回退到标准模式：${error.message || '未知错误'}`
      });
      await detachCdpDebugger(tab.id);
    }
  }

  return chrome.tabs.captureVisibleTab(S.currentRuntime.windowId, {
    format: 'png'
  });
}

export async function attachCdpDebugger(tabId, options = {}) {
  const targetOptions = normalizeRecordingTargetOptions(options);
  const modeLabel = options.modeLabel || 'CDP 录制';
  const tab = await getSettledRecordingTargetTab(tabId, targetOptions);
  assertRecordingTargetTab(tab, modeLabel, targetOptions);

  const target = { tabId: tab.id };
  await chrome.debugger.attach(target, CDP_PROTOCOL_VERSION).catch((error) => {
    throw normalizeRecordingTargetError(error, modeLabel);
  });
  S.currentRuntime.cdpAttached = true;
  S.currentRuntime.screenshotEngine = 'cdp';
  await chrome.debugger.sendCommand(target, 'Page.enable').catch(() => {});
  await chrome.debugger.sendCommand(target, 'DOM.enable').catch(() => {});
  await persistRuntime();
  notifyPopup('cdpStatus', {
    active: true,
    message: '录制中使用 CDP 精确截图，Chrome 可能显示调试提示，录制结束后会自动消失。'
  });
}

export async function detachCdpDebugger(tabId = S.currentRuntime.tabId) {
  if (!tabId || !S.currentRuntime.cdpAttached) {
    return;
  }

  await chrome.debugger.detach({ tabId }).catch(() => {});
  S.currentRuntime.cdpAttached = false;
  await persistRuntime().catch(() => {});
  notifyPopup('cdpStatus', { active: false });
}

export async function captureVisibleTabWithCdp(tabId) {
  const target = { tabId };
  const params = {
    format: 'png',
    fromSurface: true
  };

  if (S.currentRuntime.cdpCrop) {
    params.clip = S.currentRuntime.cdpCrop;
  }

  const result = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', params);
  if (!result?.data) {
    throw new Error('CDP 未返回截图数据');
  }

  return `data:image/png;base64,${result.data}`;
}
