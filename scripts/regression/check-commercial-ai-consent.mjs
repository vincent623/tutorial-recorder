import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasVisionAnalysisConfig, isSecureAiEndpoint } from '../../background/ai-vision.js';
import {
  beginAiRequestConfigurationChange,
  createTrackedAiRequestController,
  finishAiRequestConfigurationChange,
  getAiRequestConfigurationEpoch,
  releaseTrackedAiRequestController
} from '../../background/ai-request-control.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../background/settings-schema.js';

const configured = {
  ...DEFAULT_SETTINGS,
  apiBaseUrl: 'https://api.example.com',
  apiKey: 'test-only-key',
  modelId: 'vision-model'
};

assert.equal(DEFAULT_SETTINGS.aiDataSharingConsent, false, 'AI screenshot sharing must be opt-in');
assert.equal(hasVisionAnalysisConfig(configured), false, 'credentials alone must not authorize screenshot upload');
assert.equal(
  hasVisionAnalysisConfig(normalizeSettings({ ...configured, aiDataSharingConsent: true })),
  true,
  'explicit consent enables configured AI features'
);
console.log('ok - AI screenshot sharing is explicit opt-in and revocable through settings');

assert.equal(isSecureAiEndpoint('https://api.example.com/v1'), true, 'HTTPS provider endpoints are allowed');
assert.equal(isSecureAiEndpoint('http://127.0.0.1:8080/v1'), true, 'loopback development endpoints are allowed');
assert.equal(isSecureAiEndpoint('http://localhost:8080/v1'), true, 'localhost development endpoints are allowed');
assert.equal(isSecureAiEndpoint('http://api.example.com/v1'), false, 'remote plaintext endpoints are rejected');
assert.equal(isSecureAiEndpoint('https://user:pass@api.example.com/v1'), false, 'URL-embedded credentials are rejected');
assert.equal(
  hasVisionAnalysisConfig({ ...configured, aiDataSharingConsent: true, apiBaseUrl: 'http://api.example.com/v1' }),
  false,
  'credentials and consent cannot enable plaintext remote screenshot upload'
);
console.log('ok - AI credentials and screenshots only use HTTPS or explicit loopback endpoints');

const tutorialGeneratorSource = await readFile(new URL('../../background/tutorial-generator.js', import.meta.url), 'utf8');
const aiVisionSource = await readFile(new URL('../../background/ai-vision.js', import.meta.url), 'utf8');
const observationDecisionSource = await readFile(new URL('../../background/agent-observation-decision.js', import.meta.url), 'utf8');
const settingsServiceSource = await readFile(new URL('../../background/settings-service.js', import.meta.url), 'utf8');
const requestControlSource = await readFile(new URL('../../background/ai-request-control.js', import.meta.url), 'utf8');
const settingsHtml = await readFile(new URL('../../settings/settings.html', import.meta.url), 'utf8');
const privacyPolicy = await readFile(new URL('../../docs/privacy-policy-zh.md', import.meta.url), 'utf8');
const storeListing = await readFile(new URL('../../memory/store-listing.md', import.meta.url), 'utf8');
const gitignore = await readFile(new URL('../../.gitignore', import.meta.url), 'utf8');
assert.match(settingsHtml, /页面截图和脱敏控件摘要发送给所选 AI 服务商/);
assert.match(settingsHtml, /不发送输入值、原始 DOM、Cookie、Storage 或 URL 参数/);
assert.match(privacyPolicy, /决策截图只在当前请求期间存于内存/);
assert.match(privacyPolicy, /不包含输入值、隐藏或屏幕外元素清单、原始 HTML\/DOM、Cookie、Storage、完整链接/);
assert.match(storeListing, /带编号决策截图仅在请求期间存于内存/);
assert.match(gitignore, /^chats\/$/m, 'local conversation archives must not be committed');
console.log('ok - consent, privacy policy, and store disclosure describe the remote observation projection');
const workerSource = tutorialGeneratorSource.match(/export async function runDescriptionAnalysisWorker[\s\S]*?\n}\n/)?.[0] || '';
assert.match(workerSource, /while \(queue\.length\)[\s\S]*await getSettings\(\)/, 'each queue iteration must reload settings');
assert.match(workerSource, /hasVisionAnalysisConfig\(settings\)/, 'each queue iteration must recheck consent');
console.log('ok - batch workers recheck AI sharing consent before every queued screenshot');

assert.match(aiVisionSource, /for \(let attempt[\s\S]*await getSettings\(\)[\s\S]*fetch\(request\.url/, 'vision retries must reload consent before fetch');
assert.match(observationDecisionSource, /async function request[\s\S]*await readSettings\(\)[\s\S]*fetchImpl\(requestData\.url/, 'agent retries must reload consent before fetch');
const originalEpoch = getAiRequestConfigurationEpoch();
const activeController = createTrackedAiRequestController(originalEpoch);
beginAiRequestConfigurationChange();
assert.equal(activeController.signal.aborted, true, 'configuration changes abort active requests');
beginAiRequestConfigurationChange();
assert.throws(
  () => createTrackedAiRequestController(getAiRequestConfigurationEpoch()),
  { name: 'AISharingRevokedError' },
  'new requests remain blocked while settings are being written'
);
finishAiRequestConfigurationChange();
assert.throws(
  () => createTrackedAiRequestController(getAiRequestConfigurationEpoch()),
  { name: 'AISharingRevokedError' },
  'overlapping settings writes keep request admission blocked until the final writer exits'
);
finishAiRequestConfigurationChange();
assert.throws(
  () => createTrackedAiRequestController(originalEpoch),
  { name: 'AISharingRevokedError' },
  'a request holding the pre-change epoch cannot start after settings are written'
);
const currentController = createTrackedAiRequestController(getAiRequestConfigurationEpoch());
releaseTrackedAiRequestController(currentController);
assert.match(requestControlSource, /aiRequestsBlocked[\s\S]*expectedEpoch !== aiRequestConfigurationEpoch/, 'request admission must enforce both the write gate and configuration epoch');
assert.match(requestControlSource, /aiRequestConfigurationChangeDepth[\s\S]*aiRequestsBlocked = aiRequestConfigurationChangeDepth > 0/, 'overlapping settings writes must use a reentrant admission gate');
assert.match(settingsServiceSource, /beginAiRequestConfigurationChange\(\)[\s\S]*chrome\.storage\.local\.set[\s\S]*finally[\s\S]*finishAiRequestConfigurationChange\(\)/, 'settings writes must stay inside the blocked request window');
assert.match(
  settingsServiceSource,
  /settingsWriteQueue\.then\(\(\) => performSaveSettings\(settings\)\)[\s\S]*async function performSaveSettings[\s\S]*await getSettings\(\)/,
  'all settings writes must serialize before rereading and merging the latest stored settings'
);
console.log('ok - revoking consent aborts active requests, blocks the write window, and rejects stale request epochs');
