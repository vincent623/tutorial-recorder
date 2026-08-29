

import { S } from './runtime-state.js';

// Popup and content broadcast helpers.

export function notifyPopup(action, payload = {}) {
  chrome.runtime.sendMessage({ action, ...payload }).catch(() => {});
}

export function notifyContent(action, payload = {}) {
  if (!S.currentRuntime.tabId) {
    return;
  }

  chrome.tabs.sendMessage(S.currentRuntime.tabId, { action, ...payload }).catch(() => {});
}
