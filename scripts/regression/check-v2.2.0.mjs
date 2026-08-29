import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  background: 'background/',
  popup: 'popup/popup.js',
  settingsHtml: 'settings/settings.html',
  settingsJs: 'settings/settings.js',
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
    name: 'version metadata is aligned at or above 2.2.0',
    pass:
      versionAtLeast(packageJson.version, '2.2.0') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'AI Agent limits are configurable and normalized',
    pass:
      /aiAgentMaxSteps: AI_AGENT_MAX_STEPS/.test(source.background) &&
      /aiAgentMaxDurationMinutes: Math\.round\(AI_AGENT_MAX_DURATION_MS \/ 60_000\)/.test(
        source.background
      ) &&
      /function normalizeAiAgentMaxSteps\(value\)/.test(source.background) &&
      /function normalizeAiAgentMaxDurationMs\(value\)/.test(source.background) &&
      /settings\.aiAgentMaxSteps/.test(source.background) &&
      /settings\.aiAgentMaxDurationMinutes/.test(source.background)
  },
  {
    name: 'settings UI exposes Agent max steps and timeout fields',
    pass:
      /id="aiAgentMaxSteps"/.test(source.settingsHtml) &&
      /id="aiAgentMaxDurationMinutes"/.test(source.settingsHtml) &&
      /elements\.aiAgentMaxSteps\.addEventListener\('change', saveSettings\)/.test(source.settingsJs) &&
      /elements\.aiAgentMaxDurationMinutes\.addEventListener\('change', saveSettings\)/.test(
        source.settingsJs
      ) &&
      /aiAgentMaxSteps: parseInt\(elements\.aiAgentMaxSteps\.value, 10\)/.test(source.settingsJs) &&
      /aiAgentMaxDurationMinutes: parseInt\(elements\.aiAgentMaxDurationMinutes\.value, 10\)/.test(
        source.settingsJs
      )
  },
  {
    name: 'AI Agent loop uses configured limits in state, prompt, and history slicing',
    pass:
      /const agentMaxSteps = normalizeAiAgentMaxSteps\(settings\.aiAgentMaxSteps\)/.test(source.background) &&
      /const agentMaxDurationMs = normalizeAiAgentMaxDurationMs\(settings\.aiAgentMaxDurationMinutes\)/.test(
        source.background
      ) &&
      /maxSteps: agentMaxSteps/.test(source.background) &&
      /maxDurationMs: agentMaxDurationMs/.test(source.background) &&
      /deadlineAt: startedAt \+ agentMaxDurationMs/.test(source.background) &&
      /`当前步数：\$\{stepIndex\}\/\$\{maxSteps\}`/.test(source.background) &&
      /steps: \[\.\.\.steps, step\]\.slice\(-\((S\.)?currentRuntime\.aiAgent\.maxSteps \|\| AI_AGENT_MAX_STEPS\)\)/.test(
        source.background
      )
  },
  {
    name: 'AI Agent decision failures retry once before failure branch',
    pass:
      /const AI_AGENT_DECISION_RETRY_LIMIT = 1/.test(source.background) &&
      /async function decideNextAgentActionWithRetry\(screenshot, settings\)/.test(source.background) &&
      /attempt <= AI_AGENT_DECISION_RETRY_LIMIT/.test(source.background) &&
      /status: 'retrying'/.test(source.background) &&
      /const action = await decideNextAgentActionWithRetry\(screenshot, settings\)/.test(source.background)
  },
  {
    name: 'AI Agent action execution waits for page stability and detects anomalies',
    pass:
      /await waitForAgentPageStability\(action, screenshot\)/.test(source.background) &&
      /async function waitForAgentPageStability\(action, previousScreenshot\)/.test(source.background) &&
      /AI_AGENT_PAGE_STABILITY_TIMEOUT_MS/.test(source.background) &&
      /throw new Error\('AI 操作后目标页面已关闭，请接管或停止导出'\)/.test(source.background) &&
      /assertAgentTabIsRecordable\(tab\.url \|\| ''\)/.test(source.background) &&
      /warnAgentNavigationChange\(beforeUrl, tab\.url \|\| ''\)/.test(source.background)
  },
  {
    name: 'popup can carry new Agent limit fields in runtime state',
    pass:
      /maxSteps: 50/.test(source.popup) &&
      /maxDurationMs: 10 \* 60 \* 1000/.test(source.popup) &&
      /maxSteps: Number\.parseInt\(aiAgent\?\.maxSteps, 10\) \|\| 50/.test(source.popup) &&
      /maxDurationMs: Number\.parseInt\(aiAgent\?\.maxDurationMs, 10\) \|\| 10 \* 60 \* 1000/.test(
        source.popup
      )
  },
  {
    name: 'watchdog knows the v2.2.0 Agent hardening task',
    pass:
      /v2\.2\.0-agent-hardening/.test(source.watchdog) &&
      /v2\.2\.0-agent-hardening/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.2.0 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
