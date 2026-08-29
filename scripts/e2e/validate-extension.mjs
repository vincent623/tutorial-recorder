import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from '../../lib/fflate.js';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const artifactsDir = path.join(repoRoot, 'output', 'playwright');
const extensionPath = repoRoot;
const downloadsDir = path.join(artifactsDir, 'downloads');
const profileDir = path.join(artifactsDir, 'profile');
const reportPath = path.join(artifactsDir, 'report.json');
const popupShotPath = path.join(artifactsDir, 'popup.png');
const workspaceShotPath = path.join(artifactsDir, 'workspace.png');
const fixturePath = path.join(__dirname, 'fixture.html');
const detailInsertImagePath = path.join(repoRoot, 'icons', 'icon128.png');
const detailReplaceImagePath = path.join(repoRoot, 'icons', 'icon48.png');
const port = Number.parseInt(process.env.PW_FIXTURE_PORT || '48123', 10);
const headless = process.env.PW_HEADLESS !== '0';
const customOutputDir = process.env.PW_OUTPUT_SUBDIR || 'codex-e2e/tutorial-recorder';
const customAiAgentMaxSteps = 75;
const customAiAgentMaxDurationMinutes = 15;
const editedTitle = '发布版教程';
const aiConfig = buildAiConfigFromEnv();
const aiEnabled = Boolean(aiConfig.apiKey && aiConfig.modelId);

