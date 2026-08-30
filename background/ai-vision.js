import { blobToDataUrl } from './exporters.js';
import { createTrackedAiRequestController, getAiRequestConfigurationEpoch, releaseTrackedAiRequestController } from './ai-request-control.js';
import { DEFAULT_SETTINGS, getEffectivePromptConfig, getProviderPreset, normalizeApiStyle, renderPromptTemplate, sanitizeApiBaseUrl } from './settings-schema.js';
import { getSettings } from './settings-store.js';
import { delay, sanitizeEditableText } from './text-utils.js';

// Vision analysis request pipeline: build, send, retry, downscale, and parse.

export const AI_ANALYZE_TIMEOUT_MS = 45_000;

export const AI_RETRY_MAX_ATTEMPTS = 2;

export const AI_RETRY_BASE_DELAY_MS = 1200;

export const AI_CONCURRENCY = 3;

export const AI_IMAGE_MAX_SIDE = 1280;

export const AI_IMAGE_JPEG_QUALITY = 0.85;

export async function analyzeImage(screenshot, settings, index, screenshots) {
  const aiImage = await downscaleDataUrlForAi(screenshot.data);

  let lastError = null;

  for (let attempt = 0; attempt <= AI_RETRY_MAX_ATTEMPTS; attempt += 1) {
    const requestEpoch = getAiRequestConfigurationEpoch();
    const currentSettings = await getSettings();
    if (!hasVisionAnalysisConfig(currentSettings)) {
      throw createAiSharingRevokedError();
    }
    const request = buildVisionRequest({ ...screenshot, data: aiImage }, currentSettings, index, screenshots);
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
        const error = new Error(`HTTP ${response.status}${statusText}${responseText ? `: ${responseText}` : ''}`);
        error.status = response.status;
        error.retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
        throw error;
      }

      const data = await response.json();
      return extractVisionText(data, settings.apiStyle) || '未命名步骤';
    } catch (error) {
      if (controller.signal.reason?.name === 'AISharingRevokedError') {
        lastError = controller.signal.reason;
      } else if (error?.name === 'AbortError') {
        lastError = createAiTimeoutError();
      } else {
        lastError = error;
      }

      const canRetry = attempt < AI_RETRY_MAX_ATTEMPTS && isRetryableAiStatus(error?.status);
      if (!canRetry) {
        break;
      }

      await delay(Math.max(error?.retryAfterMs || 0, AI_RETRY_BASE_DELAY_MS * 2 ** attempt));
    } finally {
      clearTimeout(timeoutId);
      releaseTrackedAiRequestController(controller);
    }
  }

  throw lastError || new Error('AI 识别失败');
}

export function createAiSharingRevokedError() {
  const error = new Error('AI 截图发送授权已关闭或连接配置已失效');
  error.name = 'AISharingRevokedError';
  return error;
}

export function isRetryableAiStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function parseRetryAfterMs(value) {
  if (!value) {
    return 0;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }

  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(0, date - Date.now()), 30_000);
  }

  return 0;
}

export async function downscaleDataUrlForAi(dataUrl) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return dataUrl;
  }

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, AI_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));

    if (scale >= 1) {
      bitmap.close?.();
      return dataUrl;
    }

    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    );
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: AI_IMAGE_JPEG_QUALITY });
    return await blobToDataUrl(jpegBlob);
  } catch (error) {
    console.warn('[Background] Downscale for AI failed, using original image:', error);
    return dataUrl;
  }
}

export async function resizeDataUrlToSize(dataUrl, width, height) {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas !== 'function' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return dataUrl;
  }

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(Math.round(width), Math.round(height));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    return await blobToDataUrl(jpegBlob);
  } catch (error) {
    console.warn('[Background] Resize image failed, using original:', error);
    return dataUrl;
  }
}

export function hasVisionAnalysisConfig(settings = {}) {
  return Boolean(
    settings.aiDataSharingConsent === true &&
    settings.apiKey &&
    settings.modelId &&
    settings.apiBaseUrl &&
    isSecureAiEndpoint(settings.apiBaseUrl)
  );
}

export function isSecureAiEndpoint(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.username || parsed.password) {
      return false;
    }
    if (parsed.protocol === 'https:') {
      return true;
    }

    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'http:' &&
      (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
    );
  } catch (error) {
    return false;
  }
}

export const PROVIDER_TEST_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function describeConnectionFailureHint(error, settings = {}) {
  const status = error?.status;
  const baseUrl = settings.apiBaseUrl || '';

  if (status === 401 || status === 403) {
    return 'Key 被拒绝：请检查 API Key 是否正确、是否有该模型的调用权限；中转站用户请确认额度与分组。';
  }

  if (status === 404) {
    return '地址或模型不存在：请检查 Base URL 是否到版本根路径、模型 ID 拼写是否正确（中转站需确认已启用该模型）。';
  }

  if (status === 429) {
    return '触发限流：请稍后重试，或在服务商控制台查看配额。';
  }

  if (status >= 500) {
    return '服务端错误：可能是服务商或中转站临时故障，可稍后重试。';
  }

  if (error?.name === 'AITimeoutError') {
    return '响应超时：模型过慢或网络不通；可先换一个轻量视觉模型验证链路。';
  }

  if (baseUrl && /^http:\/\//i.test(baseUrl) && !/localhost|127\.0\.0\.1/i.test(baseUrl)) {
    return 'Base URL 使用了明文 http，多数网关要求 https；自建 One API 本地部署可保留 http。';
  }

  return '请核对 Base URL、API Key、模型 ID 与 API 风格是否匹配当前服务商。';
}

