import { recoverInterruptedRecordings, recoverPendingStorageCleanup } from './history-service.js';
import { beginAiRequestConfigurationChange, finishAiRequestConfigurationChange } from './ai-request-control.js';
import { isSecureAiEndpoint } from './ai-vision.js';
import { sendOffscreenMessage } from './media-orchestrator.js';
import { normalizeRealtimeSuggestionForSettings, notifyRealtimeSuggestion } from './realtime-suggestions.js';
import { HISTORY_KEY, S, SETTINGS_KEY, persistRuntime, restoreRuntimeState, updateBadge } from './runtime-state.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings-schema.js';
import { getSettings } from './settings-store.js';

let settingsWriteQueue = Promise.resolve();

export async function ensureInitialized() {
  if (!S.initPromise) {
    S.initPromise = initialize();
  }

  await S.initPromise;
}

export async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

  const { [SETTINGS_KEY]: storedSettings, [HISTORY_KEY]: storedHistory } = await chrome.storage.local.get([
    SETTINGS_KEY,
    HISTORY_KEY
  ]);

  if (!storedSettings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  } else {
    await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(storedSettings) });
  }

  if (!Array.isArray(storedHistory)) {
    await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  }

  await recoverPendingStorageCleanup();
  await restoreRuntimeState();
  await recoverInterruptedRecordings();
  await updateBadge();
}

export async function getPopupStateSettings() {
  const settings = await getSettings();
  return {
    ...settings,
    apiKey: '',
    apiKeyConfigured: Boolean(settings.apiKey)
  };
}

export function saveSettings(settings) {
  const operation = settingsWriteQueue.then(() => performSaveSettings(settings));
  settingsWriteQueue = operation.catch(() => {});
  return operation;
}

async function performSaveSettings(settings) {
  const currentSettings = await getSettings();
  const candidateSettings = {
    ...currentSettings,
    ...settings
  };
  if (
    candidateSettings.aiDataSharingConsent === true &&
    candidateSettings.apiKey &&
    candidateSettings.apiBaseUrl &&
    !isSecureAiEndpoint(candidateSettings.apiBaseUrl)
  ) {
    throw new Error('为保护 API Key 和截图，AI Base URL 必须使用 HTTPS；仅本机回环地址可使用 HTTP。');
  }
  const nextSettings = normalizeSettings(candidateSettings);
  const aiRequestConfigChanged = hasAiRequestConfigChanged(currentSettings, nextSettings);
  if (aiRequestConfigChanged) {
    beginAiRequestConfigurationChange();
  }
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
  } finally {
    if (aiRequestConfigChanged) {
      finishAiRequestConfigurationChange();
    }
  }

  if (S.currentRuntime.isRecording) {
    S.currentRuntime.captureIntervalMs = nextSettings.screenshotInterval * 1000;
    S.currentRuntime.autoScreenshot = nextSettings.autoScreenshot;
    S.currentRuntime.realtimeSuggestion = normalizeRealtimeSuggestionForSettings(
      S.currentRuntime.realtimeSuggestion,
      nextSettings
    );
    await persistRuntime();
    notifyRealtimeSuggestion();

    await sendOffscreenMessage('updateSession', {
      intervalMs: S.currentRuntime.captureIntervalMs,
      autoCapture: S.currentRuntime.autoScreenshot,
      paused: S.currentRuntime.isPaused
    }).catch(() => {});
  }

  return nextSettings;
}

function hasAiRequestConfigChanged(currentSettings, candidateSettings) {
  return ['aiDataSharingConsent', 'apiBaseUrl', 'apiKey', 'modelId', 'apiStyle', 'extraHeadersJson']
    .some((key) => currentSettings[key] !== candidateSettings[key]);
}
