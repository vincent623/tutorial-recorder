import { sanitizeTextValue } from './text-utils.js';

// Provider presets, prompt presets, default settings, and settings normalization.

export const AI_AGENT_MAX_STEPS = 50;

export const AI_AGENT_MAX_DURATION_MS = 10 * 60 * 1000;

export const AI_AGENT_MIN_STEPS = 1;

export const AI_AGENT_MAX_CONFIGURABLE_STEPS = 500;

export const AI_AGENT_MIN_DURATION_MINUTES = 1;

export const AI_AGENT_MAX_DURATION_MINUTES = 120;

export const PROVIDER_PRESETS = {
  volcengineArk: {
    label: '火山方舟',
    apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiStyle: 'chatCompletions'
  },
  zhipuBigModel: {
    label: '智谱 GLM',
    apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiStyle: 'chatCompletions'
  },
  siliconFlow: {
    label: '硅基流动',
    apiBaseUrl: 'https://api.siliconflow.cn/v1',
    apiStyle: 'chatCompletions'
  },
  aliyunDashScope: {
    label: '阿里云百炼',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiStyle: 'chatCompletions'
  },
  moonshot: {
    label: '月之暗面 Kimi',
    apiBaseUrl: 'https://api.moonshot.cn/v1',
    apiStyle: 'chatCompletions'
  },
  deepseekOfficial: {
    label: 'DeepSeek 官方',
    apiBaseUrl: 'https://api.deepseek.com',
    apiStyle: 'chatCompletions'
  },
  openRouter: {
    label: 'OpenRouter',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    apiStyle: 'chatCompletions'
  },
  groq: {
    label: 'Groq',
    apiBaseUrl: 'https://api.groq.com/openai/v1',
    apiStyle: 'chatCompletions'
  },
  mistral: {
    label: 'Mistral',
    apiBaseUrl: 'https://api.mistral.ai/v1',
    apiStyle: 'chatCompletions'
  },
  azureOpenAI: {
    label: 'Azure OpenAI',
    apiBaseUrl: '',
    apiStyle: 'chatCompletions'
  },
  oneApiRelay: {
    label: 'One API / 中转站',
    apiBaseUrl: '',
    apiStyle: 'chatCompletions'
  },
  googleGemini: {
    label: 'Google Gemini',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiStyle: 'chatCompletions'
  },
  anthropicClaude: {
    label: 'Claude',
    apiBaseUrl: 'https://api.anthropic.com/v1',
    apiStyle: 'anthropicMessages'
  },
  openai: {
    label: 'OpenAI',
    apiBaseUrl: 'https://api.openai.com/v1',
    apiStyle: 'responses'
  },
  openaiCompatible: {
    label: 'OpenAI Compatible',
    apiBaseUrl: 'https://api.openai.com/v1',
    apiStyle: 'chatCompletions'
  },
  custom: {
    label: '自定义',
    apiBaseUrl: '',
    apiStyle: 'chatCompletions'
  }
};

export const PROMPT_PRESETS = {
  default: {
    label: '默认（平衡）',
    description: '平衡页面上下文和最近交互，适合大多数教程场景。',
    systemPrompt:
      '你是教程录制助手。请优先根据页面上下文和最近交互，写出用户正在进行的具体操作步骤。不要只做静态截图描述。',
    userPromptTemplate: [
      '当前是教程第 {{stepIndex}} 步，共 {{totalSteps}} 步。',
      '页面标题：{{pageTitle}}。',
      '{{pageUrlLine}}',
      '最近一次用户交互：{{interactionSummary}}。',
      '上一步说明：{{previousDescription}}。',
      '请输出 1 句自然中文步骤说明，优先描述“用户正在做什么”，用动词开头，尽量点明按钮、输入框、菜单或页面区域。',
      '如果截图信息不足，请优先参考最近一次用户交互，而不是泛泛描述页面长什么样。'
    ].join('\n')
  },
  actionFirst: {
    label: '动作优先',
    description: '更强调用户动作本身，尽量避免泛泛描述页面外观。',
    systemPrompt:
      '你是教程步骤生成器。请把截图和交互记录转成可执行的操作步骤，优先写动作，不要罗列静态界面元素。',
    userPromptTemplate: [
      '当前是教程第 {{stepIndex}} 步，共 {{totalSteps}} 步。',
      '页面标题：{{pageTitle}}。',
      '{{pageUrlLine}}',
      '最近一次用户交互：{{interactionSummary}}。',
      '上一步说明：{{previousDescription}}。',
      '请只输出 1 句中文步骤，以“点击 / 输入 / 选择 / 切换 / 打开 / 提交”等动词开头。',
      '如果截图与最近交互不一致，优先采用最近交互，不要描述颜色、布局或装饰风格。'
    ].join('\n')
  },
  controlFocused: {
    label: '控件定位',
    description: '更强调按钮、输入框、菜单和页面区域，适合工具型产品教程。',
    systemPrompt:
      '你是教程录制助手，擅长把截图转成别人可以复现的操作步骤。请尽量点出具体控件名或页面区域。',
    userPromptTemplate: [
      '当前是教程第 {{stepIndex}} 步，共 {{totalSteps}} 步。',
      '页面标题：{{pageTitle}}。',
      '{{pageUrlLine}}',
      '最近一次用户交互：{{interactionSummary}}。',
      '上一步说明：{{previousDescription}}。',
      '请输出 1 句教程步骤，格式尽量接近“动词 + 控件 / 区域 + 目的或结果”。',
      '优先提到按钮、输入框、标签页、面板、菜单或表单区域，不要只说“页面发生变化”。'
    ].join('\n')
  },
  concise: {
    label: '简洁短句',
    description: '输出更短更干净，适合希望后续自己再编辑的场景。',
    systemPrompt:
      '你是教程录制助手。请输出简洁、可执行的中文步骤句子，优先描述动作，不要展开解释。',
    userPromptTemplate: [
      '当前是教程第 {{stepIndex}} 步，共 {{totalSteps}} 步。',
      '页面标题：{{pageTitle}}。',
      '{{pageUrlLine}}',
      '最近一次用户交互：{{interactionSummary}}。',
      '上一步说明：{{previousDescription}}。',
      '请输出 1 句 18 到 28 个字左右的中文步骤说明，用动词开头，只保留最关键的动作和对象。'
    ].join('\n')
  },
  custom: {
    label: '自定义',
    description: '完全自定义系统提示词和用户提示词模板。',
    systemPrompt: '',
    userPromptTemplate: ''
  }
};

