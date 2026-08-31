import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lifecycle = await readFile(path.join(repoRoot, 'background/recording-lifecycle.js'), 'utf8');
const pageAutomation = await readFile(path.join(repoRoot, 'background/page-automation.js'), 'utf8');
const agentExecutor = await readFile(path.join(repoRoot, 'background/agent-action-executor.js'), 'utf8');
const workflow = await readFile(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));
const [major, minor, patch] = packageJson.version.split('.').map((part) => Number.parseInt(part, 10));

const checks = [
  {
    name: 'release version is at least 2.8.6',
    pass:
      (major > 2 || (major === 2 && (minor > 8 || (minor === 8 && patch >= 6)))) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'AI startup downgrades debugger conflicts to scripting compatibility mode',
    pass:
      /error\?\.code === 'CDP_DEBUGGER_UNAVAILABLE'/.test(lifecycle) &&
      /automationEngine = 'scripting'/.test(lifecycle) &&
      /AI 录制中（兼容模式）/.test(lifecycle)
  },
  {
    name: 'compatibility actions use isolated scripting without string evaluation',
    pass:
      /chrome\.scripting\.executeScript/.test(pageAutomation) &&
      /executeCompatibleAgentAction/.test(agentExecutor) &&
      !/\beval\s*\(/.test(pageAutomation) &&
      !/world:\s*['"]MAIN['"]/.test(pageAutomation)
  },
  {
    name: 'CI runs the occupied debugger compatibility smoke',
    pass:
      packageJson.scripts?.['smoke:debugger-conflict'] === 'node scripts/e2e/debugger-conflict-smoke.mjs' &&
      /npm run smoke:debugger-conflict/.test(workflow)
  }
];

for (const check of checks) {
  assert.equal(check.pass, true, check.name);
  console.log(`PASS ${check.name}`);
}
