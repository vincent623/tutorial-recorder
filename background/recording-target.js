import { delay, sanitizeEditableText } from './text-utils.js';

export const RECORDING_TARGET_COMMIT_TIMEOUT_MS = 8_000;

export const RECORDING_TARGET_COMMIT_INTERVAL_MS = 250;

export const RECORDABLE_PAGE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

export async function getRecordingStartTargetTab(tabId, modeLabel, options = {}) {
  const normalizedOptions = normalizeRecordingTargetOptions(options);
  const requestedTab = await getSettledRecordingTargetTab(tabId, normalizedOptions);
  const tab = isRecordingTargetTab(requestedTab, normalizedOptions)
    ? requestedTab
    : normalizedOptions.allowFallbackTarget
      ? await findBestRecordingStartTargetTab(tabId, normalizedOptions)
      : requestedTab;

  assertRecordingTargetTab(tab, modeLabel, normalizedOptions);
  return activateRecordingTargetTab(tab, modeLabel, normalizedOptions);
}

export async function getTabByIdSafely(tabId) {
  const parsedTabId = Number.parseInt(tabId, 10);
  if (!Number.isInteger(parsedTabId) || parsedTabId < 0) {
    return null;
  }

  return chrome.tabs.get(parsedTabId).catch((error) => {
    console.warn('[Background] Unable to read tab:', sanitizeEditableText(error?.message || error, 160));
    return null;
  });
}

export async function getSettledRecordingTargetTab(tabId, options = {}) {
  let tab = await getTabByIdSafely(tabId);
  if (!isPendingRecordingTargetTab(tab, options)) {
    return tab;
  }

  const deadline = Date.now() + RECORDING_TARGET_COMMIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isRecordingTargetTab(tab, options)) {
      return tab;
    }

    await delay(RECORDING_TARGET_COMMIT_INTERVAL_MS);
    tab = await getTabByIdSafely(tabId);

    if (!isPendingRecordingTargetTab(tab, options) && !isRecordingTargetTab(tab, options)) {
      return tab;
    }
  }

  return tab;
}

export async function findBestRecordingStartTargetTab(excludedTabId, options = {}) {
  const excluded = Number.parseInt(excludedTabId, 10);
  const tabs = await chrome.tabs.query({}).catch((error) => {
    console.warn('[Background] Unable to query fallback tabs:', sanitizeEditableText(error?.message || error, 160));
    return [];
  });

  const pendingCandidates = tabs
    .filter((tab) => tab.id !== excluded)
    .filter((tab) => isPendingRecordingTargetTab(tab, options));
  const pendingTargetTab = options.targetUrl
    ? pendingCandidates.find((tab) => tabMatchesTargetUrl(tab, options.targetUrl)) || pendingCandidates[0]
    : pendingCandidates[0];
  if (pendingTargetTab) {
    const settledTab = await getSettledRecordingTargetTab(pendingTargetTab.id, options);
    if (isRecordingTargetTab(settledTab, options)) {
      return settledTab;
    }
  }

  const candidates = tabs
    .filter((tab) => tab.id !== excluded)
    .filter((tab) => isRecordingTargetTab(tab, options));

  if (options.targetUrl) {
    const targetMatch = candidates
      .filter((tab) => tabMatchesTargetUrl(tab, options.targetUrl))
      .sort(compareRecordingStartTargetTabs)[0];
    return targetMatch || null;
  }

  return candidates.sort(compareRecordingStartTargetTabs)[0] || null;
}

export async function activateRecordingTargetTab(tab, modeLabel, options = {}) {
  assertRecordingTargetTab(tab, modeLabel, options);

  if (!tab.active && typeof tab.windowId === 'number' && chrome.windows?.get && chrome.windows?.update) {
    const targetWindow = await chrome.windows.get(tab.windowId).catch(() => null);
    if (targetWindow && targetWindow.focused !== true) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
  }

  const activatedTab = tab.active
    ? tab
    : await chrome.tabs.update(tab.id, { active: true }).catch((error) => {
        throw normalizeRecordingTargetError(error, modeLabel);
      });
  const latestTab = (await getSettledRecordingTargetTab(tab.id, options)) || activatedTab || tab;
  assertRecordingTargetTab(latestTab, modeLabel, options);
  return latestTab;
}

export function isRecordingTargetTab(tab, options = {}) {
  if (!tab?.id || tab.id < 0) {
    return false;
  }

  const committedUrl = tab.url || '';
  const pendingUrl = tab.pendingUrl || '';

  if (!isRecordablePageUrl(committedUrl)) {
    return false;
  }

  return !pendingUrl || isRecordablePageUrl(pendingUrl);
}

