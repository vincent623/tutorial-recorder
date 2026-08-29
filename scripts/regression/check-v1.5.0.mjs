import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  background: 'background/',
  popupHtml: 'popup/popup.html',
  popupJs: 'popup/popup.js',
  settingsHtml: 'settings/settings.html',
  settingsJs: 'settings/settings.js',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json'
};

const source = await readSources(repoRoot, files);

const packageJson = JSON.parse(source.packageJson);
const packageLock = JSON.parse(source.packageLock);
const manifest = JSON.parse(source.manifest);
const metadataVersions = [
  packageJson.version,
  packageLock.version,
  packageLock.packages?.['']?.version,
  manifest.version
];

const checks = [
  {
    name: 'version metadata remains aligned after v1.5.0',
    pass: metadataVersions.every((version) => version === packageJson.version)
  },
  {
    name: 'realtime suggestions have a persisted toggle in popup and settings',
    pass:
      /realtimeSuggestions: false/.test(source.background) &&
      /id="realtimeSuggestions"/.test(source.popupHtml) &&
      /realtimeSuggestions: elements\.realtimeSuggestions\.checked/.test(source.popupJs) &&
      /id="realtimeSuggestions"/.test(source.settingsHtml) &&
      /realtimeSuggestions: elements\.realtimeSuggestions\.checked/.test(source.settingsJs)
  },
  {
    name: 'screenshot completion enqueues non-blocking realtime AI work',
    pass:
      /queueRealtimeSuggestion\(S\.currentRecording\.id, screenshot\.id\)\.catch/.test(source.background) &&
      /async function queueRealtimeSuggestion/.test(source.background) &&
      /(S\.)?realtimeSuggestionQueue\.pending = \{ recordingId, screenshotId \}/.test(source.background)
  },
  {
    name: 'realtime queue is latest-only while one analysis is active',
    pass:
      (/let realtimeSuggestionQueue = \{[\s\S]*active: false,[\s\S]*pending: null/.test(source.background) ||
        /realtimeSuggestionQueue: \{ active: false, pending: null \}/.test(source.background)) &&
      /if \(!S\.realtimeSuggestionQueue\.active\)|if \(!realtimeSuggestionQueue\.active\)/.test(source.background) &&
      /while \(S\.realtimeSuggestionQueue\.pending\)|while \(realtimeSuggestionQueue\.pending\)/.test(source.background)
  },
  {
    name: 'popup displays and saves editable latest suggestion',
    pass:
      /id="suggestionPanel"/.test(source.popupHtml) &&
      /id="suggestionText"/.test(source.popupHtml) &&
      /case 'realtimeSuggestion':/.test(source.popupJs) &&
      /function saveRealtimeSuggestion/.test(source.popupJs) &&
      /updateRealtimeSuggestion/.test(source.popupJs)
  },
  {
    name: 'user overrides persist and final generation preserves existing text',
    pass:
      /async function updateRealtimeSuggestionOverride/.test(source.background) &&
      /descriptionSource = description \? 'realtime-user' : 'realtime-cleared'/.test(source.background) &&
      (/if \(hasStepDescription\(currentRecording\.screenshots\[index\]\)\) \{[\s\S]*continue;[\s\S]*\}/.test(
        source.background
      ) ||
        /\.filter\(\(\{ screenshot \}\) => !hasStepDescription\(screenshot\)\)/.test(source.background))
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`Realtime suggestion regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
