import { requestAiAgentApproval, revalidateApprovedAgentAction } from './agent-approval.js';
import { executeAiAgentAction } from './agent-action-dispatch.js';
import { enrichAgentActionGuard } from './agent-action-guard.js';
import { evaluateAgentActionPolicy } from './agent-policy.js';
import { isRepeatedAgentAction } from './agent-repeat-policy.js';
import { dispatchBrowserObservationAction, verifyBrowserObservation } from './browser-observation.js';

const OBSERVATION_ACTIONS = new Set(['click_element', 'hover_element', 'type_text']);

const defaultTransaction = createAgentActionTransaction({
  verifyObservation: verifyBrowserObservation,
  evaluatePolicy: evaluateAgentActionPolicy,
  requestApproval: requestAiAgentApproval,
  enrichLegacyAction: enrichAgentActionGuard,
  revalidateLegacyAction: revalidateApprovedAgentAction,
  executeAction: executeAiAgentAction,
  dispatchObservedAction: dispatchBrowserObservationAction,
  isRepeatedAction: isRepeatedAgentAction
});

export function authorizeAgentAction(input) {
  return defaultTransaction.authorize(input);
}

export function executeAuthorizedAgentAction(ticket) {
  return defaultTransaction.execute(ticket);
}

export function createAgentActionTransaction({
  verifyObservation,
  evaluatePolicy,
  requestApproval,
  enrichLegacyAction,
  revalidateLegacyAction,
  executeAction,
  dispatchObservedAction,
  isRepeatedAction = () => false
}) {
  const issuedTickets = new WeakMap();

  return Object.freeze({ authorize, execute });

  async function authorize({
    tabId,
    action,
    goal = '',
    currentUrl = '',
    screenshot = null,
    previousSteps = []
  } = {}) {
    const prepared = await prepareAction({ tabId, action });
    if (prepared.outcome !== 'ready') return prepared;

    let authorizedAction = applyExplicitGoalConstraints(
      { ...prepared.action, sourceUrl: String(currentUrl || '') },
      goal
    );
    if (!prepared.observationBound) {
      authorizedAction = await enrichLegacyAction(authorizedAction);
    }

    if (isRepeatedAction(authorizedAction, previousSteps)) {
      return retryOutcome(
        'repeated-action',
        `已阻止重复操作“${authorizedAction.targetText || authorizedAction.action || '当前目标'}”，正在重新观察。`
      );
    }

    const policy = evaluatePolicy(authorizedAction, { currentUrl });
    if (policy.decision === 'block') {
      return retryOutcome(policy.code, policy.reason, policy);
    }

    if (policy.decision === 'confirm') {
      const decision = await requestApproval({
        action: authorizedAction,
        screenshotId: screenshot?.id || '',
        description: authorizedAction.description || '',
        policy
      });
      if (decision !== 'approved') {
        return { outcome: 'cancelled', action: authorizedAction, policy };
      }

      if (prepared.observationBound) {
        const fresh = await prepareObservedAction({ tabId, action: authorizedAction });
        if (fresh.outcome !== 'ready') return fresh;
        authorizedAction = {
          ...fresh.action,
          approvalAuthorization: policy.code,
          approvalSourceUrl: String(currentUrl || '')
        };
      } else {
        const freshness = await revalidateLegacyAction(authorizedAction, screenshot);
        if (!freshness.fresh) {
          return retryOutcome('expired-approval', freshness.reason, policy);
        }
        authorizedAction = freshness.action;
      }
    } else {
      authorizedAction = { ...authorizedAction, policyAuthorization: policy.code };
    }

    const ticket = Object.freeze({ kind: 'agent-action-ticket' });
    issuedTickets.set(ticket, Object.freeze({
      tabId,
      action: Object.freeze({ ...authorizedAction }),
      observationBound: prepared.observationBound,
      policy,
      verification: prepared.verification || null
    }));
    return {
      outcome: 'ready',
      action: authorizedAction,
      policy,
      verification: prepared.verification || null,
      ticket
    };
  }

  async function execute(ticket) {
    const issued = ticket && issuedTickets.get(ticket);
    if (!issued) {
      throw new Error('AI 动作授权票据无效或已使用');
    }
    issuedTickets.delete(ticket);

    let action = issued.action;
    if (issued.observationBound) {
      const dispatched = await dispatchObservedAction({
        tabId: issued.tabId,
        observationId: action.observationId,
        elementRef: action.elementRef,
        action
      });
      if (dispatched?.status !== 'executed') {
        return retryOutcome(
          dispatched?.reasonCode || 'observation-verification-failed',
          describeVerificationFailure(dispatched),
          issued.policy,
          dispatched?.receipt || null
        );
      }
      action = mapObservedAction(action, dispatched.target);
    } else {
      await executeAction(action, { tabId: issued.tabId });
    }

    return { outcome: 'executed', action, policy: issued.policy };
  }

  async function prepareAction({ tabId, action = {} }) {
    if (OBSERVATION_ACTIONS.has(action.action)) {
      return prepareObservedAction({ tabId, action });
    }
    if (action.action === 'click_at_xy') {
      return {
        outcome: 'ready',
        observationBound: false,
        action: { ...action, coordinateSource: 'visual-fallback' }
      };
    }
    return { outcome: 'ready', observationBound: false, action };
  }

  async function prepareObservedAction({ tabId, action }) {
    const verification = await verifyObservation({
      tabId,
      observationId: action.observationId,
      elementRef: action.elementRef
    });
    if (verification?.status !== 'verified' && verification?.status !== 'moved') {
      return retryOutcome(
        verification?.reasonCode || 'observation-verification-failed',
        describeVerificationFailure(verification),
        null,
        verification?.receipt || null
      );
    }

    return {
      outcome: 'ready',
      observationBound: true,
      verification: verification.receipt || null,
      action: mapObservedAction(action, verification.target)
    };
  }
}

