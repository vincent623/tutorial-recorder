import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  popup: 'popup/popup.js',
  e2e: 'scripts/e2e/validate-extension.mjs',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json',
  watchdog: 'scripts/dev-watchdog.mjs',
  progress: 'memory/dev-loop-progress.md'
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, relativePath]) => [
      key,
      await readFile(path.join(repoRoot, relativePath), 'utf8')
    ])
  )
);

const packageJson = JSON.parse(source.packageJson);
const packageLock = JSON.parse(source.packageLock);
const manifest = JSON.parse(source.manifest);

function versionAtLeast(version, minimum) {
  const currentParts = version.split('.').map((item) => Number.parseInt(item, 10));
  const minimumParts = minimum.split('.').map((item) => Number.parseInt(item, 10));

  for (let index = 0; index < minimumParts.length; index += 1) {
    if ((currentParts[index] || 0) > minimumParts[index]) {
      return true;
    }

    if ((currentParts[index] || 0) < minimumParts[index]) {
      return false;
    }
  }

  return true;
}

const checks = [
  {
    name: 'version metadata is aligned at or above 2.2.3',
    pass:
      versionAtLeast(packageJson.version, '2.2.3') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'AI start remains clickable when provider settings are missing',
    pass:
      /function hasAiSettingsConfigured\(settings = currentSettings\)/.test(source.popup) &&
      /elements\.btnAiStart\.disabled = state\.isRecording \|\| state\.isGenerating;/.test(source.popup) &&
      !/elements\.btnAiStart\.disabled = state\.isRecording \|\| state\.isGenerating \|\| !aiConfigured;/.test(
        source.popup
      )
  },
  {
    name: 'AI start click shows explicit missing-configuration feedback',
    pass:
      /if \(!hasAiSettingsConfigured\(\)\) \{[\s\S]*?elements\.aiStatus\.textContent = '需配置 AI';[\s\S]*?alert\('请先在完整设置中配置 AI Provider、API Key 和模型，然后再启动 AI 录制。'\);[\s\S]*?return;[\s\S]*?\}/.test(
        source.popup
      ) &&
      /elements\.btnAiStart\.title = aiConfigured/.test(source.popup)
  },
  {
    name: 'configured AI start gives immediate startup feedback',
    pass:
      /setLocalAiStartupFeedback\('正在启动 AI\.\.\.', 'starting'\);/.test(source.popup) &&
      /elements\.btnAiStart\.disabled = true;/.test(source.popup) &&
      /setLocalAiStartupFeedback\('AI 正在观察页面\.\.\.', 'running'\);/.test(source.popup) &&
      /await hydrate\(\)\.catch\(\(\) => \{\}\);/.test(source.popup)
  },
  {
    name: 'e2e verifies missing-config feedback instead of an inert button',
    pass:
      /aiStartEnabledWithoutConfig/.test(source.e2e) &&
      /aiMissingConfigDialogMessage/.test(source.e2e) &&
      /aiMissingConfigShowsFeedback/.test(source.e2e) &&
      /waitForDialogCount/.test(source.e2e)
  },
  {
    name: 'watchdog knows the v2.2.3 AI start feedback task',
    pass: /v2\.2\.3-ai-start-feedback/.test(source.watchdog) && /v2\.2\.3-ai-start-feedback/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.2.3 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
