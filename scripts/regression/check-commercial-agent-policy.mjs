import assert from 'node:assert/strict';
import {
  buildAgentApprovalRequest,
  evaluateAgentActionPolicy,
  evaluateApprovedActionFreshness
} from '../../background/agent-policy.js';
import { readFile } from 'node:fs/promises';

const cases = [
  {
    name: 'exact low-risk button clicks remain automatic',
    action: { action: 'click_at_xy', targetText: '切换到评审面板', coordinateSource: 'visible-text' },
    context: { currentUrl: 'https://example.com/wizard' },
    expected: 'allow'
  },
  {
    name: 'destructive Chinese actions require one-time approval',
    action: { action: 'click_at_xy', targetText: '删除账号', coordinateSource: 'visible-text' },
    context: { currentUrl: 'https://example.com/settings' },
    expected: 'confirm'
  },
  {
    name: 'destructive English actions require one-time approval',
    action: { action: 'click_at_xy', targetText: 'Delete account', coordinateSource: 'visible-text' },
    context: { currentUrl: 'https://example.com/settings' },
    expected: 'confirm'
  },
  {
    name: 'permission grants require one-time approval',
    action: { action: 'click_at_xy', targetText: 'Allow access', coordinateSource: 'visible-text' },
    context: { currentUrl: 'https://example.com/settings' },
    expected: 'confirm'
  },
  {
    name: 'publishing and invitations require one-time approval',
    action: { action: 'click_at_xy', targetText: '保存并公开', coordinateSource: 'visible-text' },
    context: { currentUrl: 'https://example.com/editor' },
    expected: 'confirm'
  },
  {
    name: 'semantic submit controls require one-time approval',
    action: {
      action: 'click_at_xy',
      targetText: 'Continue',
      coordinateSource: 'visible-text',
      targetType: 'submit'
    },
    context: { currentUrl: 'https://example.com/form' },
    expected: 'confirm'
  },
  {
    name: 'unknown business mutations default to confirmation',
    action: { action: 'click_at_xy', targetText: 'Upgrade plan', coordinateSource: 'visible-text' },
    context: { currentUrl: 'https://example.com/billing' },
    expected: 'confirm'
  },
  {
    name: 'ambiguous continue controls default to confirmation',
    action: { action: 'click_at_xy', targetText: '继续', coordinateSource: 'visible-text' },
    context: { currentUrl: 'https://example.com/checkout' },
    expected: 'confirm'
  },
  {
    name: 'coordinate-only clicks require one-time approval',
    action: { action: 'click_at_xy', x: 100, y: 200, coordinateSource: 'vision' },
    context: { currentUrl: 'https://example.com' },
    expected: 'confirm'
  },
  {
    name: 'Enter requires approval because it can submit a form',
    action: { action: 'press_key', key: 'enter' },
    context: { currentUrl: 'https://example.com/checkout' },
    expected: 'confirm'
  },
  {
    name: 'same-origin reversible navigation remains automatic',
    action: { action: 'navigate', url: 'https://example.com/next' },
    context: { currentUrl: 'https://example.com/start' },
    expected: 'allow'
  },
  {
    name: 'cross-origin reversible navigation remains automatic',
    action: { action: 'navigate', url: 'https://accounts.example.net/login' },
    context: { currentUrl: 'https://example.com/start' },
    expected: 'allow'
  },
  {
    name: 'high-risk URL navigation still requires approval',
    action: { action: 'navigate', url: 'https://example.com/logout' },
    context: { currentUrl: 'https://example.com/start' },
    expected: 'confirm'
  },
  {
    name: 'passive observation tools remain automatic',
    action: { action: 'scroll', deltaY: 700 },
    context: { currentUrl: 'https://example.com' },
    expected: 'allow'
  }
];

for (const testCase of cases) {
  const result = evaluateAgentActionPolicy(testCase.action, testCase.context);
  assert.equal(result.decision, testCase.expected, testCase.name);
  assert.ok(result.reason, `${testCase.name} should explain its decision`);
  console.log(`ok - ${testCase.name}`);
}

const approval = buildAgentApprovalRequest({
  action: { action: 'click_at_xy', x: 40, y: 80, targetText: 'Delete account' },
  screenshotId: 'recording-1-shot-2',
  description: '点击 Delete account',
  policy: { code: 'high-impact-click', reason: '可能删除账号' },
  now: 1234
});

assert.deepEqual(approval, {
  id: 'recording-1-shot-2:click_at_xy',
  action: { action: 'click_at_xy', x: 40, y: 80, targetText: 'Delete account' },
  screenshotId: 'recording-1-shot-2',
  description: '点击 Delete account',
  code: 'high-impact-click',
  reason: '可能删除账号',
  decision: 'pending',
  requestedAt: 1234
});
console.log('ok - approval requests persist the exact one-time action and audit reason');