async function main() {
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  await cleanupDirectory(downloadsDir);
  await cleanupDirectory(profileDir);

  const server = await startFixtureServer();
  let context;

  try {
    console.log(`[e2e] launching chromium with extension (headless=${headless})`);
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      downloadsPath: downloadsDir,
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--auto-select-desktop-capture-source=Tutorial Recorder Fixture',
        '--no-default-browser-check',
        '--no-first-run'
      ]
    });

    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', {
        timeout: 20000
      }));

    context.on('close', () => console.log('[e2e] browser context closed'));
    context.browser()?.on('disconnected', () => console.log('[e2e] browser disconnected'));
    const extensionId = new URL(serviceWorker.url()).host;
    console.log(`[e2e] extension loaded: ${extensionId}`);
    const page = context.pages()[0] || (await context.newPage());
    page.on('close', () => console.log('[e2e] fixture page closed'));
    page.on('crash', () => console.log('[e2e] fixture page crashed'));
    page.on('pageerror', (error) => console.log(`[fixture pageerror] ${error.message}`));
    page.on('console', (message) => console.log(`[fixture console:${message.type()}] ${message.text()}`));
    await page.goto(`http://127.0.0.1:${port}/fixture.html`, { waitUntil: 'networkidle' });
    await page.bringToFront();
    console.log('[e2e] fixture page ready');

    const fixtureTab = await serviceWorker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return { id: tab.id, windowId: tab.windowId };
    }, `http://127.0.0.1:${port}/fixture.html`);
    console.log(`[e2e] fixture tab id=${fixtureTab.id} windowId=${fixtureTab.windowId}`);

    const popupPromise = context.waitForEvent('page');
    await serviceWorker.evaluate(
      async (popupUrl) =>
        chrome.windows.create({
          url: popupUrl,
          type: 'popup',
          width: 420,
          height: 900
        }),
      `chrome-extension://${extensionId}/popup/popup.html`
    );

    const popup = await popupPromise;
    popup.on('close', () => console.log('[e2e] popup page closed'));
    popup.on('crash', () => console.log('[e2e] popup page crashed'));
    popup.on('pageerror', (error) => console.log(`[popup pageerror] ${error.message}`));
    popup.on('console', (message) => console.log(`[popup console:${message.type()}] ${message.text()}`));
    const popupDialogMessages = [];
    popup.on('dialog', async (dialog) => {
      popupDialogMessages.push(dialog.message());
      await dialog.dismiss();
    });
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForFunction(
      () => window.location.protocol === 'chrome-extension:' && Boolean(chrome?.runtime?.sendMessage)
    );
    console.log('[e2e] popup page ready');

    const aiStartEnabledWithoutConfig = await popup.locator('#btnAiStart').isEnabled();
    if (!aiStartEnabledWithoutConfig) {
      throw new Error('AI start button should remain clickable when configuration is missing');
    }

    await popup.locator('#aiGoal').fill('验证 AI 未配置时必须给出明确反馈');
    const missingConfigDialogIndex = popupDialogMessages.length;
    await popup.locator('#btnAiStart').click();
    await waitForDialogCount(popupDialogMessages, missingConfigDialogIndex + 1);
    const aiMissingConfigDialogMessage = popupDialogMessages[missingConfigDialogIndex] || '';
    const aiMissingConfigRuntimeState = await popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({ action: 'getPopupState' });
      return {
        ok: result?.ok === true,
        isRecording: result?.runtime?.isRecording === true
      };
    });
    const aiMissingConfigShowsFeedback =
      /请先在完整设置中配置 AI Provider、API Key 和模型/.test(aiMissingConfigDialogMessage) &&
      aiMissingConfigRuntimeState?.isRecording === false;

    if (!aiMissingConfigShowsFeedback) {
      throw new Error(`AI missing-config feedback failed: ${aiMissingConfigDialogMessage}`);
    }

    const connectionTestWithoutConfig = await popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({ action: 'testProviderConnection' });
      return {
        ok: result?.ok === true,
        error: result?.error || ''
      };
    });
    const connectionTestWithoutConfigHandled =
      connectionTestWithoutConfig?.ok === false &&
      /请先填写/.test(connectionTestWithoutConfig.error);
    if (!connectionTestWithoutConfigHandled) {
      throw new Error(
        `Provider connection test without config failed: ${JSON.stringify(connectionTestWithoutConfig)}`
      );
    }
    console.log('[e2e] connection test without config rejected with guidance');

    const invalidAiTargetResult = await popup.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.runtime.sendMessage({
        action: 'startAiRecording',
        tabId: tab?.id,
        targetDescription: '验证扩展页不能作为 AI 录制目标'
      });
    });
    const invalidAiRuntimeState = await popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({ action: 'getPopupState' });
      return {
        ok: result?.ok === true,
        isRecording: result?.runtime?.isRecording === true,
        recordingMode: result?.runtime?.recordingMode || ''
      };
    });
    console.log(`[e2e] invalid AI target result: ${JSON.stringify(invalidAiTargetResult)}`);
    const invalidAiTargetGuardPassed =
      invalidAiTargetResult?.ok === false &&
      /当前标签页是扩展页或浏览器内部页面/.test(invalidAiTargetResult?.error || '') &&
      /无法开始 AI 录制/.test(invalidAiTargetResult?.error || '') &&
      !/Cannot access a chrome-extension/i.test(invalidAiTargetResult?.error || '') &&
      invalidAiRuntimeState?.isRecording === false;

    if (!invalidAiTargetGuardPassed) {
      throw new Error(`AI extension target guard failed: ${JSON.stringify(invalidAiTargetResult)}`);
    }

    const settingsPagePromise = context.waitForEvent('page');
    await popup.locator('#btnOpenSettings').click();
    const settingsPage = await settingsPagePromise;
    settingsPage.on('close', () => console.log('[e2e] settings page closed'));
    settingsPage.on('pageerror', (error) => console.log(`[settings pageerror] ${error.message}`));
    settingsPage.on('console', (message) => console.log(`[settings console:${message.type()}] ${message.text()}`));
    await settingsPage.waitForLoadState('domcontentloaded');
    await settingsPage.waitForFunction(() => document.getElementById('outputDir') && Boolean(chrome?.runtime?.sendMessage));
    console.log('[e2e] settings page ready');

    await settingsPage.locator('#outputDir').fill(customOutputDir);
    await settingsPage.locator('#outputDir').dispatchEvent('change');
    await settingsPage.locator('#aiAgentMaxSteps').fill(String(customAiAgentMaxSteps));
    await settingsPage.locator('#aiAgentMaxDurationMinutes').fill(String(customAiAgentMaxDurationMinutes));
    console.log(`[e2e] output dir set in settings page: ${customOutputDir}`);
    const saveSettingsResult = await settingsPage.evaluate(({ outputDir, aiConfig }) =>
      chrome.runtime.sendMessage({
        action: 'saveSettings',
        settings: {
          providerPreset: aiConfig.providerPreset,
          apiStyle: aiConfig.apiStyle,
          apiKey: aiConfig.apiKey,
          apiBaseUrl: aiConfig.apiBaseUrl,
          modelId: aiConfig.modelId,
          extraHeadersJson: aiConfig.extraHeadersJson,
          captureMode: 'displayMedia',
          outputDir,
          aiAgentMaxSteps: 75,
          aiAgentMaxDurationMinutes: 15,
          screenshotInterval: 5,
          autoScreenshot: true
        }
      }),
      { outputDir: customOutputDir, aiConfig }
    );
    console.log(
      `[e2e] save settings result: ${JSON.stringify(redactValue(saveSettingsResult))}`
    );
    const settingsPageSummary = await settingsPage.evaluate(() => ({
      title: document.title,
      outputPreviewValue: document.getElementById('outputPreviewValue')?.textContent?.trim() || ''
    }));
    await settingsPage.close().catch(() => {});

    const startResult = await popup.evaluate(
      (tabId) => chrome.runtime.sendMessage({ action: 'startRecording', tabId }),
      fixtureTab.id
    );
    console.log(`[e2e] start recording result: ${JSON.stringify(startResult)}`);
    const settingsState = await serviceWorker.evaluate(async () => {
      const { settings = null } = await chrome.storage.local.get(['settings']);
      return settings;
    });
    const safeSettingsState = redactSettings(settingsState);
    console.log(`[e2e] settings snapshot: ${JSON.stringify(safeSettingsState)}`);

    await page.waitForTimeout(1200);
    const contentFeedbackObserved = await page.evaluate(() =>
      Boolean(document.getElementById('tr-feedback') || document.getElementById('tr-feedback-style'))
    );
    console.log(`[e2e] content feedback observed=${contentFeedbackObserved}`);

    await page.locator('#btnPlan').click();
    console.log('[e2e] clicked plan');
    await page.waitForTimeout(800);

    const manualCaptureResult = await popup.evaluate(() =>
      chrome.runtime.sendMessage({ action: 'manualCapture' })
    );
    console.log(`[e2e] manual capture result: ${JSON.stringify(manualCaptureResult)}`);
    await page.waitForTimeout(500);
    await page.locator('#btnTheme').click();
    console.log('[e2e] clicked theme');
    await page.waitForTimeout(800);

    const pauseResult = await popup.evaluate(() =>
      chrome.runtime.sendMessage({ action: 'pauseRecording' })
    );
    console.log(`[e2e] pause result: ${JSON.stringify(pauseResult)}`);
    await page.waitForTimeout(1000);
    await page.locator('#btnReview').click();
    console.log('[e2e] clicked review while paused');
    await page.waitForTimeout(500);

    const resumeResult = await popup.evaluate(() =>
      chrome.runtime.sendMessage({ action: 'resumeRecording' })
    );
    console.log(`[e2e] resume result: ${JSON.stringify(resumeResult)}`);
    await page.waitForTimeout(800);
    await page.locator('#btnReview').click();
    console.log('[e2e] clicked review after resume');
    await page.waitForTimeout(1500);

    const stopResult = await popup.evaluate(() =>
      chrome.runtime.sendMessage({ action: 'stopRecording' })
    );
    console.log(`[e2e] stop result: ${JSON.stringify(stopResult)}`);

    await popup.close().catch(() => {});

    const historyState = await waitForHistoryInStorage(serviceWorker);
    console.log(`[e2e] history persisted: ${historyState.length}`);

    const historyPopup = await context.newPage();
    historyPopup.on('close', () => console.log('[e2e] history popup closed'));
    historyPopup.on('crash', () => console.log('[e2e] history popup crashed'));
    historyPopup.on('pageerror', (error) => console.log(`[history pageerror] ${error.message}`));
    historyPopup.on('console', (message) => console.log(`[history console:${message.type()}] ${message.text()}`));
    await historyPopup.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded'
    });
    await historyPopup.waitForFunction(() => Boolean(chrome?.runtime?.sendMessage));
    console.log('[e2e] history popup opened');

    await historyPopup.waitForFunction(
      () => {
        const historyItems = document.querySelectorAll('.history-item');
        return historyItems.length > 0;
      },
      null,
      { timeout: 120000 }
    );
    console.log('[e2e] history rendered in popup');

    const recordingDetail = historyState[0]
      ? await historyPopup.evaluate(
          (id) => chrome.runtime.sendMessage({ action: 'getRecordingDetail', id }),
          historyState[0].id
        )
      : null;
    const generatedDescriptions =
      recordingDetail?.ok && recordingDetail.recording
        ? recordingDetail.recording.screenshots.map((item) => item.description || '')
        : [];
    if (generatedDescriptions.length) {
      console.log(
        `[e2e] generated descriptions: ${JSON.stringify(generatedDescriptions.slice(0, 3))}`
      );
    }

    const workspacePagePromise = context.waitForEvent('page');
    await historyPopup.locator('button[data-action="details"]').first().click();
    const workspacePage = await workspacePagePromise;
    workspacePage.on('close', () => console.log('[e2e] workspace page closed'));
    workspacePage.on('crash', () => console.log('[e2e] workspace page crashed'));
    workspacePage.on('pageerror', (error) => console.log(`[workspace pageerror] ${error.message}`));
    workspacePage.on('console', (message) => console.log(`[workspace console:${message.type()}] ${message.text()}`));
    await workspacePage.waitForLoadState('domcontentloaded');
    await workspacePage.waitForFunction(() => Boolean(chrome?.runtime?.sendMessage));
    await workspacePage.waitForSelector('#detailContent:not([hidden])');
    console.log('[e2e] workspace page ready');

    const detailCrudState = {
      countBefore: await workspacePage.evaluate(() => document.querySelectorAll('.detail-step').length)
    };
    const firstImageSrcBefore = await workspacePage.evaluate(
      () => document.querySelector('.detail-step img')?.getAttribute('src') || ''
    );

    await workspacePage.locator('button[data-step-action="insert-after"][data-step-index="0"]').click();
    await workspacePage.locator('#detailImageInput').setInputFiles(detailInsertImagePath);
    await workspacePage.waitForFunction(() => document.querySelectorAll('.detail-step').length === 4);
    detailCrudState.countAfterInsert = await workspacePage.evaluate(
      () => document.querySelectorAll('.detail-step').length
    );

    await workspacePage.locator('button[data-step-action="replace"][data-step-index="0"]').click();
    await workspacePage.locator('#detailImageInput').setInputFiles(detailReplaceImagePath);
    await workspacePage.waitForFunction(
      (beforeSrc) => {
        const currentSrc = document.querySelector('.detail-step img')?.getAttribute('src') || '';
        return Boolean(currentSrc) && currentSrc !== beforeSrc;
      },
      firstImageSrcBefore
    );
    detailCrudState.firstImageChanged = await workspacePage.evaluate(
      (beforeSrc) => (document.querySelector('.detail-step img')?.getAttribute('src') || '') !== beforeSrc,
      firstImageSrcBefore
    );

    workspacePage.once('dialog', (dialog) => dialog.accept());
    await workspacePage.locator('button[data-step-action="delete"][data-step-index="1"]').click();
    await workspacePage.waitForFunction(() => document.querySelectorAll('.detail-step').length === 3);
    detailCrudState.countAfterDelete = await workspacePage.evaluate(
      () => document.querySelectorAll('.detail-step').length
    );

    detailCrudState.firstStepTextBeforeReorder = await workspacePage.locator('textarea[data-step-index="0"]').inputValue();
    detailCrudState.secondStepTextBeforeReorder = await workspacePage.locator('textarea[data-step-index="1"]').inputValue();
    await workspacePage.locator('button[data-step-action="move-down"][data-step-index="0"]').click();
    await workspacePage.waitForFunction(
      (expectedValue) =>
        (document.querySelector('textarea[data-step-index="0"]')?.value || '').trim() === expectedValue,
      detailCrudState.secondStepTextBeforeReorder
    );
    detailCrudState.firstStepTextAfterReorder = await workspacePage
      .locator('textarea[data-step-index="0"]')
      .inputValue();

    const annotateState = await runAnnotateEditorFlow(workspacePage);
    console.log(`[e2e] annotate flow: ${JSON.stringify(annotateState)}`);
    detailCrudState.reorderWorked =
      detailCrudState.firstStepTextAfterReorder === detailCrudState.secondStepTextBeforeReorder;

    await workspacePage.locator('#detailTitle').fill(editedTitle);
    await workspacePage.locator('textarea[data-step-index="0"]').fill('发布版步骤 1');
    await workspacePage.locator('#btnSaveDetail').click();
    await workspacePage.waitForFunction(
      (expectedTitle) => document.querySelector('.history-title')?.textContent?.trim() === expectedTitle,
      editedTitle
    );
    console.log('[e2e] detail title saved');
    const assetStoreState = await readAssetStoreState(serviceWorker);
    console.log(`[e2e] asset store summary: ${JSON.stringify(assetStoreState)}`);

    await workspacePage.locator('#btnDetailExport').click();
    console.log('[e2e] detail zip export triggered');

    const downloadItems = await waitForDownloads(serviceWorker, 2);
    console.log(`[e2e] downloads completed: ${downloadItems.length}`);
    const popupSummary = await historyPopup.evaluate(() => {
      const statusText = document.querySelector('#status .status-text')?.textContent?.trim() || '';
      const historyCount = document.querySelectorAll('.history-item').length;
      const mediaStatus = document.getElementById('mediaStatus')?.textContent?.trim() || '';
      const providerSummary = document.getElementById('providerSummary')?.textContent?.trim() || '';
      const promptSummary = document.getElementById('promptSummary')?.textContent?.trim() || '';
      const outputDirSummary = document.getElementById('outputDirSummary')?.textContent?.trim() || '';
      const firstHistoryTitle = document.querySelector('.history-title')?.textContent?.trim() || '';
      const firstHistoryExport = document.querySelector('.history-export')?.textContent?.trim() || '';
      const detailStatus = document.getElementById('detailStatus')?.textContent?.trim() || '';
      const screenshotCount = document.getElementById('screenshotCount')?.textContent?.trim() || '';

      return {
        statusText,
        historyCount,
        mediaStatus,
        providerSummary,
        promptSummary,
        outputDirSummary,
        firstHistoryTitle,
        firstHistoryExport,
        detailStatus,
        screenshotCount
      };
    });
    const workspaceSummary = await workspacePage.evaluate(() => {
      const pageTitle = document.getElementById('pageTitle')?.textContent?.trim() || '';
      const detailStatus = document.getElementById('detailStatus')?.textContent?.trim() || '';
      const firstHistoryTitle = document.querySelector('.history-title')?.textContent?.trim() || '';
      const firstHistoryExport = document.querySelector('.history-export')?.textContent?.trim() || '';
      const detailVisible = !document.getElementById('detailContent')?.hasAttribute('hidden');

      return {
        pageTitle,
        detailStatus,
        firstHistoryTitle,
        firstHistoryExport,
        detailVisible
      };
    });

    await historyPopup.screenshot({ path: popupShotPath, fullPage: true });
    await workspacePage.screenshot({ path: workspaceShotPath, fullPage: true });

    const filesOnDisk = await listFiles(downloadsDir);
    const fileTypes = await classifyDownloadedFiles(downloadsDir, filesOnDisk);
    const archiveContents = await inspectZipArchives(downloadsDir, fileTypes);

    const report = {
      extensionId,
      fixtureUrl: `http://127.0.0.1:${port}/fixture.html`,
      contentFeedbackObserved,
      popup: popupSummary,
      workspace: workspaceSummary,
      settingsPage: settingsPageSummary,
      settingsState: safeSettingsState,
      aiConfig: redactAiConfig(aiConfig),
      aiStartEnabledWithoutConfig,
      aiMissingConfigDialogMessage,
      aiMissingConfigRuntimeState,
      aiMissingConfigShowsFeedback,
      invalidAiTargetResult,
      invalidAiRuntimeState,
      invalidAiTargetGuardPassed,
      popupDialogMessages,
      historyState,
      generatedDescriptions,
      detailCrudState,
      assetStoreState,
      downloadItems,
      filesOnDisk,
      fileTypes,
      archiveContents,
      checks: {
        hasZip: fileTypes.some((item) => item.kind === 'zip'),
        archiveHasMarkdown: archiveContents.some((archive) =>
          archive.entries.some((entry) => entry.kind === 'markdown')
        ),
        archiveHasPdf: archiveContents.some((archive) =>
          archive.entries.some((entry) => entry.kind === 'pdf')
        ),
        archiveHasAudio: archiveContents.some((archive) =>
          archive.entries.some((entry) => entry.kind === 'webm')
        ),
        archiveHasVideo: archiveContents.some((archive) =>
          archive.entries.some((entry) => entry.name.endsWith('video/tutorial-video.webm'))
        ),
        archiveHasScreenshot: archiveContents.some((archive) =>
          archive.entries.filter((entry) => entry.kind === 'png').length >= 1
        ),
        archiveHasStandaloneHtml: archiveContents.some(
          (archive) =>
            archive.entries.some(
              (entry) => entry.kind === 'html' && entry.name.endsWith('tutorial.html')
            ) &&
            archive.entries.some(
              (entry) =>
                entry.kind === 'html' &&
                entry.name.endsWith('tutorial.html') &&
                (entry.inlineImageCount || 0) >= 1
            )
        ),
        settingsPageOpened: settingsPageSummary.title.includes('设置'),
        outputDirPersisted: settingsState?.outputDir === customOutputDir,
        outputPreviewRendered:
          settingsPageSummary.outputPreviewValue.includes(`Downloads/${customOutputDir}/tutorial-`) &&
          settingsPageSummary.outputPreviewValue.endsWith('.zip'),
        aiAgentLimitsPersisted:
          settingsState?.aiAgentMaxSteps === customAiAgentMaxSteps &&
          settingsState?.aiAgentMaxDurationMinutes === customAiAgentMaxDurationMinutes,
        aiMissingConfigShowsFeedback,
        connectionTestGuidance: connectionTestWithoutConfigHandled,
        aiRejectsExtensionTarget:
          invalidAiTargetGuardPassed,
        popupSummaryRendered:
          popupSummary.providerSummary.length > 0 &&
          popupSummary.promptSummary.length > 0 &&
          popupSummary.outputDirSummary === customOutputDir,
        historyExportRendered:
          workspaceSummary.firstHistoryExport.includes(`Downloads/${customOutputDir}/tutorial-`) &&
          workspaceSummary.firstHistoryExport.includes('.zip'),
        detailTitleSaved: workspaceSummary.firstHistoryTitle === editedTitle,
        workspaceOpened:
          workspaceSummary.pageTitle.includes('工作台') &&
          workspaceSummary.detailVisible === true,
        detailStepCrudWorked:
          detailCrudState.countBefore === 3 &&
          detailCrudState.countAfterInsert === 4 &&
          detailCrudState.countAfterDelete === 3 &&
          detailCrudState.firstImageChanged === true &&
          detailCrudState.reorderWorked === true,
        annotateEditorWorked:
          annotateState.editorOpened === true &&
          annotateState.drewShape === true &&
          annotateState.drewMosaic === true &&
          annotateState.imageUpdated === true &&
          annotateState.editorClosed === true,
        assetStoreSplitWorked: assetStoreState.recordings.some(
          (recording) =>
            recording.id === historyState[0]?.id &&
            recording.screenshotCount === detailCrudState.countAfterDelete &&
            recording.inlineScreenshotDataCount === 0 &&
            recording.screenshotAssetIdCount === recording.screenshotCount
        ),
        assetHydrationWorked:
          recordingDetail?.ok === true &&
          recordingDetail.recording.screenshots.every((item) => /^data:image\/[-+\w.]+;base64,/.test(item.data)),
        assetStoreHasScreenshotPayloads:
          assetStoreState.assets.filter(
            (asset) =>
              asset.recordingId === historyState[0]?.id &&
              asset.kind === 'screenshot' &&
              asset.hasDataUrl
          ).length >= detailCrudState.countAfterDelete,
        mediaAssetsSplitWorked: assetStoreState.recordings.some(
          (recording) =>
            recording.id === historyState[0]?.id &&
            (!historyState[0]?.hasAudio || (recording.hasAudioAsset && !recording.hasInlineAudio)) &&
            (!historyState[0]?.hasVideo || (recording.hasVideoAsset && !recording.hasInlineVideo))
        ),
        aiDescriptionsActionable:
          !aiEnabled ||
          generatedDescriptions.some((item) => /(点击|切换|修改|提交|输入|进入)/.test(item)),
        archiveContainsEditedTitle: archiveContents.some((archive) =>
          archive.entries.some(
            (entry) => entry.kind === 'markdown' && entry.preview.includes(`# ${editedTitle}`)
          )
        )
      }
    };

    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context?.close().catch(() => {});
    server.close();
  }
}

