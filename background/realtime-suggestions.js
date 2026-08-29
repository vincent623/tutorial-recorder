import { analyzeImage, describeAiFailureForUser, hasVisionAnalysisConfig } from './ai-vision.js';
import { notifyPopup } from './notify.js';
import { persistRecording } from './recording-assets.js';
import { S, createRealtimeSuggestionState, persistRuntime } from './runtime-state.js';
import { getSettings } from './settings-store.js';
import { sanitizeEditableText, sanitizeTextValue } from './text-utils.js';
import { getFallbackDescription, hasStepDescription } from './step-descriptions.js';

export function createRealtimeSuggestionStateForSettings(settings = {}) {
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

export function normalizeRealtimeSuggestionForSettings(currentSuggestion = {}, settings = {}) {
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

export async function queueRealtimeSuggestion(recordingId, screenshotId) {
  if (!recordingId || !screenshotId || S.currentRuntime.isGenerating) {
    return;
  }

  const settings = await getSettings();
  S.currentRuntime.realtimeSuggestion = normalizeRealtimeSuggestionForSettings(
    S.currentRuntime.realtimeSuggestion,
    settings
  );

  if (settings.realtimeSuggestions !== true) {
    S.realtimeSuggestionQueue.pending = null;
    await updateRealtimeSuggestionState(S.currentRuntime.realtimeSuggestion);
    return;
  }

  if (!hasVisionAnalysisConfig(settings)) {
    S.realtimeSuggestionQueue.pending = null;
    await updateRealtimeSuggestionState(S.currentRuntime.realtimeSuggestion);
    return;
  }

  const located = findCurrentScreenshot(recordingId, screenshotId);
  if (!located || hasStepDescription(located.screenshot)) {
    return;
  }

  S.realtimeSuggestionQueue.pending = { recordingId, screenshotId };
  await updateRealtimeSuggestionState({
    enabled: true,
    status: 'queued',
    screenshotId,
    stepIndex: located.index + 1,
    text: '',
    message: '等待 AI 建议...'
  });

  if (!S.realtimeSuggestionQueue.active) {
    drainRealtimeSuggestionQueue().catch((error) => {
      console.warn('[Background] Realtime suggestion worker failed:', error);
    });
  }
}

export async function drainRealtimeSuggestionQueue() {
  if (S.realtimeSuggestionQueue.active) {
    return;
  }

  S.realtimeSuggestionQueue.active = true;

  try {
    while (S.realtimeSuggestionQueue.pending) {
      const job = S.realtimeSuggestionQueue.pending;
      S.realtimeSuggestionQueue.pending = null;
      await processRealtimeSuggestion(job);
    }
  } finally {
    S.realtimeSuggestionQueue.active = false;
  }
}

export async function processRealtimeSuggestion(job) {
  if (!job || S.currentRuntime.isGenerating) {
    return;
  }

  const settings = await getSettings();
  if (settings.realtimeSuggestions !== true || !hasVisionAnalysisConfig(settings)) {
    S.currentRuntime.realtimeSuggestion = normalizeRealtimeSuggestionForSettings(
      S.currentRuntime.realtimeSuggestion,
      settings
    );
    await updateRealtimeSuggestionState(S.currentRuntime.realtimeSuggestion);
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
        await analyzeImage(located.screenshot, settings, located.index, S.currentRecording.screenshots),
        400
      ) || getFallbackDescription(located.screenshot, located.index);
    const latest = findCurrentScreenshot(job.recordingId, job.screenshotId);
    const latestSettings = await getSettings();

    if (!latest || S.currentRuntime.isGenerating || latestSettings.realtimeSuggestions !== true) {
      return;
    }

    if (!hasStepDescription(latest.screenshot)) {
      latest.screenshot.description = suggestionText;
      latest.screenshot.descriptionSource = 'realtime-ai';
      latest.screenshot.descriptionUpdatedAt = Date.now();
      await persistRecording(S.currentRecording);
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

    if (!findCurrentScreenshot(job.recordingId, job.screenshotId) || S.currentRuntime.isGenerating) {
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

export function findCurrentScreenshot(recordingId, screenshotId) {
  if (
    !S.currentRecording ||
    !S.currentRuntime.isRecording ||
    S.currentRuntime.recordingId !== recordingId ||
    S.currentRecording.id !== recordingId
  ) {
    return null;
  }

  const index = S.currentRecording.screenshots.findIndex((screenshot) => screenshot.id === screenshotId);
  if (index < 0) {
    return null;
  }

  return {
    index,
    screenshot: S.currentRecording.screenshots[index]
  };
}

export async function updateRealtimeSuggestionState(patch = {}) {
  S.currentRuntime.realtimeSuggestion = {
    ...createRealtimeSuggestionState(),
    ...S.currentRuntime.realtimeSuggestion,
    ...patch,
    updatedAt: Date.now()
  };

  await persistRuntime().catch(() => {});
  notifyRealtimeSuggestion();
  return S.currentRuntime.realtimeSuggestion;
}

export function notifyRealtimeSuggestion() {
  notifyPopup('realtimeSuggestion', {
    suggestion: S.currentRuntime.realtimeSuggestion || createRealtimeSuggestionState()
  });
}


export async function updateRealtimeSuggestionOverride(payload = {}) {
  if (!S.currentRuntime.isRecording || !S.currentRecording) {
    throw new Error('当前没有活动录制');
  }

  const screenshotId = sanitizeTextValue(payload.screenshotId, 80);
  const description = sanitizeEditableText(payload.description, 400);
  const located = findCurrentScreenshot(S.currentRecording.id, screenshotId);

  if (!located) {
    throw new Error('这条实时建议已失效');
  }

  located.screenshot.description = description;
  located.screenshot.descriptionSource = description ? 'realtime-user' : 'realtime-cleared';
  located.screenshot.descriptionUpdatedAt = Date.now();
  await persistRecording(S.currentRecording);

  return updateRealtimeSuggestionState({
    enabled: S.currentRuntime.realtimeSuggestion?.enabled === true,
    status: description ? 'saved' : 'ready',
    screenshotId,
    stepIndex: located.index + 1,
    text: description,
    message: description ? '已保存到最终导出。' : '已清空，停止后会重新生成。'
  });
}
