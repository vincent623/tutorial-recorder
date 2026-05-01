import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  assetStore: 'background/asset-store.js',
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

const checks = [
  {
    name: 'version metadata is aligned for the current 2.x release',
    pass:
      /^2\.\d+\.\d+$/.test(packageJson.version) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'IndexedDB store exposes listRecordings for recovery scans',
    pass:
      /export async function listRecordings\(\)/.test(source.assetStore) &&
      /store\.getAll\(\)/.test(source.assetStore) &&
      /deleteRecording/.test(source.background) &&
      /getRecording/.test(source.background) &&
      /listRecordings/.test(source.background) &&
      /putRecording/.test(source.background)
  },
  {
    name: 'recordings have explicit commit states and recoverable state set',
    pass:
      /const COMMIT_STATES = Object\.freeze/.test(source.background) &&
      /STOPPING: 'stopping'/.test(source.background) &&
      /MEDIA_COLLECTED: 'media-collected'/.test(source.background) &&
      /DESCRIPTIONS_READY: 'descriptions-ready'/.test(source.background) &&
      /DOWNLOAD_REQUESTED: 'download-requested'/.test(source.background) &&
      /HISTORY_UPDATED: 'history-updated'/.test(source.background) &&
      /COMPLETE: 'complete'/.test(source.background) &&
      /FAILED: 'failed'/.test(source.background) &&
      /const RECOVERABLE_COMMIT_STATES = new Set/.test(source.background)
  },
  {
    name: 'recording operations persist commit state and recoverable errors',
    pass:
      /function createRecordingOperation/.test(source.background) &&
      /async function updateRecordingCommitState/.test(source.background) &&
      /async function markRecordingRecoverableFailure/.test(source.background) &&
      /recording\.commitState = commitState/.test(source.background) &&
      /recording\.recoverableError = \{/.test(source.background)
  },
  {
    name: 'start, stop, generation, export, and history update write commit states',
    pass:
      /commitState: COMMIT_STATES\.RECORDING/.test(source.background) &&
      /COMMIT_STATES\.STOPPING/.test(source.background) &&
      /COMMIT_STATES\.MEDIA_COLLECTED/.test(source.background) &&
      /COMMIT_STATES\.DESCRIPTIONS_READY/.test(source.background) &&
      /COMMIT_STATES\.DOWNLOAD_REQUESTED/.test(source.background) &&
      /COMMIT_STATES\.HISTORY_UPDATED/.test(source.background) &&
      /COMMIT_STATES\.COMPLETE/.test(source.background)
  },
  {
    name: 'startup recovery scans interrupted recordings and reconciles history',
    pass:
      /await recoverInterruptedRecordings\(\)/.test(source.background) &&
      /async function recoverInterruptedRecordings/.test(source.background) &&
      /await listRecordings\(\)/.test(source.background) &&
      /shouldRecoverInterruptedRecording/.test(source.background) &&
      /shouldIndexRecording/.test(source.background) &&
      /isHistoryEntryStale/.test(source.background) &&
      /await chrome\.storage\.local\.set\(\{ \[HISTORY_KEY\]: history \}\)/.test(source.background)
  },
  {
    name: 're-export failure is marked recoverable instead of ambiguous',
    pass:
      /catch \(error\) \{[\s\S]*await markRecordingRecoverableFailure\(recording, error, 'exportRecording'\);[\s\S]*throw error;[\s\S]*\}/.test(
        source.background
      ) &&
      /await markRecordingRecoverableFailure\(currentRecording, error, 'generateTutorial'\)/.test(
        source.background
      )
  },
  {
    name: 'watchdog knows the v2.0.3 task',
    pass:
      /v2\.0\.3-transaction-recovery/.test(source.watchdog) &&
      /v2\.0\.3-transaction-recovery/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.0.3 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
