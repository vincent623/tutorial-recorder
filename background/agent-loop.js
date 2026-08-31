import { approveAndRevalidateAgentAction } from './agent-approval.js';
import { enrichAgentActionGuard } from './agent-action-guard.js';
import { appendAiAgentStep, isAiAgentLimitReached, isAiAgentLoopActive, updateAgentScreenshotDescription, updateAiAgentState, waitForAiAgentResume } from './agent-state.js';
import { evaluateAgentActionPolicy } from './agent-policy.js';
import { calibrateAgentAction, isRepeatedAgentAction } from './agent-targeting.js';
import { buildAgentToolSchema, describeAgentAction, executeAiAgentAction, extractAgentAction } from './agent-tools.js';
import { createTrackedAiRequestController, getAiRequestConfigurationEpoch, releaseTrackedAiRequestController } from './ai-request-control.js';
import { AI_ANALYZE_TIMEOUT_MS, createAiSharingRevokedError, createAiTimeoutError, hasVisionAnalysisConfig, parseExtraHeaders, parseImageDataUrl, resizeDataUrlToSize, resolveVisionUrl, sanitizePageTitle, summarizeUrlForPrompt } from './ai-vision.js';
import { notifyContent, notifyPopup } from './notify.js';
import { readCompatibleViewport } from './page-automation.js';
import { S, updateBadge } from './runtime-state.js';
import { captureScreenshot } from './screenshot-engine.js';
import { AI_AGENT_MAX_STEPS, normalizeApiStyle } from './settings-schema.js';
import { getSettings } from './settings-store.js';
import { delay, sanitizeEditableText } from './text-utils.js';

export const AI_AGENT_STEP_DELAY_MS = 800;
export const AI_AGENT_DECISION_RETRY_LIMIT = 1;
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
async function performRunAiAgentLoop(initialSettings, requestStop) {
  let settings = initialSettings;

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

    const captureResult = await captureScreenshot({ trigger: 'agent', allowWhenPaused: true });
    if (!captureResult?.captured) {
      throw new Error('AI 录制无法截取当前页面');
    }

    const screenshot = S.currentRecording.screenshots[S.currentRecording.screenshots.length - 1];
    settings = await getSettings();
    await readAgentViewport();
    const decision = await decideNextAgentActionWithRetry(screenshot, settings);
    let action = await calibrateAgentAction(decision);
    action = await enrichAgentActionGuard(action);

    if (!isAiAgentLoopActive()) {
      return;
    }

    if (isRepeatedAgentAction(action, S.currentRuntime.aiAgent.steps)) {
      await updateAiAgentState({
        status: 'retrying',
        iteration: S.currentRuntime.aiAgent.iteration + 1,
        lastAction: 'blocked_repeated_action',
        message: `已阻止重复操作“${sanitizeEditableText(action.targetText, 80)}”，正在重新观察页面。`
      });
      notifyPopup('warning', { message: S.currentRuntime.aiAgent.message });
      await delay(AI_AGENT_STEP_DELAY_MS);
      continue;
    }

    const description = action.description || describeAgentAction(action);
    const policy = evaluateAgentActionPolicy(action, {
      currentUrl: screenshot?.pageContext?.url || ''
    });
    if (policy.decision === 'allow') action = { ...action, policyAuthorization: policy.code };
    if (policy.decision === 'block') {
      await updateAiAgentState({
        status: 'retrying',
        iteration: S.currentRuntime.aiAgent.iteration + 1,
        lastAction: 'blocked_by_policy',
        message: `已阻止 AI 动作：${policy.reason}`
      });
      notifyPopup('warning', { message: S.currentRuntime.aiAgent.message });
      await delay(AI_AGENT_STEP_DELAY_MS);
      continue;
    }

    if (policy.decision === 'confirm') {
      const approval = await approveAndRevalidateAgentAction({ action, screenshot, description, policy });
      if (approval.outcome === 'retry') {
        continue;
      }
      if (approval.outcome !== 'approved') {
        return;
      }
      action = approval.action;
    }

    await updateAgentScreenshotDescription(screenshot.id, description);
    await appendAiAgentStep(action, screenshot.id, description);

    await waitForAiAgentResume();
    if (!isAiAgentLoopActive()) {
      return;
    }

    if (action.action === 'finish') {
      await updateAiAgentState({
        status: 'finishing',
        message: 'AI 已完成目标，正在生成教程。'
      });
      await requestStop?.();
      return;
    }

    await executeAiAgentAction(action);
    await waitForAgentPageStability(action, screenshot);
    await updateAiAgentState({
      iteration: S.currentRuntime.aiAgent.iteration + 1,
      lastAction: action.action,
      message: `已执行：${description}`
    });
    await delay(AI_AGENT_STEP_DELAY_MS);
  }
}

