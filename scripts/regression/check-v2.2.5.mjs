import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  popup: 'popup/popup.js',
  background: 'background/background.js',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json',
  watchdog: 'scripts/dev-watchdog.mjs',
  progress: 'memory/dev-loop-progress.md',
  aiSmoke: 'scripts/e2e/ai-recording-smoke.mjs'
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
    name: 'version metadata is aligned at or above 2.2.5',
    pass:
      versionAtLeast(packageJson.version, '2.2.5') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'popup marks recording starts as allowed to use background fallback target selection',
    pass:
      /sendAction\('startRecording', \{[\s\S]*?allowFallbackTarget: true[\s\S]*?\}\)/.test(source.popup) &&
      /sendAction\('startAiRecording', \{[\s\S]*?allowFallbackTarget: true[\s\S]*?\}\)/.test(source.popup)
  },
  {
    name: 'background accepts fallback only for explicitly marked popup starts',
    pass:
      /startRecording\(message\.tabId, \{[\s\S]*?allowFallbackTarget: message\.allowFallbackTarget === true/.test(
        source.background
      ) &&
      /startAiRecording\(message\.tabId, message\.targetDescription \|\| '', \{[\s\S]*allowFallbackTarget: message\.allowFallbackTarget === true/.test(
        source.background
      ) &&
      /async function getRecordingStartTargetTab\(tabId, modeLabel, options = \{\}\)/.test(source.background)
  },
  {
    name: 'background can find a safe fallback tab when the requested tab is not recordable',
    pass:
      /async function findBestRecordingStartTargetTab\(excludedTabId, options = \{\}\)/.test(source.background) &&
      /chrome\.tabs\.query\(\{\}\)/.test(source.background) &&
      /\.filter\(\(tab\) => isRecordingTargetTab\(tab, options\)\)/.test(source.background) &&
      /function compareRecordingStartTargetTabs\(left, right\)/.test(source.background)
  },
  {
    name: 'AI smoke starts from an extension tab id to cover background fallback',
    pass:
      /fallbackStartResult/.test(source.aiSmoke) &&
      /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/.test(source.aiSmoke) &&
      /action: 'startAiRecording'/.test(source.aiSmoke) &&
      /allowFallbackTarget: true/.test(source.aiSmoke) &&
      /fallbackStartedFromExtensionTab/.test(source.aiSmoke)
  },
  {
    name: 'tab reads and CDP attach normalize raw chrome-extension URL errors',
    pass:
      /async function getTabByIdSafely\(tabId\)/.test(source.background) &&
      /function normalizeRecordingTargetError\(error, modeLabel\)/.test(source.background) &&
      /chrome-extension:\\\/\\\//.test(source.background) &&
      /Cannot access \.\* URL/.test(source.background) &&
      /await chrome\.debugger\.attach\(target, CDP_PROTOCOL_VERSION\)\.catch/.test(source.background) &&
      /assertRecordingTargetTab\(tab, modeLabel, targetOptions\)/.test(source.background)
  },
  {
    name: 'watchdog knows the v2.2.5 background target fallback task',
    pass:
      /v2\.2\.5-background-target-fallback/.test(source.watchdog) &&
      /v2\.2\.5-background-target-fallback/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.2.5 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
