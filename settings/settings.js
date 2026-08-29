const $ = (id) => document.getElementById(id);
const DEFAULT_OUTPUT_DIR = 'tutorial-recorder';
const PROVIDER_PRESETS = {
  volcengineArk: {
    apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 / Endpoint ID',
    modelHint: '火山方舟填 Endpoint ID，例如 ep-xxxx。',
    apiBaseHint: '会自动补成 /chat/completions，适合方舟视觉模型。'
  },
  zhipuBigModel: {
    apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: '智谱填视觉模型 ID，例如 glm-4v-plus 或 glm-4.5v。',
    apiBaseHint: '走智谱开放平台 OpenAI 兼容接口，基地址会自动补成 /chat/completions。'
  },
  siliconFlow: {
    apiBaseUrl: 'https://api.siliconflow.cn/v1',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: '硅基流动填支持视觉的模型 ID，例如 Qwen/QVQ/VLM 系列。',
    apiBaseHint: '走 OpenAI 兼容 Chat Completions，基地址会自动补成 /chat/completions。'
  },
  aliyunDashScope: {
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: '阿里云百炼填视觉模型 ID，例如 qwen-vl 系列。',
    apiBaseHint: '走百炼 OpenAI 兼容模式，基地址会自动补成 /chat/completions。'
  },
  moonshot: {
    apiBaseUrl: 'https://api.moonshot.cn/v1',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: '月之暗面填视觉模型 ID，例如 moonshot-v1-8k-vision-preview。',
    apiBaseHint: '走 Kimi OpenAI 兼容接口，基地址会自动补成 /chat/completions。'
  },
  openRouter: {
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: 'OpenRouter 填模型路由名，例如 anthropic/claude-3.5-sonnet 或 google/gemini-2.5-flash。',
    apiBaseHint: '建议配合附加 Header JSON 一起使用，例如 HTTP-Referer 和 X-Title。'
  },
  groq: {
    apiBaseUrl: 'https://api.groq.com/openai/v1',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: 'Groq 填支持视觉的模型 ID，例如 meta-llama/llama-4-scout-17b-16e-instruct。',
    apiBaseHint: 'Groq 以极低延迟著称，走 OpenAI 兼容接口。'
  },
  mistral: {
    apiBaseUrl: 'https://api.mistral.ai/v1',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: 'Mistral 填视觉模型 ID，例如 mistral-medium-latest 或 pixtral-12b。',
    apiBaseHint: '走 Mistral OpenAI 兼容接口，基地址会自动补成 /chat/completions。'
  },
  azureOpenAI: {
    apiBaseUrl: '',
    apiStyle: 'chatCompletions',
    modelLabel: '部署名 / 模型 ID',
    modelHint: '填 Azure 部署名或模型 ID，例如 gpt-4.1-mini。',
    apiBaseHint: '填 https://<你的资源名>.openai.azure.com/openai/v1（v1 兼容层免部署路径），Key 用资源密钥。'
  },
  oneApiRelay: {
    apiBaseUrl: '',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: '填中转站里的模型名，例如 gpt-4o、Qwen/Qwen3-VL-32B-Instruct 等。',
    apiBaseHint: 'One API / New API 等自建中转填站点基地址（通常以 /v1 结尾），Key 用中转站令牌。'
  },
  googleGemini: {
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: 'Google Gemini 填模型 ID，例如 gemini-2.0-flash 或 gemini-2.5-flash。',
    apiBaseHint: '使用 Google 官方 OpenAI 兼容入口，基地址会自动补成 /chat/completions。'
  },
  anthropicClaude: {
    apiBaseUrl: 'https://api.anthropic.com/v1',
    apiStyle: 'anthropicMessages',
    modelLabel: 'Claude 模型 ID',
    modelHint: 'Claude 建议填官方模型名，例如 claude-3-7-sonnet-latest。',
    apiBaseHint: '会直接调用 Anthropic 原生 /messages 接口，不走 OpenAI 兼容层。'
  },
  openai: {
    apiBaseUrl: 'https://api.openai.com/v1',
    apiStyle: 'responses',
    modelLabel: '模型 ID',
    modelHint: 'OpenAI 填模型 ID，例如 gpt-4.1-mini 或 gpt-4.1。',
    apiBaseHint: '会自动补成 /responses，适合 OpenAI 原生视觉接口。'
  },
  openaiCompatible: {
    apiBaseUrl: 'https://api.openai.com/v1',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: '适合兼容 OpenAI Chat Completions 的网关或代理。',
    apiBaseHint: '只填基地址即可，插件会自动补成 /chat/completions。'
  },
  custom: {
    apiBaseUrl: '',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 / Endpoint ID',
    modelHint: '你可以自行指定任意 OpenAI 兼容网关的模型名或 Endpoint ID。',
    apiBaseHint: '支持任意 OpenAI 兼容基地址，路径会按 API 风格自动拼接。'
  }
};