export function isPendingRecordingTargetTab(tab, options = {}) {
  if (!tab?.id || tab.id < 0 || !isRecordablePageUrl(tab.pendingUrl || '')) {
    return false;
  }

  return !isRecordingTargetTab(tab, options);
}

export function compareRecordingStartTargetTabs(left, right) {
  const activeDelta = Number(Boolean(right.active)) - Number(Boolean(left.active));
  if (activeDelta) {
    return activeDelta;
  }

  return (right.lastAccessed || 0) - (left.lastAccessed || 0);
}

export function assertRecordingTargetTab(tab, modeLabel, options = {}) {
  if (isRecordingTargetTab(tab, options)) {
    return;
  }

  throw createRecordingTargetError(modeLabel);
}

export function createRecordingTargetError(modeLabel) {
  if (!modeLabel) {
    const error = new Error('请先打开要录制的 http/https/file 网页，再启动录制。');
    error.code = 'RECORDING_TARGET_UNAVAILABLE';
    return error;
  }

  const startPhrase = modeLabel === 'AI 录制' ? '无法开始 AI 录制' : '无法开始录制';
  const error = new Error(
    `当前标签页是扩展页或浏览器内部页面，${startPhrase}。请先切换到要录制的 http/https/file 网页后再启动。`
  );
  error.code = 'RECORDING_TARGET_UNAVAILABLE';
  return error;
}

export function normalizeRecordingTargetError(error, modeLabel) {
  const message = String(error?.message || error || '');
  if (/chrome-extension:\/\//i.test(message) || /Cannot access .* URL/i.test(message)) {
    return createRecordingTargetError(modeLabel);
  }

  return error instanceof Error ? error : new Error(message || '目标标签页不可访问');
}

export function normalizeCdpDebuggerAttachError(error, modeLabel, tab, options = {}) {
  const message = String(error?.message || error || '');

  if (isRecordingTargetTab(tab, options) && isCdpDebuggerConflictMessage(message)) {
    console.warn('[Background] CDP debugger attach rejected:', sanitizeEditableText(message, 240));
    const normalizedError = new Error(
      '当前标签页正在被其他扩展或开发者工具控制，无法启动 AI 录制。请关闭正在控制该标签页的浏览器自动化或开发者工具后重试。'
    );
    normalizedError.code = 'CDP_DEBUGGER_UNAVAILABLE';
    normalizedError.diagnosticMessage = sanitizeEditableText(message, 240);
    return normalizedError;
  }

  return normalizeRecordingTargetError(error, modeLabel);
}

export function isCdpDebuggerConflictMessage(message) {
  return /Cannot access a chrome-extension:\/\/ URL of different extension|Another debugger is already attached|Cannot attach to this target/i.test(
    String(message || '')
  );
}

export function isRecordingTargetError(error) {
  return (
    error?.code === 'RECORDING_TARGET_UNAVAILABLE' ||
    /当前标签页是扩展页或浏览器内部页面|请先打开要录制的 http\/https\/file 网页/.test(
      String(error?.message || error || '')
    )
  );
}

export function normalizeRecordingTargetOptions(options = {}) {
  return {
    ...options,
    allowFallbackTarget: options.allowFallbackTarget === true,
    targetUrl: normalizeRecordableTargetUrl(options.targetUrl || '')
  };
}

export function normalizeRecordableTargetUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }

  try {
    const parsed = new URL(value.trim());
    if (!RECORDABLE_PAGE_PROTOCOLS.has(parsed.protocol)) {
      return '';
    }

    parsed.hash = '';
    return parsed.href;
  } catch (error) {
    return '';
  }
}

export function extractFirstRecordableUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const match = value.match(/https?:\/\/[^\s"'<>]+|file:\/\/[^\s"'<>]+/i);
  return normalizeRecordableTargetUrl(match?.[0] || '');
}

export function tabMatchesTargetUrl(tab, targetUrl, options = {}) {
  const normalizedTargetUrl = normalizeRecordableTargetUrl(targetUrl);
  if (!normalizedTargetUrl) {
    return true;
  }

  if (urlsMatchIgnoringHash(tab?.url || '', normalizedTargetUrl)) {
    return true;
  }

  return options.committedOnly !== true && urlsMatchIgnoringHash(tab?.pendingUrl || '', normalizedTargetUrl);
}

export function urlsMatchIgnoringHash(left, right) {
  const normalizedLeft = normalizeRecordableTargetUrl(left);
  const normalizedRight = normalizeRecordableTargetUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function isRecordablePageUrl(url) {
  try {
    return RECORDABLE_PAGE_PROTOCOLS.has(new URL(url).protocol);
  } catch (error) {
    return false;
  }
}
