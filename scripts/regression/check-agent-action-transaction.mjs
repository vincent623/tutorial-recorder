import assert from 'node:assert/strict';

import {
  createAgentActionTransaction,
  evaluateExplicitGoalCompletion
} from '../../background/agent-action-transaction.js';
import { evaluateAgentActionPolicy } from '../../background/agent-policy.js';
import { isRepeatedAgentAction } from '../../background/agent-repeat-policy.js';
import { performExecuteAiAgentAction } from '../../background/agent-action-executor.js';
import { S } from '../../background/runtime-state.js';

function verifiedTarget(overrides = {}) {
  return {
    status: 'verified',
    target: {
      ref: 'observation-1:element:1',
      role: 'textbox',
      name: '搜索',
      context: '站点搜索',
      rect: { x: 20, y: 40, width: 300, height: 36 },
      center: { x: 170, y: 58 },
      targetType: 'search',
      targetRole: 'searchbox',
      targetHref: '',
      targetFormAction: 'https://example.test/search',
      targetFormMethod: 'get',
      ...overrides
    },
    receipt: { verification: 'verified' }
  };
}

function createHarness({ verificationResults, approvalDecision = 'approved', dispatchResult = null } = {}) {
  const remainingVerifications = [...(verificationResults || [verifiedTarget(), verifiedTarget()])];
  const executed = [];
  const observedExecuted = [];
  const approvals = [];
  const transaction = createAgentActionTransaction({
    verifyObservation: async () => remainingVerifications.shift() || verifiedTarget(),
    evaluatePolicy: evaluateAgentActionPolicy,
    requestApproval: async (request) => {
      approvals.push(request);
      return approvalDecision;
    },
    enrichLegacyAction: async (action) => action,
    revalidateLegacyAction: async (action) => ({ fresh: true, action }),
    executeAction: async (action, context) => {
      executed.push({ action, context });
    },
    dispatchObservedAction: async ({ tabId, action }) => {
      observedExecuted.push({ tabId, action });
      return dispatchResult || {
        status: 'executed',
        target: {
          ...verifiedTarget().target,
          rect: { x: 21, y: 41, width: 300, height: 36 },
          center: { x: 171, y: 59 }
        }
      };
    }
  });
  return { transaction, executed, observedExecuted, approvals };
}

const search = createHarness();
const searchAuthorization = await search.transaction.authorize({
  tabId: 7,
  action: {
    action: 'type_text',
    observationId: 'observation-1',
    elementRef: 'observation-1:element:1',
    text: 'browser agent',
    submit: false,
    description: '搜索 browser agent'
  },
  goal: '输入 browser agent 并立即执行搜索',
  currentUrl: 'https://example.test/',
  screenshot: { id: 'shot-1', pageContext: { url: 'https://example.test/' } }
});
assert.equal(searchAuthorization.outcome, 'ready');
assert.equal(searchAuthorization.action.coordinateSource, 'observation-reference');
assert.equal(searchAuthorization.action.targetText, '搜索');
assert.equal(searchAuthorization.action.policyAuthorization, 'get-search-fill-submit');
assert.equal(searchAuthorization.action.submit, true);
assert.equal(searchAuthorization.action.intentAuthorization, 'explicit-get-search-goal');
assert.equal(search.approvals.length, 0);
const searchExecution = await search.transaction.execute(searchAuthorization.ticket);
assert.equal(searchExecution.outcome, 'executed');
assert.equal(search.executed.length, 0);
assert.equal(search.observedExecuted.length, 1);
assert.equal(search.observedExecuted[0].tabId, 7);
assert.deepEqual(searchExecution.action.x, 171);
assert.deepEqual(searchExecution.action.y, 59);

console.log('ok - a verified GET search field executes without routine confirmation');

const fillOnly = createHarness();
const fillOnlyAuthorization = await fillOnly.transaction.authorize({
  tabId: 7,
  action: {
    action: 'type_text',
    observationId: 'observation-1',
    elementRef: 'observation-1:element:1',
    text: 'draft',
    submit: false,
    description: '只填写搜索词'
  },
  goal: '只输入 draft，不要提交搜索',
  currentUrl: 'https://example.test/',
  screenshot: { id: 'shot-fill-only', pageContext: { url: 'https://example.test/' } }
});
assert.equal(fillOnlyAuthorization.outcome, 'ready');
assert.equal(fillOnlyAuthorization.action.submit, false);

console.log('ok - explicit fill-only intent never gains automatic submission');

