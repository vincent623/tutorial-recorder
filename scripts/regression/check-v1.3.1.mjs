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
  popup: 'popup/popup.js'
};

const source = await readSources(repoRoot, files);

const packageJson = JSON.parse(source.packageJson);
const packageLock = JSON.parse(source.packageLock);
const manifest = JSON.parse(source.manifest);

const checks = [
  {
    name: 'package, lockfile, and manifest versions stay aligned',
    pass:
      /^\d+\.\d+\.\d+$/.test(packageJson.version) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'manual screenshot remains allowed while recording is paused',
    pass:
      (/case 'manualCapture':[\s\S]*captureScreenshot\(\{\s*trigger: 'manual',\s*allowWhenPaused: true\s*\}\)/.test(
        source.background
      ) ||
        /case 'manualCapture':[\s\S]*captureScreenshot\(\{[\s\S]*trigger: 'manual',[\s\S]*allowWhenPaused: true,[\s\S]*operationId: message\.operationId[\s\S]*\}\)/.test(
          source.background
        )) &&
      /elements\.btnCapture\.disabled = !state\.isRecording \|\| state\.isGenerating;/.test(source.popup) &&
      !/elements\.btnCapture\.disabled = [^;]*state\.isPaused/.test(source.popup)
  },
  {
    name: 'AI API failures surface HTTP status before falling back',
    pass:
      /HTTP \$\{response\.status\}/.test(source.background) &&
      /describeAiFailureForUser\(error\)/.test(source.background) &&
      /notifyPopup\('warning', \{[\s\S]*describeAiFailureForUser\(error\)[\s\S]*已改用默认说明继续导出/.test(
        source.background
      )
  },
  {
    name: 'history caps and export path display remain in place',
    pass:
      /HISTORY_MAX_ENTRIES = 100/.test(source.background) &&
      /\.slice\(0, HISTORY_MAX_ENTRIES\)/.test(source.background) &&
      /history\.slice\(0, 3\)/.test(source.popup) &&
      /formatDownloadsPath\(exportBaseName\)/.test(source.popup)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`Regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
