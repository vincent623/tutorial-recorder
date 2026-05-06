import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  popup: 'popup/popup.js',
  background: 'background/background.js',
  aiSmoke: 'scripts/e2e/ai-recording-smoke.mjs',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json',
  watchdog: 'scripts/dev-watchdog.mjs',
  progress: 'memory/dev-loop-progress.md',
  gitignore: '.gitignore'
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
    name: 'version metadata is aligned at or above 2.2.4',
    pass:
      versionAtLeast(packageJson.version, '2.2.4') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'popup persists AI startup feedback in state instead of transient DOM text',
    pass:
      /function setLocalAiStartupFeedback\(message, status\)/.test(source.popup) &&
      /state\.aiAgent = normalizeAiAgent\(\{[\s\S]*status,[\s\S]*message,[\s\S]*updatedAt: Date\.now\(\)[\s\S]*\}\);/.test(
        source.popup
      ) &&
      /const hasAiStartupFeedback =[\s\S]*\['starting', 'running', 'retrying'\]\.includes\(aiAgent\.status\);/.test(
        source.popup
      ) &&
      /if \(aiAgent\.status === 'starting'\)/.test(source.popup)
  },
  {
    name: 'AI status messages carry runtime state into popup listeners',
    pass:
      /if \(typeof message\.isRecording === 'boolean'\)/.test(source.popup) &&
      /isRecording: currentRuntime\.isRecording/.test(source.background) &&
      /isPaused: currentRuntime\.isPaused/.test(source.background) &&
      /recordingId: currentRuntime\.recordingId/.test(source.background)
  },
  {
    name: 'background broadcasts starting before CDP attach and running after attach',
    pass:
      /status: 'starting'[\s\S]*message: '正在启动 AI\.\.\.'/.test(source.background) &&
      /notifyAiStatus\(\);[\s\S]*try \{[\s\S]*await attachCdpDebugger\(tab\.id\);[\s\S]*await updateAiAgentState\(\{[\s\S]*status: 'running',[\s\S]*message: 'AI 正在观察页面\.\.\.'/.test(
        source.background
      ) &&
      /AI 正在启动/.test(source.background)
  },
  {
    name: 'real AI recording smoke script is registered but only syntax-checked by default',
    pass:
      /"smoke:ai": "node scripts\/e2e\/ai-recording-smoke\.mjs"/.test(source.packageJson) &&
      /node --check scripts\/e2e\/ai-recording-smoke\.mjs/.test(source.packageJson) &&
      !/npm run smoke:ai/.test(packageJson.scripts.check) &&
      /action: 'startAiRecording'/.test(source.aiSmoke) &&
      /ai-smoke-report\.json/.test(source.aiSmoke) &&
      /apiKeyConfigured/.test(source.aiSmoke)
  },
  {
    name: 'local secret file is ignored',
    pass: /^\.env$/m.test(source.gitignore)
  },
  {
    name: 'watchdog knows the v2.2.4 AI start state task',
    pass: /v2\.2\.4-ai-start-state/.test(source.watchdog) && /v2\.2\.4-ai-start-state/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.2.4 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
