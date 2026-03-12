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
const fixturePath = path.join(__dirname, 'fixture.html');
const port = Number.parseInt(process.env.PW_FIXTURE_PORT || '48123', 10);
const headless = process.env.PW_HEADLESS !== '0';
const customOutputDir = process.env.PW_OUTPUT_SUBDIR || 'codex-e2e/tutorial-recorder';
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
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForFunction(
      () => window.location.protocol === 'chrome-extension:' && Boolean(chrome?.runtime?.sendMessage)
    );
    console.log('[e2e] popup page ready');

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

    await historyPopup.locator('button[data-action="details"]').first().click();
    await historyPopup.waitForSelector('#detailContent:not([hidden])');
    console.log('[e2e] detail panel opened');

    await historyPopup.locator('#detailTitle').fill(editedTitle);
    await historyPopup.locator('textarea[data-step-index="0"]').fill('发布版步骤 1');
    await historyPopup.locator('#btnSaveDetail').click();
    await historyPopup.waitForFunction(
      (expectedTitle) => document.querySelector('.history-title')?.textContent?.trim() === expectedTitle,
      editedTitle
    );
    console.log('[e2e] detail title saved');

    await historyPopup.locator('#btnDetailExport').click();
    console.log('[e2e] detail zip export triggered');

    const downloadItems = await waitForDownloads(serviceWorker, 2);
    console.log(`[e2e] downloads completed: ${downloadItems.length}`);
    const popupSummary = await historyPopup.evaluate(() => {
      const statusText = document.querySelector('#status .status-text')?.textContent?.trim() || '';
      const historyCount = document.querySelectorAll('.history-item').length;
      const mediaStatus = document.getElementById('mediaStatus')?.textContent?.trim() || '';
      const providerSummary = document.getElementById('providerSummary')?.textContent?.trim() || '';
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
        outputDirSummary,
        firstHistoryTitle,
        firstHistoryExport,
        detailStatus,
        screenshotCount
      };
    });

    await historyPopup.screenshot({ path: popupShotPath, fullPage: true });

    const filesOnDisk = await listFiles(downloadsDir);
    const fileTypes = await classifyDownloadedFiles(downloadsDir, filesOnDisk);
    const archiveContents = await inspectZipArchives(downloadsDir, fileTypes);

    const report = {
      extensionId,
      fixtureUrl: `http://127.0.0.1:${port}/fixture.html`,
      contentFeedbackObserved,
      popup: popupSummary,
      settingsPage: settingsPageSummary,
      settingsState: safeSettingsState,
      aiConfig: redactAiConfig(aiConfig),
      historyState,
      generatedDescriptions,
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
        settingsPageOpened: settingsPageSummary.title.includes('设置'),
        outputDirPersisted: settingsState?.outputDir === customOutputDir,
        outputPreviewRendered:
          settingsPageSummary.outputPreviewValue.includes(`Downloads/${customOutputDir}/tutorial-`) &&
          settingsPageSummary.outputPreviewValue.endsWith('.zip'),
        popupSummaryRendered:
          popupSummary.providerSummary.length > 0 && popupSummary.outputDirSummary === customOutputDir,
        historyExportRendered:
          popupSummary.firstHistoryExport.includes(`Downloads/${customOutputDir}/tutorial-`) &&
          popupSummary.firstHistoryExport.includes('.zip'),
        detailTitleSaved: popupSummary.firstHistoryTitle === editedTitle,
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
        return {
          name,
          kind: analysis.kind,
          preview: analysis.preview
        };
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
