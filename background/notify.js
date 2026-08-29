

// Popup broadcast helper.

export function notifyPopup(action, payload = {}) {
  chrome.runtime.sendMessage({ action, ...payload }).catch(() => {});
}
