import { createCdpObservationAdapter } from './browser-observation-cdp.js';
import {
  createRemoteObservationProjection,
  renderBrowserObservationDecisionScreenshot
} from './browser-observation-projection.js';
import { createScriptingObservationAdapter } from './browser-observation-scripting.js';
import { verifyObservedElement } from './browser-observation-verification.js';
import {
  capabilityDegradedReasons,
  normalizeObservedElement,
  refinementLimitOutcome,
  unavailableOutcome
} from './browser-observation-outcomes.js';
import { S } from './runtime-state.js';
import { getSettings } from './settings-store.js';

const DEFAULT_MAX_OBSERVED_ELEMENTS = 80;
const DEFAULT_OBSERVATION_ATTEMPTS = 2;
const INTERNAL_RECORD_TTL_MS = 60_000;
const MAX_REFINEMENTS_PER_LINEAGE = 2;
const MAX_REFINEMENT_LINEAGE_MS = 3_000;

const cdpAdapter = createCdpObservationAdapter();
const scriptingAdapter = createScriptingObservationAdapter();
const defaultBrowserObservation = createBrowserObservationModule({
  getTab: async (tabId) => chrome.tabs.get(tabId).catch(() => null),
  selectAdapter: () => S.currentRuntime.cdpAttached ? cdpAdapter : scriptingAdapter,
  createObservationId: () => {
    const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `browser-observation-${suffix}`;
  }
});

export function observeBrowserPage(options) {
  return defaultBrowserObservation.observe(options);
}

export function refineBrowserObservation(options) {
  return defaultBrowserObservation.refine(options);
}

export function projectBrowserObservation(options) {
  return defaultBrowserObservation.project(options);
}

export function verifyBrowserObservation(options) {
  return defaultBrowserObservation.verify(options);
}

export function dispatchBrowserObservationAction(options) {
  return defaultBrowserObservation.dispatch(options);
}