export async function decideNextAgentActionWithRetry(screenshot, settings) {
  let lastError = null;

  for (let attempt = 0; attempt <= AI_AGENT_DECISION_RETRY_LIMIT; attempt += 1) {
    try {
      return await decideNextAgentAction(screenshot, settings);
    } catch (error) {
      lastError = error;

      if (attempt >= AI_AGENT_DECISION_RETRY_LIMIT) {
        break;
      }

      await updateAiAgentState({
        status: 'retrying',
        message: `AI 决策失败，正在重试 ${attempt + 1}/${AI_AGENT_DECISION_RETRY_LIMIT}：${sanitizeEditableText(error?.message || '未知错误', 120)}`
      });
      notifyPopup('warning', { message: S.currentRuntime.aiAgent.message });
      await delay(800);
    }
  }

  throw lastError || new Error('AI 决策失败');
}

export async function decideNextAgentAction(screenshot, settings) {
  const requestEpoch = getAiRequestConfigurationEpoch();
  const currentSettings = await getSettings();
  if (!hasVisionAnalysisConfig(currentSettings)) {
    throw createAiSharingRevokedError();
  }

  const normalizedScreenshot = await normalizeAgentScreenshot(screenshot);
  const request = buildAgentDecisionRequest(normalizedScreenshot, currentSettings);
  const controller = createTrackedAiRequestController(requestEpoch);
  const timeoutId = setTimeout(() => controller.abort(), AI_ANALYZE_TIMEOUT_MS);

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    });

    if (!response.ok) {
      const responseText = (await response.text()).slice(0, 200).trim();
      const statusText = response.statusText ? ` ${response.statusText}` : '';
      throw new Error(`HTTP ${response.status}${statusText}${responseText ? `: ${responseText}` : ''}`);
    }

    const data = await response.json();
    return extractAgentAction(data, settings.apiStyle);
  } catch (error) {
    if (controller.signal.reason?.name === 'AISharingRevokedError') {
      throw controller.signal.reason;
    }
    if (error?.name === 'AbortError') {
      throw createAiTimeoutError();
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    releaseTrackedAiRequestController(controller);
  }
}

export function buildAgentDecisionRequest(screenshot, settings) {
  const apiStyle = normalizeApiStyle(settings.apiStyle);
  const extraHeaders = parseExtraHeaders(settings.extraHeadersJson);
  const headers =
    apiStyle === 'anthropicMessages'
      ? {
          'Content-Type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': '2023-06-01',
          ...extraHeaders
        }
      : {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
          ...extraHeaders
        };
  const url = resolveVisionUrl(settings.apiBaseUrl, apiStyle);
  const prompt = buildAgentDecisionPrompt(screenshot);
  const tools = buildAgentToolSchema(apiStyle);

  if (apiStyle === 'anthropicMessages') {
    const { mediaType, base64 } = parseImageDataUrl(screenshot.data);

    return {
      url,
      headers,
      body: {
        model: settings.modelId,
        system: '你是浏览器操作 Agent。你必须选择一个安全、具体、单步的浏览器动作。',
        max_tokens: 512,
        tools,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64
                }
              }
            ]
          }
        ]
      }
    };
  }

  if (apiStyle === 'responses') {
    return {
      url,
      headers,
      body: {
        model: settings.modelId,
        instructions: '你是浏览器操作 Agent。你必须选择一个安全、具体、单步的浏览器动作。',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: screenshot.data }
            ]
          }
        ],
        tools,
        max_output_tokens: 512
      }
    };
  }

  return {
    url,
    headers,
    body: {
      model: settings.modelId,
      messages: [
        {
          role: 'system',
          content: '你是浏览器操作 Agent。你必须选择一个安全、具体、单步的浏览器动作。'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: screenshot.data } }
          ]
        }
      ],
      tools,
      ...(settings.providerPreset === 'deepseekOfficial' ? { thinking: { type: 'disabled' } } : {}),
      tool_choice: settings.providerPreset === 'deepseekOfficial' ? 'required' : 'auto',
      max_tokens: 360
    }
  };
}