export const DEFAULT_SETTINGS = {
  providerPreset: 'volcengineArk',
  apiStyle: PROVIDER_PRESETS.volcengineArk.apiStyle,
  apiBaseUrl: PROVIDER_PRESETS.volcengineArk.apiBaseUrl,
  apiKey: '',
  modelId: '',
  extraHeadersJson: '',
  promptPreset: 'default',
  customSystemPrompt: '',
  customUserPrompt: '',
  captureMode: 'displayMedia',
  outputDir: 'tutorial-recorder',
  promptForSaveAs: false,
  screenshotInterval: 5,
  autoScreenshot: true,
  realtimeSuggestions: false,
  aiDataSharingConsent: false,
  aiAgentMaxSteps: AI_AGENT_MAX_STEPS,
  aiAgentMaxDurationMinutes: Math.round(AI_AGENT_MAX_DURATION_MS / 60_000),
  screenshotEngine: 'standard',
  cdpCropEnabled: false,
  cdpCropX: 0,
  cdpCropY: 0,
  cdpCropWidth: 0,
  cdpCropHeight: 0
};

export function normalizeSettings(settings = {}) {
  const preset = getProviderPreset(settings.providerPreset);
  const apiStyle = normalizeApiStyle(settings.apiStyle ?? preset.apiStyle);
  const modelId = sanitizeTextValue(settings.modelId ?? settings.endpointId ?? '', 120);

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    providerPreset: getProviderPresetKey(settings.providerPreset),
    apiStyle,
    apiBaseUrl: sanitizeApiBaseUrl(settings.apiBaseUrl || preset.apiBaseUrl, getProviderPresetKey(settings.providerPreset)),
    outputDir: sanitizeOutputDir(settings.outputDir),
    modelId,
    extraHeadersJson: normalizeHeadersJson(settings.extraHeadersJson),
    promptPreset: getPromptPresetKey(settings.promptPreset),
    customSystemPrompt: sanitizePromptValue(
      settings.customSystemPrompt,
      PROMPT_PRESETS.default.systemPrompt.length * 8
    ),
    customUserPrompt: sanitizePromptValue(
      settings.customUserPrompt,
      PROMPT_PRESETS.default.userPromptTemplate.length * 8
    ),
    captureMode: normalizeCaptureMode(settings.captureMode),
    screenshotEngine: normalizeScreenshotEngine(settings.screenshotEngine),
    cdpCropEnabled: settings.cdpCropEnabled === true,
    cdpCropX: sanitizeNonNegativeInteger(settings.cdpCropX),
    cdpCropY: sanitizeNonNegativeInteger(settings.cdpCropY),
    cdpCropWidth: sanitizeNonNegativeInteger(settings.cdpCropWidth),
    cdpCropHeight: sanitizeNonNegativeInteger(settings.cdpCropHeight),
    promptForSaveAs: settings.promptForSaveAs === true,
    screenshotInterval: clampInterval(settings.screenshotInterval ?? DEFAULT_SETTINGS.screenshotInterval),
    autoScreenshot: settings.autoScreenshot !== false,
    realtimeSuggestions: settings.realtimeSuggestions === true,
    aiDataSharingConsent: settings.aiDataSharingConsent === true,
    aiAgentMaxSteps: clampInteger(
      settings.aiAgentMaxSteps ?? DEFAULT_SETTINGS.aiAgentMaxSteps,
      AI_AGENT_MIN_STEPS,
      AI_AGENT_MAX_CONFIGURABLE_STEPS,
      DEFAULT_SETTINGS.aiAgentMaxSteps
    ),
    aiAgentMaxDurationMinutes: clampInteger(
      settings.aiAgentMaxDurationMinutes ?? DEFAULT_SETTINGS.aiAgentMaxDurationMinutes,
      AI_AGENT_MIN_DURATION_MINUTES,
      AI_AGENT_MAX_DURATION_MINUTES,
      DEFAULT_SETTINGS.aiAgentMaxDurationMinutes
    )
  };
}

