import { authorizeAgentAction, evaluateExplicitGoalCompletion, executeAuthorizedAgentAction } from './agent-action-transaction.js';
import { appendAiAgentStep, isAiAgentLimitReached, isAiAgentLoopActive, updateAgentScreenshotDescription, updateAiAgentState, waitForAiAgentResume } from './agent-state.js';
import { captureAgentCompletionObservation, runObservationAgentCycle } from './agent-observation-cycle.js';
import { describeAgentAction } from './agent-tools.js';
import { summarizeUrlForPrompt } from './ai-vision.js';
import { notifyContent, notifyPopup } from './notify.js';
import { S, updateBadge } from './runtime-state.js';
import { AI_AGENT_MAX_STEPS } from './settings-schema.js';
import { delay } from './text-utils.js';

export const AI_AGENT_STEP_DELAY_MS = 800;
export const AI_AGENT_PAGE_STABILITY_TIMEOUT_MS = 8_000;
export const AI_AGENT_PAGE_STABILITY_INTERVAL_MS = 400;
export async function pauseAiAgent() {
  if (!S.currentRuntime.isRecording || S.currentRuntime.recordingMode !== 'ai') {
    return;
  }
  if (S.currentRuntime.aiAgent?.pendingApproval?.decision === 'pending') {
    throw new Error('当前有待确认的 AI 动作，请先允许一次或拒绝并接管');
  }

  if (!S.currentRuntime.isPaused) {
    S.currentRuntime.isPaused = true;
    S.currentRuntime.pauseStartedAt = Date.now();
  }
  await updateAiAgentState({
    status: 'paused',
    paused: true,
    message: 'AI 已暂停，等待继续或接管。'
  });
  await updateBadge();
  notifyPopup('paused');
  notifyContent('recordingPaused');
}

export async function resumeAiAgent() {
  if (!S.currentRuntime.isRecording || S.currentRuntime.recordingMode !== 'ai') {
    return;
  }
  if (S.currentRuntime.aiAgent?.status === 'failed') {
    throw new Error('AI 已失败，请接管操作或停止导出');
  }

  if (S.currentRuntime.aiAgent?.pendingApproval?.decision === 'pending') {
    throw new Error('不能用“继续 AI”绕过待确认动作');
  }

  if (S.currentRuntime.pauseStartedAt) {
    S.currentRuntime.pausedDurationMs += Date.now() - S.currentRuntime.pauseStartedAt;
  }

  S.currentRuntime.isPaused = false;
  S.currentRuntime.pauseStartedAt = null;
  await updateAiAgentState({
    status: 'running',
    paused: false,
    awaitingTakeover: false,
    pendingApproval: null,
    message: 'AI 正在继续执行...'
  });
  await updateBadge();
  notifyPopup('resumed');
  notifyContent('recordingResumed');
}

export function runAiAgentLoop(initialSettings, requestStop) {
  if (S.aiAgentLoopPromise) {
    return S.aiAgentLoopPromise;
  }

  const loopPromise = performRunAiAgentLoop(initialSettings, requestStop).finally(() => {
    if (S.aiAgentLoopPromise === loopPromise) {
      S.aiAgentLoopPromise = null;
    }
  });
  S.aiAgentLoopPromise = loopPromise;
  return loopPromise;
}
async function performRunAiAgentLoop(_initialSettings, requestStop) {
  while (isAiAgentLoopActive()) {
    await waitForAiAgentResume();
    if (!isAiAgentLoopActive()) {
      return;
    }

    if (isAiAgentLimitReached()) {
      await updateAiAgentState({
        status: 'limit',
        message: '已达到 AI 录制上限，正在保留已完成步骤并导出。'
      });
      await requestStop?.();
      return;
    }

    await updateAiAgentState({
      status: 'running',
      message: `正在执行第 ${S.currentRuntime.aiAgent.iteration + 1} 步...`
    });

    const cycle = await runObservationAgentCycle({
      tabId: S.currentRuntime.tabId,
      goal: S.currentRuntime.aiAgent.goal || S.currentRecording?.aiGoal || '完成当前教程任务',
      stepIndex: S.currentRuntime.aiAgent.iteration + 1,
      maxSteps: S.currentRuntime.aiAgent.maxSteps || AI_AGENT_MAX_STEPS,
      completedSteps: S.currentRuntime.aiAgent.steps.slice(-8).map((step) => step.description)
    });
    if (cycle.outcome === 'unavailable') {
      await pauseForUnavailableObservation(cycle);
      continue;
    }

    const screenshot = cycle.screenshot;
    const authorization = await authorizeAgentAction({
      tabId: S.currentRuntime.tabId,
      action: cycle.action,
      goal: S.currentRuntime.aiAgent.goal || S.currentRecording?.aiGoal || '',
      currentUrl: screenshot?.pageContext?.url || '',
      screenshot,
      previousSteps: S.currentRuntime.aiAgent.steps
    });

    if (!isAiAgentLoopActive()) {
      return;
    }

    if (authorization.outcome === 'retry') {
      await updateAiAgentState({
        status: 'retrying',
        iteration: S.currentRuntime.aiAgent.iteration + 1,
        lastAction: authorization.reasonCode,
        message: authorization.reason
      });
      notifyPopup('warning', { message: S.currentRuntime.aiAgent.message });
      await delay(AI_AGENT_STEP_DELAY_MS);
      continue;
    }
    if (authorization.outcome !== 'ready') return;

    let action = authorization.action;
    const description = action.description || describeAgentAction(action);
    await waitForAiAgentResume();
    if (!isAiAgentLoopActive()) {
      return;
    }

    if (action.action === 'finish') {
      await updateAgentScreenshotDescription(screenshot.id, description);
      await appendAiAgentStep(action, screenshot.id, description);
      await updateAiAgentState({
        status: 'finishing',
        message: 'AI 已完成目标，正在生成教程。'
      });
      await requestStop?.();
      return;
    }

    const execution = await executeAuthorizedAgentAction(authorization.ticket);
    if (execution.outcome === 'retry') {
      await updateAiAgentState({
        status: 'retrying',
        iteration: S.currentRuntime.aiAgent.iteration + 1,
        lastAction: execution.reasonCode,
        message: execution.reason
      });
      notifyPopup('warning', { message: execution.reason });
      await delay(AI_AGENT_STEP_DELAY_MS);
      continue;
    }
    action = execution.action;
    await updateAgentScreenshotDescription(screenshot.id, description);
    await appendAiAgentStep(action, screenshot.id, description);
    await waitForAgentPageStability(action, screenshot);
    const goal = S.currentRuntime.aiAgent.goal || S.currentRecording?.aiGoal || '';
    const completionCandidate = evaluateExplicitGoalCompletion({
      action,
      goal,
      beforeUrl: screenshot?.pageContext?.url || '',
      completion: null
    });
    if (completionCandidate.reasonCode === 'completion-observation-unavailable') {
      const completion = await captureAgentCompletionObservation({ tabId: S.currentRuntime.tabId });
      const completionEvaluation = evaluateExplicitGoalCompletion({
        action,
        goal,
        beforeUrl: screenshot?.pageContext?.url || '',
        completion
      });
      if (completionEvaluation.complete) {
        const finishDescription = '确认页面已显示完成后的导航结果';
        await updateAgentScreenshotDescription(completion.screenshot.id, finishDescription);
        await appendAiAgentStep(
          { action: 'finish', description: finishDescription },
          completion.screenshot.id,
          finishDescription
        );
        await updateAiAgentState({
          status: 'finishing',
          iteration: S.currentRuntime.aiAgent.iteration + 1,
          lastAction: 'finish',
          message: 'AI 已完成目标，正在生成教程。'
        });
        await requestStop?.();
        return;
      }
    }
    await updateAiAgentState({
      iteration: S.currentRuntime.aiAgent.iteration + 1,
      lastAction: action.action,
      message: `已执行：${description}`
    });
    await delay(AI_AGENT_STEP_DELAY_MS);
  }
}

