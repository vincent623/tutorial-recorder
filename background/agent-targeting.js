import { S } from './runtime-state.js';
import { sanitizeEditableText } from './text-utils.js';

export async function calibrateAgentAction(action) {
  if (action?.action !== 'click_at_xy' || !action.targetText) {
    return action;
  }

  const center = await resolveAgentTargetCenter(action.targetText);
  if (!center) {
    return { ...action, coordinateSource: 'vision' };
  }

  return {
    ...action,
    requestedX: action.x,
    requestedY: action.y,
    x: center.x,
    y: center.y,
    matchedText: center.matchedText,
    targetType: center.targetType,
    targetRole: center.targetRole,
    targetHref: center.targetHref,
    targetFormMethod: center.targetFormMethod,
    targetFingerprint: center.targetFingerprint,
    coordinateSource: 'visible-text'
  };
}

export function isRepeatedAgentAction(action, steps = []) {
  if (action?.action !== 'click_at_xy' || !action.targetText || !Array.isArray(steps) || !steps.length) {
    return false;
  }

  const previous = steps[steps.length - 1];
  const repeatedTarget = previous?.action === 'click_at_xy' && previous.targetText === action.targetText;
  if (!repeatedTarget) {
    return false;
  }

  const highRiskTarget = /提交|删除|支付|发布|发送|购买|下单|确认订单/.test(action.targetText);
  const auditedLowRiskRepeat = action.allowRepeat === true && Boolean(action.repeatReason) && !highRiskTarget;
  return !auditedLowRiskRepeat;
}

export async function resolveAgentTargetCenter(targetText) {
  if (!S.currentRuntime.cdpAttached || !S.currentRuntime.tabId) {
    return null;
  }

  const normalizedTarget = sanitizeEditableText(targetText, 160);
  if (!normalizedTarget) {
    return null;
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
    const fingerprint = (element) => {
      const path = [];
      let node = element;
      for (let depth = 0; node && node.nodeType === 1 && depth < 5; depth += 1) {
        const parent = node.parentElement;
        const siblingIndex = parent ? Array.from(parent.children).indexOf(node) : 0;
        const stableId = node.id || node.getAttribute('data-testid') || node.getAttribute('data-id') || node.getAttribute('name') || '';
        path.unshift(node.tagName.toLowerCase() + ':' + siblingIndex + ':' + stableId);
        node = parent;
      }
      const context = element.closest('[data-id], [data-testid], tr, li, article, [role="row"]') || element.parentElement;
      const contextText = String(context?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500);
      return hash(path.join('>') + '|' + contextText + '|' + element.outerHTML.slice(0, 500));
    };
    const target = ${JSON.stringify(normalizedTarget)}.replace(/\\s+/g, ' ').trim();
    const selectors = 'button, a, [role="button"], input[type="button"], input[type="submit"], summary';
    const candidates = [...document.querySelectorAll(selectors)].map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = String(element.innerText || element.value || element.getAttribute('aria-label') || '')
        .replace(/\\s+/g, ' ')
        .trim();
      const visible = rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.right > 0 &&
        rect.top < innerHeight && rect.left < innerWidth && style.visibility !== 'hidden' &&
        style.display !== 'none' && Number(style.opacity || 1) > 0;
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const hit = document.elementFromPoint(x, y);
      const hitTested = Boolean(hit && (element === hit || element.contains(hit)));
      return {
        element,
        text,
        rect,
        visible: visible && hitTested,
        targetType: String(element.getAttribute('type') || '').toLowerCase(),
        targetRole: String(element.getAttribute('role') || '').toLowerCase(),
        targetHref: element instanceof HTMLAnchorElement ? element.href : '',
        targetFormMethod: String(element.form?.method || '').toLowerCase(),
        targetFingerprint: fingerprint(element)
      };
    }).filter((item) => item.visible && item.text);
    const match = candidates.find((item) => item.text === target);
    if (!match) return null;
    return {
      x: Math.round(match.rect.left + match.rect.width / 2),
      y: Math.round(match.rect.top + match.rect.height / 2),
      matchedText: match.text.slice(0, 160),
      targetType: match.targetType,
      targetRole: match.targetRole,
      targetHref: match.targetHref,
      targetFormMethod: match.targetFormMethod,
      targetFingerprint: match.targetFingerprint
    };
  })()`;

  try {
    const result = await chrome.debugger.sendCommand(
      { tabId: S.currentRuntime.tabId },
      'Runtime.evaluate',
      { expression, returnByValue: true }
    );
    const value = result?.result?.value;
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? value : null;
  } catch (error) {
    console.warn('[Background] Calibrate agent click target failed:', error);
    return null;
  }
}

export async function assertAgentClickTargetFresh(action) {
  if (action?.action !== 'click_at_xy' || action.coordinateSource !== 'visible-text') {
    return;
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
    const elementAtPoint = document.elementFromPoint(${Number(action.x)}, ${Number(action.y)});
    const element = elementAtPoint?.closest('button, a, [role="button"], input[type="button"], input[type="submit"], summary');
    if (!element) return null;
    const path = [];
    let node = element;
    for (let depth = 0; node && node.nodeType === 1 && depth < 5; depth += 1) {
      const parent = node.parentElement;
      const siblingIndex = parent ? Array.from(parent.children).indexOf(node) : 0;
      const stableId = node.id || node.getAttribute('data-testid') || node.getAttribute('data-id') || node.getAttribute('name') || '';
      path.unshift(node.tagName.toLowerCase() + ':' + siblingIndex + ':' + stableId);
      node = parent;
    }
    const context = element.closest('[data-id], [data-testid], tr, li, article, [role="row"]') || element.parentElement;
    const contextText = String(context?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500);
    const text = String(element.innerText || element.value || element.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    return {
      text: text.slice(0, 160),
      fingerprint: hash(path.join('>') + '|' + contextText + '|' + element.outerHTML.slice(0, 500))
    };
  })()`;
  const result = await chrome.debugger.sendCommand(
    { tabId: S.currentRuntime.tabId },
    'Runtime.evaluate',
    { expression, returnByValue: true }
  );
  const current = result?.result?.value;
  if (
    !current ||
    sanitizeEditableText(current.text, 160) !== sanitizeEditableText(action.targetText, 160) ||
    current.fingerprint !== action.targetFingerprint
  ) {
    throw new Error('点击前目标控件发生变化，已阻止执行并等待重新确认');
  }
}
