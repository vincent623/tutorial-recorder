import { sanitizeEditableText, sanitizeOperationId } from './text-utils.js';

const HIGH_RISK_TARGET_PATTERN =
  /(?:提交|确认|删除|移除|支付|付款|转账|购买|下单|发布|发送|授权|同意|注销|退出登录|清空|覆盖|submit|confirm|delete|remove|pay|purchase|buy|checkout|place\s+order|publish|send|authorize|approve|sign\s*out|log\s*out|erase|clear|overwrite)/i;

export function evaluateAgentActionPolicy(action = {}, context = {}) {
  if (action.action === 'click_at_xy') {
    const targetText = sanitizeEditableText(action.targetText, 160);

    if (!targetText || action.coordinateSource !== 'visible-text') {
      return confirmation('coordinate-click', '无法精确确认点击目标，需要您允许这一次坐标点击。');
    }

    if (HIGH_RISK_TARGET_PATTERN.test(targetText)) {
      return confirmation('high-impact-click', `“${targetText}”可能产生不可逆操作，需要您允许这一次点击。`);
    }

    return allowed('exact-visible-target', '已精确匹配低风险可见控件。');
  }

  if (action.action === 'press_key' && String(action.key || '').toLowerCase() === 'enter') {
    return confirmation('submit-capable-key', 'Enter 可能提交表单，需要您允许这一次按键。');
  }

  if (action.action === 'navigate') {
    const currentOrigin = getHttpOrigin(context.currentUrl);
    const targetOrigin = getHttpOrigin(action.url);

    if (!targetOrigin) {
      return blocked('invalid-navigation', '目标地址不是有效的 HTTP/HTTPS 页面。');
    }

    if (!currentOrigin || currentOrigin !== targetOrigin) {
      return confirmation('cross-origin-navigation', `即将离开当前站点并打开 ${targetOrigin}，需要您允许这一次跳转。`);
    }

    return allowed('same-origin-navigation', '导航保持在当前站点内。');
  }

  return allowed('low-impact-action', '该动作不会直接提交、删除或离开当前站点。');
}

export function buildAgentApprovalRequest({ action = {}, screenshotId = '', description = '', policy = {}, now = Date.now() } = {}) {
  const normalizedScreenshotId = sanitizeOperationId(screenshotId) || 'agent-shot';
  const normalizedAction = {
    action: sanitizeOperationId(action.action) || 'unknown',
    ...(Number.isFinite(action.x) ? { x: action.x } : {}),
    ...(Number.isFinite(action.y) ? { y: action.y } : {}),
    ...(action.targetText ? { targetText: sanitizeEditableText(action.targetText, 160) } : {}),
    ...(action.key ? { key: sanitizeOperationId(action.key) } : {}),
    ...(action.url ? { url: sanitizeEditableText(action.url, 500) } : {})
  };

  return {
    id: `${normalizedScreenshotId}:${normalizedAction.action}`,
    action: normalizedAction,
    screenshotId: normalizedScreenshotId,
    description: sanitizeEditableText(description, 400),
    code: sanitizeOperationId(policy.code) || 'approval-required',
    reason: sanitizeEditableText(policy.reason, 300) || '该动作需要用户确认。',
    decision: 'pending',
    requestedAt: Number.isFinite(now) ? now : Date.now()
  };
}

function getHttpOrigin(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : '';
  } catch (error) {
    return '';
  }
}

function allowed(code, reason) {
  return { decision: 'allow', code, reason };
}

function confirmation(code, reason) {
  return { decision: 'confirm', code, reason };
}

function blocked(code, reason) {
  return { decision: 'block', code, reason };
}
