import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const recordingTarget = await readFile(path.join(repoRoot, 'background/recording-target.js'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));

const checks = [
  {
    name: 'release version remains at or above 2.8.2',
    pass:
      Number(manifest.version.split('.')[0]) > 2 ||
      (Number(manifest.version.split('.')[0]) === 2 &&
        (Number(manifest.version.split('.')[1]) > 8 ||
          (Number(manifest.version.split('.')[1]) === 8 &&
            Number(manifest.version.split('.')[2]) >= 2)))
  },
  {
    name: 'an already-focused target window is not focused again',
    pass:
      /chrome\.windows\.get\(tab\.windowId\)/.test(recordingTarget) &&
      /targetWindow\.focused !== true/.test(recordingTarget)
  },
  {
    name: 'an already-active target tab is not activated again',
    pass:
      /const activatedTab = tab\.active\s*\? tab\s*:\s*await chrome\.tabs\.update/.test(recordingTarget)
  }
];

for (const check of checks) {
  assert.equal(check.pass, true, check.name);
  console.log(`PASS ${check.name}`);
}
