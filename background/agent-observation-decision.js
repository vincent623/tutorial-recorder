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

  async function request(remoteObservation, { targetDescription = '' } = {}) {
    const requestEpoch = getRequestEpoch();
    const settings = await readSettings();
    if (!hasVisionAnalysisConfig(settings)) throw createAiSharingRevokedError();
    const requestData = buildObservationDecisionRequest(remoteObservation, {
      ...settings,
      targetDescription
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
      return extractObservationAgentAction(await response.json(), settings.apiStyle);
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
  const prompt = buildObservationDecisionPrompt(projection, settings.targetDescription);
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

export function extractObservationAgentAction(data, apiStyle) {
  return extractAgentAction(data, apiStyle, { observationMode: true });
}

function buildObservationDecisionPrompt(projection, targetDescription) {
  const goal = String(targetDescription || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  return [
    `用户目标：${goal || '继续完成当前网页任务'}`,
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
