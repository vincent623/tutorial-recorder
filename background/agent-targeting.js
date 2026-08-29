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
      return { text, rect, visible };
    }).filter((item) => item.visible && item.text);
    const match = candidates.find((item) => item.text === target);
    if (!match) return null;
    return {
      x: Math.round(match.rect.left + match.rect.width / 2),
      y: Math.round(match.rect.top + match.rect.height / 2),
      matchedText: match.text.slice(0, 160)
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
