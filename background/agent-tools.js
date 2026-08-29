import { extractVisionText } from './ai-vision.js';
import { runExclusiveOperation } from './op-safety.js';
import { S } from './runtime-state.js';
import { clampNumber, delay, sanitizeCoordinate, sanitizeEditableText } from './text-utils.js';

export const AGENT_TOOL_NAMES = Object.freeze([
  'click_at_xy',
  'type_text',
  'scroll',
  'press_key',
  'navigate',
  'hover',
  'wait',
  'finish'
]);

export function buildAgentToolSchema(apiStyle) {
  const baseTools = [
    {
      name: 'click_at_xy',
      description: 'Click a visible page coordinate in the current viewport.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          description: { type: 'string' }
        },
        required: ['x', 'y', 'description']
      }
    },
    {
      name: 'type_text',
      description: 'Type text into the currently focused input.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['text', 'description']
      }
    },
    {
      name: 'scroll',
      description: 'Scroll the current page.',
      parameters: {
        type: 'object',
        properties: {
          deltaY: { type: 'number' },
          x: { type: 'number' },
          y: { type: 'number' },
          description: { type: 'string' }
        },
        required: ['deltaY', 'description']
      }
    },
    {
      name: 'press_key',
      description: 'Press a keyboard key such as Enter, Tab, Escape, Backspace or an arrow key.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Enter | Tab | Escape | Backspace | ArrowUp | ArrowDown | ArrowLeft | ArrowRight' },
          description: { type: 'string' }
        },
        required: ['key', 'description']
      }
    },
    {
      name: 'navigate',
      description: 'Open a full http/https URL in the current tab.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['url', 'description']
      }
    },
    {
      name: 'hover',
      description: 'Move the mouse to a visible viewport coordinate to reveal menus or tooltips.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          description: { type: 'string' }
        },
        required: ['x', 'y', 'description']
      }
    },
    {
      name: 'wait',
      description: 'Wait briefly for page loading or animations before the next action.',
      parameters: {
        type: 'object',
        properties: {
          ms: { type: 'number', description: 'Milliseconds between 300 and 3000' },
          description: { type: 'string' }
        },
        required: ['ms', 'description']
      }
    },
    {
      name: 'finish',
      description: 'Finish the tutorial recording when the goal is complete.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string' }
        },
        required: ['description']
      }
    }
  ];

  if (apiStyle === 'anthropicMessages') {
    return baseTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }

  if (apiStyle === 'responses') {
    return baseTools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  return baseTools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

export function extractAgentAction(data, apiStyle) {
  const toolCall = extractAgentToolCall(data, apiStyle);
  if (toolCall) {
    return sanitizeAgentAction({
      action: toolCall.name,
      ...toolCall.arguments
    });
  }

  const text = extractVisionText(data, apiStyle);
  return parseAgentActionText(text);
}

export function extractAgentToolCall(data, apiStyle) {
  if (apiStyle === 'responses') {
    const output = Array.isArray(data?.output) ? data.output : [];
    const call = output.find((item) => item?.type === 'function_call' && item.name);
    if (!call) {
      return null;
    }

    return {
      name: call.name,
      arguments: parseToolArguments(call.arguments)
    };
  }

  if (apiStyle === 'anthropicMessages') {
    const content = Array.isArray(data?.content) ? data.content : [];
    const call = content.find((item) => item?.type === 'tool_use' && item.name);
    if (!call) {
      return null;
    }

    return {
      name: call.name,
      arguments: call.input && typeof call.input === 'object' ? call.input : {}
    };
  }

  const toolCalls = data?.choices?.[0]?.message?.tool_calls;
  const call = Array.isArray(toolCalls) ? toolCalls[0] : null;
  if (!call?.function?.name) {
    return null;
  }

  return {
    name: call.function.name,
    arguments: parseToolArguments(call.function.arguments)
  };
}

export function parseToolArguments(value) {
  if (!value) {
    return {};
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    return {};
  }
}

export function parseAgentActionText(text) {
  const raw = String(text || '').trim();
  const jsonText = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw.match(/\{[\s\S]*\}/)?.[0] || raw;

  try {
    return sanitizeAgentAction(JSON.parse(jsonText));
  } catch (error) {
    throw new Error(`AI 未返回可执行动作：${sanitizeEditableText(raw, 160) || '空响应'}`);
  }
}

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

export function normalizeAgentKey(value) {
  const raw = sanitizeEditableText(value, 24).toLowerCase().replace(/[\s_-]+/g, '');
  return Object.hasOwn(AGENT_KEY_EVENT_DEFS, raw) ? raw : '';
}

export function normalizeAgentNavigateUrl(value) {
  const raw = sanitizeEditableText(value, 500);
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    return parsed.href;
  } catch (error) {
    return '';
  }
}

