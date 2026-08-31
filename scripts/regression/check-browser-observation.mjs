import assert from 'node:assert/strict';
import { createBrowserObservationModule } from '../../background/browser-observation.js';
import { createScriptingObservationAdapter } from '../../background/browser-observation-scripting.js';

const adapter = {
  kind: 'scripting',
  capabilities: {
    mainDocument: true,
    openShadowDom: false,
    sameOriginFrames: false,
    crossOriginFrames: false,
    closedShadowDom: false,
    selfDrawnSurfaces: false
  },
  async capture() {
    return 'data:image/png;base64,AA==';
  },
  async inspect() {
    return {
      documentToken: 'doc-1',
      revision: 'revision-1',
      url: 'https://example.test/tutorial',
      title: 'Tutorial Fixture',
      viewport: {
        width: 1280,
        height: 720,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 2,
        pageScaleFactor: 1,
        visualOffsetX: 0,
        visualOffsetY: 0,
        zoomFactor: 1
      },
      observedRegions: {
        openShadowDom: 0,
        sameOriginFrames: 0,
        crossOriginFrames: 0,
        inaccessibleFrames: 0
      },
      elements: [
        {
          role: 'button',
          name: '开始录制',
          value: '不应离开 adapter 的秘密值',
          rect: { x: 24, y: 40, width: 120, height: 36 },
          fingerprint: 'button-start',
          targetType: 'button',
          targetHref: '',
          targetFormMethod: ''
        }
      ],
      truncated: false,
      inspectedNodeCount: 12
    };
  }
};

const browserObservation = createBrowserObservationModule({
  getTab: async () => ({
    id: 42,
    url: 'https://example.test/tutorial',
    title: 'Tutorial Fixture',
    status: 'complete',
    active: true,
    windowId: 7
  }),
  selectAdapter: () => adapter,
  createObservationId: () => 'observation-test-1',
  now: () => 1_000
});

const result = await browserObservation.observe({ tabId: 42 });

assert.equal(result.status, 'ready');
assert.equal(result.observation.id, 'observation-test-1');
assert.equal(result.observation.adapter, 'scripting');
assert.equal(result.observation.cleanScreenshot.data, 'data:image/png;base64,AA==');
assert.deepEqual(result.observation.viewport, {
  width: 1280,
  height: 720,
  scrollX: 0,
  scrollY: 0,
  devicePixelRatio: 2,
  pageScaleFactor: 1,
  visualOffsetX: 0,
  visualOffsetY: 0,
  zoomFactor: 1
});
assert.deepEqual(result.observation.target, { tabId: 42, windowId: 7 });
assert.equal(result.observation.elements.length, 1);
assert.equal(result.observation.elements[0].ref, 'observation-test-1:element:1');
assert.equal(result.observation.elements[0].name, '开始录制');
assert.equal('value' in result.observation.elements[0], false);
assert.equal('fingerprint' in result.observation.elements[0], false);
assert.equal('targetHref' in result.observation.elements[0], false);
assert.equal(result.observation.receipt.status, 'ready');
assert.equal(result.observation.receipt.elementCount, 1);
assert.equal(result.observation.receipt.adapter, 'scripting');
assert.deepEqual(result.observation.receipt.capabilities, adapter.capabilities);
assert.deepEqual(result.observation.receipt.degradedReasons, []);

console.log('ok - a stable ordinary page produces a ready Browser Observation');

const unavailableObservation = createBrowserObservationModule({
  getTab: async () => ({
    id: 42,
    url: 'https://example.test/tutorial',
    title: 'Tutorial Fixture',
    status: 'complete',
    active: true,
    windowId: 7
  }),
  selectAdapter: () => ({
    ...adapter,
    async capture() {
      throw new Error('capture unavailable');
    }
  }),
  createObservationId: () => 'observation-test-2',
  now: () => 2_000
});

const unavailableResult = await unavailableObservation.observe({ tabId: 42 });
assert.equal(unavailableResult.status, 'unavailable');
assert.equal(unavailableResult.reasonCode, 'capture-or-inspection-failed');
assert.equal(unavailableResult.receipt.status, 'unavailable');
assert.equal(unavailableResult.receipt.adapter, 'scripting');
assert.equal(unavailableResult.receipt.reasonCode, 'capture-or-inspection-failed');
assert.equal('observation' in unavailableResult, false);

console.log('ok - capture failures produce an unavailable observation outcome');

const truncatedObservation = createBrowserObservationModule({
  getTab: async () => ({
    id: 42,
    url: 'https://example.test/tutorial',
    title: 'Tutorial Fixture',
    status: 'complete',
    active: true,
    windowId: 7
  }),
  selectAdapter: () => ({
    ...adapter,
    async inspect() {
      return {
        documentToken: 'doc-2',
        revision: 'revision-2',
        url: 'https://example.test/tutorial',
        title: 'Tutorial Fixture',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        elements: [],
        truncated: true,
        inspectedNodeCount: 5_000
      };
    }
  }),
  createObservationId: () => 'observation-test-3',
  now: () => 3_000
});

