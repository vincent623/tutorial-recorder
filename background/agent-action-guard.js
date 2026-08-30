import { S } from './runtime-state.js';
import { captureScreenshotDataUrl } from './screenshot-engine.js';
import { sanitizeEditableText } from './text-utils.js';

export async function enrichAgentActionGuard(action) {
  if (isCoordinateAction(action)) {
    const point = await readAgentPointContext(action.x, action.y);
    return {
      ...action,
      pointFingerprint: point.fingerprint,
      pointLabel: point.label
    };
  }

  if (isEnterAction(action)) {
    const focus = await readAgentFocusContext();
    return {
      ...action,
      focusFingerprint: focus.fingerprint,
      focusLabel: focus.label
    };
  }

  return action;
}

export async function readSensitiveActionContext(action, tab) {
  if (!isSensitiveAction(action)) {
    return {};
  }

  const image = await captureScreenshotDataUrl(tab);
  const context = {
    image,
    pageDigest: await digestDataUrl(image)
  };

  if (isEnterAction(action)) {
    const focus = await readAgentFocusContext();
    context.focusFingerprint = focus.fingerprint;
    context.focusLabel = focus.label;
  }
  if (isCoordinateAction(action)) {
    const point = await readAgentPointContext(action.x, action.y);
    context.pointFingerprint = point.fingerprint;
    context.pointLabel = point.label;
  }

  return context;
}

export function sealApprovedAgentAction(action, context = {}, sourceUrl = '') {
  return {
    ...action,
    approvalSourceUrl: String(sourceUrl || ''),
    ...(isSensitiveAction(action)
      ? {
          approvalPageDigest: context.pageDigest || '',
          ...(isCoordinateAction(action)
            ? {
                approvalPointFingerprint: context.pointFingerprint || '',
                pointLabel: context.pointLabel || action.pointLabel || ''
              }
            : {}),
          ...(isEnterAction(action)
            ? {
                approvalFocusFingerprint: context.focusFingerprint || '',
                focusLabel: context.focusLabel || action.focusLabel || ''
              }
            : {})
        }
      : {})
  };
}

export async function assertApprovedActionSourceFresh(action) {
  if (!action?.approvalSourceUrl) {
    return;
  }

  const tab = await chrome.tabs.get(S.currentRuntime.tabId).catch(() => null);
  if (!tab || tab.url !== action.approvalSourceUrl) {
    throw new Error('执行前页面地址发生变化，已阻止原批准动作');
  }
}

export async function assertApprovedSensitiveActionFresh(action) {
  if (!isSensitiveAction(action)) {
    return;
  }

  const tab = await chrome.tabs.get(S.currentRuntime.tabId).catch(() => null);
  if (!tab) {
    throw new Error('执行前目标页面已关闭，已阻止原批准动作');
  }
  if (!action.approvalSourceUrl || tab.url !== action.approvalSourceUrl) {
    throw new Error('执行前页面地址发生变化，已阻止原批准动作');
  }

  const current = await readSensitiveActionContext(action, tab);
  if (!action.approvalPageDigest || current.pageDigest !== action.approvalPageDigest) {
    throw new Error('执行前页面画面发生变化，已阻止原批准动作');
  }

  if (
    isCoordinateAction(action) &&
    (!action.approvalPointFingerprint || current.pointFingerprint !== action.approvalPointFingerprint)
  ) {
    throw new Error('执行前坐标命中元素发生变化，已阻止原批准点击');
  }

  if (
    isEnterAction(action) &&
    (!action.approvalFocusFingerprint || current.focusFingerprint !== action.approvalFocusFingerprint)
  ) {
    throw new Error('执行前键盘焦点发生变化，已阻止 Enter 动作');
  }
}

