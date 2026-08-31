import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');
const packageJson = JSON.parse(await read('package.json'));
const packageLock = JSON.parse(await read('package-lock.json'));
const manifest = JSON.parse(await read('manifest.json'));
const popup = await read('popup/popup.js');
const recordingTarget = await read('background/recording-target.js');
const targetSelectionSmoke = await read('scripts/e2e/target-selection-smoke.mjs');
const workflow = await read('.github/workflows/release.yml');

const checks = [
  {
    name: 'version metadata remains aligned at or above v2.8.1',
    pass:
      (Number(packageJson.version.split('.')[0]) > 2 ||
        (Number(packageJson.version.split('.')[0]) === 2 &&
          (Number(packageJson.version.split('.')[1]) > 8 ||
            (Number(packageJson.version.split('.')[1]) === 8 &&
              Number(packageJson.version.split('.')[2]) >= 1)))) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'popup resolves fallback targets inside its own Chrome window',
    pass:
      /const currentContextTab = await getCurrentTabSafely\(\)/.test(popup) &&
      /\{ active: true, windowId: contextWindowId \}/.test(popup) &&
      /queryTabsSafely\(\{ windowId: contextWindowId \}\)/.test(popup) &&
      /return null;\n}/.test(popup)
  },
  {
    name: 'deterministic browser smoke locks down multi-window target selection',
    pass:
      /intendedTargetSelected/.test(targetSelectionSmoke) &&
      /staleTargetNotSelected/.test(targetSelectionSmoke) &&
      /intendedTargetRemainsOpen/.test(targetSelectionSmoke) &&
      /staleTargetRemainsOpen/.test(targetSelectionSmoke)
  },
  {
    name: 'explicit target URLs never fall back to an unrelated tab',
    pass: /if \(options\.targetUrl\) \{[\s\S]*?return targetMatch \|\| null;[\s\S]*?\}/.test(recordingTarget)
  },
  {
    name: 'CI runs the deterministic multi-window target selection smoke',
    pass:
      packageJson.scripts?.['smoke:target-selection'] === 'node scripts/e2e/target-selection-smoke.mjs' &&
      /npm run smoke:target-selection/.test(workflow)
  }
];

const failed = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}
if (failed.length) {
  throw new Error(`v2.8.1 target-selection checks failed: ${failed.map((item) => item.name).join(', ')}`);
}
