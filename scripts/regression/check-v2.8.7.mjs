import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = await readFile(path.join(repoRoot, 'background/agent-policy.js'), 'utf8');
const guard = await readFile(path.join(repoRoot, 'background/agent-action-guard.js'), 'utf8');
const targeting = await readFile(path.join(repoRoot, 'background/agent-targeting.js'), 'utf8');
const pageAutomation = await readFile(path.join(repoRoot, 'background/page-automation.js'), 'utf8');
const e2e = await readFile(path.join(repoRoot, 'scripts/e2e/debugger-conflict-smoke.mjs'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));

const checks = [
  {
    name: 'release version remains aligned after 2.8.7',
    pass:
      /^2\.8\.(?:7|8)$/.test(packageJson.version) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'routine browser actions use explicit low-risk policy codes',
    pass:
      /get-search-submit/.test(policy) &&
      /focus-editable-field/.test(policy) &&
      /get-search-enter/.test(policy) &&
      /reversible-navigation/.test(policy)
  },
  {
    name: 'only the exact GET search Enter policy bypasses approval freshness',
    pass:
      /AUTO_AUTHORIZED_SENSITIVE_POLICY_CODES = new Set\(\['get-search-enter'\]\)/.test(guard) &&
      /policyAuthorization/.test(guard)
  },
  {
    name: 'search fields are calibrated in CDP and scripting modes',
    pass:
      targeting.includes('input[type="search"]') &&
      pageAutomation.includes('input[type="search"]') &&
      /aria-label/.test(targeting) &&
      /placeholder/.test(pageAutomation)
  },
  {
    name: 'browser E2E covers combined GET search and zero takeover confirmation',
    pass:
      /"action":"type_text"/.test(e2e) &&
      /"targetText":"搜索"/.test(e2e) &&
      /"submit":true/.test(e2e) &&
      /noTakeoverConfirmation/.test(e2e)
  },
  {
    name: 'autonomy usability policy regression is in the default gate',
    pass: packageJson.scripts?.['test:regression']?.includes('check-ai-autonomy-usability.mjs')
  }
];

for (const check of checks) {
  assert.equal(check.pass, true, check.name);
  console.log(`PASS ${check.name}`);
}
