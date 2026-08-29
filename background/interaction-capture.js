import { S, persistRuntime } from './runtime-state.js';
import { maskSensitiveText, sanitizeEditableText } from './text-utils.js';

export async function recordInteraction(payload, sender) {
  if (!S.currentRuntime.isRecording || !S.currentRecording) {
    return;
  }

  if (sender.tab?.id && S.currentRuntime.tabId && sender.tab.id !== S.currentRuntime.tabId) {
    return;
  }

  const cdpElement = await locateElementWithCdp(payload).catch(() => null);
  const cdpSummary = cdpElement ? buildCdpInteractionSummary(payload.type, cdpElement) : '';

  S.currentRuntime.lastInteraction = {
    type: sanitizeEditableText(payload.type, 40) || 'interaction',
    summary: maskSensitiveText(sanitizeEditableText(cdpSummary || payload.summary, 160)),
    target: maskSensitiveText(sanitizeEditableText(cdpElement?.target || payload.target, 160)),
    cdpElement,
    timestamp: Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now()
  };

  await persistRuntime();
}


export async function locateElementWithCdp(payload = {}) {
  if (
    S.currentRuntime.screenshotEngine !== 'cdp' ||
    !S.currentRuntime.cdpAttached ||
    !Number.isFinite(payload.clientX) ||
    !Number.isFinite(payload.clientY) ||
    payload.type !== 'click'
  ) {
    return null;
  }

  const target = { tabId: S.currentRuntime.tabId };
  const location = await chrome.debugger.sendCommand(target, 'DOM.getNodeForLocation', {
    x: Math.round(payload.clientX),
    y: Math.round(payload.clientY),
    includeUserAgentShadowDOM: true,
    ignorePointerEventsNone: true
  });

  const nodeRef = location?.backendNodeId
    ? { backendNodeId: location.backendNodeId }
    : location?.nodeId
      ? { nodeId: location.nodeId }
      : null;

  if (!nodeRef) {
    return null;
  }

  const described = await chrome.debugger.sendCommand(target, 'DOM.describeNode', nodeRef);
  return describeCdpNode(described?.node);
}

export function describeCdpNode(node) {
  if (!node?.nodeName) {
    return null;
  }

  const attributes = {};
  const rawAttributes = Array.isArray(node.attributes) ? node.attributes : [];
  for (let index = 0; index < rawAttributes.length; index += 2) {
    attributes[String(rawAttributes[index] || '').toLowerCase()] = String(rawAttributes[index + 1] || '');
  }

  const tagName = String(node.nodeName || '').toLowerCase();
  const label = sanitizeEditableText(
    attributes['aria-label'] ||
      attributes.title ||
      attributes.placeholder ||
      attributes.name ||
      attributes['data-testid'] ||
      attributes.role ||
      '',
    60
  );
  const kind = getCdpNodeKind(tagName, attributes.role);
  const target = label ? `“${label}”${kind}` : kind || tagName || '页面元素';

  return {
    tagName,
    role: sanitizeEditableText(attributes.role, 40),
    label,
    target
  };
}

export function getCdpNodeKind(tagName, role) {
  if (role === 'button' || tagName === 'button') {
    return '按钮';
  }

  if (tagName === 'input' || tagName === 'textarea') {
    return '输入框';
  }

  if (tagName === 'select') {
    return '下拉框';
  }

  if (tagName === 'a') {
    return '链接';
  }

  return '页面元素';
}

export function buildCdpInteractionSummary(type, element) {
  if (!element?.target) {
    return '';
  }

  if (type === 'click') {
    return `点击${element.target}`;
  }

  return '';
}

export function getRelevantInteraction(timestamp) {
  const interaction = S.currentRuntime.lastInteraction;
  if (!interaction?.summary) {
    return null;
  }

  if (Math.abs(timestamp - interaction.timestamp) > 15_000) {
    return null;
  }

  return interaction;
}
