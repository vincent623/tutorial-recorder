import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  background: 'background/background.js',
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
    if ((currentParts[index] || 0) > (minimumParts[index] || 0)) {
      return true;
    }

    if ((currentParts[index] || 0) < (minimumParts[index] || 0)) {
      return false;
    }
  }

  return true;
}

const checks = [
  {
    name: 'version metadata is aligned at or above 2.2.6',
    pass:
      versionAtLeast(packageJson.version, '2.2.6') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'recording target validation requires a committed recordable URL',
    pass:
      /const committedUrl = tab\.url \|\| ''/.test(source.background) &&
      /const pendingUrl = tab\.pendingUrl \|\| ''/.test(source.background) &&
      /if \(!isRecordablePageUrl\(committedUrl\)\) \{[\s\S]*?return false;[\s\S]*?\}/.test(source.background) &&
      /return !pendingUrl \|\| isRecordablePageUrl\(pendingUrl\)/.test(source.background)
  },
  {
    name: 'target errors are machine-readable for controlled retry decisions',
    pass:
      /error\.code = 'RECORDING_TARGET_UNAVAILABLE'/.test(source.background) &&
      /function isRecordingTargetError\(error\)/.test(source.background) &&
      /error\?\.code === 'RECORDING_TARGET_UNAVAILABLE'/.test(source.background)
  },
  {
    name: 'AI CDP attach retries once with a fresh fallback target',
    pass:
      /async function attachAiCdpDebuggerWithFallback\(initialTab, options = \{\}\)/.test(source.background) &&
      /await attachCdpDebugger\(initialTab\.id, \{[\s\S]*?modeLabel: 'AI 录制'/.test(source.background) &&
      /!targetOptions\.allowFallbackTarget \|\| !isRecordingTargetError\(error\)/.test(source.background) &&
      /const fallbackTab = await findBestRecordingStartTargetTab\(initialTab\.id, targetOptions\)/.test(source.background) &&
      /await attachCdpDebugger\(activatedTab\.id, \{[\s\S]*?modeLabel: 'AI 录制'/.test(source.background)
  },
  {
    name: 'AI fallback target updates persisted runtime before continuing',
    pass:
      /currentRuntime\.tabId = activatedTab\.id/.test(source.background) &&
      /currentRuntime\.windowId = activatedTab\.windowId/.test(source.background) &&
      /await persistRuntime\(\);[\s\S]*?notifyAiStatus\(\);[\s\S]*?await attachCdpDebugger\(activatedTab\.id/.test(
        source.background
      )
  },
  {
    name: 'AI startup uses the retry helper and cleans up the current runtime target',
    pass:
      /tab = await attachAiCdpDebuggerWithFallback\(tab, targetOptions\)/.test(source.background) &&
      /await detachCdpDebugger\(currentRuntime\.tabId \|\| tab\.id\)/.test(source.background)
  },
  {
    name: 'CDP attach accepts a caller supplied target error context',
    pass:
      /async function attachCdpDebugger\(tabId, options = \{\}\)/.test(source.background) &&
      /const modeLabel = options\.modeLabel \|\| 'CDP 录制'/.test(source.background) &&
      /throw normalizeRecordingTargetError\(error, modeLabel\)/.test(source.background)
  },
  {
    name: 'watchdog knows the v2.2.6 AI CDP retry task',
    pass:
      /v2\.2\.6-ai-cdp-target-retry/.test(source.watchdog) &&
      /v2\.2\.6-ai-cdp-target-retry/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.2.6 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
