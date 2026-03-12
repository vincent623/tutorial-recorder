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
  siliconFlow: {
    apiBaseUrl: 'https://api.siliconflow.com/v1',
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
  openRouter: {
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    apiStyle: 'chatCompletions',
    modelLabel: '模型 ID',
    modelHint: 'OpenRouter 填模型路由名，例如 anthropic/claude-3.5-sonnet 或 google/gemini-2.5-flash。',
    apiBaseHint: '建议配合附加 Header JSON 一起使用，例如 HTTP-Referer 和 X-Title。'
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

const CAPTURE_MODE_HINTS = {
  displayMedia: '开始录制时会弹出共享画面选择，并额外请求麦克风权限。',
  tabCapture: '直接录制当前标签页，适合自动化验证或兼容场景，通常不会弹出共享选择。'
};

const elements = {
  saveStatus: $('saveStatus'),
  captureMode: $('captureMode'),
  captureModeHint: $('captureModeHint'),
  interval: $('interval'),
  autoScreenshot: $('autoScreenshot'),
  outputDir: $('outputDir'),
  btnResetDir: $('btnResetDir'),
  outputPreviewValue: $('outputPreviewValue'),
  outputPreviewHint: $('outputPreviewHint'),
  promptForSaveAs: $('promptForSaveAs'),
  providerPreset: $('providerPreset'),
  apiStyle: $('apiStyle'),
  apiKey: $('apiKey'),
  apiBaseUrl: $('apiBaseUrl'),
  apiBaseHint: $('apiBaseHint'),
  modelId: $('modelId'),
  modelLabel: $('modelLabel'),
  modelHint: $('modelHint'),
  extraHeadersJson: $('extraHeadersJson')
};

let saveTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  await hydrate();
  bindEvents();
});

async function hydrate() {
  const snapshot = await sendAction('getPopupState');
  if (!snapshot?.ok) {
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
  elements.outputDir.addEventListener('input', updateOutputPreview);
  elements.outputDir.addEventListener('change', saveSettings);
  elements.btnResetDir.addEventListener('click', resetOutputDir);
  elements.promptForSaveAs.addEventListener('change', handlePromptForSaveAsChange);
  elements.providerPreset.addEventListener('change', handleProviderPresetChange);
  elements.apiStyle.addEventListener('change', saveSettings);
  elements.apiKey.addEventListener('change', saveSettings);
  elements.apiBaseUrl.addEventListener('change', saveSettings);
  elements.modelId.addEventListener('change', saveSettings);
  elements.extraHeadersJson.addEventListener('change', saveSettings);
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
    outputDir: elements.outputDir.value.trim(),
    promptForSaveAs: elements.promptForSaveAs.checked,
    providerPreset: elements.providerPreset.value,
    apiStyle: elements.apiStyle.value,
    apiKey: elements.apiKey.value.trim(),
    apiBaseUrl: elements.apiBaseUrl.value.trim(),
    modelId: elements.modelId.value.trim(),
    extraHeadersJson
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

async function resetOutputDir() {
  elements.outputDir.value = DEFAULT_OUTPUT_DIR;
  updateOutputPreview();
  await saveSettings();
}

function applySettingsToForm(settings = {}) {
  elements.captureMode.value = settings.captureMode || 'displayMedia';
  elements.interval.value = settings.screenshotInterval || 5;
  elements.autoScreenshot.checked = settings.autoScreenshot !== false;
  elements.outputDir.value = settings.outputDir || DEFAULT_OUTPUT_DIR;
  elements.promptForSaveAs.checked = settings.promptForSaveAs === true;
  elements.providerPreset.value = settings.providerPreset || 'volcengineArk';
  elements.apiStyle.value = settings.apiStyle || 'chatCompletions';
  elements.apiKey.value = settings.apiKey || '';
  elements.apiBaseUrl.value = settings.apiBaseUrl || '';
  elements.modelId.value = settings.modelId || '';
  elements.extraHeadersJson.value = settings.extraHeadersJson || '';
  updateCaptureModeHint();
  updateProviderUi();
  updateOutputPreview();
}

function updateCaptureModeHint() {
  elements.captureModeHint.textContent =
    CAPTURE_MODE_HINTS[elements.captureMode.value] || CAPTURE_MODE_HINTS.displayMedia;
}

function updateProviderUi() {
  const preset = PROVIDER_PRESETS[elements.providerPreset.value] || PROVIDER_PRESETS.custom;
  elements.modelLabel.textContent = preset.modelLabel;
  elements.modelHint.textContent = preset.modelHint;
  elements.apiBaseHint.textContent = preset.apiBaseHint;
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

function sendAction(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, ...payload });
}
