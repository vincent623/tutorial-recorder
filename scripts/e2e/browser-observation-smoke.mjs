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
  const searchTarget = scripting.elementSummaries.find((element) => element.name === '搜索教程');
  assert.ok(searchTarget, 'ordinary observation should include the search field');
  const refinedSearch = await refineFromHarness(harness, tabId, false, scripting.observationId, {
    role: 'searchbox',
    region: {
      x: searchTarget.rect.x - 4,
      y: searchTarget.rect.y - 4,
      width: searchTarget.rect.width + 8,
      height: searchTarget.rect.height + 8
    },
    maxElements: 10
  });
  await page.evaluate(() => {
    Object.defineProperty(globalThis, '__tutorialRecorderBrowserObservationProbeHelpersV1', {
      value: Object.freeze({ pageOwnedPoison: true }),
      configurable: false,
      writable: false
    });
  });
  const cdp = await observeFromHarness(harness, tabId, true);
  const cdpSearchTarget = cdp.elementSummaries.find((element) => element.name === '搜索教程');
  const refinedCdpSearch = await refineFromHarness(harness, tabId, true, cdp.observationId, {
    role: 'searchbox',
    region: {
      x: cdpSearchTarget.rect.x - 4,
      y: cdpSearchTarget.rect.y - 4,
      width: cdpSearchTarget.rect.width + 8,
      height: cdpSearchTarget.rect.height + 8
    },
    maxElements: 10
  });

  assert.equal(scripting.status, 'ready');
  assert.equal(scripting.adapter, 'scripting');
  assert.equal(scripting.hasScreenshot, true);
  assert.equal(scripting.capabilities.mainDocument, true);
  assert.equal(scripting.elementNames.includes('搜索教程'), true);
  assert.equal(scripting.elementNames.includes('切换到计划面板'), true);
  assert.equal(scripting.hasForbiddenElementField, false);
  assert.equal(scripting.elementNames.includes('PRIVATE_BROWSER_OBSERVATION_NOTE'), false);
  assert.equal(scripting.shadowComparison.equivalentTarget, true);
  assert.equal(refinedSearch.status, 'ready');
  assert.equal(refinedSearch.observationId === scripting.observationId, false);
  assert.deepEqual(refinedSearch.elementSummaries.map((element) => element.name), ['搜索教程']);

  assert.equal(cdp.status, 'ready');
  assert.equal(cdp.adapter, 'cdp');
  assert.equal(cdp.hasScreenshot, true);
  assert.equal(cdp.capabilities.mainDocument, true);
  assert.equal(cdp.elementNames.includes('搜索教程'), true);
  assert.equal(cdp.elementNames.includes('切换到计划面板'), true);
  assert.equal(cdp.hasForbiddenElementField, false);
  assert.equal(cdp.elementNames.includes('PRIVATE_BROWSER_OBSERVATION_NOTE'), false);
  assert.equal(cdp.shadowComparison.equivalentTarget, true);
  assert.deepEqual(refinedCdpSearch.elementSummaries.map((element) => element.name), ['搜索教程']);
  assert.equal(
    await page.evaluate(() => globalThis.__tutorialRecorderBrowserObservationProbeHelpersV1.pageOwnedPoison),
    true,
    'CDP observation must not read or replace a page-owned helper key'
  );

  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.srcdoc = '<button>Frame action</button><iframe srcdoc="<button>Nested frame action</button>"></iframe>';
    frame.style.cssText = 'position:fixed;right:20px;top:320px;width:340px;height:220px;border:1px solid #ccc;z-index:10;background:white;transform:scale(.75);transform-origin:top right';
    document.querySelector('main')?.append(frame);
  });
  await page.locator('iframe').last().waitFor({ state: 'visible' });
  const framedScripting = await observeFromHarness(harness, tabId, false);
  const framedCdp = await observeFromHarness(harness, tabId, true);
  assert.equal(framedScripting.status, 'ready');
  assert.equal(framedScripting.capabilities.sameOriginFrames, true);
  assert.equal(framedScripting.elementNames.includes('Frame action'), true);
  assert.equal(framedScripting.elementNames.includes('Nested frame action'), true);
  assert.equal(framedCdp.status, 'ready');
  assert.equal(framedCdp.capabilities.sameOriginFrames, true);
  assert.equal(framedCdp.elementNames.includes('Frame action'), true);
  assert.equal(framedCdp.elementNames.includes('Nested frame action'), true);
  const sameOriginFrameBox = await page.locator('iframe').first().boundingBox();
  for (const observation of [framedScripting, framedCdp]) {
    const frameAction = observation.elementSummaries.find((element) => element.name === 'Frame action');
    const centerX = frameAction.rect.x + frameAction.rect.width / 2;
    const centerY = frameAction.rect.y + frameAction.rect.height / 2;
    assert.equal(centerX >= sameOriginFrameBox.x && centerX <= sameOriginFrameBox.x + sameOriginFrameBox.width, true);
    assert.equal(centerY >= sameOriginFrameBox.y && centerY <= sameOriginFrameBox.y + sameOriginFrameBox.height, true);
    const topHitTag = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName || '',
      { x: centerX, y: centerY }
    );
    assert.equal(topHitTag, 'IFRAME');
  }

  await page.evaluate((box) => {
    const overlay = document.createElement('div');
    overlay.id = 'observation-frame-overlay';
    overlay.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;z-index:20;background:rgba(0,0,0,.1)`;
    document.body.append(overlay);
  }, sameOriginFrameBox);
  const occludedFrameScripting = await observeFromHarness(harness, tabId, false);
  const occludedFrameCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [occludedFrameScripting, occludedFrameCdp]) {
    assert.equal(observation.elementNames.includes('Frame action'), false);
    assert.equal(observation.elementNames.includes('Nested frame action'), false);
  }
  await page.evaluate(() => document.getElementById('observation-frame-overlay')?.remove());

  await page.evaluate(() => {
    const frame = document.querySelector('iframe');
    frame.style.transform = 'scaleX(-1)';
    frame.style.transformOrigin = 'center';
  });
  const mirroredFrameScripting = await observeFromHarness(harness, tabId, false);
  const mirroredFrameCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [mirroredFrameScripting, mirroredFrameCdp]) {
    assert.equal(observation.status, 'degraded');
    assert.equal(
      observation.receipt.degradedReasons.includes('transformed-frame-coordinate-unavailable'),
      true
    );
    assert.equal(observation.elementNames.includes('Frame action'), false);
  }

  await page.evaluate(() => {
    const frame = document.querySelector('iframe');
    frame.style.transform = 'none';
    const wrapper = document.createElement('div');
    wrapper.id = 'observation-transformed-frame-wrapper';
    frame.replaceWith(wrapper);
    wrapper.append(frame);
    wrapper.style.cssText = 'position:fixed;right:20px;top:320px;width:340px;height:220px;z-index:10;transform:rotate(3deg)';
    frame.style.cssText = 'position:static;width:340px;height:220px;border:1px solid #ccc;background:white';
  });
  const transformedAncestorScripting = await observeFromHarness(harness, tabId, false);
  const transformedAncestorCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [transformedAncestorScripting, transformedAncestorCdp]) {
    assert.equal(observation.status, 'degraded');
    assert.equal(
      observation.receipt.degradedReasons.includes('transformed-frame-coordinate-unavailable'),
      true
    );
    assert.equal(observation.elementNames.includes('Frame action'), false);
  }

  await page.evaluate((crossOriginUrl) => {
    document.getElementById('observation-transformed-frame-wrapper')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'observation-cross-origin-frame';
    frame.src = crossOriginUrl;
    frame.style.cssText = 'position:fixed;right:20px;top:320px;width:340px;height:220px;border:1px solid #ccc;z-index:10;background:white';
    document.body.append(frame);
  }, `http://localhost:${port}/fixture.html`);
  const crossOriginHandle = await page.locator('#observation-cross-origin-frame').elementHandle();
  const crossOriginFrame = await crossOriginHandle.contentFrame();
  assert.ok(crossOriginFrame, 'cross-origin frame should attach');
  await crossOriginFrame.waitForLoadState('domcontentloaded');
  const crossOriginScripting = await observeFromHarness(harness, tabId, false);
  const crossOriginCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [crossOriginScripting, crossOriginCdp]) {
    assert.equal(observation.status, 'degraded');
    assert.equal(observation.capabilities.crossOriginFrames, false);
    assert.equal(
      observation.receipt.degradedReasons.includes('cross-origin-frame-content-unavailable'),
      true
    );
  }

  await page.evaluate(() => {
    document.querySelector('iframe')?.remove();
    const shadowHost = document.createElement('div');
    shadowHost.id = 'observation-shadow-host';
    shadowHost.style.cssText = 'position:fixed;right:20px;top:320px;width:200px;height:60px;z-index:10;background:white';
    shadowHost.attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow action</button>';
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 40;
    canvas.style.cssText = 'position:fixed;right:240px;top:320px;z-index:10;background:#eee';
    document.querySelector('main')?.append(shadowHost, canvas);
  });
  const complexScripting = await observeFromHarness(harness, tabId, false);
  const complexCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [complexScripting, complexCdp]) {
    assert.equal(observation.status, 'degraded');
    assert.equal(observation.capabilities.openShadowDom, true);
    assert.equal(observation.elementNames.includes('Shadow action'), true);
    assert.equal(observation.receipt.degradedReasons.includes('open-shadow-dom-unavailable'), false);
    assert.equal(observation.receipt.degradedReasons.includes('self-drawn-surface-unavailable'), true);
  }

  await page.evaluate(() => {
    document.getElementById('observation-shadow-host')?.remove();
    document.querySelector('canvas')?.remove();
    const duplicatePanel = document.createElement('section');
    duplicatePanel.id = 'observation-duplicates';
    duplicatePanel.style.cssText = 'position:fixed;right:20px;top:300px;width:700px;display:flex;flex-wrap:wrap;gap:12px;z-index:10;background:white;padding:12px';
    duplicatePanel.innerHTML = `
      <article><h2>项目 Alpha</h2><button>打开</button></article>
      <article><h2>项目 Beta</h2><button>打开</button></article>
      <article><h2>项目 Gamma</h2><button><span role="button">嵌套操作</span></button></article>
      <article><h2 contenteditable="true">PRIVATE_EDITABLE_CONTEXT</h2><button>上下文隐私</button></article>
      <article><h2 hidden>PRIVATE_HIDDEN_CONTEXT</h2><button>隐藏上下文</button></article>
    `;
    document.body.append(duplicatePanel);
  });
  const duplicateScripting = await observeFromHarness(harness, tabId, false);
  const duplicateCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [duplicateScripting, duplicateCdp]) {
    const duplicates = observation.elementSummaries.filter((element) => element.name === '打开');
    assert.equal(duplicates.length, 2);
    assert.deepEqual(duplicates.map((element) => element.context).sort(), ['项目 Alpha', '项目 Beta']);
    assert.equal(observation.elementSummaries.filter((element) => element.name === '嵌套操作').length, 1);
    const serializedSummaries = JSON.stringify(observation.elementSummaries);
    assert.equal(serializedSummaries.includes('PRIVATE_EDITABLE_CONTEXT'), false);
    assert.equal(serializedSummaries.includes('PRIVATE_HIDDEN_CONTEXT'), false);
  }

  await page.evaluate(() => {
    document.getElementById('observation-duplicates').style.transform = 'translateX(-140px)';
  });
  const movedScripting = await observeFromHarness(harness, tabId, false);
  const movedCdp = await observeFromHarness(harness, tabId, true);
  const baselineAlphaScripting = duplicateScripting.elementSummaries.find((element) => element.context === '项目 Alpha');
  const baselineAlphaCdp = duplicateCdp.elementSummaries.find((element) => element.context === '项目 Alpha');
  const movedAlphaScripting = movedScripting.elementSummaries.find((element) => element.context === '项目 Alpha');
  const movedAlphaCdp = movedCdp.elementSummaries.find((element) => element.context === '项目 Alpha');
  assert.notEqual(movedAlphaScripting.rect.x, baselineAlphaScripting.rect.x);
  assert.notEqual(movedAlphaCdp.rect.x, baselineAlphaCdp.rect.x);
  assert.notEqual(movedAlphaScripting.ref, baselineAlphaScripting.ref);
  assert.notEqual(movedAlphaCdp.ref, baselineAlphaCdp.ref);
  assert.equal(movedAlphaScripting.rect.x, movedAlphaCdp.rect.x);

  await page.evaluate(() => {
    const modal = document.createElement('div');
    modal.id = 'observation-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = 'position:fixed;inset:180px 220px;z-index:100;background:white;padding:20px;border:2px solid black';
    modal.innerHTML = '<h2>确认操作</h2><button>确认弹窗</button>';
    document.body.append(modal);
  });
  const modalScripting = await observeFromHarness(harness, tabId, false);
  const modalCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [modalScripting, modalCdp]) {
    assert.deepEqual(observation.elementNames, ['确认弹窗']);
  }

  await page.evaluate(() => {
    document.getElementById('observation-modal')?.remove();
    const host = document.createElement('div');
    host.id = 'observation-shadow-modal-host';
    host.style.cssText = 'position:fixed;inset:180px 220px;z-index:100;background:white;padding:20px';
    host.attachShadow({ mode: 'open' }).innerHTML = `
      <div role="dialog" aria-modal="true"><h2>Shadow modal</h2><button>Shadow modal action</button></div>
    `;
    document.body.append(host);
  });
  const shadowModalScripting = await observeFromHarness(harness, tabId, false);
  const shadowModalCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [shadowModalScripting, shadowModalCdp]) {
    assert.deepEqual(observation.elementNames, ['Shadow modal action']);
  }

  await page.evaluate(() => {
    document.getElementById('observation-shadow-modal-host')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'observation-frame-modal';
    frame.setAttribute('aria-modal', 'true');
    frame.srcdoc = '<div role="dialog" aria-modal="true"><h2>Frame modal</h2><button>Frame modal action</button></div>';
    frame.style.cssText = 'position:fixed;inset:180px 220px;width:500px;height:220px;z-index:100;background:white';
    document.body.append(frame);
  });
  const frameModalHandle = await page.locator('#observation-frame-modal').elementHandle();
  const frameModalFrame = await frameModalHandle.contentFrame();
  await frameModalFrame.waitForLoadState('domcontentloaded');
  const frameModalScripting = await observeFromHarness(harness, tabId, false);
  const frameModalCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [frameModalScripting, frameModalCdp]) {
    assert.deepEqual(observation.elementNames, ['Frame modal action']);
  }

  await page.evaluate(() => {
    document.getElementById('observation-frame-modal')?.remove();
    const localFrame = document.createElement('iframe');
    localFrame.id = 'observation-local-frame-modal';
    localFrame.srcdoc = '<div aria-modal="true"><button>Frame local modal action</button></div>';
    localFrame.style.cssText = 'position:fixed;right:20px;top:160px;width:260px;height:100px;background:white';
    const hiddenFrame = document.createElement('iframe');
    hiddenFrame.id = 'observation-hidden-frame-modal';
    hiddenFrame.srcdoc = '<div aria-modal="true"><button>Hidden frame modal action</button></div>';
    hiddenFrame.style.display = 'none';
    document.body.append(localFrame, hiddenFrame);
  });
  const localModalHandle = await page.locator('#observation-local-frame-modal').elementHandle();
  await (await localModalHandle.contentFrame()).waitForLoadState('domcontentloaded');
  const localModalScripting = await observeFromHarness(harness, tabId, false);
  const localModalCdp = await observeFromHarness(harness, tabId, true);
  for (const observation of [localModalScripting, localModalCdp]) {
    assert.equal(observation.elementNames.includes('搜索教程'), true);
    assert.equal(observation.elementNames.includes('Frame local modal action'), true);
    assert.equal(observation.elementNames.includes('Hidden frame modal action'), false);
  }
  const injectedMarkers = await page.locator('[data-agent-id], [data-browser-agent-id]').count();

  assert.equal(injectedMarkers, 0, 'Browser Observation must not annotate the live DOM');

  const report = {
    fixtureUrl,
    scripting,
    refinedSearch,
    cdp,
    refinedCdpSearch,
    framedScripting,
    framedCdp,
    occludedFrameScripting,
    occludedFrameCdp,
    mirroredFrameScripting,
    mirroredFrameCdp,
    transformedAncestorScripting,
    transformedAncestorCdp,
    crossOriginScripting,
    crossOriginCdp,
    complexScripting,
    complexCdp,
    duplicateScripting,
    duplicateCdp,
    movedScripting,
    movedCdp,
    modalScripting,
    modalCdp,
    shadowModalScripting,
    shadowModalCdp,
    frameModalScripting,
    frameModalCdp,
    localModalScripting,
    localModalCdp,
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
      refinementCreatesFocusedObservation:
        refinedSearch.elementSummaries.length === 1 &&
        refinedSearch.elementSummaries[0].name === '搜索教程' &&
        refinedCdpSearch.elementSummaries.length === 1 &&
        refinedCdpSearch.elementSummaries[0].name === '搜索教程',
      nestedSameOriginFramesObserved:
        framedScripting.elementNames.includes('Nested frame action') &&
        framedCdp.elementNames.includes('Nested frame action'),
      frameScalingAndParentOcclusionHandled:
        !occludedFrameScripting.elementNames.includes('Frame action') &&
        !occludedFrameCdp.elementNames.includes('Frame action'),
      mirroredFramesExplicitlyDegraded:
        mirroredFrameScripting.status === 'degraded' &&
        mirroredFrameCdp.status === 'degraded' &&
        transformedAncestorScripting.status === 'degraded' &&
        transformedAncestorCdp.status === 'degraded',
      crossOriginFramesExplicitlyDegraded:
        crossOriginScripting.status === 'degraded' &&
        crossOriginCdp.status === 'degraded',
      shadowObservedAndCanvasExplicitlyDegraded:
        complexScripting.status === 'degraded' &&
        complexCdp.status === 'degraded',
      duplicateTargetsKeepSemanticContext:
        duplicateScripting.elementSummaries.filter((element) => element.name === '打开').length === 2 &&
        duplicateCdp.elementSummaries.filter((element) => element.name === '打开').length === 2 &&
        duplicateScripting.elementSummaries.filter((element) => element.name === '嵌套操作').length === 1 &&
        duplicateCdp.elementSummaries.filter((element) => element.name === '嵌套操作').length === 1,
      movedTargetsReceiveFreshReferences:
        movedAlphaScripting.ref !== baselineAlphaScripting.ref &&
        movedAlphaCdp.ref !== baselineAlphaCdp.ref,
      activeModalScopesTargets:
        modalScripting.elementNames.length === 1 &&
        modalCdp.elementNames.length === 1 &&
        shadowModalScripting.elementNames.length === 1 &&
        shadowModalCdp.elementNames.length === 1 &&
        frameModalScripting.elementNames.length === 1 &&
        frameModalCdp.elementNames.length === 1 &&
        localModalScripting.elementNames.includes('搜索教程') &&
        localModalCdp.elementNames.includes('搜索教程'),
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

async function refineFromHarness(harness, tabId, useCdp, observationId, options) {
  return harness.evaluate(
    ({ targetTabId, shouldUseCdp, sourceObservationId, refinementOptions }) =>
      globalThis.runBrowserObservationRefinement(
        targetTabId,
        shouldUseCdp,
        sourceObservationId,
        refinementOptions
      ),
    {
      targetTabId: tabId,
      shouldUseCdp: useCdp,
      sourceObservationId: observationId,
      refinementOptions: options
    }
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