export function applyExplicitGoalConstraints(action = {}, goal = '') {
  const normalizedGoal = String(goal || '').replace(/\s+/g, ' ').trim();
  const requestsSearch = /(?:搜索|查询|查找|检索|执行搜索|执行查询|search|query|look\s*up|find)/i.test(normalizedGoal);
  const forbidsSubmit = /(?:不要|无需|不需要|禁止)(?:立即)?(?:搜索|查询|提交|执行)|(?:仅|只)(?:需|需要)?输入|do\s+not\s+(?:submit|search)|without\s+submitt/i.test(normalizedGoal);
  const targetLooksLikeSearch = /(?:搜索|查询|查找|检索|search|query|find)/i.test(action.targetText || '');
  const safeSearchInput =
    action.action === 'type_text' &&
    action.coordinateSource === 'observation-reference' &&
    ['search', 'text', 'url'].includes(String(action.targetType || '').toLowerCase()) &&
    String(action.targetFormMethod || '').toLowerCase() === 'get' &&
    targetLooksLikeSearch;
  if (safeSearchInput && requestsSearch && !forbidsSubmit) {
    return { ...action, submit: true, intentAuthorization: 'explicit-get-search-goal' };
  }
  if (action.action === 'navigate' && goalExplicitlyNamesUrl(normalizedGoal, action.url)) {
    return { ...action, intentAuthorization: 'explicit-user-navigation' };
  }
  return action;
}

function goalExplicitlyNamesUrl(goal, actionUrl) {
  const target = normalizeGoalUrl(actionUrl);
  if (!target) return false;
  const candidates = String(goal || '').match(/https?:\/\/[^\s<>"'，。；、）)\]}]+/gi) || [];
  return candidates.some((candidate) => normalizeGoalUrl(candidate) === target);
}

function normalizeGoalUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    parsed.hash = '';
    return parsed.href;
  } catch (error) {
    return '';
  }
}

export function evaluateExplicitGoalCompletion({
  action = {},
  goal = '',
  beforeUrl = '',
  completion = null
} = {}) {
  if (
    action.action !== 'type_text' ||
    action.submit !== true ||
    action.intentAuthorization !== 'explicit-get-search-goal'
  ) {
    return { complete: false, reasonCode: 'no-local-completion-contract' };
  }
  const normalizedGoal = String(goal || '').replace(/\s+/g, ' ').trim();
  const requestsFollowUp = /(?:然后|随后|接着|再|并且?|and\s+then|then).{0,80}(?:打开|点击|选择|下载|保存|填写|open|click|select|download|save|fill)/i.test(normalizedGoal);
  if (requestsFollowUp) return { complete: false, reasonCode: 'goal-has-follow-up' };
  if (completion?.outcome !== 'ready') {
    return { complete: false, reasonCode: 'completion-observation-unavailable' };
  }
  const afterUrl = String(completion.observation?.page?.url || '');
  if (!beforeUrl || !afterUrl || afterUrl === beforeUrl) {
    return { complete: false, reasonCode: 'completion-effect-unverified' };
  }
  return { complete: true, reasonCode: 'observed-navigation-effect' };
}

function mapObservedAction(action, target) {
  const base = {
    ...action,
    x: target.center.x,
    y: target.center.y,
    targetText: target.name || action.targetText || '',
    targetContext: target.context || action.targetContext || '',
    matchedText: target.name || '',
    targetType: target.targetType || '',
    targetRole: target.targetRole || target.role || '',
    targetHref: target.targetHref || '',
    targetFormAction: target.targetFormAction || '',
    targetFormMethod: target.targetFormMethod || '',
    coordinateSource: 'observation-reference'
  };
  if (action.action === 'click_element') return { ...base, action: 'click_at_xy' };
  if (action.action === 'hover_element') return { ...base, action: 'hover' };
  return base;
}

function retryOutcome(reasonCode, reason, policy = null, verification = null) {
  return {
    outcome: 'retry',
    reasonCode,
    reason,
    ...(policy ? { policy } : {}),
    ...(verification ? { verification } : {})
  };
}

function describeVerificationFailure(verification) {
  if (verification?.reasonCode === 'observation-expired') {
    return '页面观察已过期，正在重新观察。';
  }
  if (verification?.reasonCode === 'observation-page-changed') {
    return '页面在动作执行前发生变化，正在重新观察。';
  }
  if (verification?.reasonCode === 'observation-target-changed') {
    return '目标控件在动作执行前发生变化，正在重新观察。';
  }
  return '无法复验当前目标，正在重新观察。';
}