function buildAiConfigFromEnv() {
  const providerPreset = process.env.PW_PROVIDER_PRESET?.trim() || 'volcengineArk';
  const apiStyle = process.env.PW_API_STYLE?.trim() || getDefaultApiStyle(providerPreset);
  const apiBaseUrl = process.env.PW_API_BASE_URL?.trim() || getDefaultApiBaseUrl(providerPreset);
  const apiKey = process.env.PW_API_KEY?.trim() || '';
  const modelId = process.env.PW_MODEL_ID?.trim() || '';
  const extraHeadersJson = process.env.PW_EXTRA_HEADERS_JSON?.trim() || '';
  const hasCustomAiInput = Boolean(
    process.env.PW_API_KEY ||
      process.env.PW_MODEL_ID ||
      process.env.PW_API_BASE_URL ||
      process.env.PW_API_STYLE ||
      process.env.PW_EXTRA_HEADERS_JSON ||
      process.env.PW_PROVIDER_PRESET
  );

  if (hasCustomAiInput) {
    const missing = [];
    if (!apiKey) {
      missing.push('PW_API_KEY');
    }
    if (!modelId) {
      missing.push('PW_MODEL_ID');
    }

    if (missing.length) {
      throw new Error(`AI 回归缺少必要环境变量：${missing.join(', ')}`);
    }
  }

  return {
    providerPreset,
    apiStyle,
    apiBaseUrl,
    apiKey,
    modelId,
    extraHeadersJson
  };
}

