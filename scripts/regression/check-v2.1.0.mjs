import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  assetStore: 'background/asset-store.js',
  background: 'background/',
  offscreen: 'offscreen/offscreen.js',
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
    name: 'version metadata is aligned at or above 2.1.0',
    pass:
      versionAtLeast(packageJson.version, '2.1.0') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'IndexedDB schema has a recording-indexed assets store',
    pass:
      /const DB_VERSION = 2/.test(source.assetStore) &&
      /const ASSETS_STORE = 'assets'/.test(source.assetStore) &&
      /const ASSETS_RECORDING_INDEX = 'recordingId'/.test(source.assetStore) &&
      /db\.createObjectStore\(ASSETS_STORE, \{ keyPath: 'id' \}\)/.test(source.assetStore) &&
      /assetsStore\.createIndex\(ASSETS_RECORDING_INDEX, 'recordingId'/.test(source.assetStore)
  },
  {
    name: 'asset-store exposes atomic recording and asset writes',
    pass:
      /export async function putRecordingWithAssets\(recording, assets = \[\], options = \{\}\)/.test(
        source.assetStore
      ) &&
      /withStores\(\[RECORDINGS_STORE, ASSETS_STORE\], 'readwrite'/.test(source.assetStore) &&
      /assetStore\.put\(asset\)/.test(source.assetStore) &&
      /stores\[RECORDINGS_STORE\]\.put\(recording\)/.test(source.assetStore)
  },
  {
    name: 'recording delete cascades assets by recordingId in the same transaction',
    pass:
      /export async function deleteRecording\(id\)/.test(source.assetStore) &&
      /stores\[RECORDINGS_STORE\]\.delete\(id\)/.test(source.assetStore) &&
      /stores\[ASSETS_STORE\]\.index\(ASSETS_RECORDING_INDEX\)/.test(source.assetStore) &&
      /IDBKeyRange\.only\(id\)/.test(source.assetStore) &&
      /cursor\.delete\(\)/.test(source.assetStore)
  },
  {
    name: 'background persists lightweight recordings and hydrates assets on demand',
    pass:
      /listAssetsForRecording/.test(source.background) &&
      /putRecordingWithAssets/.test(source.background) &&
      /async function persistRecording/.test(source.background) &&
      /function stripRecordingAssetData/.test(source.background) &&
      /delete next\.data/.test(source.background) &&
      /async function hydrateRecordingAssets/.test(source.background) &&
      /data: screenshot\.data \|\| asset\?\.dataUrl \|\| ''/.test(source.background)
  },
  {
    name: 'capture path stores screenshots as assets and keeps popup detail payload hydrated',
    pass:
      /const screenshotAsset = ensureScreenshotAsset/.test(source.background) &&
      /await persistRecording\((S\.)?currentRecording, screenshotAsset \? \[screenshotAsset\] : \[\]\)/.test(
        source.background
      ) &&
      /async function getRecordingDetail\(id\)[\s\S]*hydrateRecordingAssets\(await getRecording\(id\)\)/.test(
        source.background
      ) &&
      /return buildRecordingDetail\(recording\)/.test(source.background)
  },
  {
    name: 'export and runtime recovery hydrate assets before using screenshot data',
    pass:
      /(S\.)?currentRecording = await hydrateRecordingAssets\(await getRecording\((S\.)?currentRuntime\.recordingId\)\)/.test(
        source.background
      ) &&
      /async function performExportRecording\(id, operationId = ''\)[\s\S]*hydrateRecordingAssets\(await getRecording\(id\)\)/.test(
        source.background
      ) &&
      /sendOffscreenMessage\('generatePdf', \{ recording: buildPdfPayload\(recording\) \}\)/.test(
        source.background
      ) &&
      /downloadRecordingBundle\(\s*recording,/.test(source.background)
  },
  {
    name: 'media payloads are split into audio/video assets and committed atomically',
    pass:
      /AUDIO: 'audio'/.test(source.background) &&
      /VIDEO: 'video'/.test(source.background) &&
      /\^data:\.\*\?;base64,/.test(source.background) &&
      /applyMediaResult/.test(source.background) &&
      (/createRecordingAsset\(recording\.id, ASSET_KINDS\.AUDIO/.test(source.background) &&
        /createRecordingAsset\(recording\.id, ASSET_KINDS\.VIDEO/.test(source.background)) ||
        (/recording\.audioAssetId = mediaResult\.audioAssetId/.test(source.background) &&
          /recording\.videoAssetId = mediaResult\.videoAssetId/.test(source.background) &&
          /writeMediaAsset/.test(source.offscreen) &&
          /assets: mediaAssets|status: 'stopping'/.test(source.background))
  },
  {
    name: 'workspace screenshot edits replace assets and delete removed asset ids',
    pass:
      /const previousAssetIds = getRecordingAssetIds\(storedRecording\)/.test(source.background) &&
      /const nextAssetIds = getRecordingAssetIds\(recording\)/.test(source.background) &&
      /const deleteAssetIds = \[\.\.\.previousAssetIds\]\.filter/.test(source.background) &&
      /await persistRecording\(recording, assets, \{ deleteAssetIds \}\)/.test(source.background)
  },
  {
    name: 'watchdog knows the v2.1.0 asset-store task',
    pass:
      /v2\.1\.0-asset-store/.test(source.watchdog) &&
      /v2\.1\.0-asset-store/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.1.0 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
