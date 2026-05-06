import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const extensionPath = repoRoot;
const fixturePath = path.join(__dirname, 'fixture.html');
const artifactsDir = path.join(repoRoot, 'output', 'playwright');
const profileDir = path.join(artifactsDir, 'ai-profile');
const reportPath = path.join(artifactsDir, 'ai-smoke-report.json');
const port = Number.parseInt(process.env.PW_FIXTURE_PORT || '48124', 10);
const headless = process.env.PW_HEADLESS !== '0';
const aiConfig = await loadAiConfig();

async function main() {
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  await cleanupDirectory(profileDir);

  const server = await startFixtureServer();
  let context;
  const report = {
    fixtureUrl: `http://127.0.0.1:${port}/fixture.html`,
    aiConfig: redactAiConfig(aiConfig),
    statusSamples: [],
    runtimeSamples: [],
    checks: {}
  };

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-default-browser-check',
        '--no-first-run'
      ]
    });

    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', {
        timeout: 20000
      }));
    const extensionId = new URL(serviceWorker.url()).host;
    report.extensionId = extensionId;

    const page = context.pages()[0] || (await context.newPage());
    page.on('console', (message) => console.log(`[fixture console:${message.type()}] ${message.text()}`));
    await page.goto(report.fixtureUrl, { waitUntil: 'networkidle' });
    await page.bringToFront();

    const fixtureTab = await serviceWorker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return { id: tab.id, windowId: tab.windowId };
    }, report.fixtureUrl);
    report.fixtureTab = fixtureTab;

    const popup = await context.newPage();
    popup.on('console', (message) => console.log(`[popup console:${message.type()}] ${message.text()}`));
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded'
    });
    await popup.waitForFunction(() => Boolean(chrome?.runtime?.sendMessage));
    const saveSettingsResult = await popup.evaluate(
      async ({ aiConfig: config }) =>
        chrome.runtime.sendMessage({
          action: 'saveSettings',
          settings: {
            providerPreset: config.providerPreset,
            apiStyle: config.apiStyle,
            apiKey: config.apiKey,
            apiBaseUrl: config.apiBaseUrl,
            modelId: config.modelId,
            extraHeadersJson: config.extraHeadersJson,
            outputDir: 'codex-e2e/tutorial-recorder-ai-smoke',
            captureMode: 'displayMedia',
            screenshotInterval: 5,
            autoScreenshot: false,
            aiAgentMaxSteps: 2,
            aiAgentMaxDurationMinutes: 2
          }
        }),
      { aiConfig }
    );
    report.saveSettingsOk = saveSettingsResult?.ok === true;
    if (!report.saveSettingsOk) {
      throw new Error(`Unable to save AI smoke settings: ${saveSettingsResult?.error || 'unknown error'}`);
    }
    await popup.reload({ waitUntil: 'domcontentloaded' });
    await popup.waitForFunction(() => Boolean(chrome?.runtime?.sendMessage));
    const goal = '确认当前演示页面可见后，直接完成 AI 录制。';
    await popup.locator('#aiGoal').fill(goal);

    report.fallbackStartResult = await popup.evaluate(async ({ targetDescription }) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await chrome.runtime.sendMessage({
        action: 'startAiRecording',
        tabId: tab?.id,
        targetDescription,
        allowFallbackTarget: true
      });

      return {
        requestedTab: {
          id: tab?.id,
          url: tab?.url || ''
        },
        result
      };
    }, { targetDescription: goal });
    if (report.fallbackStartResult?.result?.ok !== true) {
      throw new Error(`AI fallback start failed: ${JSON.stringify(report.fallbackStartResult?.result)}`);
    }
    report.statusSamples.push({
      at: 'after-extension-tab-fallback-start',
      text: await readAiStatus(popup)
    });

    const startRuntime = await waitForRuntime(
      serviceWorker,
      (runtime) =>
        runtime?.recordingMode === 'ai' &&
        (runtime.isRecording || ['starting', 'running', 'failed', 'finishing', 'stopping'].includes(runtime.aiAgent?.status)),
      30000,
      report
    );
    report.startRuntime = summarizeRuntime(startRuntime);
    report.statusSamples.push({
      at: 'after-runtime-start',
      text: await readAiStatus(popup)
    });

    const finalState = await waitForAiCompletion(serviceWorker, report);
    report.finalRuntime = summarizeRuntime(finalState.runtime);
    report.historyState = finalState.history.map(summarizeHistoryItem);
    report.fixtureState = await page.evaluate(() => ({
      headline: document.getElementById('headline')?.textContent || '',
      metricMode: document.getElementById('metricMode')?.textContent || '',
      metricCount: document.getElementById('metricCount')?.textContent || '',
      statusText: document.getElementById('statusText')?.textContent || ''
    }));

    report.checks = {
      startStatusVisible: report.statusSamples.some((item) => /正在启动 AI|AI 正在观察|正在执行/.test(item.text)),
      runtimeEnteredAiMode: report.runtimeSamples.some((item) => item?.recordingMode === 'ai'),
      fallbackStartedFromExtensionTab:
        /^chrome-extension:\/\//.test(report.fallbackStartResult?.requestedTab?.url || '') &&
        report.fallbackStartResult?.result?.ok === true,
      runtimeReachedRunning:
        report.runtimeSamples.some((item) => item?.aiAgent?.status === 'running') ||
        report.runtimeSamples.some((item) => item?.aiAgent?.status === 'finishing'),
      finishedWithoutFailure: finalState.runtime?.aiAgent?.status !== 'failed',
      historyCreated: finalState.history.some((item) => item.recordingMode === 'ai'),
      screenshotsCaptured: finalState.history.some((item) => item.recordingMode === 'ai' && item.screenshotCount >= 1)
    };

    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(redactReport(report), null, 2));

    const failedChecks = Object.entries(report.checks)
      .filter(([, passed]) => passed !== true)
      .map(([name]) => name);
    if (failedChecks.length) {
      throw new Error(`AI smoke failed checks: ${failedChecks.join(', ')}`);
    }
  } finally {
    await context?.close().catch(() => {});
    server.close();
  }
}

