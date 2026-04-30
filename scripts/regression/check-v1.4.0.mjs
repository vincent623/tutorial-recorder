import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  manifest: 'manifest.json',
  background: 'background/background.js',
  content: 'content/content.js',
  popupHtml: 'popup/popup.html',
  popupJs: 'popup/popup.js',
  settingsHtml: 'settings/settings.html',
  settingsJs: 'settings/settings.js'
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, relativePath]) => [
      key,
      await readFile(path.join(repoRoot, relativePath), 'utf8')
    ])
  )
);

const manifest = JSON.parse(source.manifest);

const checks = [
  {
    name: 'manifest declares debugger permission for CDP mode',
    pass: Array.isArray(manifest.permissions) && manifest.permissions.includes('debugger')
  },
  {
    name: 'settings expose standard/CDP screenshot engine and crop controls',
    pass:
      /id="screenshotEngine"/.test(source.settingsHtml) &&
      /value="standard"/.test(source.settingsHtml) &&
      /value="cdp"/.test(source.settingsHtml) &&
      /id="cdpCropEnabled"/.test(source.settingsHtml) &&
      /id="cdpCropWidth"/.test(source.settingsHtml) &&
      /screenshotEngine: elements\.screenshotEngine\.value/.test(source.settingsJs)
  },
  {
    name: 'background has CDP attach, capture, fallback, and detach paths',
    pass:
      /chrome\.debugger\.attach/.test(source.background) &&
      /Page\.captureScreenshot/.test(source.background) &&
      /CDP 截图失败，已回退到标准模式/.test(source.background) &&
      /CDP 截图启动失败，已回退到标准模式/.test(source.background) &&
      /await detachCdpDebugger\(\);[\s\S]*await generateTutorial\(\);/.test(source.background)
  },
  {
    name: 'content reports click coordinates for CDP element location',
    pass:
      /clientX: event\.clientX/.test(source.content) &&
      /clientY: event\.clientY/.test(source.content) &&
      /DOM\.getNodeForLocation/.test(source.background) &&
      /DOM\.describeNode/.test(source.background)
  },
  {
    name: 'popup shows CDP status banner while debugger is active',
    pass:
      /id="cdpBanner"/.test(source.popupHtml) &&
      /case 'cdpStatus':/.test(source.popupJs) &&
      /elements\.cdpBanner\.hidden = !\(state\.isRecording && state\.cdpAttached\)/.test(source.popupJs)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`CDP regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
