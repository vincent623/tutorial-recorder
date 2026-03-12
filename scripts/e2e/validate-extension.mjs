import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

    await popup.locator('#outputDir').fill(customOutputDir);
    console.log(`[e2e] output dir set: ${customOutputDir}`);
    const saveSettingsResult = await popup.evaluate((outputDir) =>
      chrome.runtime.sendMessage({
        action: 'saveSettings',
        settings: {
          apiKey: '',
          endpointId: '',
          outputDir,
          screenshotInterval: 5,
          autoScreenshot: true
        }
      }),
      customOutputDir
    );
    console.log(`[e2e] save settings result: ${JSON.stringify(saveSettingsResult)}`);

    const startResult = await popup.evaluate(
      (tabId) => chrome.runtime.sendMessage({ action: 'startRecording', tabId }),
      fixtureTab.id
    );
    console.log(`[e2e] start recording result: ${JSON.stringify(startResult)}`);
    const settingsState = await serviceWorker.evaluate(async () => {
      const { settings = null } = await chrome.storage.local.get(['settings']);
      return settings;
    });
    console.log(`[e2e] settings snapshot: ${JSON.stringify(settingsState)}`);

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

    const downloadItems = await waitForDownloads(serviceWorker);
    console.log(`[e2e] downloads completed: ${downloadItems.length}`);
    const popupSummary = await historyPopup.evaluate(() => {
      const statusText = document.querySelector('#status .status-text')?.textContent?.trim() || '';
      const historyCount = document.querySelectorAll('.history-item').length;
      const audioStatus = document.getElementById('audioStatus')?.textContent?.trim() || '';
      const firstHistoryTitle = document.querySelector('.history-title')?.textContent?.trim() || '';
      const firstHistoryExport = document.querySelector('.history-export')?.textContent?.trim() || '';
      const screenshotCount = document.getElementById('screenshotCount')?.textContent?.trim() || '';
      const outputPreviewValue = document.getElementById('outputPreviewValue')?.textContent?.trim() || '';

      return {
        statusText,
        historyCount,
        audioStatus,
        firstHistoryTitle,
        firstHistoryExport,
        screenshotCount,
        outputPreviewValue
      };
    });

    await historyPopup.screenshot({ path: popupShotPath, fullPage: true });

    const filesOnDisk = await listFiles(downloadsDir);
    const fileTypes = await classifyDownloadedFiles(downloadsDir, filesOnDisk);

    const report = {
      extensionId,
      fixtureUrl: `http://127.0.0.1:${port}/fixture.html`,
      contentFeedbackObserved,
      popup: popupSummary,
      settingsState,
      historyState,
      downloadItems,
      filesOnDisk,
      fileTypes,
      checks: {
        hasMarkdown: fileTypes.some((item) => item.kind === 'markdown'),
        hasPdf: fileTypes.some((item) => item.kind === 'pdf'),
        hasAudio: fileTypes.some((item) => item.kind === 'webm'),
        hasScreenshot: fileTypes.filter((item) => item.kind === 'png').length >= 1,
        outputDirPersisted: settingsState?.outputDir === customOutputDir,
        outputPreviewRendered: popupSummary.outputPreviewValue.includes(`Downloads/${customOutputDir}/tutorial-`),
        historyExportRendered: popupSummary.firstHistoryExport.includes(`Downloads/${customOutputDir}/tutorial-`)
      }
    };

    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context?.close().catch(() => {});
    server.close();
  }
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

async function waitForDownloads(serviceWorker) {
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

    const finished = items.length >= 4 && items.every((item) => item.state === 'complete');
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
    const header = buffer.subarray(0, 16);
    let kind = 'unknown';

    if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
      kind = 'pdf';
    } else if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
      kind = 'png';
    } else if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
      kind = 'webm';
    } else {
      const text = buffer.toString('utf8').trimStart();
      if (text.startsWith('# ')) {
        kind = 'markdown';
      }
    }

    results.push({
      name: relativePath,
      kind
    });
  }

  return results;
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