export async function readAgentFocusContext() {
  if (!S.currentRuntime.cdpAttached || !S.currentRuntime.tabId) {
    return { fingerprint: '', label: '' };
  }

  const expression = `(() => {
    const hash = (value) => {
      let result = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
      }
      return (result >>> 0).toString(16);
    };
    const element = document.activeElement || document.body;
    const path = [];
    let node = element;
    for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth += 1) {
      const parent = node.parentElement;
      const siblingIndex = parent ? Array.from(parent.children).indexOf(node) : 0;
      const stableId = node.id || node.getAttribute('data-testid') || node.getAttribute('data-id') || node.getAttribute('name') || '';
      path.unshift(node.tagName.toLowerCase() + ':' + siblingIndex + ':' + stableId);
      node = parent;
    }
    const semantics = [
      element.tagName,
      element.id,
      element.getAttribute('name'),
      element.getAttribute('type'),
      element.getAttribute('role'),
      element.getAttribute('aria-label')
    ].map((value) => String(value || '')).join('|');
    const label = element.getAttribute('aria-label') || element.getAttribute('name') ||
      element.id || element.getAttribute('type') || element.tagName.toLowerCase();
    return {
      fingerprint: hash(path.join('>') + '|' + semantics),
      label: String(label || '').slice(0, 120)
    };
  })()`;

  const result = await chrome.debugger.sendCommand(
    { tabId: S.currentRuntime.tabId },
    'Runtime.evaluate',
    { expression, returnByValue: true }
  );
  const value = result?.result?.value || {};
  return {
    fingerprint: sanitizeEditableText(value.fingerprint, 80),
    label: sanitizeEditableText(value.label, 120)
  };
}

export async function readAgentPointContext(x, y) {
  if (!S.currentRuntime.cdpAttached || !S.currentRuntime.tabId) {
    return { fingerprint: '', label: '' };
  }

  const expression = `(() => {
    const hash = (value) => {
      let result = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
      }
      return (result >>> 0).toString(16);
    };
    const element = document.elementFromPoint(${Number(x)}, ${Number(y)});
    if (!element) return { fingerprint: '', label: '' };
    const path = [];
    let node = element;
    for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth += 1) {
      const parent = node.parentElement;
      const siblingIndex = parent ? Array.from(parent.children).indexOf(node) : 0;
      const stableId = node.id || node.getAttribute('data-testid') || node.getAttribute('data-id') || node.getAttribute('name') || '';
      path.unshift(node.tagName.toLowerCase() + ':' + siblingIndex + ':' + stableId);
      node = parent;
    }
    const semantics = [
      element.tagName,
      element.id,
      element.getAttribute('name'),
      element.getAttribute('type'),
      element.getAttribute('role'),
      element.getAttribute('aria-label'),
      element.getAttribute('href'),
      element.getAttribute('formaction')
    ].map((value) => String(value || '')).join('|');
    const label = element.getAttribute('aria-label') || element.getAttribute('name') ||
      element.id || element.getAttribute('type') || element.tagName.toLowerCase();
    return {
      fingerprint: hash(path.join('>') + '|' + semantics),
      label: String(label || '').slice(0, 120)
    };
  })()`;

  const result = await chrome.debugger.sendCommand(
    { tabId: S.currentRuntime.tabId },
    'Runtime.evaluate',
    { expression, returnByValue: true }
  );
  const value = result?.result?.value || {};
  return {
    fingerprint: sanitizeEditableText(value.fingerprint, 80),
    label: sanitizeEditableText(value.label, 120)
  };
}

export async function digestDataUrl(dataUrl) {
  const bytes = new TextEncoder().encode(String(dataUrl || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isSensitiveAction(action) {
  return (
    isCoordinateAction(action) ||
    isEnterAction(action)
  );
}

function isCoordinateAction(action) {
  return action?.action === 'click_at_xy' && action.coordinateSource !== 'visible-text';
}

function isEnterAction(action) {
  return action?.action === 'press_key' && String(action.key || '').toLowerCase() === 'enter';
}
