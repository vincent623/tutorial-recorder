import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  background: 'background/background.js',
  popup: 'popup/popup.js',
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
    name: 'backend has exclusive, serialized, and idempotent operation guards',
    pass:
      /const operationLocks = new Map\(\)/.test(source.background) &&
      /const operationSerialQueues = new Map\(\)/.test(source.background) &&
      /const recentOperationResults = new Map\(\)/.test(source.background) &&
      /async function runExclusiveOperation/.test(source.background) &&
      /async function runSerializedOperation/.test(source.background) &&
      /async function runIdempotentOperation/.test(source.background)
  },
  {
    name: 'stop, capture, export, generation, and agent actions are guarded',
    pass:
      /runExclusiveOperation\('stopRecording'/.test(source.background) &&
      /runSerializedOperation\(queueKey/.test(source.background) &&
      /runExclusiveOperation\(`exportRecording:\$\{recordingId\}`/.test(source.background) &&
      /runExclusiveOperation\(`generateTutorial:\$\{recordingId\}`/.test(source.background) &&
      /runExclusiveOperation\(lockKey, \(\) => performExecuteAiAgentAction/.test(source.background)
  },
  {
    name: 'runtime messages and popup attach operation ids for repeatable mutations',
    pass:
      /message\.operationId/.test(source.background) &&
      /const IDEMPOTENT_ACTIONS = new Set\(\['stopRecording', 'manualCapture', 'downloadRecording'\]\)/.test(
        source.popup
      ) &&
      /const pendingOperationIds = new Map\(\)/.test(source.popup) &&
      /operationId = createClientOperationId\(action\)/.test(source.popup)
  },
  {
    name: 'screenshot ids use recording id plus monotonic sequence plus random suffix',
    pass:
      /screenshotSequence: 0/.test(source.background) &&
      /function getNextScreenshotSequence/.test(source.background) &&
      /function createScreenshotId\(recordingId, sequence\)/.test(source.background) &&
      /id: createScreenshotId\(currentRecording\.id, sequence\)/.test(source.background) &&
      /operationId: resolvedOperationId/.test(source.background)
  },
  {
    name: 'AI agent steps are idempotent per screenshot/action',
    pass:
      /function createAgentStepId\(recordingId, screenshotId, actionName\)/.test(source.background) &&
      /steps\.find\(\(step\) => step\.id === stepId \|\| step\.screenshotId === screenshotId\)/.test(
        source.background
      ) &&
      /operationId: stepId/.test(source.background)
  },
  {
    name: 'watchdog knows the v2.0.2 task',
    pass:
      /v2\.0\.2-idempotent-operations/.test(source.watchdog) &&
      /v2\.0\.2-idempotent-operations/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.0.2 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
