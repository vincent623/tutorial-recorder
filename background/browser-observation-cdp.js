import { inspectVisibleInteractivePage } from './browser-observation-probe.js';

const CDP_CAPABILITIES = Object.freeze({
  mainDocument: true,
  openShadowDom: false,
  sameOriginFrames: false,
  crossOriginFrames: false,
  closedShadowDom: false,
  selfDrawnSurfaces: false
});

export function createCdpObservationAdapter() {
  return Object.freeze({
    kind: 'cdp',
    capabilities: CDP_CAPABILITIES,
    capture,
    inspect
  });
}

async function capture(tab) {
  const result = await chrome.debugger.sendCommand(
    { tabId: tab.id },
    'Page.captureScreenshot',
    { format: 'png', fromSurface: true }
  );
  if (!result?.data) {
    throw new Error('CDP observation returned no screenshot data');
  }
  return `data:image/png;base64,${result.data}`;
}

async function inspect(tabId, options) {
  const [evaluation, zoomFactor] = await Promise.all([
    chrome.debugger.sendCommand(
      { tabId },
      'Runtime.evaluate',
      {
        expression: `(${inspectVisibleInteractivePage.toString()})(${JSON.stringify(options || {})})`,
        returnByValue: true,
        awaitPromise: true
      }
    ),
    chrome.tabs.getZoom(tabId)
  ]);
  if (evaluation?.exceptionDetails || !evaluation?.result?.value) {
    throw new Error('CDP observation returned no page result');
  }
  return {
    ...evaluation.result.value,
    viewport: {
      ...evaluation.result.value.viewport,
      zoomFactor
    }
  };
}
