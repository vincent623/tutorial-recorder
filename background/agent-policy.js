import { sanitizeEditableText, sanitizeOperationId } from './text-utils.js';

const HIGH_RISK_TARGET_PATTERN =
  /(?:提交|确认|删除|移除|支付|付款|转账|购买|下单|发布|公开|发送|授权|允许|授予|同意|接受|邀请|订阅|保存|上传|分享|创建|申请|预订|连接|安装|启用|注销|退出登录|清空|覆盖|submit|confirm|delete|remove|pay|purchase|buy|checkout|place\s+order|publish|make\s+public|send|authorize|approve|allow(?:\s+access)?|grant(?:\s+permission)?|accept|invite|subscribe|save|upload|share|create|apply|book|reserve|connect|install|enable|sign\s*out|log\s*out|erase|clear|overwrite)/i;
const LOW_RISK_TARGET_PATTERN =
  /^(?:展开|收起|切换到[^\n]{1,40}(?:面板|标签|视图)|expand|collapse|switch to [^\n]{1,40}(?:panel|tab|view))$/i;

export function evaluateAgentActionPolicy(action = {}, context = {}) {
  if (action.action === 'click_at_xy') {
    const targetText = sanitizeEditableText(action.targetText, 160);

    if (!targetText || action.coordinateSource !== 'visible-text') {
      return confirmation('coordinate-click', '无法精确确认点击目标，需要您允许这一次坐标点击。');
    }

    if (HIGH_RISK_TARGET_PATTERN.test(targetText)) {
      return confirmation('high-impact-click', `“${targetText}”可能产生不可逆操作，需要您允许这一次点击。`);
    }

    if (String(action.targetType || '').toLowerCase() === 'submit' || action.targetFormMethod === 'post') {
      return confirmation('submit-control', `“${targetText}”会提交表单，需要您允许这一次点击。`);
    }

    const currentOrigin = getHttpOrigin(context.currentUrl);
    const targetOrigin = getHttpOrigin(action.targetHref);
    if (targetOrigin && currentOrigin !== targetOrigin) {
      return confirmation('cross-origin-link', `“${targetText}”将打开 ${targetOrigin}，需要您允许这一次点击。`);
    }

    if (LOW_RISK_TARGET_PATTERN.test(targetText)) {
      return allowed('known-low-impact-target', '已精确匹配已知低风险可见控件。');
    }

    return confirmation('unknown-impact-click', `无法证明“${targetText}”仅产生低风险效果，需要您允许这一次点击。`);
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

    const scope = !currentOrigin || currentOrigin !== targetOrigin ? `离开当前站点并打开 ${targetOrigin}` : '打开当前站点内的新地址';
    return confirmation('explicit-navigation', `即将${scope}，URL 导航可能触发服务器操作，需要您允许这一次跳转。`);
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
    ...(action.matchedText ? { matchedText: sanitizeEditableText(action.matchedText, 160) } : {}),
    ...(action.coordinateSource ? { coordinateSource: sanitizeOperationId(action.coordinateSource) } : {}),
    ...(action.targetType ? { targetType: sanitizeOperationId(action.targetType) } : {}),
    ...(action.targetRole ? { targetRole: sanitizeOperationId(action.targetRole) } : {}),
    ...(action.targetHref ? { targetHref: sanitizeEditableText(action.targetHref, 500) } : {}),
    ...(action.targetFormMethod ? { targetFormMethod: sanitizeOperationId(action.targetFormMethod) } : {}),
    ...(action.key ? { key: sanitizeOperationId(action.key) } : {}),
    ...(action.focusLabel ? { focusLabel: sanitizeEditableText(action.focusLabel, 120) } : {}),
    ...(action.pointLabel ? { pointLabel: sanitizeEditableText(action.pointLabel, 120) } : {}),
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

export function evaluateApprovedActionFreshness({
  action = {},
  freshAction = {},
  originalUrl = '',
  currentUrl = '',
  originalImage = '',
  currentImage = '',
  originalFocusFingerprint = '',
  currentFocusFingerprint = '',
  originalPointFingerprint = '',
  currentPointFingerprint = ''
} = {}) {
  if (!originalUrl || originalUrl !== currentUrl) {
    return { fresh: false, reason: '确认期间页面地址已变化，原批准已失效。' };
  }

  if (action.action === 'click_at_xy' && action.coordinateSource === 'visible-text') {
    const approvedTarget = sanitizeEditableText(action.targetText, 160);
    const currentTarget = sanitizeEditableText(freshAction.matchedText || freshAction.targetText, 160);
    const approvedSemantics = buildTargetSemantics(action);
    const currentSemantics = buildTargetSemantics(freshAction);
    if (
      !approvedTarget ||
      freshAction.coordinateSource !== 'visible-text' ||
      approvedTarget !== currentTarget ||
      approvedSemantics !== currentSemantics ||
      action.targetFingerprint !== freshAction.targetFingerprint ||
      action.x !== freshAction.x ||
      action.y !== freshAction.y
    ) {
      return { fresh: false, reason: '确认期间目标控件已变化，原批准已失效。' };
    }
    return { fresh: true, reason: '页面与精确目标保持不变。' };
  }

  if (action.action === 'navigate') {
    return { fresh: true, reason: '来源页面与批准的目标地址保持不变。' };
  }

  if (!originalImage || originalImage !== currentImage) {
    return { fresh: false, reason: '确认期间页面画面已变化，原批准已失效。' };
  }

  if (
    action.action === 'press_key' &&
    String(action.key || '').toLowerCase() === 'enter' &&
    (!originalFocusFingerprint || originalFocusFingerprint !== currentFocusFingerprint)
  ) {
    return { fresh: false, reason: '确认期间键盘焦点已变化，原批准已失效。' };
  }

  if (
    action.action === 'click_at_xy' &&
    action.coordinateSource !== 'visible-text' &&
    (!originalPointFingerprint || originalPointFingerprint !== currentPointFingerprint)
  ) {
    return { fresh: false, reason: '确认期间坐标命中元素已变化，原批准已失效。' };
  }

  return { fresh: true, reason: '页面画面保持不变。' };
}

function buildTargetSemantics(action = {}) {
  return [
    sanitizeOperationId(action.targetType),
    sanitizeOperationId(action.targetRole),
    sanitizeEditableText(action.targetHref, 500),
    sanitizeOperationId(action.targetFormMethod),
    sanitizeOperationId(action.targetFingerprint)
  ].join('|');
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
