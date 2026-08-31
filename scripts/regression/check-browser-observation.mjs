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
    transformedFrames: false,
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

let refinementId = 0;
let lastProbeOptions = null;
const refinementObservation = createBrowserObservationModule({
  getTab: async () => ({
    id: 42,
    url: 'https://example.test/refine',
    title: 'Refine',
    status: 'complete',
    active: true,
    windowId: 7
  }),
  selectAdapter: () => ({
    ...adapter,
    async inspect(tabId, options) {
      lastProbeOptions = options;
      return {
        documentToken: 'refine-document',
        revision: `refine-${JSON.stringify(options)}`,
        url: 'https://example.test/refine',
        title: 'Refine',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        observedRegions: {},
        elements: [],
        truncated: false
      };
    }
  }),
  createObservationId: () => `refinement-${++refinementId}`,
  now: () => 7_000
});

const refinementSource = await refinementObservation.observe({ tabId: 42 });
const refinedResult = await refinementObservation.refine({
  tabId: 42,
  observationId: refinementSource.observation.id,
  role: 'button',
  region: { x: 10, y: 20, width: 300, height: 200 },
  maxElements: 30
});
assert.equal(refinedResult.status, 'ready');
assert.equal(refinedResult.observation.id, 'refinement-2');
assert.deepEqual(lastProbeOptions, {
  maxElements: 30,
  region: { x: 10, y: 20, width: 300, height: 200 },
  role: 'button'
});
const expiredRefinement = await refinementObservation.refine({
  tabId: 42,
  observationId: refinementSource.observation.id
});
assert.equal(expiredRefinement.status, 'unavailable');
assert.equal(expiredRefinement.reasonCode, 'observation-expired');
const secondRefinement = await refinementObservation.refine({
  tabId: 42,
  observationId: refinedResult.observation.id,
  role: 'button'
});
assert.equal(secondRefinement.status, 'ready');
const limitedRefinement = await refinementObservation.refine({
  tabId: 42,
  observationId: secondRefinement.observation.id,
  role: 'button'
});
assert.equal(limitedRefinement.status, 'unavailable');
assert.equal(limitedRefinement.reasonCode, 'refinement-limit-reached');

console.log('ok - refinement creates new references and enforces lineage limits');

let refinementDocumentToken = 'document-before';
const changingDocumentRefinement = createBrowserObservationModule({
  getTab: async () => ({
    id: 42,
    url: 'https://example.test/refine',
    title: 'Refine',
    status: 'complete',
    active: true,
    windowId: 7
  }),
  selectAdapter: () => ({
    ...adapter,
    async inspect() {
      return {
        documentToken: refinementDocumentToken,
        revision: refinementDocumentToken,
        url: 'https://example.test/refine',
        title: 'Refine',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        observedRegions: {},
        elements: [],
        truncated: false
      };
    }
  }),
  createObservationId: () => 'changing-refinement',
  now: () => 8_000
});
const changingRefinementSource = await changingDocumentRefinement.observe({ tabId: 42 });
refinementDocumentToken = 'document-after';
const changingRefinementResult = await changingDocumentRefinement.refine({
  tabId: 42,
  observationId: changingRefinementSource.observation.id
});
assert.equal(changingRefinementResult.status, 'unavailable');
assert.equal(changingRefinementResult.reasonCode, 'observation-page-changed');

console.log('ok - refinement rejects a source whose document identity changed');

