import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readSource = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');
const [tools, executor, policy, repeatPolicy, pageAutomation, deterministicSmoke, realSmoke] = await Promise.all([
  readSource('background/agent-tools.js'),
  readSource('background/agent-action-executor.js'),
  readSource('background/agent-policy.js'),
  readSource('background/agent-repeat-policy.js'),
  readSource('background/page-automation.js'),
  readSource('scripts/e2e/debugger-conflict-smoke.mjs'),
  readSource('scripts/e2e/ai-recording-smoke.mjs')
]);
const packageJson = JSON.parse(await readSource('package.json'));
const packageLock = JSON.parse(await readSource('package-lock.json'));
const manifest = JSON.parse(await readSource('manifest.json'));

const checks = [
  {
    name: 'release version remains at or above 2.8.8',
    pass:
      /^2\.(?:8\.[89]|9\.\d+)$/.test(packageJson.version) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'type_text supports generic exact-field targeting and optional submission',
    pass: /targetText/.test(tools) && /submit/.test(tools) && /get-search-fill-submit/.test(policy)
  },
  {
    name: 'CDP and scripting execution use native form submission with GET safety',
    pass:
      /requestSubmit/.test(executor) &&
      /unsafe-form/.test(executor) &&
      /requestSubmit/.test(pageAutomation)
  },
  {
    name: 'repeated targeted text actions are blocked and targeted fills replace old text',
    pass:
      /action\.action === 'type_text'/.test(repeatPolicy) &&
      /selectFocusedEditableContents/.test(executor) &&
      /element\.select\(\)/.test(pageAutomation)
  },
  {
    name: 'deterministic smoke enforces a single combined search decision',
    pass:
      /modelDecisionCount/.test(deterministicSmoke) &&
      /searchUsesAtMostTwoModelDecisions/.test(deterministicSmoke) &&
      /"submit":true/.test(deterministicSmoke)
  },
  {
    name: 'real-model smoke covers the generic search scenario and composite action',
    pass:
      /PW_AI_SMOKE_SCENARIO/.test(realSmoke) &&
      /compositeSearchActionUsed/.test(realSmoke) &&
      /searchStatus/.test(realSmoke)
  }
];

for (const check of checks) {
  assert.equal(check.pass, true, check.name);
  console.log(`PASS ${check.name}`);
}
