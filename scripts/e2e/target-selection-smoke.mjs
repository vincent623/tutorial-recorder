import { createServer } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const artifactsDir = path.join(repoRoot, 'output', 'playwright');
const profileDir = path.join(artifactsDir, 'target-selection-profile');
const port = Number.parseInt(process.env.PW_FIXTURE_PORT || '48143', 10);
const headless = process.env.PW_HEADLESS !== '0';
const browserChannel = process.env.PW_BROWSER_CHANNEL?.trim() || 'chromium';
const browserExecutablePath = process.env.PW_EXECUTABLE_PATH?.trim() || '';

async function main() {
  await mkdir(artifactsDir, { recursive: true });
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });

  const server = await startServer();
  let context;

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      ...(browserExecutablePath ? { executablePath: browserExecutablePath } : { channel: browserChannel }),
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
    const staleUrl = `http://127.0.0.1:${port}/stale.html`;
    const intendedUrl = `http://127.0.0.1:${port}/intended.html`;

    const intendedPage = context.pages()[0] || (await context.newPage());
    await intendedPage.goto(intendedUrl, { waitUntil: 'networkidle' });
    const intendedTab = await serviceWorker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return { id: tab.id, windowId: tab.windowId };
    }, intendedUrl);

    const stalePagePromise = context.waitForEvent('page');
    await serviceWorker.evaluate((url) => chrome.windows.create({ url, focused: true }), staleUrl);
    const stalePage = await stalePagePromise;
    await stalePage.waitForLoadState('networkidle');

    await serviceWorker.evaluate(async ({ tabId, windowId }) => {
      await chrome.windows.update(windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
    }, { tabId: intendedTab.id, windowId: intendedTab.windowId });

    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
    const popupPromise = context.waitForEvent('page');
    await serviceWorker.evaluate(
      ({ windowId, url }) => chrome.tabs.create({ windowId, url, active: true }),
      { windowId: intendedTab.windowId, url: popupUrl }
    );
    const popup = await popupPromise;
    const popupDialogs = [];
    popup.on('dialog', async (dialog) => {
      popupDialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForFunction(() => document.documentElement.dataset.appReady === 'true');

    const saveResult = await popup.evaluate(async (apiBaseUrl) =>
      chrome.runtime.sendMessage({
        action: 'saveSettings',
        settings: {
          providerPreset: 'custom',
          apiStyle: 'chatCompletions',
          apiKey: 'target-selection-smoke-key',
          apiBaseUrl,
          modelId: 'target-selection-smoke-model',
          aiDataSharingConsent: true,
          aiAgentMaxSteps: 2,
          aiAgentMaxDurationMinutes: 1,
          autoScreenshot: false
        }
      }),
      `http://127.0.0.1:${port}`
    );
    if (saveResult?.ok !== true) {
      throw new Error(`Unable to save target-selection settings: ${saveResult?.error || 'unknown error'}`);
    }
    await popup.reload({ waitUntil: 'domcontentloaded' });
    await popup.waitForFunction(() => document.documentElement.dataset.appReady === 'true');

    const tabsBefore = await serviceWorker.evaluate(async ({ staleUrl, intendedUrl }) => {
      const tabs = await chrome.tabs.query({});
      const stale = tabs.find((tab) => tab.url === staleUrl);
      const intended = tabs.find((tab) => tab.url === intendedUrl);
      globalThis.__targetSelectionTrace = { activated: [], removed: [] };
      chrome.tabs.onActivated.addListener((info) => {
        globalThis.__targetSelectionTrace.activated.push(info.tabId);
      });
      chrome.tabs.onRemoved.addListener((tabId) => {
        globalThis.__targetSelectionTrace.removed.push(tabId);
      });
      return {
        stale: { id: stale?.id, windowId: stale?.windowId, lastAccessed: stale?.lastAccessed ?? null },
        intended: { id: intended?.id, windowId: intended?.windowId, lastAccessed: intended?.lastAccessed ?? null }
      };
    }, { staleUrl, intendedUrl });

    await popup.locator('#aiGoal').fill('演示谷歌搜索');
    await popup.locator('#btnAiStart').click();
    await popup.waitForTimeout(250);
    const aiStatus = await popup.locator('#aiStatus').textContent();
    const runtimeState = await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'getPopupState' }));

    const result = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const windows = await chrome.windows.getAll();
      return {
        trace: globalThis.__targetSelectionTrace,
        remainingTabIds: tabs.map((tab) => tab.id),
        focusedWindowId: windows.find((window) => window.focused)?.id || null,
        activeTabIds: tabs.filter((tab) => tab.active).map((tab) => tab.id)
      };
    });
    result.runtimeTabId = runtimeState?.runtime?.tabId || null;
    result.runtime = runtimeState?.runtime || null;
    await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'stopRecording' })).catch(() => {});

    const report = {
      tabsBefore,
      aiStatus,
      popupDialogs,
      result,
      checks: {
        intendedTargetSelected: result.runtimeTabId === tabsBefore.intended.id,
        staleTargetNotSelected: result.runtimeTabId !== tabsBefore.stale.id,
        intendedTargetRemainsOpen: result.remainingTabIds.includes(tabsBefore.intended.id),
        staleTargetRemainsOpen: result.remainingTabIds.includes(tabsBefore.stale.id)
      }
    };

    console.log(JSON.stringify(report, null, 2));
    const failed = Object.entries(report.checks).filter(([, pass]) => !pass);
    if (failed.length) {
      throw new Error(`Target selection smoke failed: ${failed.map(([name]) => name).join(', ')}`);
    }
  } finally {
    await context?.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      if (request.method === 'POST') {
        request.resume();
        request.on('end', () => {
          setTimeout(() => {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
              choices: [{ message: { content: '{"action":"finish","description":"测试结束"}' } }]
            }));
          }, 5_000);
        });
        return;
      }

      const label = request.url === '/intended.html' ? 'intended' : 'stale';
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><body><h1>${label}</h1></body></html>`);
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