async function loadAiConfig() {
  const envConfig = {
    providerPreset: process.env.PW_PROVIDER_PRESET?.trim() || '',
    apiStyle: process.env.PW_API_STYLE?.trim() || '',
    apiBaseUrl: process.env.PW_API_BASE_URL?.trim() || '',
    apiKey: process.env.PW_API_KEY?.trim() || '',
    modelId: process.env.PW_MODEL_ID?.trim() || '',
    extraHeadersJson: process.env.PW_EXTRA_HEADERS_JSON?.trim() || ''
  };

  if (envConfig.apiBaseUrl && envConfig.apiKey && envConfig.modelId) {
    return {
      providerPreset: envConfig.providerPreset || inferProviderPreset(envConfig.apiBaseUrl),
      apiStyle: envConfig.apiStyle || 'chatCompletions',
      apiBaseUrl: envConfig.apiBaseUrl,
      apiKey: envConfig.apiKey,
      modelId: envConfig.modelId,
      extraHeadersJson: envConfig.extraHeadersJson
    };
  }

  const envPath = path.join(repoRoot, '.env');
  const raw = await readFile(envPath, 'utf8').catch(() => '');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const providerComment = lines.find((line) => line.startsWith('##')) || '';
  const values = lines.filter((line) => !line.startsWith('#'));
  const [apiBaseUrl = '', apiKey = '', modelId = ''] = values;

  if (!apiBaseUrl || !apiKey || !modelId) {
    throw new Error('AI smoke requires PW_API_BASE_URL/PW_API_KEY/PW_MODEL_ID or a local .env with base URL, key, and model id');
  }

  return {
    providerPreset: inferProviderPreset(apiBaseUrl, providerComment),
    apiStyle: 'chatCompletions',
    apiBaseUrl,
    apiKey,
    modelId,
    extraHeadersJson: ''
  };
}

function inferProviderPreset(apiBaseUrl, providerComment = '') {
  const value = `${providerComment}\n${apiBaseUrl}`.toLowerCase();
  if (value.includes('openrouter')) {
    return 'openRouter';
  }
  if (value.includes('siliconflow')) {
    return 'siliconFlow';
  }
  if (value.includes('dashscope')) {
    return 'aliyunDashScope';
  }
  if (value.includes('openai')) {
    return 'openai';
  }
  return 'custom';
}

async function readAiStatus(popup) {
  return popup.locator('#aiStatus').textContent().then((text) => (text || '').trim());
}

async function waitForRuntime(serviceWorker, predicate, timeoutMs, report) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await readRuntimeSnapshot(serviceWorker);
    const summary = summarizeRuntime(snapshot.runtime);
    report.runtimeSamples.push(summary);
    if (predicate(snapshot.runtime, snapshot.history)) {
      return snapshot.runtime;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for AI runtime after ${timeoutMs}ms`);
}

async function waitForAiCompletion(serviceWorker, report) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 150000) {
    const snapshot = await readRuntimeSnapshot(serviceWorker);
    report.runtimeSamples.push(summarizeRuntime(snapshot.runtime));

    if (!snapshot.runtime?.isRecording && snapshot.history.some((item) => item.recordingMode === 'ai')) {
      return snapshot;
    }

    if (snapshot.runtime?.aiAgent?.status === 'failed') {
      return snapshot;
    }

    await delay(1000);
  }

  await serviceWorker.evaluate(() => chrome.runtime.sendMessage({ action: 'stopRecording' })).catch(() => {});
  throw new Error('Timed out waiting for AI recording completion');
}

async function readRuntimeSnapshot(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    const runtimePayload = await chrome.storage.session.get(['recordingRuntime']);
    const historyPayload = await chrome.storage.local.get(['recordings']);
    return {
      runtime: runtimePayload.recordingRuntime || null,
      history: historyPayload.recordings || []
    };
  });
}

function summarizeRuntime(runtime) {
  if (!runtime) {
    return null;
  }

  return {
    isRecording: runtime.isRecording === true,
    isPaused: runtime.isPaused === true,
    isGenerating: runtime.isGenerating === true,
    recordingMode: runtime.recordingMode || '',
    count: runtime.count || 0,
    mediaStatus: runtime.mediaStatus || '',
    aiAgent: runtime.aiAgent
      ? {
          status: runtime.aiAgent.status || '',
          iteration: runtime.aiAgent.iteration || 0,
          message: runtime.aiAgent.message || '',
          steps: Array.isArray(runtime.aiAgent.steps) ? runtime.aiAgent.steps.length : 0
        }
      : null
  };
}

function summarizeHistoryItem(item) {
  return {
    id: item.id,
    recordingMode: item.recordingMode,
    title: item.title,
    screenshotCount: item.screenshotCount,
    commitState: item.commitState,
    recoverable: item.recoverable === true
  };
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

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function cleanupDirectory(dirPath) {
  await rm(dirPath, { recursive: true, force: true }).catch(() => {});
  await mkdir(dirPath, { recursive: true });
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

function redactReport(report) {
  return {
    ...report,
    aiConfig: redactAiConfig(aiConfig)
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(async (error) => {
  const failure = {
    ok: false,
    error: error.message,
    stack: error.stack,
    aiConfig: redactAiConfig(aiConfig)
  };
  await writeFile(reportPath, JSON.stringify(failure, null, 2)).catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