export function buildPromptContext(screenshot, index, screenshots) {
  const pageTitle = sanitizePageTitle(screenshot?.pageContext?.title) || '未知页面';
  const pageUrl = summarizeUrlForPrompt(screenshot?.pageContext?.url);
  const interactionSummary = screenshot?.pageContext?.interaction?.summary || '没有可靠的交互记录';
  const previousDescription = screenshots[index - 1]?.description || '无';

  return {
    stepIndex: String(index + 1),
    totalSteps: String(screenshots.length),
    pageTitle,
    pageUrl,
    pageUrlLine: pageUrl ? `页面地址：${pageUrl}。` : '',
    interactionSummary,
    previousDescription
  };
}

export function sanitizePageTitle(title) {
  return sanitizeEditableText(title, 120);
}

export function summarizeUrlForPrompt(url) {
  if (typeof url !== 'string' || !url) {
    return '';
  }

  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.slice(0, 160);
  } catch (error) {
    return sanitizeEditableText(url, 160);
  }
}

export function buildVisionRequest(screenshot, settings, index, screenshots) {
  const imageData = screenshot.data;
  const apiStyle = normalizeApiStyle(settings.apiStyle);
  const extraHeaders = parseExtraHeaders(settings.extraHeadersJson);
  const promptConfig = getEffectivePromptConfig(settings);
  const contextPrompt = renderPromptTemplate(
    promptConfig.userPromptTemplate,
    buildPromptContext(screenshot, index, screenshots)
  );
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

  if (apiStyle === 'anthropicMessages') {
    const { mediaType, base64 } = parseImageDataUrl(imageData);

    return {
      url,
      headers,
      body: {
        model: settings.modelId,
        system: promptConfig.systemPrompt,
        max_tokens: 160,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: contextPrompt },
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
        instructions: promptConfig.systemPrompt,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: contextPrompt },
              { type: 'input_image', image_url: imageData }
            ]
          }
        ],
        max_output_tokens: 120
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
            content: promptConfig.systemPrompt
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: contextPrompt },
              { type: 'image_url', image_url: { url: imageData } }
            ]
          }
      ],
      max_tokens: 120
    }
  };
}

export function createAiTimeoutError() {
  const error = new Error(`AI 识别超时（${Math.round(AI_ANALYZE_TIMEOUT_MS / 1000)} 秒）`);
  error.name = 'AITimeoutError';
  return error;
}

export function isAiTimeoutError(error) {
  return error?.name === 'AITimeoutError';
}

export function describeAiFailureForUser(error) {
  if (isAiTimeoutError(error)) {
    return 'AI 识别超时';
  }

  const message = sanitizeEditableText(error?.message || 'AI 识别失败', 220);
  return `AI 识别失败：${message}`;
}

export function resolveVisionUrl(apiBaseUrl, apiStyle) {
  const base = sanitizeApiBaseUrl(apiBaseUrl || getProviderPreset(DEFAULT_SETTINGS.providerPreset).apiBaseUrl);
  if (!isSecureAiEndpoint(base)) {
    throw new Error('AI Base URL 必须使用 HTTPS；仅本机 localhost、127.0.0.1 或 [::1] 可使用 HTTP。');
  }
  const normalizedBase = base
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/messages$/i, '');

  if (apiStyle === 'responses') {
    return `${normalizedBase}/responses`;
  }

  if (apiStyle === 'anthropicMessages') {
    return `${normalizedBase}/messages`;
  }

  return `${normalizedBase}/chat/completions`;
}

export function parseExtraHeaders(extraHeadersJson) {
  if (!extraHeadersJson) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(extraHeadersJson);
  } catch (error) {
    throw new Error(`附加请求头 JSON 无法解析：${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('附加请求头必须是 JSON 对象');
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([key, value]) => typeof key === 'string' && key.trim() && value != null)
      .map(([key, value]) => [key.trim(), String(value)])
  );
}

export function extractVisionText(data, apiStyle) {
  if (apiStyle === 'responses') {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
      return data.output_text.trim();
    }

    for (const item of data?.output || []) {
      for (const part of item?.content || []) {
        const text = part?.text || part?.content?.[0]?.text;
        if (typeof text === 'string' && text.trim()) {
          return text.trim();
        }
      }
    }

    return '';
  }

  if (apiStyle === 'anthropicMessages') {
    return (data?.content || [])
      .filter((part) => part?.type === 'text' && typeof part?.text === 'string')
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || '')
      .join('\n')
      .trim();
  }

  return '';
}

export function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[-+\w.]+);base64,(.*)$/);
  if (!match) {
    throw new Error('无法解析截图数据');
  }

  return {
    mediaType: match[1],
    base64: match[2]
  };
}
