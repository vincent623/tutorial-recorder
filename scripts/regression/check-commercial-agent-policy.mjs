import assert from 'node:assert/strict';
import { buildAgentApprovalRequest, evaluateAgentActionPolicy } from '../../background/agent-policy.js';

const cases = [
  {
    name: 'exact low-risk button clicks remain automatic',
    action: { action: 'click_at_xy', targetText: '下一步', coordinateSource: 'visible-text' },
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
    name: 'same-origin navigation remains automatic',
    action: { action: 'navigate', url: 'https://example.com/next' },
    context: { currentUrl: 'https://example.com/start' },
    expected: 'allow'
  },
  {
    name: 'cross-origin navigation requires approval',
    action: { action: 'navigate', url: 'https://accounts.example.net/login' },
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
