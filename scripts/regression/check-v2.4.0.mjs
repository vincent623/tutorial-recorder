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
  content: 'content/content.js',
  offscreen: 'offscreen/offscreen.js',
  assetStore: 'background/asset-store.js',
  settings: 'settings/settings.js',
  settingsHtml: 'settings/settings.html',
  popup: 'popup/popup.js',
  stress: 'scripts/stress/recording-scale.mjs',
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
    name: 'version metadata is aligned at or above 2.4.0',
    pass:
      versionAtLeast(packageJson.version, '2.4.0') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'content script excludes sensitive input values before reporting interactions',
    pass:
      /SENSITIVE_INPUT_TYPES/.test(source.content) &&
      /isSensitiveField/.test(source.content) &&
      /canReadValue =[\s\S]*?isSensitiveField/.test(source.content) &&
      /maskSensitiveText/.test(source.content) &&
      /element\.value/.test(source.content)
  },
  {
    name: 'background masks sensitive text in recorded interaction summaries',
    pass:
      /maskSensitiveText\(/.test(source.background) &&
      /summary: maskSensitiveText\(/.test(source.background) &&
      /target: maskSensitiveText\(/.test(source.background)
  },
  {
    name: 'asset store recovers from stale IndexedDB connections',
    pass:
      /versionchange/.test(source.assetStore) &&
      /addEventListener\('close'/.test(source.assetStore) &&
      /resetDatabaseConnection/.test(source.assetStore) &&
      /withStoreRobust/.test(source.assetStore) &&
      /isConnectionLostError/.test(source.assetStore)
  },
  {
    name: 'offscreen media sessions write assets directly to IndexedDB',
    pass:
      /writeMediaAsset/.test(source.offscreen) &&
      /putMediaAsset/.test(source.offscreen) &&
      /audioAssetId: audioAsset\?\.id/.test(source.offscreen) &&
      /sessionRecordingId = String\(payload\.recordingId/.test(source.offscreen) &&
      !/audioDataUrl: audioBlob \? await blobToDataUrl/.test(source.offscreen)
  },
  {
    name: 'offscreen enforces media size limits with graceful warnings',
    pass:
      /MAX_MEDIA_CHUNK_BYTES/.test(source.offscreen) &&
      /enforceMediaLimit/.test(source.offscreen) &&
      /audioLimitWarning/.test(source.offscreen) &&
      /videoLimitWarning/.test(source.offscreen)
  },
  {
    name: 'background links offscreen media assets and loads payload on demand',
    pass:
      /recordingId: (S\.)?currentRecording\.id,\s*\n\s*intervalMs/.test(source.background) &&
      /resolveAssetDataUrl/.test(source.background) &&
      /mediaResult\?\.audioAssetId/.test(source.background) &&
      (/getAsset,/.test(source.background) || /getAsset \}/.test(source.background))
  },
  {
    name: 'vision analysis retries rate limits and downscales screenshots before upload',
    pass:
      /AI_RETRY_MAX_ATTEMPTS/.test(source.background) &&
      /isRetryableAiStatus/.test(source.background) &&
      /parseRetryAfterMs/.test(source.background) &&
      /downscaleDataUrlForAi/.test(source.background) &&
      /AI_IMAGE_MAX_SIDE/.test(source.background)
  },
  {
    name: 'batch description generation runs with bounded concurrency',
    pass:
      /AI_CONCURRENCY/.test(source.background) &&
      /runDescriptionAnalysisWorker/.test(source.background) &&
      /Promise\.all\(\s*Array\.from\(\{ length: workerCount \}/.test(source.background)
  },
  {
    name: 'agent toolset supports press_key, navigate, hover, and wait',
    pass:
      /AGENT_TOOL_NAMES/.test(source.background) &&
      /'press_key'/.test(source.background) &&
      /'navigate'/.test(source.background) &&
      /'hover'/.test(source.background) &&
      /'wait'/.test(source.background) &&
      /AGENT_KEY_EVENT_DEFS/.test(source.background) &&
      /Page\.navigate/.test(source.background)
  },
  {
    name: 'agent decisions use a synchronized viewport observation',
    pass:
      /observeBrowserPage/.test(source.background) &&
      /cleanScreenshot/.test(source.background) &&
      /viewport/.test(source.background) &&
      /decisionScreenshot/.test(source.background)
  },
  {
    name: 'zip export includes a standalone tutorial.html entry',
    pass:
      /buildTutorialHtml/.test(source.background) &&
      /tutorial\.html`/.test(source.background) &&
      /escapeHtmlText/.test(source.background)
  },
  {
    name: 'zhipu and moonshot provider presets are registered across UI layers',
    pass:
      /zhipuBigModel/.test(source.background) &&
      /zhipuBigModel/.test(source.settings) &&
      /zhipuBigModel/.test(source.settingsHtml) &&
      /zhipuBigModel/.test(source.popup) &&
      /moonshot/.test(source.background) &&
      /moonshot/.test(source.settings) &&
      /moonshot/.test(source.settingsHtml) &&
      /moonshot/.test(source.popup)
  },
  {
    name: 'history retention raised to 100 entries',
    pass:
      /HISTORY_MAX_ENTRIES = 100/.test(source.background) &&
      !/slice\(0, 20\)/.test(source.background)
  },
  {
    name: 'stress script counts the tutorial.html zip entry',
    pass: /zipEntries: 2 \+/.test(source.stress)
  },
  {
    name: 'watchdog knows the v2.4.0 release task',
    pass:
      /v2\.4\.0-privacy-and-media-hardening/.test(source.watchdog) &&
      /v2\.4\.0-privacy-and-media-hardening/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.4.0 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