const truncatedResult = await truncatedObservation.observe({ tabId: 42 });
assert.equal(truncatedResult.status, 'degraded');
assert.deepEqual(truncatedResult.observation.degradedReasons, ['element-list-truncated']);
assert.equal(truncatedResult.observation.receipt.status, 'degraded');
assert.equal(truncatedResult.observation.receipt.truncated, true);

console.log('ok - truncated element inventories produce a degraded observation outcome');

let changingTabReadCount = 0;
let changingPageInspectCount = 0;
const changingPageObservation = createBrowserObservationModule({
  getTab: async () => {
    changingTabReadCount += 1;
    const changed = changingTabReadCount >= 2;
    return {
      id: 42,
      url: changed ? 'https://example.test/after' : 'https://example.test/before',
      title: changed ? 'After' : 'Before',
      status: 'complete',
      active: true,
      windowId: 7
    };
  },
  selectAdapter: () => ({
    ...adapter,
    async inspect() {
      changingPageInspectCount += 1;
      const changed = changingPageInspectCount >= 2;
      return {
        documentToken: changed ? 'doc-after' : 'doc-before',
        revision: changed ? 'revision-after' : 'revision-before',
        url: changed ? 'https://example.test/after' : 'https://example.test/before',
        title: changed ? 'After' : 'Before',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        elements: [],
        truncated: false,
        inspectedNodeCount: 12
      };
    }
  }),
  createObservationId: () => 'observation-test-4',
  now: () => 4_000
});

const changingPageResult = await changingPageObservation.observe({ tabId: 42 });
assert.equal(changingPageResult.status, 'ready');
assert.equal(changingPageResult.observation.page.url, 'https://example.test/after');
assert.equal(changingPageResult.observation.page.documentToken, 'doc-after');
assert.equal(changingPageInspectCount, 4);

console.log('ok - navigation during capture retries instead of mixing page revisions');

let spaInspectionCount = 0;
const spaObservation = createBrowserObservationModule({
  getTab: async () => ({
    id: 42,
    url: 'https://example.test/app',
    title: 'SPA',
    status: 'complete',
    active: true,
    windowId: 7
  }),
  selectAdapter: () => ({
    ...adapter,
    async inspect() {
      spaInspectionCount += 1;
      const revision = spaInspectionCount === 1 ? 'spa-before' : 'spa-after';
      return {
        documentToken: 'spa-document',
        revision,
        url: 'https://example.test/app',
        title: 'SPA',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        observedRegions: {},
        elements: [],
        truncated: false
      };
    }
  }),
  createObservationId: () => 'observation-test-5',
  now: () => 5_000
});

const spaResult = await spaObservation.observe({ tabId: 42 });
assert.equal(spaResult.status, 'ready');
assert.equal(spaInspectionCount, 4);
assert.equal(spaResult.observation.page.documentToken, 'spa-document');

console.log('ok - a same-URL SPA mutation retries until screenshot and structure share a revision');

const framedObservation = createBrowserObservationModule({
  getTab: async () => ({
    id: 42,
    url: 'https://example.test/framed',
    title: 'Framed',
    status: 'complete',
    active: true,
    windowId: 7
  }),
  selectAdapter: () => ({
    ...adapter,
    async inspect() {
      return {
        documentToken: 'framed-document',
        revision: 'framed-revision',
        url: 'https://example.test/framed',
        title: 'Framed',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        observedRegions: { sameOriginFrames: 1 },
        elements: [],
        truncated: false
      };
    }
  }),
  createObservationId: () => 'observation-test-6',
  now: () => 6_000
});

const framedResult = await framedObservation.observe({ tabId: 42 });
assert.equal(framedResult.status, 'degraded');
assert.deepEqual(framedResult.observation.degradedReasons, ['same-origin-frame-content-unavailable']);
assert.deepEqual(framedResult.observation.receipt.degradedReasons, ['same-origin-frame-content-unavailable']);

console.log('ok - unsupported page regions are explicit in the outcome and receipt');

let activationListener = null;
const switchingAdapter = createScriptingObservationAdapter({
  tabs: {
    onActivated: {
      addListener(listener) {
        activationListener = listener;
      },
      removeListener(listener) {
        if (activationListener === listener) activationListener = null;
      }
    },
    async query() {
      return [{ id: 42 }];
    },
    async captureVisibleTab() {
      activationListener?.({ windowId: 7, tabId: 99 });
      return 'data:image/png;base64,AA==';
    }
  }
});

await assert.rejects(
  switchingAdapter.capture({ id: 42, windowId: 7, active: true }),
  /changed while capturing/
);
assert.equal(activationListener, null);

console.log('ok - tab switches during window-scoped screenshot capture invalidate the observation');