export async function readAgentViewport() {
  if (!S.currentRuntime.tabId) {
    return null;
  }

  try {
    const metrics = S.currentRuntime.cdpAttached
      ? await chrome.debugger.sendCommand(
          { tabId: S.currentRuntime.tabId },
          'Page.getLayoutMetrics'
        )
      : null;
    const css = metrics?.cssLayoutSize || metrics?.layoutViewport || await readCompatibleViewport();
    const width = Math.round(Number(css?.width) || 0);
    const height = Math.round(Number(css?.height) || 0);

    if (width > 0 && height > 0) {
      await updateAiAgentState({ viewport: { width, height } });
      return { width, height };
    }
  } catch (error) {
    console.warn('[Background] Read agent viewport failed:', error);
  }

  return null;
}

export async function normalizeAgentScreenshot(screenshot) {
  const viewport = S.currentRuntime.aiAgent?.viewport;

  if (!viewport?.width || !viewport?.height) {
    return screenshot;
  }

  const resized = await resizeDataUrlToSize(screenshot.data, viewport.width, viewport.height);
  return { ...screenshot, data: resized };
}

export function buildAgentDecisionPrompt(screenshot) {
  const goal = S.currentRuntime.aiAgent.goal || S.currentRecording?.aiGoal || '完成当前教程任务';
  const stepIndex = S.currentRuntime.aiAgent.iteration + 1;
  const pageTitle = sanitizePageTitle(screenshot?.pageContext?.title) || '未知页面';
  const pageUrl = summarizeUrlForPrompt(screenshot?.pageContext?.url) || '未知地址';
  const completedSteps = S.currentRuntime.aiAgent.steps
    .slice(-8)
    .map((step) => `${step.index}. ${step.description}`)
    .join('\n');
  const maxSteps = S.currentRuntime.aiAgent.maxSteps || AI_AGENT_MAX_STEPS;
  const viewport = S.currentRuntime.aiAgent.viewport;
  const viewportLine = viewport?.width
    ? `浏览器视口：${viewport.width} x ${viewport.height}（截图已按视口等比对齐，点击与悬停坐标使用视口内 CSS 像素）。`
    : '点击与悬停坐标使用视口内 CSS 像素。';

  return [
    `教程目标：${goal}`,
    `当前页面：${pageTitle}（${pageUrl}）`,
    `当前步数：${stepIndex}/${maxSteps}`,
    viewportLine,
    completedSteps ? `已完成步骤：\n${completedSteps}` : '已完成步骤：无',
    '请选择下一步工具调用。只能使用 click_at_xy、type_text、scroll、press_key、navigate、hover、wait、finish。',
    '如果目标已完成，调用 finish。',
    '不得重复执行已完成步骤；如果上一动作已经让页面达到目标状态，必须直接调用 finish。',
    '只有在新的向导步骤确实需要再次点击同一低风险控件时，才可设置 allowRepeat=true 并写明 repeatReason；提交、删除、支付、发布、发送、购买等高风险目标禁止重复。',
    '如果需要点击，给出视口坐标 x/y，并在可识别时用 targetText 返回按钮/链接的完整可见文字；如果需要输入，优先在一次 type_text 中返回输入框的精确 aria-label/placeholder 作为 targetText，无需先点击；当用户目标明确要求立即执行 GET 搜索时，在同一次 type_text 中设置 submit=true，无需再调用 press_key Enter；其他可能提交数据的场景不得设置 submit=true。需要悬停时给出视口坐标 x/y；需要打开新地址时使用 navigate 并给出完整 http/https 地址；页面正在加载或动效未完成时可用 wait 短暂等待。',
    '每次只执行一个动作，并写出一句中文教程步骤说明 description。',
    '如果不能使用工具调用，请只输出 JSON，例如 {"action":"click_at_xy","x":120,"y":240,"targetText":"提交","description":"点击提交按钮"}。'
  ].join('\n');
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