export function getProviderPresetKey(value) {
  return Object.hasOwn(PROVIDER_PRESETS, value) ? value : DEFAULT_SETTINGS.providerPreset;
}

export function getProviderPreset(value) {
  return PROVIDER_PRESETS[getProviderPresetKey(value)];
}

export function getPromptPresetKey(value) {
  return Object.hasOwn(PROMPT_PRESETS, value) ? value : DEFAULT_SETTINGS.promptPreset;
}

export function getPromptPreset(value) {
  return PROMPT_PRESETS[getPromptPresetKey(value)];
}

export function normalizeApiStyle(value) {
  if (value === 'responses') {
    return 'responses';
  }

  if (value === 'anthropicMessages') {
    return 'anthropicMessages';
  }

  return 'chatCompletions';
}

export function normalizeCaptureMode(value) {
  return value === 'tabCapture' ? 'tabCapture' : 'displayMedia';
}

export function normalizeScreenshotEngine(value) {
  return value === 'cdp' ? 'cdp' : 'standard';
}

export function sanitizeNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(parsed, 100_000);
}

export function buildCdpCropFromSettings(settings = {}) {
  if (
    settings.cdpCropEnabled !== true ||
    !settings.cdpCropWidth ||
    !settings.cdpCropHeight
  ) {
    return null;
  }

  return {
    x: sanitizeNonNegativeInteger(settings.cdpCropX),
    y: sanitizeNonNegativeInteger(settings.cdpCropY),
    width: sanitizeNonNegativeInteger(settings.cdpCropWidth),
    height: sanitizeNonNegativeInteger(settings.cdpCropHeight),
    scale: 1
  };
}

export function sanitizeApiBaseUrl(value, providerPreset = DEFAULT_SETTINGS.providerPreset) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return '';
  }

  let normalized = raw.replace(/\/+$/, '');

  try {
    const parsed = new URL(normalized);
    const isSiliconFlow =
      providerPreset === 'siliconFlow' || /^api\.siliconflow\.(cn|com)$/i.test(parsed.hostname);

    if (isSiliconFlow && !/\/v\d+$/i.test(parsed.pathname)) {
      normalized = `${parsed.origin}/v1`;
    }
  } catch (error) {
    if (providerPreset === 'siliconFlow' && !/\/v\d+$/i.test(normalized)) {
      normalized = `${normalized}/v1`.replace(/\/+$/, '/v1');
    }
  }

  return normalized;
}

export function normalizeHeadersJson(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function sanitizePromptValue(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\r\n?/g, '\n').trim().slice(0, maxLength);
}

export function clampInterval(seconds) {
  const value = Number.parseInt(seconds, 10);
  if (Number.isNaN(value)) {
    return DEFAULT_SETTINGS.screenshotInterval;
  }

  return Math.min(60, Math.max(1, value));
}

export function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function normalizeAiAgentMaxSteps(value) {
  return clampInteger(value, AI_AGENT_MIN_STEPS, AI_AGENT_MAX_CONFIGURABLE_STEPS, AI_AGENT_MAX_STEPS);
}

export function normalizeAiAgentMaxDurationMs(value) {
  const minutes = clampInteger(
    value,
    AI_AGENT_MIN_DURATION_MINUTES,
    AI_AGENT_MAX_DURATION_MINUTES,
    Math.round(AI_AGENT_MAX_DURATION_MS / 60_000)
  );
  return minutes * 60_000;
}

export function sanitizeOutputDir(value) {
  const raw = typeof value === 'string' ? value : DEFAULT_SETTINGS.outputDir;
  const normalized = raw.replaceAll('\\', '/').trim();
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[<>:"|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return segments.join('/') || DEFAULT_SETTINGS.outputDir;
}

export function getEffectivePromptConfig(settings = {}) {
  const presetKey = getPromptPresetKey(settings.promptPreset);
  const preset = getPromptPreset(presetKey);
  if (presetKey !== 'custom') {
    return preset;
  }

  return {
    ...preset,
    systemPrompt: settings.customSystemPrompt || PROMPT_PRESETS.default.systemPrompt,
    userPromptTemplate: settings.customUserPrompt || PROMPT_PRESETS.default.userPromptTemplate
  };
}

export function renderPromptTemplate(template, context) {
  const rendered = String(template || '').replace(/{{\s*(\w+)\s*}}/g, (_, key) =>
    Object.hasOwn(context, key) ? String(context[key] ?? '') : ''
  );

  return rendered
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n')
    .trim();
}
