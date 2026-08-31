import { buildAgentToolSchema, extractAgentAction } from './agent-tools.js';
import {
  AI_ANALYZE_TIMEOUT_MS,
  createAiSharingRevokedError,
  createAiTimeoutError,
  hasVisionAnalysisConfig,
  parseExtraHeaders,
  parseImageDataUrl,
  resolveVisionUrl
} from './ai-vision.js';
import {
  createTrackedAiRequestController,
  getAiRequestConfigurationEpoch,
  releaseTrackedAiRequestController
} from './ai-request-control.js';
import { normalizeApiStyle } from './settings-schema.js';
import { getSettings } from './settings-store.js';

const defaultRequester = createObservationDecisionRequester({
  readSettings: getSettings,
  getRequestEpoch: getAiRequestConfigurationEpoch,
  createRequestController: createTrackedAiRequestController,
  releaseRequestController: releaseTrackedAiRequestController,
  fetchImpl: (...args) => fetch(...args)
});

export function requestObservationAgentDecision(remoteObservation, options) {
  return defaultRequester.request(remoteObservation, options);
}

export function createObservationDecisionRequester({
  readSettings,
  getRequestEpoch,
  createRequestController,
  releaseRequestController,
  fetchImpl,
  timeoutMs = AI_ANALYZE_TIMEOUT_MS
}) {
  return Object.freeze({ request });

  async function request(remoteObservation, {
    targetDescription = '',
    stepIndex = 1,
    maxSteps = 1,
    completedSteps = []
  } = {}) {
    const requestEpoch = getRequestEpoch();
    const settings = await readSettings();
    if (!hasVisionAnalysisConfig(settings)) throw createAiSharingRevokedError();
    const requestData = buildObservationDecisionRequest(remoteObservation, {
      ...settings,
      targetDescription,
      stepIndex,
      maxSteps,
      completedSteps
    });
    const controller = createRequestController(requestEpoch);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(requestData.url, {
        method: 'POST',
        headers: requestData.headers,
        body: JSON.stringify(requestData.body),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      return extractObservationAgentAction(await response.json(), settings.apiStyle, remoteObservation);
    } catch (error) {
      if (controller.signal.reason?.name === 'AISharingRevokedError') {
        throw controller.signal.reason;
      }
      if (error?.name === 'AbortError') throw createAiTimeoutError();
      throw error;
    } finally {
      clearTimeout(timeoutId);
      releaseRequestController(controller);
    }
  }
}

export function buildObservationDecisionRequest(remoteObservation, settings = {}) {
  if (settings.aiDataSharingConsent !== true) {
    throw new Error('AI 页面数据发送授权未开启');
  }
  const projection = remoteObservation?.projection;
  const imageData = remoteObservation?.decisionScreenshot?.data || '';
  if (!projection?.observationId || !Array.isArray(projection.elements) || !imageData) {
    throw new Error('远程浏览器观察不完整');
  }

  const apiStyle = normalizeApiStyle(settings.apiStyle);
  const headers = buildHeaders(apiStyle, settings);
  const url = resolveVisionUrl(settings.apiBaseUrl, apiStyle);
  const tools = buildAgentToolSchema(apiStyle, { observationMode: true });
  const prompt = buildObservationDecisionPrompt(projection, settings.targetDescription, {
    stepIndex: settings.stepIndex,
    maxSteps: settings.maxSteps,
    completedSteps: settings.completedSteps
  });
  const system = '你是浏览器操作 Agent。只选择一个安全、具体、单步动作；优先使用观察元素引用。';

  if (apiStyle === 'anthropicMessages') {
    const { mediaType, base64 } = parseImageDataUrl(imageData);
    return {
      url,
      headers,
      body: {
        model: settings.modelId,
        system,
        max_tokens: 512,
        tools,
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
        ] }]
      }
    };
  }

  if (apiStyle === 'responses') {
    return {
      url,
      headers,
      body: {
        model: settings.modelId,
        instructions: system,
        input: [{ role: 'user', content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: imageData }
        ] }],
        tools,
        tool_choice: 'required',
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
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageData } }
        ] }
      ],
      tools,
      tool_choice: 'required',
      ...(settings.providerPreset === 'deepseekOfficial' ? { thinking: { type: 'disabled' } } : {}),
      max_tokens: 512
    }
  };
}

export function extractObservationAgentAction(data, apiStyle, remoteObservation = null) {
  try {
    return extractAgentAction(data, apiStyle, { observationMode: true });
  } catch (observationError) {
    const legacyAction = extractAgentAction(data, apiStyle);
    return adaptLegacyAgentAction(legacyAction, remoteObservation?.projection);
  }
}

export function adaptLegacyAgentAction(action = {}, projection = null) {
  if (!['click_at_xy', 'type_text', 'hover'].includes(action.action)) return action;
  const targetText = String(action.targetText || '').replace(/\s+/g, ' ').trim();
  const candidates = Array.isArray(projection?.elements) ? projection.elements : [];
  const namedMatches = targetText
    ? candidates.filter((element) => String(element.name || '').replace(/\s+/g, ' ').trim() === targetText)
    : [];
  const matches = action.action === 'type_text'
    ? namedMatches.filter(isEditableObservationElement)
    : namedMatches;
  if (matches.length === 1) {
    const mappedAction = action.action === 'click_at_xy'
      ? 'click_element'
      : action.action === 'hover'
        ? 'hover_element'
        : 'type_text';
    return {
      ...action,
      action: mappedAction,
      observationId: projection.observationId,
      elementRef: matches[0].ref
    };
  }
  if (action.action === 'click_at_xy') {
    return {
      ...action,
      fallbackReason: '旧模型输出未提供可唯一映射的元素引用'
    };
  }
  throw new Error('旧模型输出无法唯一绑定当前观察元素');
}

function isEditableObservationElement(element = {}) {
  const targetType = String(element.targetType || '').toLowerCase();
  const role = String(element.role || '').toLowerCase();
  return ['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'textarea'].includes(targetType) ||
    ['textbox', 'searchbox', 'combobox'].includes(role);
}

function buildObservationDecisionPrompt(projection, targetDescription, progress = {}) {
  const goal = String(targetDescription || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const completed = Array.isArray(progress.completedSteps)
    ? progress.completedSteps.slice(-8).map((step, index) => `${index + 1}. ${String(step || '').slice(0, 300)}`).join('\n')
    : '';
  return [
    `用户目标：${goal || '继续完成当前网页任务'}`,
    `当前步数：${Number(progress.stepIndex) || 1}/${Number(progress.maxSteps) || 1}`,
    completed ? `最近已完成步骤：\n${completed}` : '最近已完成步骤：无',
    '先检查截图是否已经出现用户目标中的完成条件；一旦达到，必须立即调用 finish。',
    '不得重复已完成动作。需要向可编辑字段输入时直接调用 type_text，它会自动聚焦并替换内容，禁止为了聚焦先调用 click_element。',
    '下面 JSON 是与编号决策截图同步的脱敏浏览器观察。',
    '必须从当前 observationId 和 elements[].ref 中原样选择引用；不要猜测、拼接或复用旧引用。',
    '只有没有可用语义元素引用时才允许坐标降级，并明确填写 fallbackReason。',
    JSON.stringify(projection)
  ].join('\n');
}

function buildHeaders(apiStyle, settings) {
  const extraHeaders = parseExtraHeaders(settings.extraHeadersJson);
  if (apiStyle === 'anthropicMessages') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      ...extraHeaders
    };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
    ...extraHeaders
  };
}
