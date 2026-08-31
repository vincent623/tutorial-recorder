import assert from 'node:assert/strict';
import { evaluateAgentActionPolicy } from '../../background/agent-policy.js';
import { isRepeatedAgentAction } from '../../background/agent-repeat-policy.js';

const cases = [
  {
    name: 'pagination button runs without takeover confirmation',
    action: {
      action: 'click_at_xy',
      targetText: '下一页',
      coordinateSource: 'visible-text',
      targetType: 'button',
      targetFormMethod: '',
      targetHref: ''
    },
    context: { currentUrl: 'https://example.com/list' },
    expected: 'allow'
  },
  {
    name: 'GET search submit runs without takeover confirmation',
    action: {
      action: 'click_at_xy',
      targetText: 'Google 搜索',
      coordinateSource: 'visible-text',
      targetType: 'submit',
      targetFormMethod: 'get',
      targetHref: ''
    },
    context: { currentUrl: 'https://www.google.com/' },
    expected: 'allow'
  },
  {
    name: 'exact search field focus runs without takeover confirmation',
    action: {
      action: 'click_at_xy',
      targetText: '搜索',
      coordinateSource: 'visible-text',
      targetType: 'search',
      targetFormMethod: 'get',
      targetHref: ''
    },
    context: { currentUrl: 'https://www.google.com/' },
    expected: 'allow'
  },
  {
    name: 'same-origin result navigation runs without takeover confirmation',
    action: {
      action: 'click_at_xy',
      targetText: '搜索结果详情',
      coordinateSource: 'visible-text',
      targetType: '',
      targetFormMethod: '',
      targetHref: 'https://www.google.com/search?q=tutorial'
    },
    context: { currentUrl: 'https://www.google.com/' },
    expected: 'allow'
  },
  {
    name: 'an exact user-authorized URL runs without takeover confirmation',
    action: {
      action: 'navigate',
      url: 'https://www.google.com/',
      intentAuthorization: 'explicit-user-navigation'
    },
    context: { currentUrl: 'https://example.com/' },
    expected: 'allow'
  },
  {
    name: 'Enter in a GET search box runs without takeover confirmation',
    action: {
      action: 'press_key',
      key: 'enter',
      focusInputType: 'search',
      focusFormMethod: 'get',
      focusLabel: 'q',
      focusPlaceholder: '搜索'
    },
    context: { currentUrl: 'https://www.google.com/' },
    expected: 'allow'
  },
  {
    name: 'GET search field can type and submit in one autonomous action',
    action: {
      action: 'type_text',
      text: '教程自动录制器',
      targetText: '搜索',
      submit: true,
      coordinateSource: 'visible-text',
      targetType: 'search',
      targetFormMethod: 'get'
    },
    context: { currentUrl: 'https://example.com/' },
    expected: 'allow'
  },
  {
    name: 'POST field submit in a composite action still requires confirmation',
    action: {
      action: 'type_text',
      text: '商业资料',
      targetText: '搜索',
      submit: true,
      coordinateSource: 'visible-text',
      targetType: 'text',
      targetFormMethod: 'post'
    },
    context: { currentUrl: 'https://example.com/form' },
    expected: 'confirm'
  },
  {
    name: 'POST submit still requires confirmation',
    action: {
      action: 'click_at_xy',
      targetText: '提交资料',
      coordinateSource: 'visible-text',
      targetType: 'submit',
      targetFormMethod: 'post',
      targetHref: ''
    },
    context: { currentUrl: 'https://example.com/form' },
    expected: 'confirm'
  },
  {
    name: 'ordinary cross-origin result link runs without takeover confirmation',
    action: {
      action: 'click_at_xy',
      targetText: '查看结果',
      coordinateSource: 'visible-text',
      targetHref: 'https://other.example/result'
    },
    context: { currentUrl: 'https://example.com/' },
    expected: 'allow'
  },
  {
    name: 'high-risk URL navigation still requires confirmation',
    action: { action: 'navigate', url: 'https://example.com/logout' },
    context: { currentUrl: 'https://example.com/' },
    expected: 'confirm'
  },
  {
    name: 'unknown mutation button still requires confirmation',
    action: {
      action: 'click_at_xy',
      targetText: '执行操作',
      coordinateSource: 'visible-text',
      targetType: 'button',
      targetFormMethod: '',
      targetHref: ''
    },
    context: { currentUrl: 'https://example.com/' },
    expected: 'confirm'
  }
];

let failed = 0;
for (const testCase of cases) {
  const policy = evaluateAgentActionPolicy(testCase.action, testCase.context);
  const pass = policy.decision === testCase.expected;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${testCase.name}: ${policy.decision} (${policy.code})`);
  if (!pass) failed += 1;
}

assert.equal(failed, 0, `${failed} autonomy usability checks failed`);
assert.equal(
  isRepeatedAgentAction(
    { action: 'type_text', targetText: '搜索教程', submit: true },
    [{ action: 'type_text', targetText: '搜索教程', submit: true }]
  ),
  true,
  'repeated composite field submit must be blocked'
);
assert.equal(
  isRepeatedAgentAction(
    { action: 'click_at_xy', targetText: '搜索教程' },
    [
      { action: 'click_at_xy', targetText: '搜索教程' },
      { action: 'type_text', targetText: '搜索教程' }
    ]
  ),
  true,
  'a non-consecutive repeated target action must still be blocked'
);
