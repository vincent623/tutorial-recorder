import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  background: 'background/background.js',
  popupHtml: 'popup/popup.html',
  popupJs: 'popup/popup.js',
  settingsHtml: 'settings/settings.html',
  settingsJs: 'settings/settings.js',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json'
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, relativePath]) => [
      key,
      await readFile(path.join(repoRoot, relativePath), 'utf8')
    ])
  )
);

const packageJson = JSON.parse(source.packageJson);
const packageLock = JSON.parse(source.packageLock);
const manifest = JSON.parse(source.manifest);

const checks = [
  {
    name: 'version metadata is aligned at 1.5.0',
    pass:
      packageJson.version === '1.5.0' &&
      packageLock.version === '1.5.0' &&
      packageLock.packages?.['']?.version === '1.5.0' &&
      manifest.version === '1.5.0'
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
      /queueRealtimeSuggestion\(currentRecording\.id, screenshot\.id\)\.catch/.test(source.background) &&
      /async function queueRealtimeSuggestion/.test(source.background) &&
      /realtimeSuggestionQueue\.pending = \{ recordingId, screenshotId \}/.test(source.background)
  },
  {
    name: 'realtime queue is latest-only while one analysis is active',
    pass:
      /let realtimeSuggestionQueue = \{[\s\S]*active: false,[\s\S]*pending: null/.test(source.background) &&
      /if \(!realtimeSuggestionQueue\.active\)/.test(source.background) &&
      /while \(realtimeSuggestionQueue\.pending\)/.test(source.background)
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
      /if \(hasStepDescription\(currentRecording\.screenshots\[index\]\)\) \{[\s\S]*continue;[\s\S]*\}/.test(
        source.background
      )
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`Realtime suggestion regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
