import { inspectVisibleInteractivePage } from './browser-observation-probe.js';

const SCRIPTING_CAPABILITIES = Object.freeze({
  mainDocument: true,
  openShadowDom: false,
  sameOriginFrames: false,
  crossOriginFrames: false,
  closedShadowDom: false,
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
  const [results, zoomFactor] = await Promise.all([
    chromeApi.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: inspectVisibleInteractivePage,
      args: [options]
    }),
    chromeApi.tabs.getZoom(tabId)
  ]);
  const first = results?.[0];
  if (!first?.result) {
    throw new Error('Scripting observation returned no page result');
  }
  return {
    ...first.result,
    documentToken: first.documentId || first.result.documentToken || '',
    viewport: {
      ...first.result.viewport,
      zoomFactor
    }
  };
}

async function assertActiveTarget(chromeApi, tab) {
  const [activeTab] = await chromeApi.tabs.query({ active: true, windowId: tab.windowId });
  if (activeTab?.id !== tab.id) {
    throw new Error('Target tab is no longer the active tab in its window');
  }
}
