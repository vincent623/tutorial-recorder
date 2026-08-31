import assert from 'node:assert/strict';

import { createObservationAgentCycle } from '../../background/agent-observation-cycle.js';

const observed = {
  status: 'ready',
  observation: {
    id: 'observation-9',
    target: { tabId: 9, windowId: 3 },
    page: { url: 'https://example.test/app', title: 'App' },
    cleanScreenshot: { data: 'data:image/png;base64,CLEAN' },
    receipt: { status: 'ready', adapter: 'scripting' }
  }
};
const projected = {
  status: 'ready',
  projection: { observationId: 'observation-9', elements: [] },
  decisionScreenshot: { data: 'data:image/png;base64,NUMBERED' },
  receipt: { status: 'ready', adapter: 'scripting' }
};

let recordedScreenshot = null;
let decisionInput = null;
const cycle = createObservationAgentCycle({
  observe: async () => observed,
  refine: async () => { throw new Error('refine not expected'); },
  project: async () => projected,
  recordScreenshot: async (input) => {
    recordedScreenshot = input;
    return {
      ok: true,
      captured: true,
      screenshot: {
        id: 'shot-observation-9',
        data: input.dataUrl,
        pageContext: { url: input.tab.url, title: input.tab.title }
      }
    };
  },
  requestDecision: async (remoteObservation, options) => {
    decisionInput = { remoteObservation, options };
    return {
      action: 'finish',
      description: '任务完成'
    };
  }
});

const result = await cycle.run({
  tabId: 9,
  goal: '演示站点搜索',
  stepIndex: 2,
  maxSteps: 20,
  completedSteps: ['输入关键词']
});
assert.equal(result.outcome, 'ready');
assert.equal(result.screenshot.data, observed.observation.cleanScreenshot.data);
assert.equal(recordedScreenshot.dataUrl, observed.observation.cleanScreenshot.data);
assert.deepEqual(recordedScreenshot.tab, {
  id: 9,
  windowId: 3,
  url: 'https://example.test/app',
  title: 'App'
});
assert.equal(decisionInput.remoteObservation, projected);
assert.deepEqual(decisionInput.options, {
  targetDescription: '演示站点搜索',
  stepIndex: 2,
  maxSteps: 20,
  completedSteps: ['输入关键词']
});

console.log('ok - the tutorial screenshot and model observation share one clean capture');

decisionInput = null;
const completion = await cycle.captureCompletion({ tabId: 9 });
assert.equal(completion.outcome, 'ready');
assert.equal(completion.screenshot.data, observed.observation.cleanScreenshot.data);
assert.equal(decisionInput, null);

console.log('ok - a local completion capture never sends another model request');

let unavailableDecisionRequested = false;
const unavailableCycle = createObservationAgentCycle({
  observe: async () => ({
    status: 'unavailable',
    reasonCode: 'page-changed-during-observation',
    receipt: { status: 'unavailable' }
  }),
  project: async () => {
    throw new Error('projection must not run');
  },
  recordScreenshot: async () => {
    throw new Error('recording must not run');
  },
  requestDecision: async () => {
    unavailableDecisionRequested = true;
  },
  refine: async () => { throw new Error('refine must not run'); }
});
const unavailable = await unavailableCycle.run({ tabId: 9, goal: '任意任务' });
assert.equal(unavailable.outcome, 'unavailable');
assert.equal(unavailable.reasonCode, 'page-changed-during-observation');
assert.equal(unavailableDecisionRequested, false);

console.log('ok - an incoherent observation is retried before persistence or model access');

let deniedScreenshotRecorded = false;
const deniedProjectionCycle = createObservationAgentCycle({
  observe: async () => observed,
  project: async () => ({
    status: 'unavailable',
    reasonCode: 'ai-data-sharing-consent-required',
    receipt: { status: 'unavailable' }
  }),
  recordScreenshot: async () => {
    deniedScreenshotRecorded = true;
  },
  requestDecision: async () => {
    throw new Error('decision must not run');
  },
  refine: async () => { throw new Error('refine must not run'); }
});
const deniedProjection = await deniedProjectionCycle.run({ tabId: 9, goal: '任意任务' });
assert.equal(deniedProjection.outcome, 'unavailable');
assert.equal(deniedProjection.reasonCode, 'ai-data-sharing-consent-required');
assert.equal(deniedScreenshotRecorded, false);

console.log('ok - revoked data sharing blocks both persistence and remote decision in the cycle');

let refinementCalls = 0;
let refinementDecisionCalls = 0;
let refinementScreenshots = 0;
const refinedObserved = {
  ...observed,
  observation: { ...observed.observation, id: 'observation-10' }
};
const refinementCycle = createObservationAgentCycle({
  observe: async () => ({
    ...observed,
    status: 'degraded',
    observation: { ...observed.observation, truncated: true }
  }),
  refine: async ({ observationId, role }) => {
    refinementCalls += 1;
    assert.equal(observationId, 'observation-9');
    assert.equal(role, 'button');
    return refinedObserved;
  },
  project: async ({ observationId }) => ({
    ...projected,
    projection: { ...projected.projection, observationId }
  }),
  recordScreenshot: async ({ dataUrl }) => {
    refinementScreenshots += 1;
    return { captured: true, screenshot: { id: 'refined-shot', data: dataUrl } };
  },
  requestDecision: async () => {
    refinementDecisionCalls += 1;
    return refinementDecisionCalls === 1
      ? { action: 'refine_observation', role: 'button', description: '细化按钮' }
      : { action: 'click_element', observationId: 'observation-10', elementRef: 'observation-10:element:1', description: '点击目标' };
  }
});
const refinedResult = await refinementCycle.run({ tabId: 9, goal: '找到并点击目标按钮' });
assert.equal(refinedResult.outcome, 'ready');
assert.equal(refinedResult.action.action, 'click_element');
assert.equal(refinementCalls, 1);
assert.equal(refinementDecisionCalls, 2);
assert.equal(refinementScreenshots, 1);

console.log('ok - truncated observations refine before recording or dispatch');

let forcedRefinementCalls = 0;
let forcedDecisionCalls = 0;
const forcedRefinementCycle = createObservationAgentCycle({
  observe: async () => ({
    ...observed,
    status: 'degraded',
    observation: { ...observed.observation, truncated: true }
  }),
  refine: async () => {
    forcedRefinementCalls += 1;
    return refinedObserved;
  },
  project: async ({ observationId }) => ({
    ...projected,
    projection: { ...projected.projection, observationId }
  }),
  recordScreenshot: async () => ({ captured: true, screenshot: { id: 'forced-refinement-shot' } }),
  requestDecision: async () => {
    forcedDecisionCalls += 1;
    return forcedDecisionCalls === 1
      ? { action: 'click_at_xy', x: 10, y: 20, fallbackReason: '目标未出现', description: '坐标兜底' }
      : { action: 'click_element', observationId: 'observation-10', elementRef: 'observation-10:element:1', description: '点击目标' };
  }
});
const forcedRefinedResult = await forcedRefinementCycle.run({ tabId: 9, goal: '找到目标' });
assert.equal(forcedRefinedResult.action.action, 'click_element');
assert.equal(forcedRefinementCalls, 1);
assert.equal(forcedDecisionCalls, 2);

console.log('ok - truncated observations cannot fall through to visual coordinates');