assert.equal(evaluateExplicitGoalCompletion({
  action: searchAuthorization.action,
  goal: '演示站点搜索',
  beforeUrl: 'https://example.test/',
  completion: { outcome: 'ready', observation: { page: { url: 'https://example.test/?q=browser+agent' } } }
}).complete, true);
assert.equal(evaluateExplicitGoalCompletion({
  action: searchAuthorization.action,
  goal: '演示站点搜索',
  beforeUrl: 'https://example.test/',
  completion: { outcome: 'retry' }
}).complete, false);
assert.equal(evaluateExplicitGoalCompletion({
  action: searchAuthorization.action,
  goal: '搜索 browser agent，然后打开第一个结果',
  beforeUrl: 'https://example.test/',
  completion: { outcome: 'ready', observation: { page: { url: 'https://example.test/?q=browser+agent' } } }
}).complete, false);

console.log('ok - local completion requires a single-action goal and observed navigation evidence');

const moved = createHarness({
  verificationResults: [
    verifiedTarget(),
    verifiedTarget({
      rect: { x: 400, y: 200, width: 160, height: 40 },
      center: { x: 480, y: 220 }
    })
  ]
});
const movedAuthorization = await moved.transaction.authorize({
  tabId: 7,
  action: {
    action: 'click_element',
    observationId: 'observation-1',
    elementRef: 'observation-1:element:1',
    description: '打开搜索框'
  },
  currentUrl: 'https://example.test/',
  screenshot: { id: 'shot-2', pageContext: { url: 'https://example.test/' } }
});
assert.equal(movedAuthorization.outcome, 'ready');
const movedExecution = await moved.transaction.execute(movedAuthorization.ticket);
assert.equal(movedExecution.outcome, 'executed');
assert.equal(moved.executed.length, 0);
assert.equal(moved.observedExecuted.length, 1);

console.log('ok - element movement updates coordinates without changing target identity');

const stale = createHarness({
  verificationResults: [
    verifiedTarget(),
    {
      status: 'invalid',
      reasonCode: 'observation-target-changed',
      receipt: { verification: 'invalid', reasonCode: 'observation-target-changed' }
    }
  ],
  dispatchResult: {
    status: 'invalid',
    reasonCode: 'observation-target-changed',
    receipt: { verification: 'invalid', reasonCode: 'observation-target-changed' }
  }
});
const staleAuthorization = await stale.transaction.authorize({
  tabId: 7,
  action: {
    action: 'type_text',
    observationId: 'observation-1',
    elementRef: 'observation-1:element:1',
    text: 'must not be typed',
    description: '输入文本'
  },
  currentUrl: 'https://example.test/',
  screenshot: { id: 'shot-3', pageContext: { url: 'https://example.test/' } }
});
assert.equal(staleAuthorization.outcome, 'ready');
const staleExecution = await stale.transaction.execute(staleAuthorization.ticket);
assert.equal(staleExecution.outcome, 'retry');
assert.equal(staleExecution.reasonCode, 'observation-target-changed');
assert.equal(stale.executed.length, 0);
assert.equal(stale.observedExecuted.length, 1);

console.log('ok - a stale element reference is never dispatched');

const riskyTarget = verifiedTarget({
  role: 'button',
  name: '删除项目',
  targetType: 'button',
  targetRole: 'button',
  targetFormAction: 'https://example.test/projects/delete',
  targetFormMethod: 'post'
});
const denied = createHarness({ verificationResults: [riskyTarget], approvalDecision: 'rejected' });
const deniedAuthorization = await denied.transaction.authorize({
  tabId: 7,
  action: {
    action: 'click_element',
    observationId: 'observation-1',
    elementRef: 'observation-1:element:1',
    description: '删除项目'
  },
  currentUrl: 'https://example.test/projects',
  screenshot: { id: 'shot-4', pageContext: { url: 'https://example.test/projects' } }
});
assert.equal(deniedAuthorization.outcome, 'cancelled');
assert.equal(denied.approvals.length, 1);
assert.equal(denied.executed.length, 0);

const approvedPost = createHarness({ verificationResults: [riskyTarget, riskyTarget] });
const approvedPostAuthorization = await approvedPost.transaction.authorize({
  tabId: 7,
  action: {
    action: 'type_text',
    observationId: 'observation-1',
    elementRef: 'observation-1:element:1',
    text: 'confirmed value',
    submit: true,
    description: '填写并提交表单'
  },
  currentUrl: 'https://example.test/projects',
  screenshot: { id: 'shot-approved-post', pageContext: { url: 'https://example.test/projects' } }
});
assert.equal(approvedPostAuthorization.outcome, 'ready');
assert.equal(approvedPost.approvals.length, 1);
assert.equal(approvedPostAuthorization.action.approvalAuthorization, 'submit-capable-input');
assert.equal(approvedPostAuthorization.action.approvalSourceUrl, 'https://example.test/projects');
const approvedPostExecution = await approvedPost.transaction.execute(approvedPostAuthorization.ticket);
assert.equal(approvedPostExecution.outcome, 'executed');
assert.equal(approvedPost.observedExecuted[0].action.approvalAuthorization, 'submit-capable-input');

