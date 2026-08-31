import { inspectVisibleInteractivePage } from './browser-observation-probe.js';
import { installBrowserObservationProbeHelpers } from './browser-observation-probe-helpers.js';

const SCRIPTING_CAPABILITIES = Object.freeze({
  mainDocument: true,
  openShadowDom: true,
  sameOriginFrames: true,
  crossOriginFrames: false,
  closedShadowDom: false,
  transformedFrames: false,
  selfDrawnSurfaces: false
});

export function createScriptingObservationAdapter(chromeApi = globalThis.chrome) {
  return Object.freeze({
    kind: 'scripting',
    capabilities: SCRIPTING_CAPABILITIES,
    capture: (tab) => capture(chromeApi, tab),
    inspect: (tabId, options) => inspect(chromeApi, tabId, options)
  });
}

async function capture(chromeApi, tab) {
  if (!tab?.active) {
    throw new Error('Scripting observation requires the target tab to be active');
  }
  let activationChanged = false;
  const onActivated = (activeInfo) => {
    if (activeInfo.windowId === tab.windowId && activeInfo.tabId !== tab.id) {
      activationChanged = true;
    }
  };
  chromeApi.tabs.onActivated.addListener(onActivated);
  try {
    await assertActiveTarget(chromeApi, tab);
    const screenshot = await chromeApi.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await assertActiveTarget(chromeApi, tab);
    if (activationChanged) {
      throw new Error('Target tab changed while capturing the visible page');
    }
    return screenshot;
  } finally {
    chromeApi.tabs.onActivated.removeListener(onActivated);
  }
}

async function inspect(chromeApi, tabId, options) {
  const maxElements = clampMaxElements(options?.maxElements);
  const zoomFactorPromise = chromeApi.tabs.getZoom(tabId);
  await chromeApi.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'ISOLATED',
    func: installBrowserObservationProbeHelpers
  });
  const [results, zoomFactor] = await Promise.all([
    chromeApi.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'ISOLATED',
      func: inspectVisibleInteractivePage,
      args: [{ ...options, traverseSameOriginFrames: false }]
    }),
    zoomFactorPromise
  ]);
  const accessibleResults = (results || [])
    .filter((item) => item?.result?.frameContext?.sameOriginToTop === true)
    .sort((left, right) =>
      left.result.frameContext.framePath.join('>').localeCompare(right.result.frameContext.framePath.join('>'))
    );
  const first = accessibleResults.find((item) => item.result.frameContext.isTop) || accessibleResults[0];
  if (!first?.result) {
    throw new Error('Scripting observation returned no page result');
  }
  const observedRegions = accessibleResults.reduce((total, item) => {
    for (const [key, value] of Object.entries(item.result.observedRegions || {})) {
      total[key] = (total[key] || 0) + Number(value || 0);
    }
    return total;
  }, {});
  const missingSameOriginFrameResults = Math.max(
    0,
    Number(observedRegions.sameOriginFrames || 0) - Math.max(0, accessibleResults.length - 1)
  );
  const degradedReasons = [
    ...new Set(accessibleResults.flatMap((item) => item.result.degradedReasons || [])),
    ...(missingSameOriginFrameResults ? ['same-origin-frame-result-missing'] : [])
  ];
  const combinedElements = accessibleResults.flatMap((item) => item.result.elements || []);
  const elements = combinedElements
    .sort((left, right) =>
      Number(right.priority || 0) - Number(left.priority || 0) ||
      Number(left.rect?.y || 0) - Number(right.rect?.y || 0) ||
      Number(left.rect?.x || 0) - Number(right.rect?.x || 0)
    )
    .slice(0, maxElements)
    .sort((left, right) =>
      Number(left.rect?.y || 0) - Number(right.rect?.y || 0) ||
      Number(left.rect?.x || 0) - Number(right.rect?.x || 0)
    );
  return {
    ...first.result,
    documentToken: first.documentId || first.result.documentToken || '',
    revision: accessibleResults.map((item) => [
      item.documentId || item.result.documentToken || '',
      item.result.revision || ''
    ].join(':')).join('|'),
    elements,
    observedRegions,
    truncated:
      accessibleResults.some((item) => item.result.truncated === true) ||
      combinedElements.length > maxElements,
    inspectedNodeCount: accessibleResults.reduce(
      (total, item) => total + Number(item.result.inspectedNodeCount || 0),
      0
    ),
    degradedReasons,
    viewport: {
      ...first.result.viewport,
      zoomFactor
    }
  };
}

function clampMaxElements(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(250, Math.max(1, parsed)) : 80;
}

async function assertActiveTarget(chromeApi, tab) {
  const [activeTab] = await chromeApi.tabs.query({ active: true, windowId: tab.windowId });
  if (activeTab?.id !== tab.id) {
    throw new Error('Target tab is no longer the active tab in its window');
  }
}
