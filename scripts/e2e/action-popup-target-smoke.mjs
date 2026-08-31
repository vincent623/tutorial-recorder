import { createServer } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactsDir = path.join(repoRoot, 'output', 'playwright');
const profileDir = path.join(artifactsDir, 'action-popup-target-profile');
const port = Number.parseInt(process.env.PW_FIXTURE_PORT || '48144', 10);
const executablePath = process.env.PW_EXECUTABLE_PATH?.trim() || '';

async function main() {
  await mkdir(artifactsDir, { recursive: true });
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });

  const server = await startServer();
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      args: [
        `--disable-extensions-except=${repoRoot}`,
        `--load-extension=${repoRoot}`,
        '--no-default-browser-check',
        '--no-first-run'
      ]
    });

    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', { timeout: 20_000 }));
    const extensionId = new URL(serviceWorker.url()).host;
    const intendedUrl = `http://127.0.0.1:${port}/intended.html`;
    const intendedPage = context.pages()[0] || (await context.newPage());
    await intendedPage.goto(intendedUrl, { waitUntil: 'networkidle' });
    await intendedPage.bringToFront();
    const intendedTab = await serviceWorker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return { id: tab.id, windowId: tab.windowId, url: tab.url };
    }, intendedUrl);

    const configPage = await context.newPage();
    await configPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await configPage.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    const saveResult = await configPage.evaluate(async (apiBaseUrl) =>
      chrome.runtime.sendMessage({
        action: 'saveSettings',
        settings: {
          providerPreset: 'custom',
          apiStyle: 'chatCompletions',
          apiKey: 'action-popup-smoke-key',
          apiBaseUrl,
          modelId: 'action-popup-smoke-model',
          aiDataSharingConsent: true,
          aiAgentMaxSteps: 2,
          aiAgentMaxDurationMinutes: 1,
          autoScreenshot: false
        }
      }),
      `http://127.0.0.1:${port}`
    );
    if (saveResult?.ok !== true) {
      throw new Error(`Unable to save popup smoke settings: ${saveResult?.error || 'unknown error'}`);
    }
    await configPage.close();

    const settingsPagePromise = context.waitForEvent('page');
    await serviceWorker.evaluate(
      (url) => chrome.windows.create({ url, focused: true }),
      `chrome-extension://${extensionId}/settings/settings.html`
    );
    const settingsPage = await settingsPagePromise;
    await settingsPage.waitForLoadState('domcontentloaded');

    const browserSession = await context.browser().newBrowserCDPSession();
    await browserSession.send('Target.setDiscoverTargets', { discover: true });
    const openResult = await serviceWorker.evaluate(async () => {
      try {
        await chrome.action.openPopup();
        return { ok: true, error: '' };
      } catch (error) {
        return { ok: false, error: String(error?.message || error || '') };
      }
    });
    if (!openResult.ok) {
      throw new Error(`Unable to open real action popup: ${openResult.error}`);
    }

    await intendedPage.waitForTimeout(250);
    const { targetInfos } = await browserSession.send('Target.getTargets');
    const popupTarget = targetInfos.find((target) => target.url.includes('/popup/popup.html'));
    if (!popupTarget) {
      throw new Error(`Real action popup target not found: ${JSON.stringify(targetInfos.map(({ type, url }) => ({ type, url })))}`);
    }

    const { sessionId } = await browserSession.send('Target.attachToTarget', {
      targetId: popupTarget.targetId,
      flatten: false
    });
    const popupDialogs = [];
    const sendToPopup = createTargetSessionClient(browserSession, sessionId, (event) => {
      if (event.method === 'Page.javascriptDialogOpening') {
        popupDialogs.push(event.params?.message || '');
      }
    });
    await sendToPopup('Runtime.enable');
    await sendToPopup('Page.enable');
    const triggerResult = await sendToPopup('Runtime.evaluate', {
      expression: `(async () => {
        while (document.documentElement.dataset.appReady !== 'true') {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const goal = document.getElementById('aiGoal');
        goal.value = '演示谷歌搜索';
        goal.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('btnAiStart').click();
        return { url: location.href, goal: goal.value };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    await intendedPage.waitForTimeout(500);
    const statePage = await context.newPage();
    await statePage.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await statePage.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    const snapshot = await statePage.evaluate(() => chrome.runtime.sendMessage({ action: 'getPopupState' }));
    await statePage.close();
    const report = {
      intendedTab,
      launchContextUrl: settingsPage.url(),
      popupUrl: popupTarget.url,
      triggerResult: triggerResult?.result?.value || null,
      popupDialogs,
      runtime: snapshot?.runtime || null,
      checks: {
        noTargetError: !popupDialogs.some((message) => /扩展页|http\/https\/file 网页/.test(message)),
        intendedTargetSelected: snapshot?.runtime?.tabId === intendedTab.id,
        aiRuntimeStarted: snapshot?.runtime?.recordingMode === 'ai' && snapshot?.runtime?.isRecording === true
      }
    };

    console.log(JSON.stringify(report, null, 2));
    await serviceWorker.evaluate(() => chrome.runtime.sendMessage({ action: 'stopRecording' })).catch(() => {});
    const failed = Object.entries(report.checks).filter(([, pass]) => pass !== true);
    if (failed.length) {
      throw new Error(`Action popup target smoke failed: ${failed.map(([name]) => name).join(', ')}`);
    }
  } finally {
    await context?.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

function createTargetSessionClient(browserSession, sessionId, onEvent) {
  let nextId = 0;
  const pending = new Map();
  browserSession.on('Target.receivedMessageFromTarget', ({ sessionId: receivedSessionId, message }) => {
    if (receivedSessionId !== sessionId) {
      return;
    }
    const payload = JSON.parse(message);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) {
        reject(new Error(payload.error.message || 'Target command failed'));
      } else {
        resolve(payload.result || {});
      }
      return;
    }
    onEvent?.(payload);
  });

  return async (method, params = {}) => {
    const id = ++nextId;
    const resultPromise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    await browserSession.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method, params })
    });
    return resultPromise;
  };
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      if (request.method === 'POST') {
        request.resume();
        request.on('end', () => {
          setTimeout(() => {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ choices: [{ message: { content: '{"action":"finish","description":"完成"}' } }] }));
          }, 5_000);
        });
        return;
      }

      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body><h1>intended</h1></body></html>');
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