export function sanitizeAgentAction(action = {}) {
  const rawAction = sanitizeEditableText(action.action || action.type || action.name || action.tool, 40);
  const normalizedAction = AGENT_TOOL_NAMES.includes(rawAction) ? rawAction : '';

  if (!normalizedAction) {
    throw new Error('AI 返回了未知工具动作');
  }

  const description = sanitizeEditableText(action.description, 400) || describeAgentAction({ action: normalizedAction });

  if (normalizedAction === 'click_at_xy' || normalizedAction === 'hover') {
    const x = sanitizeCoordinate(action.x);
    const y = sanitizeCoordinate(action.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(normalizedAction === 'hover' ? 'AI 悬停动作缺少有效坐标' : 'AI 点击动作缺少有效坐标');
    }

    return { action: normalizedAction, x, y, description };
  }

  if (normalizedAction === 'type_text') {
    const text = sanitizeEditableText(action.text, 500);
    if (!text) {
      throw new Error('AI 输入动作缺少文本');
    }

    return { action: normalizedAction, text, description };
  }

  if (normalizedAction === 'scroll') {
    return {
      action: normalizedAction,
      deltaY: clampNumber(action.deltaY, -3000, 3000, 700),
      x: sanitizeCoordinate(action.x, 400),
      y: sanitizeCoordinate(action.y, 400),
      description
    };
  }

  if (normalizedAction === 'press_key') {
    const key = normalizeAgentKey(action.key);
    if (!key) {
      throw new Error('AI 按键动作包含不支持的按键');
    }

    return { action: normalizedAction, key, description };
  }

  if (normalizedAction === 'navigate') {
    const url = normalizeAgentNavigateUrl(action.url);
    if (!url) {
      throw new Error('AI 导航动作缺少有效的 http/https 地址');
    }

    return { action: normalizedAction, url, description };
  }

  if (normalizedAction === 'wait') {
    return {
      action: normalizedAction,
      ms: clampNumber(action.ms, 300, 3000, 800),
      description
    };
  }

  return { action: 'finish', description };
}



export function describeAgentAction(action = {}) {
  if (action.action === 'click_at_xy') {
    return '点击页面中的目标位置';
  }

  if (action.action === 'type_text') {
    return '在当前输入框中输入内容';
  }

  if (action.action === 'scroll') {
    return action.deltaY < 0 ? '向上滚动页面' : '向下滚动页面';
  }

  if (action.action === 'press_key') {
    return `按下 ${String(action.key || 'Enter').toUpperCase()} 键`;
  }

  if (action.action === 'navigate') {
    return '打开指定网页地址';
  }

  if (action.action === 'hover') {
    return '将鼠标悬停在目标位置';
  }

  if (action.action === 'wait') {
    return '等待页面加载稳定';
  }

  return '完成当前教程目标';
}

export async function executeAiAgentAction(action) {
  const lockKey = `agentAction:${S.currentRuntime.recordingId || 'idle'}:${S.currentRuntime.aiAgent?.iteration || 0}`;
  return runExclusiveOperation(lockKey, () => performExecuteAiAgentAction(action));
}

export async function performExecuteAiAgentAction(action) {
  if (!S.currentRuntime.cdpAttached || !S.currentRuntime.tabId) {
    throw new Error('CDP 未连接，无法执行 AI 操作');
  }

  const target = { tabId: S.currentRuntime.tabId };

  if (action.action === 'click_at_xy') {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: action.x,
      y: action.y,
      button: 'left',
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: action.x,
      y: action.y,
      button: 'left',
      clickCount: 1
    });
    return;
  }

  if (action.action === 'type_text') {
    await chrome.debugger.sendCommand(target, 'Input.insertText', {
      text: action.text
    });
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
    const keyDef = AGENT_KEY_EVENT_DEFS[action.key] || AGENT_KEY_EVENT_DEFS.enter;
    const baseEvent = {
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode
    };

    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...baseEvent
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...baseEvent
    });
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
