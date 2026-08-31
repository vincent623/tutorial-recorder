import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCdpDebuggerAttachError } from '../../background/recording-target.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const popup = await readFile(path.join(repoRoot, 'popup/popup.js'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));
const [major, minor, patch] = packageJson.version.split('.').map((part) => Number.parseInt(part, 10));

const conflict = normalizeCdpDebuggerAttachError(
  new Error('Cannot access a chrome-extension:// URL of different extension'),
  'AI 录制',
  { id: 42, url: 'https://www.google.com/' }
);

const invalidTarget = normalizeCdpDebuggerAttachError(
  new Error('Cannot access a chrome-extension:// URL of different extension'),
  'AI 录制',
  { id: 43, url: 'chrome-extension://other/settings.html' }
);

const checks = [
  {
    name: 'release version is at least 2.8.4',
    pass:
      (major > 2 || (major === 2 && (minor > 8 || (minor === 8 && patch >= 4)))) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'debugger ownership conflict is not misreported as an extension page',
    pass:
      conflict.code === 'CDP_DEBUGGER_UNAVAILABLE' &&
      /其他扩展或开发者工具控制/.test(conflict.message) &&
      invalidTarget.code === 'RECORDING_TARGET_UNAVAILABLE'
  },
  {
    name: 'failed AI startup suppresses duplicate alerts and rehydrates idle state',
    pass:
      /let aiStartPending = false/.test(popup) &&
      /if \(!aiStartPending\) \{\s*alert\(`错误：/.test(popup) &&
      /if \(!result\?\.ok\) \{\s*await hydrate\(\)\.catch/.test(popup)
  }
];

for (const check of checks) {
  assert.equal(check.pass, true, check.name);
  console.log(`PASS ${check.name}`);
}
