import { createServer } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ownerRoot = path.join(repoRoot, 'scripts', 'e2e', 'fixtures', 'debugger-owner');
const artifactsDir = path.join(repoRoot, 'output', 'playwright');
const profileDir = path.join(artifactsDir, 'debugger-conflict-profile');
const port = Number.parseInt(process.env.PW_FIXTURE_PORT || '48145', 10);
const executablePath = process.env.PW_EXECUTABLE_PATH?.trim() || '';

async function main() {
  await mkdir(artifactsDir, { recursive: true });
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });

  const server = await startServer();
  let context;
  try {
    const extensionRoots = `${repoRoot},${ownerRoot}`;
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      args: [
        `--disable-extensions-except=${extensionRoots}`,
        `--load-extension=${extensionRoots}`,
        '--no-default-browser-check',
        '--no-first-run'
      ]
    });

    await waitForServiceWorkers(context, 2);
    const workers = context.serviceWorkers();
    const recorderWorker = workers.find((worker) => worker.url().endsWith('/background/background.js'));
    const ownerWorker = workers.find((worker) => worker.url().endsWith('/background.js') && worker !== recorderWorker);
    if (!recorderWorker || !ownerWorker) {
      throw new Error(`Expected two extension workers, got: ${workers.map((worker) => worker.url()).join(', ')}`);
    }
    const extensionId = new URL(recorderWorker.url()).host;
    const targetUrl = `http://127.0.0.1:${port}/target.html`;
    const targetPage = context.pages()[0] || (await context.newPage());
    await targetPage.goto(targetUrl, { waitUntil: 'networkidle' });
    await targetPage.bringToFront();
    const targetTab = await ownerWorker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return { id: tab.id, windowId: tab.windowId, url: tab.url };
    }, targetUrl);

    const ownerAttach = await ownerWorker.evaluate(async (tabId) => {
      try {
        await chrome.debugger.attach({ tabId }, '1.3');
        return { ok: true, error: '' };
      } catch (error) {
        return { ok: false, error: String(error?.message || error || '') };
      }
    }, targetTab.id);
    if (!ownerAttach.ok) {
      throw new Error(`Fixture extension could not own debugger: ${ownerAttach.error}`);
    }

    const attachMockInstalled = await recorderWorker.evaluate(() => {
      globalThis.__originalDebuggerAttach = chrome.debugger.attach;
      const rejectedAttach = async () => {
        throw new Error('Another debugger is already attached to the tab with id: fixture');
      };
      chrome.debugger.attach = rejectedAttach;
      return chrome.debugger.attach === rejectedAttach;
    });
    if (!attachMockInstalled) {
      throw new Error('Unable to install deterministic chrome.debugger.attach conflict fixture');
    }

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await popup.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    const popupDialogs = [];
    popup.on('dialog', async (dialog) => {
      popupDialogs.push(dialog.message());
      await dialog.dismiss();
    });
    const saveResult = await popup.evaluate(async (apiBaseUrl) =>
      chrome.runtime.sendMessage({
        action: 'saveSettings',
        settings: {
          providerPreset: 'custom',
          apiStyle: 'chatCompletions',
          apiKey: 'debugger-conflict-smoke-key',
          apiBaseUrl,
          modelId: 'debugger-conflict-smoke-model',
          aiDataSharingConsent: true,
          aiAgentMaxSteps: 5,
          aiAgentMaxDurationMinutes: 1,
          autoScreenshot: false
        }
      }),
      `http://127.0.0.1:${port}`
    );
    if (saveResult?.ok !== true) {
      throw new Error(`Unable to save debugger-conflict settings: ${saveResult?.error || 'unknown error'}`);
    }

    await popup.locator('#aiGoal').fill('完成兼容模式测试');
    await popup.locator('#btnAiStart').click();
    await popup.waitForTimeout(750);
    await recorderWorker.evaluate(() => {
      if (globalThis.__originalDebuggerAttach) {
        chrome.debugger.attach = globalThis.__originalDebuggerAttach;
        delete globalThis.__originalDebuggerAttach;
      }
    });
    const runtimeState = await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'getPopupState' }));
    let pageActionError = '';
    await targetPage
      .waitForFunction(() => document.body.dataset.compatClick === '1', null, { timeout: 20_000 })
      .catch((error) => {
        pageActionError = String(error?.message || error || '');
      });
    const runtimeAfterAction = await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'getPopupState' }));
    const pageActionState = await targetPage.evaluate(() => ({
      compatClick: document.body.dataset.compatClick || '',
      query: document.body.dataset.query || '',
      activeText: document.activeElement?.textContent || ''
    }));
    const ownerProbe = await ownerWorker.evaluate(async (tabId) => {
      try {
        const result = await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics');
        return { ok: Boolean(result), error: '' };
      } catch (error) {
        return { ok: false, error: String(error?.message || error || '') };
      }
    }, targetTab.id);
    const report = {
      targetTab,
      ownerAttach,
      attachMockInstalled,
      ownerProbe,
      popupDialogs,
      pageActionState,
      pageActionError,
      runtimeAfterAction: runtimeAfterAction?.runtime || null,
      modelDecisionCount: server.getAgentActionCount(),
      runtime: runtimeState?.runtime || null,
      checks: {
        competingOwnerRetainsDebugger: ownerProbe.ok === true,
        noExclusiveDebuggerFailure: !popupDialogs.some((message) => /其他扩展|开发者工具控制/.test(message)),
        compatiblePageActionExecuted: pageActionState.compatClick === '1',
        searchQueryTyped: pageActionState.query === '教程自动录制器',
        searchUsesAtMostTwoModelDecisions: server.getAgentActionCount() <= 2,
        noTakeoverConfirmation:
          runtimeAfterAction?.runtime?.isPaused === false &&
          !runtimeAfterAction?.runtime?.aiAgent?.pendingApproval,
        aiRuntimeStartedInCompatibilityMode:
          runtimeState?.runtime?.recordingMode === 'ai' &&
          runtimeState?.runtime?.isRecording === true &&
          runtimeState?.runtime?.cdpAttached === false
      }
    };

    console.log(JSON.stringify(report, null, 2));
    await recorderWorker.evaluate(() => chrome.runtime.sendMessage({ action: 'stopRecording' })).catch(() => {});
    await ownerWorker.evaluate((tabId) => chrome.debugger.detach({ tabId }), targetTab.id).catch(() => {});
    const failed = Object.entries(report.checks).filter(([, pass]) => pass !== true);
    if (failed.length) {
      throw new Error(`Debugger conflict smoke failed: ${failed.map(([name]) => name).join(', ')}`);
    }
  } finally {
    await context?.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

async function waitForServiceWorkers(context, count) {
  const deadline = Date.now() + 20_000;
  while (context.serviceWorkers().length < count && Date.now() < deadline) {
    await context.waitForEvent('serviceworker', { timeout: Math.max(1, deadline - Date.now()) }).catch(() => {});
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const agentActions = [
      '{"action":"type_text","targetText":"搜索","text":"教程自动录制器","submit":true,"description":"输入关键词并执行 GET 搜索"}',
      '{"action":"finish","description":"搜索流程完成"}'
    ];
    let agentActionIndex = 0;
    const server = createServer((request, response) => {
      if (request.method === 'POST') {
        request.resume();
        request.on('end', () => {
          setTimeout(() => {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
              choices: [{ message: { content: agentActions[Math.min(agentActionIndex++, agentActions.length - 1)] } }]
            }));
          }, 100);
        });
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body><form method="get" action="/search" onsubmit="event.preventDefault(); document.body.dataset.compatClick = \'1\'; document.body.dataset.query = this.q.value"><input type="search" name="q" aria-label="搜索" placeholder="搜索"><button id="target" type="submit">搜索</button></form></body></html>');
    });
    server.getAgentActionCount = () => agentActionIndex;
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
