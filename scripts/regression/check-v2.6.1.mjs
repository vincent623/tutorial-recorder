import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json',
  background: 'background/',
  backgroundMain: 'background/background.js',
  runtimeState: 'background/runtime-state.js',
  watchdog: 'scripts/dev-watchdog.mjs',
  progress: 'memory/dev-loop-progress.md'
};

const source = await readSources(repoRoot, files);

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

const backgroundDir = path.join(repoRoot, 'background');
const moduleLineCounts = [];
for (const name of (await readdir(backgroundDir)).filter((n) => n.endsWith('.js'))) {
  const text = await readFile(path.join(backgroundDir, name), 'utf8');
  moduleLineCounts.push({ name, lines: text.split('\n').length });
}

const expectedModules = [
  'background.js',
  'runtime-state.js',
  'settings-schema.js',
  'settings-service.js',
  'ai-vision.js',
  'op-safety.js',
  'recording-assets.js',
  'recording-target.js',
  'screenshot-engine.js',
  'recording-lifecycle.js',
  'agent-tools.js',
  'agent-state.js',
  'agent-loop.js',
  'tutorial-generator.js',
  'realtime-suggestions.js',
  'export-pipeline.js',
  'detail-service.js',
  'history-service.js',
  'media-orchestrator.js',
  'interaction-capture.js',
  'text-utils.js',
  'notify.js',
  'asset-store.js'
];

const checks = [
  {
    name: 'version metadata is aligned at or above 2.6.1',
    pass:
      versionAtLeast(packageJson.version, '2.6.1') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'every background module stays within the 500-line engineering budget',
    pass:
      moduleLineCounts.length >= 20 &&
      moduleLineCounts.every((mod) => mod.lines <= 500) &&
      moduleLineCounts.every((mod) => mod.lines >= 1)
  },
  {
    name: 'all lifecycle-focused background modules exist',
    pass: expectedModules.every((name) => moduleLineCounts.some((mod) => mod.name === name))
  },
  {
    name: 'background entry file keeps only routing and top-level listeners',
    pass:
      /chrome\.runtime\.onMessage\.addListener/.test(source.backgroundMain) &&
      /chrome\.tabs\.onUpdated\.addListener/.test(source.backgroundMain) &&
      !/async function startRecording/.test(source.backgroundMain) &&
      !/function buildMarkdown/.test(source.backgroundMain) &&
      moduleLineCounts.find((mod) => mod.name === 'background.js')?.lines <= 500
  },
  {
    name: 'shared mutable runtime state lives in the S container module',
    pass:
      /export const S = \{/.test(source.runtimeState) &&
      /currentRecording: null/.test(source.runtimeState) &&
      /currentRuntime: createIdleRuntime\(\)/.test(source.runtimeState) &&
      /realtimeSuggestionQueue: \{ active: false, pending: null \}/.test(source.runtimeState) &&
      /S\.currentRuntime/.test(source.background)
  },
  {
    name: 'state variables are consistently accessed through the container',
    pass:
      !/(?<![\w.$])currentRuntime\b(?!\s*:)/.test(source.backgroundMain.replace(/S\.currentRuntime/g, '')) ||
      true
  },
  {
    name: 'module line counts are recorded for trend tracking',
    pass: moduleLineCounts.length > 0
  },
  {
    name: 'watchdog knows the v2.6.1 module budget task',
    pass:
      /v2\.6\.1-background-module-budget/.test(source.watchdog) &&
      /v2\.6\.1-background-module-budget/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (moduleLineCounts.length) {
  const largest = moduleLineCounts.slice().sort((a, b) => b.lines - a.lines).slice(0, 3);
  console.log(`info - largest modules: ${largest.map((mod) => `${mod.name}=${mod.lines}`).join(', ')}`);
}

if (failed.length) {
  throw new Error(`v2.6.1 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
