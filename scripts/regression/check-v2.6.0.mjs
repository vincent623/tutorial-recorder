import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json',
  background: 'background/',
  backgroundMain: 'background/background.js',
  settingsSchema: 'background/settings-schema.js',
  aiVision: 'background/ai-vision.js',
  exporters: 'background/exporters.js',
  textUtils: 'background/text-utils.js',
  notify: 'background/notify.js',
  content: 'content/content.js',
  annotate: 'popup/annotate.js',
  popup: 'popup/popup.js',
  settingsPage: 'settings/settings.js',
  privacyPolicy: 'docs/privacy-policy-zh.md',
  storeListing: 'memory/store-listing.md',
  envExample: '.env.example',
  smoke: 'scripts/e2e/ai-recording-smoke.mjs',
  e2e: 'scripts/e2e/validate-extension.mjs',
  checkSyntax: 'scripts/check-syntax.mjs',
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
    if ((currentParts[index] || 0) > (minimumParts[index] || 0)) {
      return true;
    }

    if ((currentParts[index] || 0) < (minimumParts[index] || 0)) {
      return false;
    }
  }

  return true;
}

const checks = [
  {
    name: 'version metadata is aligned at or above 2.6.0',
    pass:
      versionAtLeast(packageJson.version, '2.6.0') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'content script is injected on demand instead of static declaration',
    pass:
      !JSON.stringify(manifest).includes('content_scripts') &&
      /injectContentScript/.test(source.background) &&
      /chrome\.scripting[\s\S]*executeScript[\s\S]*content\/content\.js/.test(source.background) &&
      /chrome\.tabs\.onUpdated\.addListener/.test(source.background)
  },
  {
    name: 'content script guards against double injection',
    pass:
      /__tutorialRecorderContentReady/.test(source.content) &&
      /initTutorialRecorderContent\(\)/.test(source.content)
  },
  {
    name: 'popup state no longer carries the plaintext API key',
    pass:
      /getPopupStateSettings/.test(source.background) &&
      /apiKey: '',\s*\n\s*apiKeyConfigured: Boolean\(settings\.apiKey\)/.test(source.background) &&
      /case 'getSecretSettings':/.test(source.background) &&
      /apiKeyConfigured \|\| settings\.apiKey/.test(source.popup) &&
      /getSecretSettings/.test(source.settingsPage)
  },
  {
    name: 'background is split into focused pure-function modules',
    pass:
      /PROVIDER_PRESETS/.test(source.settingsSchema) &&
      !/PROVIDER_PRESETS/.test(source.backgroundMain) &&
      /async function analyzeImage/.test(source.aiVision) &&
      !/async function analyzeImage/.test(source.backgroundMain) &&
      /function buildMarkdown/.test(source.exporters) &&
      !/function buildMarkdown/.test(source.backgroundMain) &&
      /function maskSensitiveText/.test(source.textUtils) &&
      /function notifyPopup/.test(source.notify)
  },
  {
    name: 'background modules wire imports without losing functions',
    pass:
      /from '\.\/ai-vision\.js'/.test(source.background) &&
      /from '\.\/exporters\.js'/.test(source.background) &&
      /from '\.\/text-utils\.js'/.test(source.background) &&
      /from '\.\/notify\.js'/.test(source.background) &&
      /from '\.\/settings-schema\.js'/.test(source.aiVision)
  },
  {
    name: 'syntax gate dynamically scans every source file',
    pass:
      /check-syntax\.mjs/.test(source.packageJson) &&
      /SCAN_DIRS/.test(source.checkSyntax) &&
      /spawnSync\(process\.execPath, \['--check'/.test(source.checkSyntax)
  },
  {
    name: 'annotate editor module ships with core annotation tools',
    pass:
      /TutorialAnnotate/.test(source.annotate) &&
      /'arrow'/.test(source.annotate) &&
      /'rect'/.test(source.annotate) &&
      /'mosaic'/.test(source.annotate) &&
      /'text'/.test(source.annotate) &&
      /pixelateRegion/.test(source.annotate) &&
      /toDataURL\('image\/png'\)/.test(source.annotate)
  },
  {
    name: 'workspace detail steps expose the annotate action',
    pass:
      /data-step-action="annotate"/.test(source.popup) &&
      /openStepAnnotator/.test(source.popup) &&
      /TutorialAnnotate\.open/.test(source.popup) &&
      /annotate\.js/.test(await readFile(path.join(repoRoot, 'popup/popup.html'), 'utf8').catch(() => ''))
  },
  {
    name: 'e2e covers the annotate editor drawing and save flow',
    pass:
      /runAnnotateEditorFlow/.test(source.e2e) &&
      /annotateEditorWorked/.test(source.e2e) &&
      /data-tool="mosaic"/.test(source.e2e)
  },
  {
    name: 'smoke config supports KEY=VALUE env files with legacy fallback',
    pass:
      /TUTORIAL_RECORDER_API_BASE_URL/.test(source.smoke) &&
      /TUTORIAL_RECORDER_API_KEY/.test(source.smoke) &&
      /legacyValues/.test(source.smoke) &&
      /TUTORIAL_RECORDER_API_BASE_URL/.test(source.envExample)
  },
  {
    name: 'store submission materials document privacy and review answers',
    pass:
      /录制数据默认保存在您自己的电脑/.test(source.privacyPolicy) &&
      /AI 截图发送默认关闭/.test(source.privacyPolicy) &&
      /自动打码/.test(source.privacyPolicy) &&
      /debugger/.test(source.storeListing) &&
      /隐私政策/.test(source.storeListing) &&
      /Edge Add-ons/.test(source.storeListing)
  },
  {
    name: 'watchdog knows the v2.6.0 store-readiness task',
    pass:
      /v2\.6\.0-store-readiness-and-annotations/.test(source.watchdog) &&
      /v2\.6\.0-store-readiness-and-annotations/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.6.0 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