export function createBrowserObservationModule({
  getTab,
  selectAdapter,
  createObservationId,
  renderDecisionScreenshot = renderBrowserObservationDecisionScreenshot,
  readSettings = getSettings,
  now = Date.now
}) {
  if (typeof getTab !== 'function' || typeof selectAdapter !== 'function') {
    throw new TypeError('Browser Observation requires tab and adapter dependencies');
  }

  if (typeof createObservationId !== 'function') {
    throw new TypeError('Browser Observation requires an observation ID factory');
  }

  const internalRecordsByTab = new Map();

  return Object.freeze({ observe, refine, project, verify, dispatch });

  function observe({
    tabId,
    maxElements = DEFAULT_MAX_OBSERVED_ELEMENTS,
    region = null,
    role = ''
  } = {}) {
    return observeInternal({ tabId, maxElements, region, role });
  }

  async function observeInternal({
    tabId,
    maxElements,
    region,
    role,
    refinementContext = null
  }) {
    const startedAt = now();
    const lineageStartedAt = refinementContext?.lineageStartedAt ?? startedAt;
    const refinementDepth = refinementContext?.depth ?? 0;
    const expectedDocumentToken = refinementContext?.expectedDocumentToken || '';
    const refinementDeadlineAt = refinementContext?.deadlineAt ?? null;
    let lastAdapterKind = '';
    let lastCapabilities = {};
    internalRecordsByTab.delete(tabId);

    for (let attempt = 0; attempt < DEFAULT_OBSERVATION_ATTEMPTS; attempt += 1) {
      if (refinementDeadlineAt !== null && now() >= refinementDeadlineAt) {
        return refinementLimitOutcome(lastAdapterKind, lastCapabilities);
      }
      const tab = await getTab(tabId);
      if (!isRecordableTab(tab)) {
        return unavailableOutcome({
          reasonCode: 'target-tab-unavailable',
          durationMs: Math.max(0, now() - startedAt)
        });
      }
      const adapter = selectAdapter(tab);
      lastAdapterKind = adapter.kind;
      lastCapabilities = adapter.capabilities;
      let screenshotData;
      let inspectionBefore;
      let inspection;
      let capturedAt;
      try {
        const probeOptions = { maxElements, region, role };
        inspectionBefore = await adapter.inspect(tab.id, probeOptions);
        if (
          expectedDocumentToken &&
          inspectionBefore.documentToken !== expectedDocumentToken
        ) {
          return unavailableOutcome({
            adapter: adapter.kind,
            capabilities: adapter.capabilities,
            reasonCode: 'observation-page-changed',
            durationMs: Math.max(0, now() - startedAt)
          });
        }
        screenshotData = await adapter.capture(tab);
        capturedAt = now();
        inspection = await adapter.inspect(tab.id, probeOptions);
      } catch (error) {
        return unavailableOutcome({
          adapter: adapter.kind,
          capabilities: adapter.capabilities,
          reasonCode: 'capture-or-inspection-failed',
          durationMs: Math.max(0, now() - startedAt)
        });
      }

      if (refinementDeadlineAt !== null && now() >= refinementDeadlineAt) {
        return refinementLimitOutcome(adapter.kind, adapter.capabilities);
      }

      const currentTab = await getTab(tabId);
      if (
        !isSamePageRevision(tab, currentTab, inspectionBefore, inspection) ||
        !isSameInspectionRevision(inspectionBefore, inspection)
      ) {
        continue;
      }


      const observationId = createObservationId();
      const internalRecord = createInternalRecord(
        observationId,
        inspection,
        screenshotData,
        adapter,
        refinementDepth,
        lineageStartedAt
      );
      internalRecordsByTab.set(tab.id, internalRecord);
      const expiryHandle = setTimeout(() => {
        if (internalRecordsByTab.get(tab.id)?.observationId === observationId) {
          internalRecordsByTab.delete(tab.id);
        }
      }, INTERNAL_RECORD_TTL_MS);
      expiryHandle?.unref?.();
      while (internalRecordsByTab.size > 16) {
        internalRecordsByTab.delete(internalRecordsByTab.keys().next().value);
      }

      return readyOrDegradedOutcome({
        adapter,
        tab: currentTab,
        inspection,
        screenshotData,
        observationId,
        capturedAt,
        durationMs: Math.max(0, now() - startedAt)
      });
    }

    return unavailableOutcome({
      adapter: lastAdapterKind,
      capabilities: lastCapabilities,
      reasonCode: 'page-changed-during-observation',
      durationMs: Math.max(0, now() - startedAt)
    });
  }

  async function refine({ tabId, observationId, region = null, role = '', maxElements = 120 } = {}) {
    const currentRecord = internalRecordsByTab.get(tabId);
    if (!currentRecord || currentRecord.observationId !== observationId) {
      return unavailableOutcome({
        reasonCode: 'observation-expired',
        durationMs: 0
      });
    }
    const deadlineAt = currentRecord.lineageStartedAt + MAX_REFINEMENT_LINEAGE_MS;
    if (
      currentRecord.refinementDepth >= MAX_REFINEMENTS_PER_LINEAGE ||
      now() >= deadlineAt
    ) {
      return refinementLimitOutcome();
    }
    return observeInternal({
      tabId,
      maxElements,
      region,
      role,
      refinementContext: {
        depth: currentRecord.refinementDepth + 1,
        lineageStartedAt: currentRecord.lineageStartedAt,
        deadlineAt,
        expectedDocumentToken: currentRecord.documentToken
      }
    });
  }

  async function project({
    tabId,
    observationId,
    aiDataSharingConsent = false
  } = {}) {
    if (aiDataSharingConsent !== true) {
      return unavailableOutcome({
        reasonCode: 'ai-data-sharing-consent-required',
        durationMs: 0
      });
    }
    const currentSettings = await readSettings();
    if (currentSettings?.aiDataSharingConsent !== true) {
      return unavailableOutcome({
        reasonCode: 'ai-data-sharing-consent-required',
        durationMs: 0
      });
    }
    const currentRecord = internalRecordsByTab.get(tabId);
    if (!currentRecord || currentRecord.observationId !== observationId) {
      return unavailableOutcome({
        reasonCode: 'observation-expired',
        durationMs: 0
      });
    }
    const projection = createRemoteObservationProjection(currentRecord);
    try {
      const data = await renderDecisionScreenshot({
        cleanScreenshot: currentRecord.cleanScreenshotData,
        elements: projection.elements,
        viewport: projection.viewport
      });
      return {
        status: 'ready',
        projection,
        decisionScreenshot: { data },
        receipt: {
          status: 'ready',
          adapter: currentRecord.adapter,
          capabilities: { ...currentRecord.capabilities },
          elementCount: projection.elements.length,
          truncated: projection.truncated,
          degradedReasons: [],
          durationMs: 0
        }
      };
    } catch (error) {
      console.warn('[Browser Observation] Decision screenshot failed:', error);
      return unavailableOutcome({
        adapter: currentRecord.adapter,
        capabilities: currentRecord.capabilities,
        reasonCode: 'decision-screenshot-failed',
        durationMs: 0
      });
    }
  }

  async function verify({ tabId, observationId, elementRef } = {}) {
    const currentRecord = internalRecordsByTab.get(tabId);
    if (!currentRecord || currentRecord.observationId !== observationId) {
      return unavailableOutcome({ reasonCode: 'observation-expired', durationMs: 0 });
    }
    const tab = await getTab(tabId);
    if (!isRecordableTab(tab) || (currentRecord.pageUrl && tab.url !== currentRecord.pageUrl)) {
      return {
        status: 'invalid',
        reasonCode: 'observation-page-changed',
        receipt: { verification: 'invalid', reasonCode: 'observation-page-changed' }
      };
    }
    try {
      const inspection = await currentRecord.adapterImpl.inspect(tabId, { maxElements: 250 });
      return verifyObservedElement({ record: currentRecord, inspection, elementRef });
    } catch (error) {
      return unavailableOutcome({
        adapter: currentRecord.adapter,
        capabilities: currentRecord.capabilities,
        reasonCode: 'verification-failed',
        durationMs: 0
      });
    }
  }

  async function dispatch({ tabId, observationId, elementRef, action } = {}) {
    const currentRecord = internalRecordsByTab.get(tabId);
    const source = currentRecord?.elementsByRef.get(elementRef);
    if (!currentRecord || currentRecord.observationId !== observationId) {
      return unavailableOutcome({ reasonCode: 'observation-expired', durationMs: 0 });
    }
    if (!source || typeof currentRecord.adapterImpl.dispatch !== 'function') {
      return { status: 'invalid', reasonCode: 'observation-target-changed' };
    }
    const tab = await getTab(tabId);
    if (!isRecordableTab(tab) || (currentRecord.pageUrl && tab.url !== currentRecord.pageUrl)) {
      return { status: 'invalid', reasonCode: 'observation-page-changed' };
    }
    try {
      const result = await currentRecord.adapterImpl.dispatch(tabId, {
        action,
        fingerprint: source.fingerprint,
        documentToken: currentRecord.documentToken
      });
      if (result?.ok !== true) {
        return { status: 'invalid', reasonCode: result?.reasonCode || 'observation-verification-failed' };
      }
      const verification = verifyObservedElement({
        record: currentRecord,
        elementRef,
        inspection: {
          documentToken: result.documentToken,
          url: result.url,
          elements: [result.target]
        }
      });
      return verification.status === 'verified' || verification.status === 'moved'
        ? { status: 'executed', target: verification.target, receipt: verification.receipt }
        : verification;
    } catch (error) {
      console.warn('[Browser Observation] Atomic action dispatch failed:', error);
      return { status: 'invalid', reasonCode: 'observation-verification-failed' };
    }
  }
}

