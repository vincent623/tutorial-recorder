import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const fixtureHtml = await readFile(path.join(__dirname, 'fixture.html'));
const artifactsDir = path.join(repoRoot, 'output', 'playwright');
const reportPath = path.join(artifactsDir, 'browser-observation-report.json');
const requestedPort = Number.parseInt(process.env.PW_FIXTURE_PORT || '0', 10);
const headless = process.env.PW_HEADLESS !== '0';
const browserChannel = process.env.PW_BROWSER_CHANNEL?.trim() || 'chromium';
const browserExecutablePath = process.env.PW_EXECUTABLE_PATH?.trim() || '';

await mkdir(artifactsDir, { recursive: true });
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'tutorial-recorder-observation-'));
const { server, port } = await startFixtureServer();
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
  const fixtureUrl = `http://127.0.0.1:${port}/fixture.html`;
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(fixtureUrl, { waitUntil: 'networkidle' });
  await page.bringToFront();
  await page.evaluate(() => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.setAttribute('aria-label', '教程备注');
    editable.textContent = 'PRIVATE_BROWSER_OBSERVATION_NOTE';
    editable.style.cssText = 'width:240px;height:32px;margin:8px 0;border:1px solid #ccc';
    document.querySelector('main')?.append(editable);
  });

  const tabId = await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab?.id;
  }, fixtureUrl);
  assert.equal(Number.isInteger(tabId), true, 'fixture tab must be discoverable');

  const harness = await context.newPage();
  await harness.goto(`chrome-extension://${extensionId}/scripts/e2e/browser-observation-harness.html`, {
    waitUntil: 'domcontentloaded'
  });
  await harness.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await page.bringToFront();

  const scripting = await observeFromHarness(harness, tabId, false);
  const cdp = await observeFromHarness(harness, tabId, true);
  const injectedMarkers = await page.locator('[data-agent-id], [data-browser-agent-id]').count();

  assert.equal(scripting.status, 'ready');
  assert.equal(scripting.adapter, 'scripting');
  assert.equal(scripting.hasScreenshot, true);
  assert.equal(scripting.capabilities.mainDocument, true);
  assert.equal(scripting.elementNames.includes('搜索教程'), true);
  assert.equal(scripting.elementNames.includes('切换到计划面板'), true);
  assert.equal(scripting.hasForbiddenElementField, false);
  assert.equal(scripting.elementNames.includes('PRIVATE_BROWSER_OBSERVATION_NOTE'), false);
  assert.equal(scripting.shadowComparison.equivalentTarget, true);

  assert.equal(cdp.status, 'ready');
  assert.equal(cdp.adapter, 'cdp');
  assert.equal(cdp.hasScreenshot, true);
  assert.equal(cdp.capabilities.mainDocument, true);
  assert.equal(cdp.elementNames.includes('搜索教程'), true);
  assert.equal(cdp.elementNames.includes('切换到计划面板'), true);
  assert.equal(cdp.hasForbiddenElementField, false);
  assert.equal(cdp.elementNames.includes('PRIVATE_BROWSER_OBSERVATION_NOTE'), false);
  assert.equal(cdp.shadowComparison.equivalentTarget, true);

  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.srcdoc = '<button>Frame action</button>';
    frame.style.cssText = 'width:240px;height:80px;border:1px solid #ccc';
    document.querySelector('main')?.append(frame);
  });
  await page.locator('iframe').last().waitFor({ state: 'visible' });
  const framedScripting = await observeFromHarness(harness, tabId, false);
  const framedCdp = await observeFromHarness(harness, tabId, true);
  assert.equal(framedScripting.status, 'degraded');
  assert.equal(
    framedScripting.receipt.degradedReasons.includes('same-origin-frame-content-unavailable'),
    true
  );
  assert.equal(framedCdp.status, 'degraded');
  assert.equal(
    framedCdp.receipt.degradedReasons.includes('same-origin-frame-content-unavailable'),
    true
  );

  await page.evaluate(() => {
    document.querySelector('iframe')?.remove();
    const shadowHost = document.createElement('div');
    shadowHost.id = 'observation-shadow-host';
    shadowHost.attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow action</button>';
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 40;
    document.querySelector('main')?.append(shadowHost, canvas);
  });
  const complexScripting = await observeFromHarness(harness, tabId, false);
  const complexCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [complexScripting, complexCdp]) {
    assert.equal(observation.status, 'degraded');
    assert.equal(observation.receipt.degradedReasons.includes('open-shadow-dom-unavailable'), true);
    assert.equal(observation.receipt.degradedReasons.includes('self-drawn-surface-unavailable'), true);
  }

  assert.equal(injectedMarkers, 0, 'Browser Observation must not annotate the live DOM');

  const report = {
    fixtureUrl,
    scripting,
    cdp,
    framedScripting,
    framedCdp,
    complexScripting,
    complexCdp,
    injectedMarkers,
    checks: {
      scriptingReady: scripting.status === 'ready',
      cdpReady: cdp.status === 'ready',
      commonTargetsObserved:
        scripting.elementNames.includes('搜索教程') &&
        scripting.elementNames.includes('切换到计划面板') &&
        cdp.elementNames.includes('搜索教程') &&
        cdp.elementNames.includes('切换到计划面板'),
      ordinaryDomMatchesLegacyPath:
        scripting.shadowComparison.equivalentTarget &&
        cdp.shadowComparison.equivalentTarget,
      sensitiveEditableTextExcluded:
        !scripting.elementNames.includes('PRIVATE_BROWSER_OBSERVATION_NOTE') &&
        !cdp.elementNames.includes('PRIVATE_BROWSER_OBSERVATION_NOTE'),
      unsupportedFramesExplicitlyDegraded:
        framedScripting.status === 'degraded' &&
        framedCdp.status === 'degraded',
      shadowAndCanvasExplicitlyDegraded:
        complexScripting.status === 'degraded' &&
        complexCdp.status === 'degraded',
      liveDomUnmodified: injectedMarkers === 0
    }
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context?.close().catch(() => {});
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  server.close();
}

async function observeFromHarness(harness, tabId, useCdp) {
  return harness.evaluate(
    ({ targetTabId, shouldUseCdp }) => globalThis.runBrowserObservation(targetTabId, shouldUseCdp),
    { targetTabId: tabId, shouldUseCdp: useCdp }
  );
}

async function startFixtureServer() {
  const server = createServer((request, response) => {
    if (request.url === '/fixture.html' || request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(fixtureHtml);
      return;
    }

    response.writeHead(404);
    response.end('Not Found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fixture server did not expose a TCP port');
  }
  return { server, port: address.port };
}
