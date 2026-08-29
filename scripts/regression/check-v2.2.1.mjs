import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  stress: 'scripts/stress/recording-scale.mjs',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json',
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
    name: 'version metadata is aligned at or above 2.2.1',
    pass:
      versionAtLeast(packageJson.version, '2.2.1') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'package scripts register the scale stress check',
    pass:
      /"stress:scale": "node scripts\/stress\/recording-scale\.mjs"/.test(source.packageJson) &&
      /npm run stress:scale/.test(source.packageJson) &&
      (/node --check scripts\/stress\/recording-scale\.mjs/.test(source.packageJson) ||
        /scripts\/check-syntax\.mjs/.test(source.packageJson))
  },
  {
    name: 'stress script covers 100, 300, and 1000 step scenarios',
    pass:
      /const stepCounts = \[100, 300, 1000\]/.test(source.stress) &&
      /buildScenario\(steps\)/.test(source.stress) &&
      /createSyntheticRecording\(steps\)/.test(source.stress) &&
      /createInlineSyntheticRecording\(steps\)/.test(source.stress)
  },
  {
    name: 'stress script asserts PDF strategy and asset split metadata bounds',
    pass:
      /100-step recording should remain eligible for PDF/.test(source.stress) &&
      /300-step recording should skip PDF by count threshold/.test(source.stress) &&
      /1000-step recording should skip PDF by count threshold/.test(source.stress) &&
      /recordingMetadataBytes < 1_000_000/.test(source.stress) &&
      /metadataReductionRatio > 100/.test(source.stress)
  },
  {
    name: 'stress script writes a JSON report under output/stress',
    pass:
      /output', 'stress', 'recording-scale-report\.json'/.test(source.stress) &&
      /await writeFile\(reportPath, JSON\.stringify\(report, null, 2\)\)/.test(source.stress)
  },
  {
    name: 'watchdog knows the v2.2.1 scale stress task',
    pass:
      /v2\.2\.1-scale-stress/.test(source.watchdog) &&
      /v2\.2\.1-scale-stress/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.2.1 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
