import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgentActionText } from '../../background/agent-tools.js';
import { isRepeatedAgentAction } from '../../background/agent-repeat-policy.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');
const packageJson = JSON.parse(await read('package.json'));
const packageLock = JSON.parse(await read('package-lock.json'));
const manifest = JSON.parse(await read('manifest.json'));
const workflow = await read('.github/workflows/release.yml');
const settingsSchema = await read('background/settings-schema.js');
const settingsPage = await read('settings/settings.js');
const settingsHtml = await read('settings/settings.html');
const popup = await read('popup/popup.js');
const backgroundMain = await read('background/background.js');
const assetStore = await read('background/asset-store.js');
const historyService = await read('background/history-service.js');
const agentTools = await read('background/agent-tools.js');
const actionTransaction = await read('background/agent-action-transaction.js');
const agentState = await read('background/agent-state.js');
const observationDecision = await read('background/agent-observation-decision.js');
const e2e = await read('scripts/e2e/validate-extension.mjs');
const aiSmoke = await read('scripts/e2e/ai-recording-smoke.mjs');
const packageScript = await read('scripts/package-extension.mjs');
const readme = await read('README.md');
const systemDoc = await read('.42cog/sys.md');
const realityDoc = await read('.42cog/real.md');
const watchdog = await read('scripts/dev-watchdog.mjs');
const progress = await read('memory/dev-loop-progress.md');

const backgroundDir = path.join(repoRoot, 'background');
const backgroundNames = (await readdir(backgroundDir)).filter((name) => name.endsWith('.js')).sort();
const backgroundSources = Object.fromEntries(
  await Promise.all(backgroundNames.map(async (name) => [name, await read(`background/${name}`)]))
);

function findImportCycles(sources) {
  const graph = new Map(
    Object.entries(sources).map(([name, source]) => [
      name,
      [...source.matchAll(/from '\.\/(.+?\.js)'/g)].map((match) => match[1]).filter((item) => sources[item])
    ])
  );
  const visiting = new Set();
  const visited = new Set();

  function visit(name) {
    if (visiting.has(name)) {
      return true;
    }
    if (visited.has(name)) {
      return false;
    }
    visiting.add(name);
    for (const dependency of graph.get(name) || []) {
      if (visit(dependency)) {
        return true;
      }
    }
    visiting.delete(name);
    visited.add(name);
    return false;
  }

  return [...graph.keys()].some(visit);
}

function rejectsNaturalAgentText(text) {
  try {
    parseAgentActionText(text);
    return false;
  } catch (error) {
    return true;
  }
}

