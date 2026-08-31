import { assertApprovedActionSourceFresh, assertApprovedSensitiveActionFresh } from './agent-action-guard.js';
import { executeCompatibleAgentAction } from './page-automation.js';
import { S } from './runtime-state.js';
import { delay } from './text-utils.js';

export const AGENT_KEY_EVENT_DEFS = Object.freeze({
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
});

export async function performExecuteAiAgentAction(
  action,
  { observationVerified = false, tabId = S.currentRuntime.tabId } = {}
) {
  if (!Number.isInteger(tabId) || tabId < 0 || S.currentRuntime.tabId !== tabId) {
    throw new Error('AI 操作目标标签页不可用');
  }

  if (!observationVerified) await assertApprovedActionSourceFresh(action);
  if (action.action === 'type_text' && action.submit) {
    assertCompositeSubmitAuthorized(action);
  }

  if (!S.currentRuntime.cdpAttached) {
    if (!observationVerified && (action.action === 'click_at_xy' || action.action === 'press_key')) {
      await assertApprovedSensitiveActionFresh(action);
    }
    if (action.action === 'wait') {
      await delay(action.ms || 800);
      return;
    }
    await executeCompatibleAgentAction(action, tabId);
    return;
  }

  const target = { tabId };
  if (action.action === 'click_at_xy') {
    if (!observationVerified) await assertApprovedSensitiveActionFresh(action);
    await dispatchCdpClick(target, action.x, action.y);
    return;
  }

  if (action.action === 'type_text') {
    if (action.targetText && Number.isFinite(action.x) && Number.isFinite(action.y)) {
      await dispatchCdpClick(target, action.x, action.y);
      await selectFocusedEditableContents(target);
    }
    await chrome.debugger.sendCommand(target, 'Input.insertText', { text: action.text });
    if (action.submit) {
      const submitResult = await submitFocusedForm(target, Boolean(action.approvalSourceUrl));
      if (submitResult === 'unsafe-form' || (submitResult === 'not-form' && action.policyAuthorization === 'get-search-fill-submit')) {
        throw new Error('提交前搜索表单结构发生变化，已阻止执行');
      }
      if (submitResult === 'not-form') {
        await dispatchCdpKey(target, 'enter');
      }
    }
    return;
  }

  if (action.action === 'scroll') {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: action.x,
      y: action.y,
      deltaY: action.deltaY,
      deltaX: 0
    });
    return;
  }

  if (action.action === 'hover') {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: action.x,
      y: action.y
    });
    return;
  }

  if (action.action === 'press_key') {
    await assertApprovedSensitiveActionFresh(action);
    await dispatchCdpKey(target, action.key);
    return;
  }

  if (action.action === 'navigate') {
    await chrome.debugger.sendCommand(target, 'Page.navigate', { url: action.url });
    return;
  }

  if (action.action === 'wait') {
    await delay(action.ms || 800);
  }
}

function assertCompositeSubmitAuthorized(action) {
  if (action.policyAuthorization === 'get-search-fill-submit' || action.approvalSourceUrl) {
    return;
  }
  throw new Error('组合输入提交未经风险策略授权，已阻止执行');
}

async function dispatchCdpClick(target, x, y) {
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1
  });
}

async function dispatchCdpKey(target, keyName) {
  const keyDef = AGENT_KEY_EVENT_DEFS[keyName] || AGENT_KEY_EVENT_DEFS.enter;
  const baseEvent = {
    key: keyDef.key,
    code: keyDef.code,
    windowsVirtualKeyCode: keyDef.keyCode,
    nativeVirtualKeyCode: keyDef.keyCode
  };
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', ...baseEvent });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...baseEvent });
}

async function submitFocusedForm(target, allowNonGet) {
  const result = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
    expression: `(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLInputElement) || !element.form) return 'not-form';
      if (!${allowNonGet === true} && String(element.form.method || '').toLowerCase() !== 'get') return 'unsafe-form';
      element.form.requestSubmit();
      return 'form-submitted';
    })()`,
    returnByValue: true
  });
  return String(result?.result?.value || 'not-form');
}

async function selectFocusedEditableContents(target) {
  await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
    expression: `(() => {
      const element = document.activeElement;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.select();
        return;
      }
      if (element?.isContentEditable) {
        const selection = getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    })()`
  });
}
