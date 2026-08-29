import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferAgentFinishFromText } from '../../background/agent-tools.js';

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
const agentTargeting = await read('background/agent-targeting.js');
const agentState = await read('background/agent-state.js');
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
    name: 'version metadata is aligned at v2.7.0',
    pass:
      packageJson.version === '2.7.0' &&
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
      /Require DeepSeek secret for trusted CI/.test(workflow) &&
      /output\/playwright\/\*\.json/.test(workflow) &&
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
      /inferAgentFinishFromText/.test(agentTools) &&
      Boolean(inferAgentFinishFromText('已经确认当前模式切换成功，目标达成。')) &&
      Boolean(inferAgentFinishFromText('已经完成点击评审按钮，当前模式已生效，目标达成。')) &&
      !inferAgentFinishFromText('尚未完成目标，仍需继续操作。') &&
      !inferAgentFinishFromText('为了让任务完成，请点击提交。') &&
      !inferAgentFinishFromText('请确认任务完成后继续。') &&
      !inferAgentFinishFromText('已说明任务完成条件为点击提交。') &&
      !inferAgentFinishFromText('已完成任务要求说明，仍需点击提交。') &&
      !inferAgentFinishFromText('点击提交按钮继续。') &&
      /resolveAgentTargetCenter/.test(agentTargeting) &&
      /Runtime\.evaluate/.test(agentTargeting) &&
      /action\.targetText/.test(agentState) &&
      /recentSteps/.test(aiSmoke) &&
      /partialReport/.test(aiSmoke) &&
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