function getDefaultApiBaseUrl(providerPreset) {
  switch (providerPreset) {
    case 'siliconFlow':
      return 'https://api.siliconflow.cn/v1';
    case 'aliyunDashScope':
      return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    case 'openRouter':
      return 'https://openrouter.ai/api/v1';
    case 'googleGemini':
      return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'anthropicClaude':
      return 'https://api.anthropic.com/v1';
    case 'openai':
    case 'openaiCompatible':
      return 'https://api.openai.com/v1';
    case 'custom':
      return '';
    case 'volcengineArk':
    default:
      return 'https://ark.cn-beijing.volces.com/api/v3';
  }
}

function getDefaultApiStyle(providerPreset) {
  return providerPreset === 'anthropicClaude'
    ? 'anthropicMessages'
    : providerPreset === 'openai'
      ? 'responses'
      : 'chatCompletions';
}

function redactAiConfig(config) {
  return {
    providerPreset: config.providerPreset,
    apiStyle: config.apiStyle,
    apiBaseUrl: config.apiBaseUrl,
    modelId: config.modelId,
    apiKeyConfigured: Boolean(config.apiKey),
    extraHeadersConfigured: Boolean(config.extraHeadersJson)
  };
}

function redactSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    return settings;
  }

  return {
    ...settings,
    apiKey: settings.apiKey ? '[REDACTED]' : '',
    extraHeadersJson: settings.extraHeadersJson ? '[REDACTED]' : ''
  };
}

function redactValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'settings') {
      next[key] = redactSettings(item);
      continue;
    }

    if (key === 'apiKey') {
      next[key] = item ? '[REDACTED]' : '';
      continue;
    }

    if (key === 'extraHeadersJson') {
      next[key] = item ? '[REDACTED]' : '';
      continue;
    }

    next[key] = redactValue(item);
  }

  return next;
}

async function startFixtureServer() {
  const html = await readFile(fixturePath);

  const server = createServer((request, response) => {
    if (request.url === '/fixture.html' || request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }

    response.writeHead(404);
    response.end('Not Found');
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  console.log(`[e2e] fixture server listening on http://127.0.0.1:${port}`);
  return server;
}

async function waitForDownloads(serviceWorker, minCount = 1) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 120000) {
    const items = await serviceWorker.evaluate(async () => {
      const results = await chrome.downloads.search({
        orderBy: ['-startTime'],
        limit: 30
      });

      return results
        .filter((item) => item.filename.includes('tutorial-'))
        .map((item) => ({
          id: item.id,
          filename: item.filename,
          state: item.state,
          exists: item.exists
        }));
    });

    const finished = items.length >= minCount && items.every((item) => item.state === 'complete');
    if (finished) {
      return items;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Timed out waiting for extension downloads');
}

async function waitForHistoryInStorage(serviceWorker) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 120000) {
    const payload = await serviceWorker.evaluate(async () => {
      const { recordings = [] } = await chrome.storage.local.get(['recordings']);
      const { recordingRuntime = null } = await chrome.storage.session.get(['recordingRuntime']);

      return {
        recordings,
        recordingRuntime
      };
    });

    if (payload.recordings.length > 0 && !payload.recordingRuntime?.isRecording && !payload.recordingRuntime?.isGenerating) {
      return payload.recordings;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Timed out waiting for history to persist');
}

async function runAnnotateEditorFlow(workspacePage) {
  const state = {};

  const imageSrcBefore = await workspacePage.evaluate(
    () => document.querySelector('.detail-step img')?.getAttribute('src') || ''
  );

  await workspacePage.locator('button[data-step-action="annotate"][data-step-index="0"]').click();
  await workspacePage.waitForSelector('.tr-annotate-overlay', { timeout: 10_000 });
  state.editorOpened = true;

  const canvasBox = await workspacePage.locator('.tr-annotate-canvas').boundingBox();
  if (!canvasBox) {
    throw new Error('Annotate canvas not visible');
  }

  await workspacePage.mouse.move(canvasBox.x + 10, canvasBox.y + 10);
  await workspacePage.mouse.down();
  await workspacePage.mouse.move(canvasBox.x + 60, canvasBox.y + 30, { steps: 4 });
  await workspacePage.mouse.up();
  state.drewShape = true;

  await workspacePage.locator('.tr-annotate-tools [data-tool="mosaic"]').click();
  await workspacePage.mouse.move(canvasBox.x + 20, canvasBox.y + 40);
  await workspacePage.mouse.down();
  await workspacePage.mouse.move(canvasBox.x + 90, canvasBox.y + 80, { steps: 4 });
  await workspacePage.mouse.up();
  state.drewMosaic = true;

  await workspacePage.locator('.tr-annotate-save').click();
  await workspacePage.waitForFunction(
    (beforeSrc) => {
      const overlayGone = !document.querySelector('.tr-annotate-overlay');
      const currentSrc = document.querySelector('.detail-step img')?.getAttribute('src') || '';
      return overlayGone && Boolean(currentSrc) && currentSrc !== beforeSrc;
    },
    imageSrcBefore,
    { timeout: 15_000 }
  );

  state.imageUpdated = true;
  state.editorClosed = await workspacePage.evaluate(() => !document.querySelector('.tr-annotate-overlay'));
  return state;
}

async function waitForDialogCount(messages, minimumCount, timeoutMs = 5000) {  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (messages.length >= minimumCount) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for dialog count ${minimumCount}, got ${messages.length}`);
}

async function readAssetStoreState(serviceWorker) {
  return serviceWorker.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('tutorialRecorder');

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const storeNames = Array.from(db.objectStoreNames);
          const transaction = db.transaction(storeNames, 'readonly');
          const recordingsRequest = transaction.objectStore('recordings').getAll();
          const assetsRequest = storeNames.includes('assets')
            ? transaction.objectStore('assets').getAll()
            : null;

          transaction.oncomplete = () => {
            const recordings = (recordingsRequest.result || []).map((recording) => {
              const screenshots = Array.isArray(recording.screenshots) ? recording.screenshots : [];
              return {
                id: recording.id,
                screenshotCount: screenshots.length,
                inlineScreenshotDataCount: screenshots.filter((screenshot) => Boolean(screenshot?.data)).length,
                screenshotAssetIdCount: screenshots.filter((screenshot) => Boolean(screenshot?.assetId)).length,
                hasInlineAudio: Boolean(recording.audioDataUrl),
                hasInlineVideo: Boolean(recording.videoDataUrl),
                hasAudioAsset: Boolean(recording.audioAssetId),
                hasVideoAsset: Boolean(recording.videoAssetId)
              };
            });
            const assets = (assetsRequest?.result || []).map((asset) => ({
              id: asset.id,
              recordingId: asset.recordingId,
              kind: asset.kind,
              hasDataUrl: Boolean(asset.dataUrl),
              size: asset.size || 0
            }));

            resolve({
              stores: storeNames,
              recordings,
              assets
            });
            db.close();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        };
      })
  );
}

async function cleanupDirectory(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);

  await Promise.all(
    entries.map((entry) =>
      rm(path.join(dirPath, entry.name), {
        recursive: true,
        force: true
      })
    )
  );
}

async function listFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => []);
  const names = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      names.push(...(await listFiles(rootDir, fullPath)));
      continue;
    }

    const info = await stat(fullPath);
    if (!info.isFile()) {
      continue;
    }

    names.push(path.relative(rootDir, fullPath));
  }

  return names.sort();
}

async function classifyDownloadedFiles(rootDir, files) {
  const results = [];

  for (const relativePath of files) {
    const buffer = await readFile(path.join(rootDir, relativePath));
    results.push({
      name: relativePath,
      kind: classifyBuffer(buffer).kind
    });
  }

  return results;
}

async function inspectZipArchives(rootDir, files) {
  const archives = [];

  for (const file of files) {
    if (file.kind !== 'zip') {
      continue;
    }

    const buffer = await readFile(path.join(rootDir, file.name));
    const archive = unzipSync(new Uint8Array(buffer));
    const entries = Object.entries(archive)
      .map(([name, bytes]) => {
        const analysis = classifyBuffer(Buffer.from(bytes));
        const entry = {
          name,
          kind: analysis.kind,
          preview: analysis.preview
        };

        if (analysis.kind === 'html') {
          const text = Buffer.from(bytes).toString('utf8');
          entry.inlineImageCount = (text.match(/data:image/g) || []).length;
          entry.hasRelativeMedia =
            text.includes('audio/tutorial-audio.webm') || text.includes('video/tutorial-video.webm');
        }

        return entry;
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    archives.push({
      name: file.name,
      entries
    });
  }

  return archives;
}

function classifyBuffer(buffer) {
  const header = buffer.subarray(0, 16);

  if (header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04) {
    return { kind: 'zip', preview: '' };
  }

  if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
    return { kind: 'pdf', preview: '' };
  }

  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
    return { kind: 'png', preview: '' };
  }

  if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
    return { kind: 'webm', preview: '' };
  }

  const text = buffer.toString('utf8').trimStart();
  if (/^<!doctype html>/i.test(text)) {
    return {
      kind: 'html',
      preview: text.slice(0, 120)
    };
  }

  if (text.startsWith('# ')) {
    return {
      kind: 'markdown',
      preview: text.slice(0, 200)
    };
  }

  return { kind: 'unknown', preview: text.slice(0, 80) };
}

main().catch(async (error) => {
  const failure = {
    ok: false,
    error: error.message,
    stack: error.stack
  };
  await writeFile(reportPath, JSON.stringify(failure, null, 2)).catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