function isRecordableTab(tab) {
  return Boolean(
    Number.isInteger(tab?.id) &&
    /^https?:|^file:/i.test(String(tab.url || ''))
  );
}

function readyOrDegradedOutcome({
  adapter,
  tab,
  inspection,
  screenshotData,
  observationId,
  capturedAt,
  durationMs
}) {
  const elements = (inspection.elements || []).map((element, index) =>
    normalizeObservedElement(element, `${observationId}:element:${index + 1}`)
  );
  const degradedReasons = [
    ...(Array.isArray(inspection.degradedReasons) ? inspection.degradedReasons : []),
    ...(inspection.truncated === true ? ['element-list-truncated'] : []),
    ...capabilityDegradedReasons(adapter.capabilities, inspection.observedRegions)
  ].filter((reason, index, reasons) => reasons.indexOf(reason) === index);
  const status = degradedReasons.length ? 'degraded' : 'ready';
  const receipt = {
    status,
    adapter: adapter.kind,
    capabilities: { ...adapter.capabilities },
    elementCount: elements.length,
    truncated: inspection.truncated === true,
    degradedReasons: [...degradedReasons],
    durationMs
  };

  return {
    status,
    observation: {
      id: observationId,
      capturedAt,
      adapter: adapter.kind,
      target: {
        tabId: tab.id,
        windowId: tab.windowId
      },
      capabilities: { ...adapter.capabilities },
      page: {
        documentToken: inspection.documentToken || '',
        url: inspection.url || tab.url || '',
        title: inspection.title || tab.title || ''
      },
      viewport: inspection.viewport || null,
      cleanScreenshot: { data: screenshotData },
      elements,
      truncated: inspection.truncated === true,
      degradedReasons,
      receipt
    }
  };
}

function isSamePageRevision(beforeTab, afterTab, inspectionBefore, inspectionAfter) {
  return Boolean(
    beforeTab &&
    afterTab &&
    beforeTab.id === afterTab.id &&
    beforeTab.active === true &&
    afterTab.active === true &&
    beforeTab.url === afterTab.url &&
    beforeTab.title === afterTab.title &&
    (!inspectionBefore?.url || inspectionBefore.url === beforeTab.url) &&
    (!inspectionBefore?.title || inspectionBefore.title === beforeTab.title) &&
    (!inspectionAfter?.url || inspectionAfter.url === afterTab.url) &&
    (!inspectionAfter?.title || inspectionAfter.title === afterTab.title)
  );
}

function isSameInspectionRevision(before, after) {
  return Boolean(
    before?.documentToken &&
    before.documentToken === after?.documentToken &&
    before?.revision &&
    before.revision === after?.revision
  );
}

function createInternalRecord(
  observationId,
  inspection,
  cleanScreenshotData,
  adapter,
  refinementDepth,
  lineageStartedAt
) {
  return {
    observationId,
    documentToken: inspection.documentToken || '',
    pageUrl: inspection.url || '',
    viewport: inspection.viewport || null,
    truncated: inspection.truncated === true,
    cleanScreenshotData,
    adapter: adapter.kind,
    adapterImpl: adapter,
    capabilities: { ...adapter.capabilities },
    refinementDepth,
    lineageStartedAt,
    elementsByRef: new Map((inspection.elements || []).map((element, index) => [
      `${observationId}:element:${index + 1}`,
      { ...element }
    ]))
  };
}
