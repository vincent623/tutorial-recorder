import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json',
  background: 'background/',
  settings: 'settings/settings.js',
  settingsHtml: 'settings/settings.html',
  settingsCss: 'settings/settings.css',
  popup: 'popup/popup.js',
  e2e: 'scripts/e2e/validate-extension.mjs',
  watchdog: 'scripts/dev-watchdog.mjs',
  progress: 'memory/dev-loop-progress.md'
};

const source = await readSources(repoRoot, files);

const packageJson = JSON.parse(source.packageJson);
const packageLock = JSON.parse(source.packageLock);
const manifest = JSON.parse(source.manifest);

function versionAtLeast(version, minimum) {
  const currentParts = version.split('.').map((item) => Number.parseInt(item, 10));
  const minimumParts = minimum.split('.').map((item) => Number.parseInt(item, 10));

  for (let index = 0; index < minimumParts.length; index += 1) {
    if ((currentParts[index] || 0) > (minimumParts[index] || 0)) {
      return true;
    }

    if ((currentParts[index] || 0) < (minimumParts[index] || 0)) {
      return false;
    }
  }

  return true;
}

const relayPresets = ['groq', 'mistral', 'azureOpenAI', 'oneApiRelay'];

const checks = [
  {
    name: 'version metadata is aligned at or above 2.5.0',
    pass:
      versionAtLeast(packageJson.version, '2.5.0') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'overseas and relay provider presets are registered in the background',
    pass: relayPresets.every((preset) => new RegExp(`${preset}:\\s*\\{`).test(source.background))
  },
  {
    name: 'settings page documents every new preset with localized hints',
    pass:
      relayPresets.every((preset) => source.settings.includes(`${preset}: {`)) &&
      /openai\.azure\.com\/openai\/v1/.test(source.settings) &&
      /One API \/ New API/.test(source.settings)
  },
  {
    name: 'provider dropdown groups domestic, overseas, and relay providers',
    pass:
      /<optgroup label="国产模型">/.test(source.settingsHtml) &&
      /<optgroup label="海外模型">/.test(source.settingsHtml) &&
      /<optgroup label="中转与网关">/.test(source.settingsHtml) &&
      relayPresets.every((preset) => source.settingsHtml.includes(`value="${preset}"`))
  },
  {
    name: 'popup labels cover the new provider presets',
    pass:
      relayPresets.every((preset) => source.popup.includes(`${preset}: `)) &&
      /Azure OpenAI/.test(source.popup) &&
      /One API \/ 中转站/.test(source.popup)
  },
  {
    name: 'connection test action validates full provider chain with a minimal vision request',
    pass:
      /case 'testProviderConnection':/.test(source.background) &&
      /testProviderConnection\(message\.operationId\)/.test(source.background) &&
      /PROVIDER_TEST_IMAGE_DATA_URL/.test(source.background) &&
      /performTestProviderConnection/.test(source.background) &&
      /latencyMs/.test(source.background)
  },
  {
    name: 'connection test returns stepwise configuration guidance and relay hints',
    pass:
      /请先填写 API Base URL/.test(source.background) &&
      /请先填写 API Key/.test(source.background) &&
      /请先填写模型 \/ Endpoint ID/.test(source.background) &&
      /describeConnectionFailureHint/.test(source.background) &&
      /中转站需确认已启用该模型/.test(source.background) &&
      /自建 One API 本地部署可保留 http/.test(source.background)
  },
  {
    name: 'settings page exposes a styled test-connection control with tone feedback',
    pass:
      /testConnectionBtn/.test(source.settingsHtml) &&
      /handleTestConnection/.test(source.settings) &&
      /testProviderConnection/.test(source.settings) &&
      /primary-btn/.test(source.settingsCss) &&
      /data-tone='success'/.test(source.settingsCss)
  },
  {
    name: 'api key input opts out of browser password managers',
    pass: /autocomplete="new-password"/.test(source.settingsHtml)
  },
  {
    name: 'e2e covers connection-test guidance without provider configuration',
    pass:
      /testProviderConnection/.test(source.e2e) &&
      /connectionTestGuidance/.test(source.e2e)
  },
  {
    name: 'watchdog knows the v2.5.0 provider compatibility task',
    pass:
      /v2\.5\.0-global-provider-compatibility/.test(source.watchdog) &&
      /v2\.5\.0-global-provider-compatibility/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.5.0 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
