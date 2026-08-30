import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  background: 'background/',
  popupHtml: 'popup/popup.html',
  popupJs: 'popup/popup.js',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json'
};

const source = await readSources(repoRoot, files);

const packageJson = JSON.parse(source.packageJson);
const packageLock = JSON.parse(source.packageLock);
const manifest = JSON.parse(source.manifest);

const checks = [
  {
    name: 'version metadata is aligned for the current 2.x release',
    pass:
      /^2\.\d+\.\d+$/.test(packageJson.version) &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'popup exposes AI recording entry and takeover control',
    pass:
      /id="aiGoal"/.test(source.popupHtml) &&
      /id="btnAiStart"/.test(source.popupHtml) &&
      /id="btnAiTakeover"/.test(source.popupHtml) &&
      /startAiRecording/.test(source.popupJs) &&
      /takeoverRecording/.test(source.popupJs)
  },
  {
    name: 'background registers AI recording lifecycle messages',
    pass:
      /case 'startAiRecording':/.test(source.background) &&
      /case 'pauseAiAgent':/.test(source.background) &&
      /case 'resumeAiAgent':/.test(source.background) &&
      /case 'takeoverRecording':/.test(source.background)
  },
  {
    name: 'AI agent loop captures, decides, executes, and finishes through existing export',
    pass:
      /function runAiAgentLoop/.test(source.background) &&
      /captureScreenshot\(\{ trigger: 'agent'/.test(source.background) &&
      /decideNextAgentAction/.test(source.background) &&
      /executeAiAgentAction/.test(source.background) &&
      (/await stopRecording\(\);/.test(source.background) || /await requestStop\?\.\(\);/.test(source.background))
  },
  {
    name: 'CDP tool executor supports required browser actions',
    pass:
      /click_at_xy/.test(source.background) &&
      /type_text/.test(source.background) &&
      /scroll/.test(source.background) &&
      /finish/.test(source.background) &&
      /Input\.dispatchMouseEvent/.test(source.background) &&
      /Input\.insertText/.test(source.background)
  },
  {
    name: 'AI recording has default safety limits and failure takeover path',
    pass:
      /const AI_AGENT_MAX_STEPS = 50/.test(source.background) &&
      /const AI_AGENT_MAX_DURATION_MS = 10 \* 60 \* 1000/.test(source.background) &&
      /handleAiAgentFailure/.test(source.background) &&
      /await detachCdpDebugger\(\);[\s\S]*awaitingTakeover: true/.test(source.background)
  },
  {
    name: 'recording export labels AI generated tutorials',
    pass:
      /recordingMode: 'ai'/.test(source.background) &&
      /captureMode: 'agent'/.test(source.background) &&
      /AI 自动录制/.test(source.background) &&
      /formatRecordingModeLabel/.test(source.popupJs)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`AI recording regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
