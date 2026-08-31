import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const popup = await readFile(path.join(repoRoot, 'popup/popup.js'), 'utf8');
const workflow = await readFile(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));
const [major, minor, patch] = packageJson.version.split('.').map((part) => Number.parseInt(part, 10));

const checks = [
  {
    name: 'release version is at least 2.8.5',
    pass:
      (major > 2 || (major === 2 && (minor > 8 || (minor === 8 && patch >= 5)))) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'popup delegates a missing local target to background fallback',
    pass:
      /sendAction\('startRecording', \{\s*tabId: tab\?\.id \?\? null/.test(popup) &&
      /sendAction\('startAiRecording', \{\s*tabId: tab\?\.id \?\? null/.test(popup) &&
      !/if \(!tab\) \{\s*alert\(RECORDING_TARGET_HELP\)/.test(popup)
  },
  {
    name: 'CI runs the real action popup cross-window fallback smoke',
    pass:
      packageJson.scripts?.['smoke:action-popup-target'] === 'node scripts/e2e/action-popup-target-smoke.mjs' &&
      /npm run smoke:action-popup-target/.test(workflow)
  }
];

for (const check of checks) {
  assert.equal(check.pass, true, check.name);
  console.log(`PASS ${check.name}`);
}
