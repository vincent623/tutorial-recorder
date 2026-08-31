import { inspectVisibleInteractivePage } from './browser-observation-probe.js';
import { installBrowserObservationProbeHelpers } from './browser-observation-probe-helpers.js';

const CDP_CAPABILITIES = Object.freeze({
  mainDocument: true,
  openShadowDom: true,
  sameOriginFrames: true,
  crossOriginFrames: false,
  closedShadowDom: false,
  transformedFrames: false,
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
        expression: `(() => {
          const helpers = (${installBrowserObservationProbeHelpers.toString()})(false);
          return (${inspectVisibleInteractivePage.toString()})(${JSON.stringify(options || {})}, helpers);
        })()`,
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
