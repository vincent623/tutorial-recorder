import { S } from './runtime-state.js';

export async function readCompatibleViewport(tabId = S.currentRuntime.tabId) {
  return runPageProbe(tabId, () => ({ width: innerWidth, height: innerHeight }));
}

export async function readCompatibleFocusContext(tabId = S.currentRuntime.tabId) {
  return runPageProbe(tabId, inspectCompatiblePageContext, ['focus', 0, 0]);
}

export async function readCompatiblePointContext(x, y, tabId = S.currentRuntime.tabId) {
  return runPageProbe(tabId, inspectCompatiblePageContext, ['point', x, y]);
}

function inspectCompatiblePageContext(kind, x, y) {
  const element = kind === 'point'
    ? document.elementFromPoint(Number(x), Number(y))
    : document.activeElement || document.body;
  if (!element) return { fingerprint: '', label: '' };
  const hash = (value) => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
  };
  const path = [];
  let node = element;
  for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth += 1) {
    const parent = node.parentElement;
    const siblingIndex = parent ? Array.from(parent.children).indexOf(node) : 0;
    const stableId = node.id || node.getAttribute('data-testid') || node.getAttribute('data-id') || node.getAttribute('name') || '';
    path.unshift(`${node.tagName.toLowerCase()}:${siblingIndex}:${stableId}`);
    node = parent;
  }
  const semantics = [
    element.tagName,
    element.id,
    element.getAttribute('name'),
    element.getAttribute('type'),
    element.getAttribute('role'),
    element.getAttribute('aria-label'),
    ...(kind === 'point' ? [element.getAttribute('href'), element.getAttribute('formaction')] : [])
  ].map((value) => String(value || '')).join('|');
  const label = element.getAttribute('aria-label') || element.getAttribute('name') ||
    element.id || element.getAttribute('type') || element.tagName.toLowerCase();
  return {
    fingerprint: hash(`${path.join('>')}|${semantics}`),
    label: String(label || '').slice(0, 120),
    inputType: String(element.getAttribute('type') || '').toLowerCase(),
    formMethod: String(element.form?.method || '').toLowerCase(),
    placeholder: String(element.getAttribute('placeholder') || '').slice(0, 160)
  };
}

async function runPageProbe(tabId, func, args = []) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error('AI 操作目标标签页不可用');
  }
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return results?.[0]?.result;
}

export async function executeCompatibleAgentAction(action, tabId = S.currentRuntime.tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error('AI 操作目标标签页不可用');
  }

  if (action.action === 'navigate') {
    await chrome.tabs.update(tabId, { url: action.url });
    return;
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: performPageAction,
    args: [toCompatibleActionPayload(action)]
  });
  const result = results?.[0]?.result;
  if (result?.ok !== true) {
    throw new Error(result?.error || '页面兼容操作执行失败');
  }
}

export function toCompatibleActionPayload(action = {}) {
  return {
    action: String(action.action || ''),
    x: Number(action.x) || 0,
    y: Number(action.y) || 0,
    deltaY: Number(action.deltaY) || 0,
    text: String(action.text || ''),
    key: String(action.key || ''),
    targetText: String(action.targetText || ''),
    targetLocated:
      action.coordinateSource === 'visible-text' ||
      action.coordinateSource === 'observation-reference',
    submit: action.submit === true
  };
}

function performPageAction(action) {
  const pointElement = () => document.elementFromPoint(action.x, action.y);
  const dispatchMouse = (element, type, extras = {}) => {
    element.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: action.x,
      clientY: action.y,
      button: 0,
      ...extras
    }));
  };
  const editable = () => {
    const element = document.activeElement;
    return element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element?.isContentEditable
      ? element
      : null;
  };

  if (action.action === 'click_at_xy') {
    const element = pointElement();
    if (!element) return { ok: false, error: '点击位置没有可操作元素' };
    element.focus?.({ preventScroll: true });
    dispatchMouse(element, 'mousedown');
    dispatchMouse(element, 'mouseup');
    element.click();
    return { ok: true };
  }

  if (action.action === 'hover') {
    const element = pointElement();
    if (!element) return { ok: false, error: '悬停位置没有可操作元素' };
    dispatchMouse(element, 'mouseover');
    dispatchMouse(element, 'mouseenter', { bubbles: false });
    dispatchMouse(element, 'mousemove');
    return { ok: true };
  }

  if (action.action === 'scroll') {
    window.scrollBy({ top: action.deltaY, left: 0, behavior: 'instant' });
    return { ok: true };
  }

  if (action.action === 'type_text') {
    const pointed = action.targetLocated ? pointElement() : null;
    const pointedEditable = pointed?.closest?.('input:not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]');
    const element = pointedEditable || editable();
    if (!element) return { ok: false, error: '当前页面没有获得焦点的输入框' };
    element.focus({ preventScroll: true });
    if (action.targetLocated && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      element.select();
    } else if (action.targetLocated && element.isContentEditable) {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const inserted = document.execCommand('insertText', false, action.text);
    if (!inserted) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? start;
        element.setRangeText(action.text, start, end, 'end');
      } else {
        element.textContent = `${element.textContent || ''}${action.text}`;
      }
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: action.text
      }));
    }
    if (action.submit) {
      const down = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true
      });
      const allowed = element.dispatchEvent(down);
      if (allowed && element instanceof HTMLInputElement && element.form) {
        element.form.requestSubmit();
      }
      element.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter', code: 'Enter', bubbles: true, composed: true
      }));
    }
    return { ok: true };
  }

  if (action.action === 'press_key') {
    const target = document.activeElement || document.body;
    const normalizedKey = String(action.key || 'enter').toLowerCase().replace(/[\s_-]+/g, '');
    const key = {
      enter: 'Enter',
      tab: 'Tab',
      escape: 'Escape',
      backspace: 'Backspace',
      arrowup: 'ArrowUp',
      arrowdown: 'ArrowDown',
      arrowleft: 'ArrowLeft',
      arrowright: 'ArrowRight'
    }[normalizedKey] || 'Enter';
    const down = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, composed: true });
    const allowed = target.dispatchEvent(down);
    if (allowed && key === 'Enter') {
      if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) {
        target.click();
      } else if (target instanceof HTMLInputElement && target.form) {
        target.form.requestSubmit();
      }
    } else if (allowed && key === 'Tab') {
      const focusable = [...document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => element.getClientRects().length > 0);
      const currentIndex = focusable.indexOf(target);
      focusable[(currentIndex + 1) % focusable.length]?.focus();
    } else if (allowed && key === 'Escape') {
      target.blur?.();
    }
    target.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, composed: true }));
    return { ok: true };
  }

  return { ok: false, error: `不支持的页面兼容操作：${action.action}` };
}
