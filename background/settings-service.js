import { recoverInterruptedRecordings } from './history-service.js';
import { sendOffscreenMessage } from './media-orchestrator.js';
import { normalizeRealtimeSuggestionForSettings, notifyRealtimeSuggestion } from './realtime-suggestions.js';
import { HISTORY_KEY, S, SETTINGS_KEY, persistRuntime, restoreRuntimeState, updateBadge } from './runtime-state.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings-schema.js';
import { getSettings } from './settings-store.js';

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

export async function saveSettings(settings) {
  const currentSettings = await getSettings();
  const nextSettings = normalizeSettings({
    ...currentSettings,
    ...settings
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });

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
