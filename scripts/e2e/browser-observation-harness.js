import { observeBrowserPage } from '../../background/browser-observation.js';
import { resolveAgentTargetCenter } from '../../background/agent-targeting.js';
import { resolveCompatibleTextTarget } from '../../background/page-automation.js';
import { S } from '../../background/runtime-state.js';

globalThis.runBrowserObservation = async function runBrowserObservation(tabId, useCdp) {
  let attachedHere = false;
  try {
    S.currentRuntime.tabId = tabId;
    S.currentRuntime.cdpAttached = false;
    if (useCdp) {
      await chrome.debugger.attach({ tabId }, '1.3');
      attachedHere = true;
      S.currentRuntime.cdpAttached = true;
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    }

    const legacyTarget = useCdp
      ? await resolveAgentTargetCenter('搜索教程')
      : await resolveCompatibleTextTarget('搜索教程', tabId);
    const result = await observeBrowserPage({ tabId, maxElements: 60 });
    const observation = result.observation || null;
    const observedTarget = observation?.elements?.find((element) => element.name === '搜索教程');
    const observedCenter = observedTarget
      ? {
          x: Math.round(observedTarget.rect.x + observedTarget.rect.width / 2),
          y: Math.round(observedTarget.rect.y + observedTarget.rect.height / 2)
        }
      : null;
    return {
      status: result.status,
      reasonCode: result.reasonCode || '',
      adapter: observation?.adapter || result.receipt?.adapter || '',
      capabilities: observation?.capabilities || {},
      elementCount: observation?.elements?.length || 0,
      elementNames: (observation?.elements || []).map((element) => element.name),
      hasForbiddenElementField: (observation?.elements || []).some((element) =>
        ['value', 'fingerprint', 'targetHref'].some((field) => field in element)
      ),
      shadowComparison: {
        legacyMatchedText: legacyTarget?.matchedText || '',
        equivalentTarget: Boolean(
          legacyTarget &&
          observedCenter &&
          legacyTarget.x === observedCenter.x &&
          legacyTarget.y === observedCenter.y
        )
      },
      hasScreenshot: /^data:image\/png;base64,/.test(observation?.cleanScreenshot?.data || ''),
      truncated: observation?.truncated === true,
      receipt: observation?.receipt || result.receipt || null
    };
  } finally {
    if (attachedHere) {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
    S.currentRuntime.cdpAttached = false;
  }
};

document.documentElement.dataset.ready = 'true';