let guardedRefinementId = 0;
const guardedRefinement = createBrowserObservationModule({
  getTab: async () => ({
    id: 42,
    url: 'https://example.test/guarded-refine',
    title: 'Guarded refine',
    status: 'complete',
    active: true,
    windowId: 7
  }),
  selectAdapter: () => ({
    ...adapter,
    async inspect() {
      return {
        documentToken: 'guarded-document',
        revision: 'guarded-revision',
        url: 'https://example.test/guarded-refine',
        title: 'Guarded refine',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        observedRegions: {},
        elements: [],
        truncated: false
      };
    }
  }),
  createObservationId: () => `guarded-refinement-${++guardedRefinementId}`,
  now: () => 9_000
});
const guardedSource = await guardedRefinement.observe({
  tabId: 42,
  internalRefinementDepth: -100,
  internalLineageStartedAt: 999_999,
  internalExpectedDocumentToken: 'forged-document'
});
assert.equal(guardedSource.status, 'ready');
const guardedFirst = await guardedRefinement.refine({
  tabId: 42,
  observationId: guardedSource.observation.id
});
const guardedSecond = await guardedRefinement.refine({
  tabId: 42,
  observationId: guardedFirst.observation.id
});
const guardedLimit = await guardedRefinement.refine({
  tabId: 42,
  observationId: guardedSecond.observation.id
});
assert.equal(guardedFirst.status, 'ready');
assert.equal(guardedSecond.status, 'ready');
assert.equal(guardedLimit.reasonCode, 'refinement-limit-reached');

console.log('ok - public observe input cannot forge internal refinement lineage state');

let deadlineNow = 10_000;
let deadlineCaptureCount = 0;
let deadlineObservationId = 0;
const deadlineRefinement = createBrowserObservationModule({
  getTab: async () => ({
    id: 42,
    url: 'https://example.test/deadline',
    title: 'Deadline',
    status: 'complete',
    active: true,
    windowId: 7
  }),
  selectAdapter: () => ({
    ...adapter,
    async capture() {
      deadlineCaptureCount += 1;
      if (deadlineCaptureCount > 1) deadlineNow = 13_000;
      return 'data:image/png;base64,AA==';
    },
    async inspect() {
      return {
        documentToken: 'deadline-document',
        revision: 'deadline-revision',
        url: 'https://example.test/deadline',
        title: 'Deadline',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        observedRegions: {},
        elements: [],
        truncated: false
      };
    }
  }),
  createObservationId: () => `deadline-${++deadlineObservationId}`,
  now: () => deadlineNow
});
const deadlineSource = await deadlineRefinement.observe({ tabId: 42 });
const deadlineResult = await deadlineRefinement.refine({
  tabId: 42,
  observationId: deadlineSource.observation.id
});
assert.equal(deadlineResult.status, 'unavailable');
assert.equal(deadlineResult.reasonCode, 'refinement-limit-reached');

console.log('ok - refinement cannot succeed after its total lineage deadline');

let scriptingInjectionCount = 0;
const cappedScriptingAdapter = createScriptingObservationAdapter({
  tabs: {
    async getZoom() {
      return 1;
    }
  },
  scripting: {
    async executeScript() {
      scriptingInjectionCount += 1;
      if (scriptingInjectionCount === 1) return [];
      return [
        {
          documentId: 'top-document',
          result: {
            documentToken: 'top-token',
            revision: 'top-revision',
            frameContext: { isTop: true, sameOriginToTop: true, framePath: [] },
            url: 'https://example.test/frames',
            title: 'Frames',
            viewport: { width: 100, height: 100 },
            observedRegions: { sameOriginFrames: 1 },
            elements: [
              { name: 'low', priority: 1, rect: { x: 0, y: 5, width: 10, height: 10 } },
              { name: 'top', priority: 100, rect: { x: 0, y: 50, width: 10, height: 10 } }
            ],
            truncated: false
          }
        },
        {
          documentId: 'child-document',
          result: {
            documentToken: 'child-token',
            revision: 'child-revision',
            frameContext: { isTop: false, sameOriginToTop: true, framePath: ['child'] },
            url: 'https://example.test/child',
            title: 'Child',
            viewport: { width: 100, height: 100 },
            observedRegions: {},
            elements: [
              { name: 'child', priority: 90, rect: { x: 0, y: 10, width: 10, height: 10 } },
              { name: 'lower-child', priority: 2, rect: { x: 0, y: 20, width: 10, height: 10 } }
            ],
            truncated: false
          }
        }
      ];
    }
  }
});
const cappedInspection = await cappedScriptingAdapter.inspect(42, { maxElements: 2 });
assert.deepEqual(cappedInspection.elements.map((element) => element.name), ['child', 'top']);
assert.equal(cappedInspection.truncated, true);

console.log('ok - scripting frame aggregation preserves a global rank and element cap');

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
