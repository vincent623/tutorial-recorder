import { requestObservationAgentDecision } from './agent-observation-decision.js';
import { observeBrowserPage, projectBrowserObservation, refineBrowserObservation } from './browser-observation.js';
import { recordScreenshotDataUrl } from './screenshot-engine.js';

export const OBSERVATION_DECISION_RETRY_LIMIT = 1;

const defaultCycle = createObservationAgentCycle({
  observe: observeBrowserPage,
  refine: refineBrowserObservation,
  project: projectBrowserObservation,
  recordScreenshot: recordScreenshotDataUrl,
  requestDecision: requestObservationAgentDecision
});

export function runObservationAgentCycle(input) {
  return defaultCycle.run(input);
}

export function createObservationAgentCycle({
  observe,
  refine,
  project,
  recordScreenshot,
  requestDecision
}) {
  return Object.freeze({ run, captureCompletion });

  async function run({
    tabId,
    goal = '',
    stepIndex = 1,
    maxSteps = 1,
    completedSteps = []
  } = {}) {
    let observed = await observe({ tabId });
    if (observed?.status !== 'ready' && observed?.status !== 'degraded') {
      return unavailableOutcome(observed);
    }
    for (let refinementDepth = 0; refinementDepth <= 2; refinementDepth += 1) {
      const observation = observed.observation;
      const remoteObservation = await project({
        tabId,
        observationId: observation.id,
        aiDataSharingConsent: true
      });
      if (remoteObservation?.status !== 'ready') return unavailableOutcome(remoteObservation);
      const action = await requestDecisionWithRetry(remoteObservation, {
        targetDescription: goal,
        stepIndex,
        maxSteps,
        completedSteps
      });
      if (action.action === 'refine_observation') {
        if (observation.truncated !== true || refinementDepth >= 2) {
          return unavailableOutcome({ reasonCode: 'refinement-limit-reached' });
        }
        observed = await refine({
          tabId,
          observationId: observation.id,
          region: action.region || null,
          role: action.role || '',
          maxElements: 120
        });
        if (observed?.status !== 'ready' && observed?.status !== 'degraded') {
          return unavailableOutcome(observed);
        }
        continue;
      }
      if (observation.truncated === true && action.action === 'click_at_xy') {
        if (refinementDepth >= 2) {
          return unavailableOutcome({ reasonCode: 'refinement-limit-reached' });
        }
        observed = await refine({
          tabId,
          observationId: observation.id,
          region: null,
          role: '',
          maxElements: 120
        });
        if (observed?.status !== 'ready' && observed?.status !== 'degraded') {
          return unavailableOutcome(observed);
        }
        continue;
      }
      const capture = await recordObservationScreenshot(observation);
      return {
        outcome: 'ready',
        action,
        screenshot: capture.screenshot,
        observation: summarizeObservation(observed)
      };
    }
    return unavailableOutcome({ reasonCode: 'refinement-limit-reached' });
  }

  async function captureCompletion({ tabId } = {}) {
    const observed = await observe({ tabId });
    if (observed?.status !== 'ready' && observed?.status !== 'degraded') {
      return unavailableOutcome(observed);
    }
    const observation = observed.observation;
    const capture = await recordScreenshot({
      dataUrl: observation.cleanScreenshot.data,
      tab: {
        id: observation.target.tabId,
        windowId: observation.target.windowId,
        url: observation.page.url,
        title: observation.page.title
      },
      trigger: 'agent'
    });
    if (!capture?.captured || !capture.screenshot) {
      return retryOutcome({ reasonCode: 'completion-screenshot-failed' });
    }
    return {
      outcome: 'ready',
      screenshot: capture.screenshot,
      observation: {
        id: observation.id,
        status: observed.status,
        receipt: observation.receipt,
        page: { ...observation.page }
      }
    };
  }

  async function recordObservationScreenshot(observation) {
    const capture = await recordScreenshot({
      dataUrl: observation.cleanScreenshot.data,
      tab: {
        id: observation.target.tabId,
        windowId: observation.target.windowId,
        url: observation.page.url,
        title: observation.page.title
      },
      trigger: 'agent'
    });
    if (!capture?.captured || !capture.screenshot) {
      throw new Error('AI 录制无法保存当前页面截图');
    }
    return capture;
  }

  async function requestDecisionWithRetry(remoteObservation, options) {
    let lastError = null;
    for (let attempt = 0; attempt <= OBSERVATION_DECISION_RETRY_LIMIT; attempt += 1) {
      try {
        return await requestDecision(remoteObservation, options);
      } catch (error) {
        lastError = error;
        if (attempt >= OBSERVATION_DECISION_RETRY_LIMIT) break;
      }
    }
    throw lastError || new Error('AI 决策失败');
  }
}

export function captureAgentCompletionObservation(input) {
  return defaultCycle.captureCompletion(input);
}

function unavailableOutcome(result = {}) {
  return {
    outcome: 'unavailable',
    reasonCode: result.reasonCode || 'browser-observation-unavailable',
    reason: describeObservationFailure(result.reasonCode),
    receipt: result.receipt || null
  };
}

function summarizeObservation(observed) {
  const observation = observed.observation;
  return {
    id: observation.id,
    status: observed.status,
    receipt: observation.receipt,
    page: { ...observation.page }
  };
}

function describeObservationFailure(reasonCode) {
  if (reasonCode === 'ai-data-sharing-consent-required') {
    return 'AI 页面数据发送授权已关闭，无法继续自动录制。';
  }
  if (reasonCode === 'target-tab-unavailable') {
    return '目标页面当前不可录制，请切回普通网页后重试。';
  }
  if (reasonCode === 'page-changed-during-observation') {
    return '页面仍在变化，正在重新观察。';
  }
  return '当前页面观察暂不可用，正在重试。';
}
