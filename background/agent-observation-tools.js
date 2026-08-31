import { clampNumber, sanitizeCoordinate, sanitizeEditableText } from './text-utils.js';

const observationReference = {
  type: 'string',
  description: 'Opaque reference from the current remote browser observation. Do not invent or reuse it.'
};

export function buildObservationAgentBaseTools() {
  return [
    referencedTool(
      'click_element',
      'Click a visible element from the current browser observation. Do not click an editable field merely to focus it before type_text.'
    ),
    {
      name: 'type_text',
      description: 'Focus the referenced editable element, replace its current content, type text, and optionally submit. No prior click is needed.',
      parameters: {
        type: 'object',
        properties: {
          observationId: observationReference,
          elementRef: observationReference,
          text: { type: 'string' },
          targetText: { type: 'string', description: 'Short human-readable target label for the tutorial.' },
          submit: {
            type: 'boolean',
            description: 'Must be true when the user goal asks to execute a search/query now; false when the goal only asks to fill the field.'
          },
          allowRepeat: { type: 'boolean', description: 'True only when the goal explicitly requires repeating this same semantic action.' },
          repeatReason: { type: 'string', description: 'Required audit reason when allowRepeat is true.' },
          description: { type: 'string' }
        },
        required: ['observationId', 'elementRef', 'text', 'description']
      }
    },
    referencedTool('hover_element', 'Hover over a visible element from the current browser observation.'),
    {
      name: 'refine_observation',
      description: 'Refine a truncated observation before using visual coordinates for an omitted semantic target.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', description: 'Optional semantic role to focus, such as button, link, or textbox.' },
          region: {
            type: 'object',
            properties: {
              x: { type: 'number' }, y: { type: 'number' },
              width: { type: 'number' }, height: { type: 'number' }
            },
            required: ['x', 'y', 'width', 'height']
          },
          description: { type: 'string' }
        },
        required: ['description']
      }
    },
    {
      name: 'click_at_xy',
      description: 'Visual fallback only: click a viewport coordinate when no semantic element reference exists.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          fallbackReason: { type: 'string', description: 'Why no semantic element reference can be used.' },
          description: { type: 'string' }
        },
        required: ['x', 'y', 'fallbackReason', 'description']
      }
    },
    sharedTool('scroll', 'Scroll the current page.', {
      deltaY: { type: 'number' },
      x: { type: 'number' },
      y: { type: 'number' }
    }, ['deltaY', 'description']),
    sharedTool('press_key', 'Press a supported keyboard key.', {
      key: { type: 'string', description: 'Enter | Tab | Escape | Backspace | ArrowUp | ArrowDown | ArrowLeft | ArrowRight' }
    }, ['key', 'description']),
    sharedTool('navigate', 'Open a full http/https URL in the current tab.', {
      url: { type: 'string' }
    }, ['url', 'description']),
    sharedTool('wait', 'Wait briefly for page loading or animations.', {
      ms: { type: 'number', description: 'Milliseconds between 300 and 3000' }
    }, ['ms', 'description']),
    sharedTool('finish', 'Finish the tutorial recording when the goal is complete.', {}, ['description'])
  ];
}

export function sanitizeObservationAgentAction(action = {}, { sanitizeLegacyAction, describeAgentAction }) {
  const normalizedAction = sanitizeEditableText(action.action || action.type || action.name || action.tool, 40);
  if (normalizedAction === 'refine_observation') {
    const region = action.region && typeof action.region === 'object'
      ? {
          x: sanitizeCoordinate(action.region.x, 0),
          y: sanitizeCoordinate(action.region.y, 0),
          width: clampNumber(action.region.width, 1, 10_000, 1),
          height: clampNumber(action.region.height, 1, 10_000, 1)
        }
      : null;
    return {
      action: normalizedAction,
      role: sanitizeEditableText(action.role, 80).toLowerCase(),
      ...(region ? { region } : {}),
      description: sanitizeEditableText(action.description, 400) || '细化当前页面观察'
    };
  }
  if (['scroll', 'press_key', 'navigate', 'wait', 'finish'].includes(normalizedAction)) {
    return sanitizeLegacyAction({ ...action, action: normalizedAction });
  }

  const description = sanitizeEditableText(action.description, 400) || describeAgentAction({ action: normalizedAction });
  if (normalizedAction === 'click_at_xy') {
    const x = sanitizeCoordinate(action.x);
    const y = sanitizeCoordinate(action.y);
    const fallbackReason = sanitizeEditableText(action.fallbackReason, 300);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('AI 点击动作缺少有效坐标');
    if (!fallbackReason) throw new Error('AI 视觉点击缺少视觉降级原因');
    return { action: normalizedAction, x, y, fallbackReason, description };
  }

  if (!['click_element', 'hover_element', 'type_text'].includes(normalizedAction)) {
    throw new Error('AI 返回了未知工具动作');
  }

  const observationId = sanitizeOpaqueReference(action.observationId);
  const elementRef = sanitizeOpaqueReference(action.elementRef);
  if (!observationId || !elementRef) throw new Error('AI 元素动作缺少有效观察引用');
  const targetText = sanitizeEditableText(action.targetText, 160);
  const repeatReason = sanitizeEditableText(action.repeatReason, 240);
  const allowRepeat = action.allowRepeat === true && Boolean(repeatReason);
  const base = {
    action: normalizedAction,
    observationId,
    elementRef,
    ...(targetText ? { targetText } : {}),
    ...(allowRepeat ? { allowRepeat: true, repeatReason } : {}),
    description
  };
  if (normalizedAction !== 'type_text') return base;

  const text = sanitizeEditableText(action.text, 500);
  if (!text) throw new Error('AI 输入动作缺少文本');
  return { ...base, text, ...(action.submit === true ? { submit: true } : {}) };
}

function referencedTool(name, description) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {
        observationId: observationReference,
        elementRef: observationReference,
        targetText: { type: 'string', description: 'Short human-readable target label for the tutorial.' },
        allowRepeat: { type: 'boolean', description: 'True only when the goal explicitly requires repeating this same semantic action.' },
        repeatReason: { type: 'string', description: 'Required audit reason when allowRepeat is true.' },
        description: { type: 'string' }
      },
      required: ['observationId', 'elementRef', 'description']
    }
  };
}

function sharedTool(name, description, properties, required) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: { ...properties, description: { type: 'string' } },
      required
    }
  };
}

function sanitizeOpaqueReference(value) {
  const reference = sanitizeEditableText(value, 240);
  return /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(reference) ? reference : '';
}
