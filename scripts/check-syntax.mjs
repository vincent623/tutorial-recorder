import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_DIRS = ['background', 'content', 'offscreen', 'popup', 'settings'];
const SCAN_FILES = ['scripts/e2e/validate-extension.mjs', 'scripts/e2e/ai-recording-smoke.mjs', 'scripts/stress/recording-scale.mjs', 'scripts/package-extension.mjs'];
const REGRESSION_DIR = 'scripts/regression';

async function listJsFiles(dir) {
  const entries = await readdir(path.join(repoRoot, dir), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(dir, entry.name));
}

async function listRegressionScripts() {
  const entries = await readdir(path.join(repoRoot, REGRESSION_DIR), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && entry.name.startsWith('check-'))
    .map((entry) => path.join(REGRESSION_DIR, entry.name))
    .sort();
}

const targets = [
  ...(await Promise.all(SCAN_DIRS.map(listJsFiles))).flat(),
  ...SCAN_FILES,
  ...(await listRegressionScripts())
];

let failed = 0;
for (const relativePath of targets) {
  const absolutePath = path.join(repoRoot, relativePath);
  await readFile(absolutePath).catch(() => {
    throw new Error(`Missing expected source file: ${relativePath}`);
  });

  const result = spawnSync(process.execPath, ['--check', absolutePath], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`not ok - ${relativePath}`);
    console.error(result.stderr?.trim());
  } else {
    console.log(`ok - ${relativePath}`);
  }
}

if (failed) {
  throw new Error(`Syntax check failed for ${failed} file(s)`);
}
