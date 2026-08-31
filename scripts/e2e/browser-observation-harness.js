import {
  dispatchBrowserObservationAction,
  observeBrowserPage,
  projectBrowserObservation,
  refineBrowserObservation,
  verifyBrowserObservation
} from '../../background/browser-observation.js';
import {
  requestObservationAgentDecision
} from '../../background/agent-observation-decision.js';
import { S } from '../../background/runtime-state.js';
import { saveSettings } from '../../background/settings-service.js';

globalThis.configureBrowserObservationSettings = async function configureBrowserObservationSettings(settings) {
  const saved = await saveSettings(settings || {});
  return {
    aiDataSharingConsent: saved.aiDataSharingConsent === true,
    apiKeyConfigured: Boolean(saved.apiKey),
    modelId: saved.modelId || ''
  };
};

globalThis.runBrowserObservationAction = async function runBrowserObservationAction(
  tabId,
  useCdp,
  observationId,
  elementRef,
  action
) {
  let attachedHere = false;
  try {
    S.currentRuntime.tabId = tabId;
    S.currentRuntime.cdpAttached = false;
    if (useCdp) {
      await chrome.debugger.attach({ tabId }, '1.3');
      attachedHere = true;
      S.currentRuntime.cdpAttached = true;
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    }
    return await dispatchBrowserObservationAction({
      tabId,
      observationId,
      elementRef,
      action
    });
  } finally {
    if (attachedHere) await chrome.debugger.detach({ tabId }).catch(() => {});
    S.currentRuntime.cdpAttached = false;
  }
};

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

    const legacyTarget = await resolveHistoricalTextFixture(tabId, '搜索教程');
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
      observationId: observation?.id || '',
      adapter: observation?.adapter || result.receipt?.adapter || '',
      capabilities: observation?.capabilities || {},
      elementCount: observation?.elements?.length || 0,
      elementNames: (observation?.elements || []).map((element) => element.name),
      elementSummaries: (observation?.elements || []).map((element) => ({
        ref: element.ref,
        role: element.role,
        name: element.name,
        context: element.context,
        rect: element.rect
      })),
      hasForbiddenElementField: (observation?.elements || []).some((element) =>
        ['value', 'fingerprint', 'targetHref', 'targetFormAction'].some((field) => field in element)
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

globalThis.runBrowserObservationRefinement = async function runBrowserObservationRefinement(
  tabId,
  useCdp,
  observationId,
  options
) {
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
    const result = await refineBrowserObservation({ tabId, observationId, ...options });
    return {
      status: result.status,
      reasonCode: result.reasonCode || '',
      observationId: result.observation?.id || '',
      elementSummaries: (result.observation?.elements || []).map((element) => ({
        ref: element.ref,
        role: element.role,
        name: element.name,
        context: element.context,
        rect: element.rect
      })),
      receipt: result.observation?.receipt || result.receipt || null
    };
  } finally {
    if (attachedHere) await chrome.debugger.detach({ tabId }).catch(() => {});
    S.currentRuntime.cdpAttached = false;
  }
};

globalThis.runBrowserObservationProjection = async function runBrowserObservationProjection(
  tabId,
  observationId,
  aiDataSharingConsent
) {
  const result = await projectBrowserObservation({
    tabId,
    observationId,
    aiDataSharingConsent
  });
  const decisionScreenshot = result.decisionScreenshot?.data || '';
  return {
    status: result.status,
    reasonCode: result.reasonCode || '',
    projection: result.projection || null,
    decisionScreenshot: {
      isPng: /^data:image\/png;base64,/.test(decisionScreenshot),
      length: decisionScreenshot.length
    },
    receipt: result.receipt || null
  };
};

globalThis.runBrowserObservationVerification = async function runBrowserObservationVerification(
  tabId,
  observationId,
  elementRef
) {
  const result = await verifyBrowserObservation({ tabId, observationId, elementRef });
  return {
    status: result.status,
    reasonCode: result.reasonCode || '',
    target: result.target ? {
      ref: result.target.ref,
      role: result.target.role,
      name: result.target.name,
      rect: result.target.rect,
      center: result.target.center
    } : null,
    receipt: result.receipt || null
  };
};

globalThis.runBrowserObservationModelDecision = async function runBrowserObservationModelDecision(
  tabId,
  observationId,
  settings
) {
  const remoteObservation = await projectBrowserObservation({
    tabId,
    observationId,
    aiDataSharingConsent: settings?.aiDataSharingConsent === true
  });
  if (remoteObservation.status !== 'ready') {
    throw new Error(`Remote observation unavailable: ${remoteObservation.reasonCode || 'unknown'}`);
  }
  const action = await requestObservationAgentDecision(remoteObservation, {
    targetDescription: settings?.targetDescription || ''
  });
  const validElementRefs = new Set(remoteObservation.projection.elements.map((element) => element.ref));
  return {
    status: 'ready',
    modelId: settings.modelId,
    action: {
      action: action.action,
      observationId: action.observationId || '',
      elementRef: action.elementRef || '',
      targetText: action.targetText || '',
      description: action.description || '',
      fallbackReason: action.fallbackReason || ''
    },
    observationIdMatches: action.observationId === remoteObservation.projection.observationId,
    elementRefMatches: action.elementRef ? validElementRefs.has(action.elementRef) : false
  };
};

document.documentElement.dataset.ready = 'true';

async function resolveHistoricalTextFixture(tabId, requestedText) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      const target = [...document.querySelectorAll('button, a, input, textarea, [role="button"]')]
        .find((element) => {
          const label = String(
            element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || ''
          ).replace(/\s+/g, ' ').trim();
          return label === text && element.getClientRects().length > 0;
        });
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        matchedText: text
      };
    },
    args: [requestedText]
  });
  return results?.[0]?.result || null;
}