function buildPackage() {
  const result = spawnSync(process.execPath, ['scripts/package-extension.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'package command failed');
  }
  return readFile(path.join(repoRoot, 'dist', `tutorial-recorder-v${packageJson.version}.zip`));
}

const firstPackage = await buildPackage();
await new Promise((resolve) => setTimeout(resolve, 1200));
const secondPackage = await buildPackage();

const checks = [
  {
    name: 'version metadata remains aligned at or above v2.7.0',
    pass:
      (Number(packageJson.version.split('.')[0]) > 2 ||
        (Number(packageJson.version.split('.')[0]) === 2 && Number(packageJson.version.split('.')[1]) >= 7)) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'CI installs Chromium and runs the secretless browser E2E gate',
    pass:
      /playwright install --with-deps chromium/.test(workflow) &&
      /npm run validate:e2e/.test(workflow) &&
      /secrets\.DEEPSEEK_API_KEY/.test(workflow) &&
      /npm run smoke:ai/.test(workflow) &&
      /Require DeepSeek repository secret/.test(workflow) &&
      /output\/playwright\/report\.json/.test(workflow) &&
      !/path: output\/playwright\/$/.test(workflow)
  },
  {
    name: 'DeepSeek official vision preset is wired across runtime and UI',
    pass:
      /deepseekOfficial/.test(settingsSchema) &&
      /https:\/\/api\.deepseek\.com/.test(settingsSchema) &&
      /deepseek-v4-flash-vision-exp/.test(settingsPage) &&
      /value="deepseekOfficial"/.test(settingsHtml) &&
      /deepseekOfficial: 'DeepSeek 官方'/.test(popup)
  },
  {
    name: 'AI click actions preserve coordinates and calibrate visible text targets',
    pass:
      /targetText/.test(agentTools) &&
      !/inferAgentFinishFromText/.test(agentTools) &&
      /thinking: \{ type: 'disabled' \}/.test(observationDecision) &&
      /tool_choice: 'required'/.test(observationDecision) &&
      parseAgentActionText('{"action":"finish","description":"目标已完成"}').action === 'finish' &&
      rejectsNaturalAgentText('已经确认当前模式切换成功，目标达成。') &&
      rejectsNaturalAgentText('已完成对任务完成情况的分析，下一步点击提交。') &&
      isRepeatedAgentAction(
        { action: 'click_at_xy', targetText: '提交' },
        [{ action: 'click_at_xy', targetText: '提交' }]
      ) &&
      !isRepeatedAgentAction(
        { action: 'click_at_xy', targetText: '下一步' },
        [{ action: 'click_at_xy', targetText: '提交' }]
      ) &&
      !isRepeatedAgentAction(
        { action: 'click_at_xy', targetText: '下一步', allowRepeat: true, repeatReason: '进入了新的向导页' },
        [{ action: 'click_at_xy', targetText: '下一步' }]
      ) &&
      isRepeatedAgentAction(
        { action: 'click_at_xy', targetText: '提交订单', allowRepeat: true, repeatReason: '再次提交' },
        [{ action: 'click_at_xy', targetText: '提交订单' }]
      ) &&
      /verifyObservation/.test(actionTransaction) &&
      /observation-reference/.test(actionTransaction) &&
      /action\.targetText/.test(agentState) &&
      /recentSteps/.test(aiSmoke) &&
      /partialReport/.test(aiSmoke) &&
      /metricCount, 10\) === 1/.test(aiSmoke) &&
      /await rm\(profileDir/.test(aiSmoke)
  },
  {
    name: 'storage usage and batch cleanup are exposed and browser-tested',
    pass:
      /getStorageUsageSummary/.test(assetStore) &&
      /clearAllRecordingData/.test(assetStore) &&
      /clearAllRecordings/.test(historyService) &&
      /case 'getStorageUsage':/.test(backgroundMain) &&
      /case 'clearAllRecordings':/.test(backgroundMain) &&
      /id="storageUsageValue"/.test(settingsHtml) &&
      /storageGovernanceWorked/.test(e2e)
  },
  {
    name: 'background static import graph has no cycles',
    pass: !findImportCycles(backgroundSources)
  },
  {
    name: 'extension package is byte-for-byte reproducible',
    pass:
      Buffer.from(firstPackage).equals(Buffer.from(secondPackage)) &&
      /PACKAGE_MTIME/.test(packageScript)
  },
  {
    name: 'current docs describe implemented provider, history, storage, and module state',
    pass:
      /16 个 Provider/.test(readme) &&
      /DeepSeek/.test(readme) &&
      /最多 100 条/.test(systemDoc) &&
      /StorageQuotaManager[^\n]*已实现/.test(systemDoc) &&
      /`getStorageUsage`/.test(systemDoc) &&
      /`clearAllRecordings`/.test(systemDoc) &&
      /已提供存储用量提示和批量清理能力/.test(realityDoc) &&
      /\[x\] 存储用量可见可清理/.test(realityDoc)
  },
  {
    name: 'watchdog records the v2.7.0 risk-closure task',
    pass:
      /v2\.7\.0-risk-closure/.test(watchdog) &&
      /v2\.7\.0-risk-closure/.test(progress)
  }
];

const failed = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.7.0 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
