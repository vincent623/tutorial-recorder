import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  popup: 'popup/popup.js',
  background: 'background/',
  e2e: 'scripts/e2e/validate-extension.mjs',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json',
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
    name: 'version metadata is aligned at or above 2.2.2',
    pass:
      versionAtLeast(packageJson.version, '2.2.2') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'popup resolves a recordable target tab instead of blindly using the active extension tab',
    pass:
      /const RECORDABLE_TAB_PROTOCOLS = new Set\(\['http:', 'https:', 'file:'\]\)/.test(source.popup) &&
      /async function getRecordingTargetTab\(\)/.test(source.popup) &&
      /function isRecordableTab\(tab\)/.test(source.popup) &&
      /function isRecordablePageUrl\(url\)/.test(source.popup) &&
      /new URL\(url\)\.protocol/.test(source.popup)
  },
  {
    name: 'manual and AI popup starts both use the target resolver',
    pass:
      /async function startRecording\(\) \{[\s\S]*?const tab = await getRecordingTargetTab\(\);[\s\S]*?sendAction\('startRecording'/.test(
        source.popup
      ) &&
      /async function startAiRecording\(\) \{[\s\S]*?const tab = await getRecordingTargetTab\(\);[\s\S]*?sendAction\('startAiRecording'/.test(
        source.popup
      )
  },
  {
    name: 'background validates and activates target tabs before recording startup',
    pass:
      /const RECORDABLE_PAGE_PROTOCOLS = new Set\(\['http:', 'https:', 'file:'\]\)/.test(source.background) &&
      /async function getRecordingStartTargetTab\(tabId, modeLabel, options = \{\}\)/.test(source.background) &&
      /function assertRecordingTargetTab\(tab, modeLabel, options = \{\}\)/.test(source.background) &&
      /chrome\.tabs\.update\(tab\.id, \{ active: true \}\)/.test(source.background) &&
      /let tab = await getRecordingStartTargetTab\(tabId, '录制', targetOptions\);\n  const settings = await getSettings\(\);/.test(
        source.background
      ) &&
      /let tab = await getRecordingStartTargetTab\(tabId, 'AI 录制', targetOptions\);\n  const settings = await getSettings\(\);/.test(
        source.background
      )
  },
  {
    name: 'background rejects extension and browser-internal URLs with a user-facing error',
    pass:
      /当前标签页是扩展页或浏览器内部页面/.test(source.background) &&
      /无法开始 AI 录制/.test(source.background) &&
      /\^\(chrome\|chrome-extension\|edge\|brave\|vivaldi\|opera\|about\|devtools\):/.test(
        source.background
      )
  },
  {
    name: 'e2e covers AI rejection for extension-page targets without leaking Chrome raw errors',
    pass:
      /invalidAiTargetGuardPassed/.test(source.e2e) &&
      /action: 'startAiRecording'/.test(source.e2e) &&
      /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/.test(source.e2e) &&
      /Cannot access a chrome-extension/.test(source.e2e) &&
      /aiRejectsExtensionTarget/.test(source.e2e)
  },
  {
    name: 'watchdog knows the v2.2.2 target-tab guard task',
    pass: /v2\.2\.2-target-tab-guard/.test(source.watchdog) && /v2\.2\.2-target-tab-guard/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.2.2 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