const PROMPT_PRESETS = {
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

const CAPTURE_MODE_HINTS = {
  displayMedia: '开始录制时会弹出共享画面选择，并额外请求麦克风权限。',
  tabCapture: '直接录制当前标签页，适合自动化验证或兼容场景，通常不会弹出共享选择。'
};

const SCREENSHOT_ENGINE_HINTS = {
  standard: '标准模式不触发 Chrome 调试提示，适合日常录制。',
  cdp: 'CDP 模式会使用 chrome.debugger 截图，可在目标标签页不在前台时继续捕获画面。'
};

const elements = {
  saveStatus: $('saveStatus'),
  captureMode: $('captureMode'),
  captureModeHint: $('captureModeHint'),
  interval: $('interval'),
  autoScreenshot: $('autoScreenshot'),
  screenshotEngine: $('screenshotEngine'),
  screenshotEngineHint: $('screenshotEngineHint'),
  cdpCropEnabled: $('cdpCropEnabled'),
  cdpCropX: $('cdpCropX'),
  cdpCropY: $('cdpCropY'),
  cdpCropWidth: $('cdpCropWidth'),
  cdpCropHeight: $('cdpCropHeight'),
  btnClearCdpCrop: $('btnClearCdpCrop'),
  outputDir: $('outputDir'),
  btnResetDir: $('btnResetDir'),
  outputPreviewValue: $('outputPreviewValue'),
  outputPreviewHint: $('outputPreviewHint'),
  promptForSaveAs: $('promptForSaveAs'),
  providerPreset: $('providerPreset'),
  realtimeSuggestions: $('realtimeSuggestions'),
  aiAgentMaxSteps: $('aiAgentMaxSteps'),
  aiAgentMaxDurationMinutes: $('aiAgentMaxDurationMinutes'),
  advancedAiSettings: $('advancedAiSettings'),
  apiStyle: $('apiStyle'),
  apiKey: $('apiKey'),
  apiBaseUrl: $('apiBaseUrl'),
  apiBaseHint: $('apiBaseHint'),
  modelId: $('modelId'),
  modelLabel: $('modelLabel'),
  modelHint: $('modelHint'),
  extraHeadersJson: $('extraHeadersJson'),
  testConnectionBtn: $('testConnectionBtn'),
  testConnectionStatus: $('testConnectionStatus'),
  promptPreset: $('promptPreset'),
  promptPresetHint: $('promptPresetHint'),
  promptSystem: $('promptSystem'),
  promptUser: $('promptUser'),
  promptEditorHint: $('promptEditorHint')
};

let saveTimer = null;
let promptDraft = {
  systemPrompt: '',
  userPromptTemplate: ''
};

document.addEventListener('DOMContentLoaded', async () => {
  await hydrate();
  bindEvents();
});

async function hydrate() {
  const snapshot = await sendAction('getSecretSettings');
  if (!snapshot?.ok || !snapshot.settings) {
    setSaveStatus('加载失败，请重试。', false);
    return;
  }

  applySettingsToForm(snapshot.settings);
  setSaveStatus('已加载当前设置', true);
}

function bindEvents() {
  elements.captureMode.addEventListener('change', saveSettings);
  elements.interval.addEventListener('change', saveSettings);
  elements.autoScreenshot.addEventListener('change', saveSettings);
  elements.screenshotEngine.addEventListener('change', handleScreenshotEngineChange);
  elements.cdpCropEnabled.addEventListener('change', saveSettings);
  elements.cdpCropX.addEventListener('change', saveSettings);
  elements.cdpCropY.addEventListener('change', saveSettings);
  elements.cdpCropWidth.addEventListener('change', saveSettings);
  elements.cdpCropHeight.addEventListener('change', saveSettings);
  elements.btnClearCdpCrop.addEventListener('click', clearCdpCrop);
  elements.outputDir.addEventListener('input', updateOutputPreview);
  elements.outputDir.addEventListener('change', saveSettings);
  elements.btnResetDir.addEventListener('click', resetOutputDir);
  elements.promptForSaveAs.addEventListener('change', handlePromptForSaveAsChange);
  elements.providerPreset.addEventListener('change', handleProviderPresetChange);
  elements.realtimeSuggestions.addEventListener('change', saveSettings);
  elements.aiAgentMaxSteps.addEventListener('change', saveSettings);
  elements.aiAgentMaxDurationMinutes.addEventListener('change', saveSettings);
  elements.apiStyle.addEventListener('change', saveSettings);
  elements.apiKey.addEventListener('change', saveSettings);
  elements.apiBaseUrl.addEventListener('change', saveSettings);
  elements.modelId.addEventListener('change', saveSettings);
  elements.extraHeadersJson.addEventListener('change', saveSettings);
  elements.testConnectionBtn.addEventListener('click', handleTestConnection);
  elements.promptPreset.addEventListener('change', handlePromptPresetChange);
  elements.promptSystem.addEventListener('input', handlePromptDraftInput);
  elements.promptUser.addEventListener('input', handlePromptDraftInput);
  elements.promptSystem.addEventListener('change', handlePromptDraftCommit);
  elements.promptUser.addEventListener('change', handlePromptDraftCommit);
}

async function saveSettings() {
  const settings = readSettingsFromForm();
  if (!settings) {
    return;
  }

  setSaveStatus('正在保存...', false);
  const result = await sendAction('saveSettings', { settings });
  if (!result?.ok || !result.settings) {
    setSaveStatus('保存失败，请稍后重试。', false);
    return;
  }

  applySettingsToForm(result.settings);
  setSaveStatus('已自动保存', true);
}

async function handleTestConnection() {
  const button = elements.testConnectionBtn;
  if (!button || button.disabled) {
    return;
  }

  await saveSettings();

  button.disabled = true;
  setTestConnectionStatus('正在测试连接，最长约 45 秒...', 'pending');

  const result = await sendAction('testProviderConnection', {
    operationId: `settings-${Date.now().toString(36)}`
  }).catch((error) => ({ ok: false, error: error?.message || '测试请求发送失败' }));

  button.disabled = false;

  if (result?.ok) {
    setTestConnectionStatus(
      `连接成功：${result.modelId || ''} 响应 ${result.latencyMs ?? '?'}ms${result.reply ? `，回复“${result.reply}”` : ''}`,
      'success'
    );
    return;
  }

  const hint = result?.hint ? ` ${result.hint}` : '';
  setTestConnectionStatus(`连接失败：${result?.error || '未知错误'}。${hint}`.trim(), 'error');
}

function setTestConnectionStatus(text, tone) {
  if (!elements.testConnectionStatus) {
    return;
  }

  elements.testConnectionStatus.textContent = text;
  elements.testConnectionStatus.dataset.tone = tone || 'default';
}

function readSettingsFromForm() {
  const extraHeadersJson = elements.extraHeadersJson.value.trim();
  if (extraHeadersJson) {
    try {
      const parsed = JSON.parse(extraHeadersJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('附加请求头必须是 JSON 对象');
      }
    } catch (error) {
      setSaveStatus(`附加请求头格式不正确：${error.message}`, false);
      elements.extraHeadersJson.focus();
      return null;
    }
  }

  return {
    captureMode: elements.captureMode.value,
    screenshotInterval: parseInt(elements.interval.value, 10),
    autoScreenshot: elements.autoScreenshot.checked,
    screenshotEngine: elements.screenshotEngine.value,
    cdpCropEnabled: elements.cdpCropEnabled.checked,
    cdpCropX: parseInt(elements.cdpCropX.value, 10),
    cdpCropY: parseInt(elements.cdpCropY.value, 10),
    cdpCropWidth: parseInt(elements.cdpCropWidth.value, 10),
    cdpCropHeight: parseInt(elements.cdpCropHeight.value, 10),
    outputDir: elements.outputDir.value.trim(),
    promptForSaveAs: elements.promptForSaveAs.checked,
    providerPreset: elements.providerPreset.value,
    realtimeSuggestions: elements.realtimeSuggestions.checked,
    aiAgentMaxSteps: parseInt(elements.aiAgentMaxSteps.value, 10),
    aiAgentMaxDurationMinutes: parseInt(elements.aiAgentMaxDurationMinutes.value, 10),
    apiStyle: elements.apiStyle.value,
    apiKey: elements.apiKey.value.trim(),
    apiBaseUrl: elements.apiBaseUrl.value.trim(),
    modelId: elements.modelId.value.trim(),
    extraHeadersJson,
    promptPreset: elements.promptPreset.value,
    customSystemPrompt:
      elements.promptPreset.value === 'custom'
        ? elements.promptSystem.value
        : promptDraft.systemPrompt,
    customUserPrompt:
      elements.promptPreset.value === 'custom'
        ? elements.promptUser.value
        : promptDraft.userPromptTemplate
  };
}

async function handleProviderPresetChange() {
  const preset = PROVIDER_PRESETS[elements.providerPreset.value] || PROVIDER_PRESETS.custom;
  elements.apiStyle.value = preset.apiStyle;
  if (preset.apiBaseUrl) {
    elements.apiBaseUrl.value = preset.apiBaseUrl;
  }
  updateProviderUi();
  await saveSettings();
}

async function handlePromptForSaveAsChange() {
  updateOutputPreview();
  await saveSettings();
}

async function handleScreenshotEngineChange() {
  updateScreenshotEngineUi();
  await saveSettings();
}

async function handlePromptPresetChange() {
  updatePromptUi();
  await saveSettings();
}

function handlePromptDraftInput(event) {
  if (elements.promptPreset.value !== 'custom') {
    return;
  }

  if (event.target === elements.promptSystem) {
    promptDraft.systemPrompt = elements.promptSystem.value;
    return;
  }

  if (event.target === elements.promptUser) {
    promptDraft.userPromptTemplate = elements.promptUser.value;
  }
}

async function handlePromptDraftCommit() {
  if (elements.promptPreset.value !== 'custom') {
    return;
  }

  await saveSettings();
}

async function resetOutputDir() {
  elements.outputDir.value = DEFAULT_OUTPUT_DIR;
  updateOutputPreview();
  await saveSettings();
}

async function clearCdpCrop() {
  elements.cdpCropEnabled.checked = false;
  elements.cdpCropX.value = 0;
  elements.cdpCropY.value = 0;
  elements.cdpCropWidth.value = 0;
  elements.cdpCropHeight.value = 0;
  await saveSettings();
}

function applySettingsToForm(settings = {}) {
  elements.captureMode.value = settings.captureMode || 'displayMedia';
  elements.interval.value = settings.screenshotInterval || 5;
  elements.autoScreenshot.checked = settings.autoScreenshot !== false;
  elements.screenshotEngine.value = settings.screenshotEngine === 'cdp' ? 'cdp' : 'standard';
  elements.cdpCropEnabled.checked = settings.cdpCropEnabled === true;
  elements.cdpCropX.value = settings.cdpCropX || 0;
  elements.cdpCropY.value = settings.cdpCropY || 0;
  elements.cdpCropWidth.value = settings.cdpCropWidth || 0;
  elements.cdpCropHeight.value = settings.cdpCropHeight || 0;
  elements.outputDir.value = settings.outputDir || DEFAULT_OUTPUT_DIR;
  elements.promptForSaveAs.checked = settings.promptForSaveAs === true;
  elements.providerPreset.value = settings.providerPreset || 'volcengineArk';
  elements.realtimeSuggestions.checked = settings.realtimeSuggestions === true;
  elements.aiAgentMaxSteps.value = settings.aiAgentMaxSteps || 50;
  elements.aiAgentMaxDurationMinutes.value = settings.aiAgentMaxDurationMinutes || 10;
  elements.apiStyle.value = settings.apiStyle || 'chatCompletions';
  elements.apiKey.value = settings.apiKey || '';
  elements.apiBaseUrl.value = settings.apiBaseUrl || '';
  elements.modelId.value = settings.modelId || '';
  elements.extraHeadersJson.value = settings.extraHeadersJson || '';
  elements.promptPreset.value = settings.promptPreset || 'default';
  promptDraft = {
    systemPrompt: settings.customSystemPrompt || '',
    userPromptTemplate: settings.customUserPrompt || ''
  };
  updateCaptureModeHint();
  updateScreenshotEngineUi();
  updateProviderUi();
  updatePromptUi();
  updateOutputPreview();
}

function updateCaptureModeHint() {
  elements.captureModeHint.textContent =
    CAPTURE_MODE_HINTS[elements.captureMode.value] || CAPTURE_MODE_HINTS.displayMedia;
}

function updateScreenshotEngineUi() {
  const engine = elements.screenshotEngine.value === 'cdp' ? 'cdp' : 'standard';
  elements.screenshotEngineHint.textContent = SCREENSHOT_ENGINE_HINTS[engine];
  const cropDisabled = engine !== 'cdp';
  elements.cdpCropEnabled.disabled = cropDisabled;
  elements.cdpCropX.disabled = cropDisabled;
  elements.cdpCropY.disabled = cropDisabled;
  elements.cdpCropWidth.disabled = cropDisabled;
  elements.cdpCropHeight.disabled = cropDisabled;
  elements.btnClearCdpCrop.disabled = cropDisabled;
}

function updateProviderUi() {
  const preset = PROVIDER_PRESETS[elements.providerPreset.value] || PROVIDER_PRESETS.custom;
  elements.modelLabel.textContent = preset.modelLabel;
  elements.modelHint.textContent = preset.modelHint;
  elements.apiBaseHint.textContent = preset.apiBaseHint;
  syncAdvancedAiPanel();
}

function updatePromptUi() {
  const presetKey = elements.promptPreset.value || 'default';
  const preset = PROMPT_PRESETS[presetKey] || PROMPT_PRESETS.default;
  const isCustom = presetKey === 'custom';
  const fallbackPreset = PROMPT_PRESETS.default;

  elements.promptPresetHint.textContent = preset.description;
  elements.promptSystem.readOnly = !isCustom;
  elements.promptUser.readOnly = !isCustom;
  elements.promptSystem.classList.toggle('is-readonly', !isCustom);
  elements.promptUser.classList.toggle('is-readonly', !isCustom);
  elements.promptSystem.value = isCustom
    ? promptDraft.systemPrompt || fallbackPreset.systemPrompt
    : preset.systemPrompt;
  elements.promptUser.value = isCustom
    ? promptDraft.userPromptTemplate || fallbackPreset.userPromptTemplate
    : preset.userPromptTemplate;
  elements.promptEditorHint.textContent = isCustom
    ? '支持占位符：{{stepIndex}}、{{totalSteps}}、{{pageTitle}}、{{pageUrl}}、{{pageUrlLine}}、{{interactionSummary}}、{{previousDescription}}。'
    : '当前显示的是内置模板预览，切到“自定义”后可直接编辑。';
  syncAdvancedAiPanel();
}

function updateOutputPreview() {
  elements.outputPreviewValue.textContent = buildOutputPreviewPath();
  elements.outputPreviewHint.textContent = elements.promptForSaveAs.checked
    ? '开启询问后，Chrome 会只为这个 ZIP 文件弹出一次保存对话框。'
    : '导出时会在下载目录下生成这个 ZIP 文件。';
}

function buildOutputPreviewPath() {
  const outputDir = sanitizeOutputDir(elements.outputDir.value.trim());
  return `Downloads/${outputDir}/tutorial-YYYYMMDD-HHMMSS-录制ID.zip`;
}

function sanitizeOutputDir(value) {
  const raw = typeof value === 'string' && value.trim() ? value : DEFAULT_OUTPUT_DIR;
  const normalized = raw.replaceAll('\\', '/').trim();
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[<>:"|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return segments.join('/') || DEFAULT_OUTPUT_DIR;
}

function setSaveStatus(text, saved) {
  elements.saveStatus.textContent = text;
  elements.saveStatus.classList.toggle('is-saved', saved === true);

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (saved) {
    saveTimer = setTimeout(() => {
      elements.saveStatus.textContent = '修改后会自动保存';
      elements.saveStatus.classList.remove('is-saved');
    }, 1800);
  }
}

function syncAdvancedAiPanel() {
  const preset = PROVIDER_PRESETS[elements.providerPreset.value] || PROVIDER_PRESETS.custom;
  const promptPreset = elements.promptPreset.value || 'default';
  const currentApiBase = elements.apiBaseUrl.value.trim();
  const currentHeaders = elements.extraHeadersJson.value.trim();
  const shouldOpen =
    promptPreset === 'custom' ||
    Boolean(currentHeaders) ||
    elements.apiStyle.value !== preset.apiStyle ||
    (preset.apiBaseUrl || '') !== currentApiBase;

  elements.advancedAiSettings.open = elements.advancedAiSettings.open || shouldOpen;
}

function sendAction(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, ...payload });
}
