import { SETTINGS_KEY } from './runtime-state.js';
import { normalizeSettings } from './settings-schema.js';

export async function getSettings() {
  const { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(settings);
}
