import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');
const packageJson = JSON.parse(await read('package.json'));
const packageLock = JSON.parse(await read('package-lock.json'));
const manifest = JSON.parse(await read('manifest.json'));
const workflow = await read('.github/workflows/release.yml');
const agentLoop = await read('background/agent-loop.js');
const agentApproval = await read('background/agent-approval.js');
const agentPolicy = await read('background/agent-policy.js');
const historyService = await read('background/history-service.js');
const settingsSchema = await read('background/settings-schema.js');
const settingsHtml = await read('settings/settings.html');
const popupHtml = await read('popup/popup.html');
const e2e = await read('scripts/e2e/validate-extension.mjs');
const packageScript = await read('scripts/package-extension.mjs');
const privacyPolicy = await read('docs/privacy-policy-zh.md');
const releaseChecklist = await read('docs/commercial-release-checklist.md');
const securityPolicy = await read('SECURITY.md');
const notices = await read('THIRD_PARTY_NOTICES.txt');

const backgroundFiles = (await readdir(path.join(repoRoot, 'background'))).filter((name) => name.endsWith('.js'));
const oversizedModules = [];
for (const name of backgroundFiles) {
  const source = await read(`background/${name}`);
  const lineCount = source.split('\n').length;
  if (lineCount > 500) {
    oversizedModules.push(`${name}=${lineCount}`);
  }
}

const checks = [
  {
    name: 'version metadata remains aligned at or above v2.8.0',
    pass:
      (Number(packageJson.version.split('.')[0]) > 2 ||
        (Number(packageJson.version.split('.')[0]) === 2 &&
          (Number(packageJson.version.split('.')[1]) > 8 ||
            (Number(packageJson.version.split('.')[1]) === 8 &&
              Number(packageJson.version.split('.')[2]) >= 0)))) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'AI high-impact actions cross a one-time approval seam',
    pass:
      /evaluateAgentActionPolicy/.test(agentPolicy) &&
      /approveAndRevalidateAgentAction/.test(agentLoop) &&
      /requestAiAgentApproval/.test(agentApproval) &&
      /resolveAiAgentApproval/.test(agentApproval) &&
      /pendingApproval/.test(agentApproval) &&
      /id="aiApprovalPanel"/.test(popupHtml) &&
      /仅允许这一次/.test(popupHtml) &&
      /拒绝并接管/.test(popupHtml)
  },
  {
    name: 'AI screenshot sharing is explicit opt-in',
    pass:
      /aiDataSharingConsent: false/.test(settingsSchema) &&
      /settings\.aiDataSharingConsent === true/.test(settingsSchema) &&
      /id="aiDataSharingConsent"/.test(settingsHtml) &&
      /默认关闭/.test(settingsHtml) &&
      /明确开启 AI 截图发送授权/.test(privacyPolicy)
  },
  {
    name: 'history retention deletes invisible recording payloads with recovery',
    pass:
      /planHistoryRetention/.test(historyService) &&
      /CLEANUP_QUEUE_KEY/.test(historyService) &&
      /CLEAR_ALL_PENDING_KEY/.test(historyService) &&
      /recoverPendingStorageCleanup/.test(historyService) &&
      /retentionDeletesInvisiblePayloads/.test(e2e)
  },
  {
    name: 'CI uses least privilege, immutable actions, isolated provider smoke, and guarded releases',
    pass:
      /permissions:\n  contents: read/.test(workflow) &&
      /name: Deterministic Quality Gate/.test(workflow) &&
      /name: DeepSeek Vision Provider Smoke/.test(workflow) &&
      /continue-on-error:.*startsWith/.test(workflow) &&
      /environment: production-release/.test(workflow) &&
      !/--clobber/.test(workflow) &&
      /permissions:\n      contents: write/.test(workflow) &&
      /check-release-version\.mjs/.test(workflow) &&
      /sha256sum --check/.test(workflow) &&
      !/^\s*uses:\s*actions\/[^@\s]+@v\d+/m.test(workflow)
  },
  {
    name: 'distributed package carries third-party notices',
    pass:
      /THIRD_PARTY_NOTICES\.txt/.test(packageScript) &&
      /fflate/.test(notices) &&
      /html2canvas/.test(notices) &&
      /jsPDF/.test(notices) &&
      /MIT License/.test(notices)
  },
  {
    name: 'commercial security and release runbooks are present',
    pass:
      /Private Vulnerability Reporting/.test(securityPolicy) &&
      /exact release commit/.test(releaseChecklist) &&
      /Choose and publish the product's source-code license/.test(releaseChecklist)
  },
  {
    name: 'background deep modules remain within the 500-line budget',
    pass: oversizedModules.length === 0,
    detail: oversizedModules.join(', ')
  }
];

const failed = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
}
if (failed.length) {
  throw new Error(`v2.8.0 commercial checks failed: ${failed.map((item) => item.name).join(', ')}`);
}