assert.equal(
  evaluateApprovedActionFreshness({
    action: {
      action: 'click_at_xy', x: 20, y: 30, targetText: '删除账号', coordinateSource: 'visible-text', targetFingerprint: 'abc'
    },
    freshAction: {
      action: 'click_at_xy',
      x: 20,
      y: 30,
      targetText: '删除账号',
      matchedText: '删除账号',
      coordinateSource: 'visible-text',
      targetFingerprint: 'abc'
    },
    originalUrl: 'https://example.com/settings',
    currentUrl: 'https://example.com/settings'
  }).fresh,
  true,
  'the same exact visible target remains valid after approval'
);
assert.equal(
  evaluateApprovedActionFreshness({
    action: { action: 'click_at_xy', targetText: '删除账号', coordinateSource: 'visible-text' },
    freshAction: { action: 'click_at_xy', coordinateSource: 'vision' },
    originalUrl: 'https://example.com/settings',
    currentUrl: 'https://example.com/settings'
  }).fresh,
  false,
  'approval expires when the exact target can no longer be located'
);
assert.equal(
  evaluateApprovedActionFreshness({
    action: { action: 'navigate', url: 'https://accounts.example.net' },
    originalUrl: 'https://example.com/settings',
    currentUrl: 'https://example.com/changed'
  }).fresh,
  false,
  'approval expires when the source page changes'
);
assert.equal(
  evaluateApprovedActionFreshness({
    action: { action: 'navigate', url: 'https://accounts.example.net' },
    originalUrl: 'https://example.com/settings',
    currentUrl: 'https://example.com/settings'
  }).fresh,
  true,
  'an unchanged source page keeps an approved fixed navigation fresh'
);
assert.equal(
  evaluateApprovedActionFreshness({
    action: {
      action: 'click_at_xy',
      targetText: 'Continue',
      coordinateSource: 'visible-text',
      targetHref: 'https://example.com/next'
    },
    freshAction: {
      action: 'click_at_xy',
      targetText: 'Continue',
      matchedText: 'Continue',
      coordinateSource: 'visible-text',
      targetHref: 'https://attacker.example/next'
    },
    originalUrl: 'https://example.com/settings',
    currentUrl: 'https://example.com/settings'
  }).fresh,
  false,
  'approval expires when an exact-text target changes its destination'
);
assert.equal(
  evaluateApprovedActionFreshness({
    action: { action: 'click_at_xy', x: 10, y: 20, coordinateSource: 'vision' },
    originalUrl: 'https://example.com/settings',
    currentUrl: 'https://example.com/settings',
    originalImage: 'data:image/png;base64,OLD',
    currentImage: 'data:image/png;base64,NEW'
  }).fresh,
  false,
  'coordinate approval expires when the visible page changes'
);
assert.equal(
  evaluateApprovedActionFreshness({
    action: { action: 'click_at_xy', x: 10, y: 20, coordinateSource: 'vision' },
    originalUrl: 'https://example.com/settings',
    currentUrl: 'https://example.com/settings',
    originalImage: 'data:image/png;base64,SAME',
    currentImage: 'data:image/png;base64,SAME',
    originalPointFingerprint: 'approved-target',
    currentPointFingerprint: 'transparent-overlay'
  }).fresh,
  false,
  'coordinate approval expires when an invisible hit-test overlay replaces the target'
);
assert.equal(
  evaluateApprovedActionFreshness({
    action: { action: 'press_key', key: 'enter' },
    originalUrl: 'https://example.com/search',
    currentUrl: 'https://example.com/search',
    originalImage: 'data:image/png;base64,SAME',
    currentImage: 'data:image/png;base64,SAME',
    originalFocusFingerprint: 'search-field',
    currentFocusFingerprint: 'checkout-submit'
  }).fresh,
  false,
  'Enter approval expires when keyboard focus changes'
);
console.log('ok - one-time approvals expire when the page or approved target changes');

const targetingSource = await readFile(new URL('../../background/agent-targeting.js', import.meta.url), 'utf8');
const executorSource = await readFile(new URL('../../background/agent-action-executor.js', import.meta.url), 'utf8');
const actionGuardSource = await readFile(new URL('../../background/agent-action-guard.js', import.meta.url), 'utf8');
assert.match(targetingSource, /targetFingerprint/, 'calibrated targets must carry a stable opaque fingerprint');
assert.match(targetingSource, /elementFromPoint/, 'target calibration and dispatch validation must use hit testing');
assert.match(executorSource, /assertAgentClickTargetFresh\(action\)/, 'click dispatch must revalidate the target immediately before execution');
assert.match(actionGuardSource, /approvalPageDigest/, 'coordinate and Enter approvals must seal the approved page state');
assert.match(actionGuardSource, /approvalFocusFingerprint/, 'Enter approvals must seal the approved focus target');
assert.match(actionGuardSource, /approvalPointFingerprint/, 'coordinate approvals must seal the elementFromPoint target');
assert.match(actionGuardSource, /approvalSourceUrl/, 'every approved action must seal its exact source URL');
assert.match(executorSource, /assertApprovedActionSourceFresh\(action\)/, 'every approved action must verify its source URL immediately before dispatch');
assert.match(
  executorSource,
  /if \(action\.action === 'click_at_xy'\)[\s\S]*assertApprovedSensitiveActionFresh\(action\)[\s\S]*dispatchCdpClick/,
  'coordinate clicks must verify the approval seal immediately before dispatch'
);
assert.match(
  executorSource,
  /if \(action\.action === 'press_key'\)[\s\S]*assertApprovedSensitiveActionFresh\(action\)[\s\S]*dispatchCdpKey/,
  'Enter must verify page and focus approval seals immediately before dispatch'
);
console.log('ok - approved visible-text clicks preserve target identity through dispatch');
