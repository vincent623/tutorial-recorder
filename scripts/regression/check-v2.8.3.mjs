import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const recordingTarget = await readFile(path.join(repoRoot, 'background/recording-target.js'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));
const [major, minor, patch] = packageJson.version.split('.').map((part) => Number.parseInt(part, 10));

const checks = [
  {
    name: 'release version is at least 2.8.3',
    pass:
      (major > 2 || (major === 2 && (minor > 8 || (minor === 8 && patch >= 3)))) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'an active target never triggers a focus call that closes the action popup',
    pass:
      /if \(!tab\.active && typeof tab\.windowId === 'number'/.test(recordingTarget) &&
      /const activatedTab = tab\.active\s*\? tab\s*:\s*await chrome\.tabs\.update/.test(recordingTarget)
  }
];

for (const check of checks) {
  assert.equal(check.pass, true, check.name);
  console.log(`PASS ${check.name}`);
}