console.log('ok - an approved non-GET observation action carries one-time dispatch authorization');

const exactNavigation = createHarness();
const exactNavigationAuthorization = await exactNavigation.transaction.authorize({
  tabId: 7,
  action: { action: 'navigate', url: 'https://good.test/path?mode=demo', description: '打开演示页' },
  goal: '请打开 https://good.test/path?mode=demo',
  currentUrl: 'https://example.test/'
});
assert.equal(exactNavigationAuthorization.outcome, 'ready');
assert.equal(exactNavigationAuthorization.action.intentAuthorization, 'explicit-user-navigation');
assert.equal(exactNavigation.approvals.length, 0);

for (const goal of [
  '请打开 https://good.test/redirect?next=https://evil.test',
  '请打开 https://evil.test.example/path'
]) {
  const nestedNavigation = createHarness({ approvalDecision: 'rejected' });
  const nestedAuthorization = await nestedNavigation.transaction.authorize({
    tabId: 7,
    action: { action: 'navigate', url: 'https://evil.test', description: '打开外部页' },
    goal,
    currentUrl: 'https://example.test/'
  });
  assert.equal(nestedAuthorization.outcome, 'cancelled');
  assert.equal(nestedNavigation.approvals[0].policy.code, 'unknown-destination-navigation');
}

console.log('ok - direct navigation requires an exact URL token from the user goal');

const visualFallback = createHarness({ approvalDecision: 'rejected' });
const fallbackAuthorization = await visualFallback.transaction.authorize({
  tabId: 7,
  action: {
    action: 'click_at_xy',
    x: 80,
    y: 90,
    fallbackReason: 'Canvas 自绘控件没有语义元素引用',
    description: '点击画布控件'
  },
  currentUrl: 'https://example.test/canvas',
  screenshot: { id: 'shot-5', pageContext: { url: 'https://example.test/canvas' } }
});
assert.equal(fallbackAuthorization.outcome, 'cancelled');
assert.equal(visualFallback.approvals[0].policy.code, 'coordinate-click');

console.log('ok - high-impact references and visual fallback retain one-time approval');

await assert.rejects(
  () => search.transaction.execute({}),
  /授权票据无效/
);

console.log('ok - execution requires an unforgeable in-memory authorization ticket');

const tamper = createHarness();
const tamperAuthorization = await tamper.transaction.authorize({
  tabId: 7,
  action: { action: 'wait', ms: 300, description: '等待页面' },
  currentUrl: 'https://example.test/'
});
try {
  tamperAuthorization.ticket.action = {
    action: 'navigate',
    url: 'https://evil.example/delete',
    description: '篡改票据'
  };
} catch {}
const tamperExecution = await tamper.transaction.execute(tamperAuthorization.ticket);
assert.equal(tamperExecution.action.action, 'wait');
assert.equal(tamper.executed[0].action.action, 'wait');
assert.deepEqual(tamper.executed[0].context, { tabId: 7 });
await assert.rejects(() => tamper.transaction.execute(tamperAuthorization.ticket), /授权票据无效/);

console.log('ok - issued tickets are immutable, opaque, and single-use');

const originalRuntimeTabId = S.currentRuntime.tabId;
S.currentRuntime.tabId = 8;
await assert.rejects(
  () => performExecuteAiAgentAction({ action: 'wait', ms: 300 }, { tabId: 7 }),
  /标签页不可用/
);
S.currentRuntime.tabId = originalRuntimeTabId;

console.log('ok - every legacy or visual dispatch remains pinned to the authorized tab');

assert.equal(isRepeatedAgentAction({
  action: 'click_at_xy', targetText: '打开', targetContext: '项目 Beta', sourceUrl: 'https://example.test/projects'
}, [{
  action: 'click_at_xy', targetText: '打开', targetContext: '项目 Alpha', sourceUrl: 'https://example.test/projects'
}]), false);
assert.equal(isRepeatedAgentAction({
  action: 'click_at_xy', targetText: '下一页', targetContext: '分页', sourceUrl: 'https://example.test/projects',
  allowRepeat: true, repeatReason: '用户要求继续翻页'
}, [{
  action: 'click_at_xy', targetText: '下一页', targetContext: '分页', sourceUrl: 'https://example.test/projects'
}]), false);

console.log('ok - repeat detection uses semantic context and explicit repeat intent');
