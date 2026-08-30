import { AI_CONCURRENCY, PROVIDER_TEST_IMAGE_DATA_URL, analyzeImage, describeAiFailureForUser, describeConnectionFailureHint, hasVisionAnalysisConfig } from './ai-vision.js';
import { downloadRecordingBundle, generatePdfForRecording } from './export-pipeline.js';
import { buildMarkdown, buildRecordingTitle } from './exporters.js';
import { buildHistoryEntry, getHistory, upsertHistoryEntry } from './history-service.js';
import { notifyPopup } from './notify.js';
import { COMMIT_STATES, createOperationId, runExclusiveOperation, runIdempotentOperation, updateRecordingCommitState } from './op-safety.js';
import { S, createIdleRuntime, persistRuntime, updateBadge } from './runtime-state.js';
import { getSettings } from './settings-store.js';
import { getFallbackDescription, hasStepDescription } from './step-descriptions.js';
import { sanitizeEditableText, sanitizeOperationId } from './text-utils.js';

export async function generateTutorial(operationId = '') {
  const recordingId = S.currentRecording?.id || 'idle';
  return runExclusiveOperation(`generateTutorial:${recordingId}`, () => performGenerateTutorial(operationId));
}

export async function performGenerateTutorial(operationId = '') {
  if (!S.currentRecording?.screenshots.length) {
    throw new Error('没有可导出的截图');
  }

  const settings = await getSettings();
  const canAnalyze = hasVisionAnalysisConfig(settings);

  if (canAnalyze) {
    const queue = S.currentRecording.screenshots
      .map((screenshot, index) => ({ screenshot, index }))
      .filter(({ screenshot }) => !hasStepDescription(screenshot));

    const workerCount = Math.min(AI_CONCURRENCY, queue.length);
    await Promise.all(
      Array.from({ length: workerCount }, () => runDescriptionAnalysisWorker(queue))
    );
  } else {
    notifyPopup('generating', {
      message: '未配置 AI，正在使用默认步骤说明生成教程...'
    });

    S.currentRecording.screenshots = S.currentRecording.screenshots.map((screenshot, index) => ({
      ...screenshot,
      description: screenshot.description || getFallbackDescription(screenshot, index)
    }));
  }

  S.currentRecording.title = buildRecordingTitle(S.currentRecording);
  S.currentRecording.status = 'ready';
  await updateRecordingCommitState(S.currentRecording, COMMIT_STATES.DESCRIPTIONS_READY, {
    type: 'generateTutorial',
    operationId,
    status: 'ready'
  });

  notifyPopup('generating', { message: '正在生成 Markdown 和导出素材...' });

  const markdown = buildMarkdown(S.currentRecording);
  const pdfResult = await generatePdfForRecording(S.currentRecording);

  if (pdfResult?.error) {
    notifyPopup('warning', { message: `PDF 生成失败：${pdfResult.error}` });
  }

  const exportBaseName = await downloadRecordingBundle(
    S.currentRecording,
    markdown,
    pdfResult?.pdfDataUrl || null,
    settings.outputDir,
    settings.promptForSaveAs
  );

  S.currentRecording.exportBaseName = exportBaseName;
  S.currentRecording.lastExportAt = Date.now();
  S.currentRecording.lastExportPrompted = settings.promptForSaveAs;
  S.currentRecording.lastExportOperationId = sanitizeOperationId(operationId) || createOperationId('export');
  await updateRecordingCommitState(S.currentRecording, COMMIT_STATES.DOWNLOAD_REQUESTED, {
    type: 'downloadRecordingBundle',
    operationId,
    status: 'ready'
  });

  await upsertHistoryEntry(buildHistoryEntry(S.currentRecording));
  await updateRecordingCommitState(S.currentRecording, COMMIT_STATES.HISTORY_UPDATED, {
    type: 'upsertHistoryEntry',
    operationId,
    status: 'ready'
  });
  await updateRecordingCommitState(S.currentRecording, COMMIT_STATES.COMPLETE, {
    type: 'generateTutorial',
    operationId,
    status: 'ready'
  });
  await upsertHistoryEntry(buildHistoryEntry(S.currentRecording));

  S.currentRuntime = createIdleRuntime();
  await persistRuntime();
  await updateBadge();
  S.currentRecording = null;

  notifyPopup('complete', {
    history: await getHistory()
  });
}

export async function runDescriptionAnalysisWorker(queue) {
  while (queue.length) {
    const item = queue.shift();
    if (!item) {
      return;
    }

    const { screenshot, index } = item;
    const settings = await getSettings();
    if (!hasVisionAnalysisConfig(settings)) {
      screenshot.description = getFallbackDescription(screenshot, index);
      screenshot.descriptionSource = 'fallback-consent-revoked';
      screenshot.descriptionUpdatedAt = Date.now();
      continue;
    }

    notifyPopup('generating', {
      message: `正在分析步骤 ${index + 1}/${S.currentRecording.screenshots.length}...`
    });

    try {
      screenshot.description = await analyzeImage(screenshot, settings, index, S.currentRecording.screenshots);
      screenshot.descriptionSource = 'batch-ai';
      screenshot.descriptionUpdatedAt = Date.now();
    } catch (error) {
      console.error('[Background] Analyze error:', error);
      notifyPopup('warning', {
        message: `步骤 ${index + 1} ${describeAiFailureForUser(error)}，已改用默认说明继续导出。`
      });
      screenshot.description = getFallbackDescription(screenshot, index);
      screenshot.descriptionSource = 'fallback';
      screenshot.descriptionUpdatedAt = Date.now();
    }
  }
}








export async function testProviderConnection(operationId = '') {
  const resolvedOperationId = sanitizeOperationId(operationId) || createOperationId('test-connection');
  return runIdempotentOperation('testProviderConnection', resolvedOperationId, () =>
    performTestProviderConnection()
  );
}

export async function performTestProviderConnection() {
  const settings = await getSettings();

  if (!settings.apiBaseUrl) {
    return { ok: false, error: '请先填写 API Base URL（可在高级 AI 选项中设置）。' };
  }

  if (!settings.apiKey) {
    return { ok: false, error: '请先填写 API Key。' };
  }

  if (!settings.modelId) {
    return { ok: false, error: '请先填写模型 / Endpoint ID。' };
  }

  if (settings.aiDataSharingConsent !== true) {
    return { ok: false, error: '请先明确允许将测试图片发送到所选 AI 服务商。' };
  }

  const testScreenshot = {
    data: PROVIDER_TEST_IMAGE_DATA_URL,
    pageContext: {
      title: '连接测试',
      url: '',
      interaction: null
    }
  };

  const startedAt = Date.now();

  try {
    const reply = await analyzeImage(testScreenshot, settings, 0, [testScreenshot]);
    const latencyMs = Date.now() - startedAt;
    const trimmedReply = sanitizeEditableText(reply, 120);

    return {
      ok: true,
      latencyMs,
      provider: settings.providerPreset,
      modelId: settings.modelId,
      reply: trimmedReply || '(模型返回了空内容，但连接正常)',
      message: `连接成功，模型响应 ${latencyMs}ms。`
    };
  } catch (error) {
    return {
      ok: false,
      provider: settings.providerPreset,
      modelId: settings.modelId,
      latencyMs: Date.now() - startedAt,
      error: describeAiFailureForUser(error),
      hint: describeConnectionFailureHint(error, settings)
    };
  }
}
