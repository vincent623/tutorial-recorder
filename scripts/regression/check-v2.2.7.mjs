import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  background: 'background/background.js',
  popup: 'popup/popup.js',
  aiSmoke: 'scripts/e2e/ai-recording-smoke.mjs',
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
    name: 'version metadata is aligned at or above 2.2.7',
    pass:
      versionAtLeast(packageJson.version, '2.2.7') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'popup forwards a concrete target URL with recording starts',
    pass:
      /targetUrl: getTabTargetUrl\(tab\)/.test(source.popup) &&
      /function getTabTargetUrl\(tab\)/.test(source.popup) &&
      /isRecordablePageUrl\(tab\?\.pendingUrl \|\| ''\)[\s\S]*?return tab\.pendingUrl/.test(source.popup)
  },
  {
    name: 'background receives and normalizes startup target URLs',
    pass:
      /targetUrl: message\.targetUrl \|\| ''/.test(source.background) &&
      /function normalizeRecordingTargetOptions\(options = \{\}\)/.test(source.background) &&
      /targetUrl: normalizeRecordableTargetUrl\(options\.targetUrl \|\| ''\)/.test(source.background)
  },
  {
    name: 'startup waits for recordable pending URLs to commit',
    pass:
      /const RECORDING_TARGET_COMMIT_TIMEOUT_MS = 8_000/.test(source.background) &&
      /async function getSettledRecordingTargetTab\(tabId, options = \{\}\)/.test(source.background) &&
      /isPendingRecordingTargetTab\(tab, options\)/.test(source.background) &&
      /await delay\(RECORDING_TARGET_COMMIT_INTERVAL_MS\)/.test(source.background)
  },
  {
    name: 'recording target selection and CDP attach both use settled tabs',
    pass:
      /const requestedTab = await getSettledRecordingTargetTab\(tabId, normalizedOptions\)/.test(
        source.background
      ) &&
      /const latestTab = \(await getSettledRecordingTargetTab\(tab\.id, options\)\)/.test(source.background) &&
      /const tab = await getSettledRecordingTargetTab\(tabId, targetOptions\)/.test(source.background)
  },
  {
    name: 'fallback selection prefers tabs matching the intended target URL',
    pass:
      /pendingCandidates\.find\(\(tab\) => tabMatchesTargetUrl\(tab, options\.targetUrl\)\)/.test(
        source.background
      ) &&
      /\.filter\(\(tab\) => tabMatchesTargetUrl\(tab, options\.targetUrl\)\)/.test(source.background) &&
      /function tabMatchesTargetUrl\(tab, targetUrl/.test(source.background)
  },
  {
    name: 'AI goals can supply a target URL when popup focus is unreliable',
    pass:
      /function extractFirstRecordableUrl\(value\)/.test(source.background) &&
      /targetUrl: options\.targetUrl \|\| extractFirstRecordableUrl\(goal\)/.test(source.background)
  },
  {
    name: 'real AI smoke covers extension-tab fallback with explicit target URL',
    pass:
      /targetUrl: report\.fixtureUrl/.test(source.aiSmoke) &&
      /targetUrl,/.test(source.aiSmoke) &&
      /fallbackStartedFromExtensionTab/.test(source.aiSmoke)
  },
  {
    name: 'watchdog knows the v2.2.7 pending target URL task',
    pass:
      /v2\.2\.7-pending-target-url/.test(source.watchdog) &&
      /v2\.2\.7-pending-target-url/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.2.7 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