async function pauseForUnavailableObservation(cycle) {
  S.currentRuntime.isPaused = true;
  S.currentRuntime.pauseStartedAt = S.currentRuntime.pauseStartedAt || Date.now();
  await updateAiAgentState({
    status: 'paused',
    paused: true,
    awaitingTakeover: true,
    lastAction: `observation:${cycle.reasonCode || 'unavailable'}`,
    message: `${cycle.reason || '当前页面无法稳定观察'}已暂停，可重试、接管或停止导出。`
  });
  await updateBadge();
  notifyPopup('warning', { message: S.currentRuntime.aiAgent.message });
}

export async function waitForAgentPageStability(action, previousScreenshot) {
  if (!S.currentRuntime.tabId || action?.action === 'finish') {
    return null;
  }

  const beforeUrl = previousScreenshot?.pageContext?.url || '';
  const startedAt = Date.now();
  let stableSignature = '';
  let stableCount = 0;
  let lastTab = null;

  while (Date.now() - startedAt < AI_AGENT_PAGE_STABILITY_TIMEOUT_MS) {
    const tab = await chrome.tabs.get(S.currentRuntime.tabId).catch(() => null);
    if (!tab) {
      throw new Error('AI 操作后目标页面已关闭，请接管或停止导出');
    }

    lastTab = tab;
    assertAgentTabIsRecordable(tab.url || '');

    if (tab.status === 'complete') {
      const signature = `${tab.url || ''}\n${tab.title || ''}`;
      stableCount = signature === stableSignature ? stableCount + 1 : 1;
      stableSignature = signature;

      if (stableCount >= 2) {
        warnAgentNavigationChange(beforeUrl, tab.url || '');
        return tab;
      }
    } else {
      stableCount = 0;
    }

    await delay(AI_AGENT_PAGE_STABILITY_INTERVAL_MS);
  }

  throw new Error(
    `AI 操作后页面长时间未稳定${lastTab?.status ? `（当前状态：${lastTab.status}）` : ''}，请接管或停止导出`
  );
}

export function assertAgentTabIsRecordable(url) {
  if (!url) {
    return;
  }
  if (/^(chrome|chrome-extension|edge|brave|vivaldi|opera|about|devtools):/i.test(url)) {
    throw new Error(`AI 操作后进入浏览器内部页面：${summarizeUrlForPrompt(url) || url}`);
  }
}

export function warnAgentNavigationChange(beforeUrl, afterUrl) {
  if (!beforeUrl || !afterUrl || beforeUrl === afterUrl) {
    return;
  }

  const beforeOrigin = getUrlOrigin(beforeUrl);
  const afterOrigin = getUrlOrigin(afterUrl);
  if (beforeOrigin && afterOrigin && beforeOrigin !== afterOrigin) {
    notifyPopup('warning', {
      message: `AI 操作后页面跳转到 ${summarizeUrlForPrompt(afterUrl)}，已等待页面稳定后继续。`
    });
  }
}

export function getUrlOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (error) {
    return '';
  }
}
