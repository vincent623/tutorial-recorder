export function isRepeatedAgentAction(action, steps = []) {
  if (!action?.targetText || !Array.isArray(steps) || !steps.length) {
    return false;
  }

  const identity = repeatIdentity(action);
  const repeatedTarget = steps.slice(-8).some((previous) =>
    repeatIdentity(previous) === identity
  );
  if (!repeatedTarget) return false;
  if (action.action === 'type_text') return true;
  if (action.action !== 'click_at_xy') return false;

  const highRiskTarget = /提交|删除|支付|发布|发送|购买|下单|确认订单/.test(action.targetText);
  if (highRiskTarget) return true;
  return !(action.allowRepeat === true && action.repeatReason);
}

function repeatIdentity(action = {}) {
  return [
    action.action,
    action.sourceUrl,
    action.targetText,
    action.targetContext,
    action.targetType,
    action.targetRole,
    action.targetHref,
    action.targetFormAction,
    action.targetFormMethod,
    action.submit === true ? 'submit' : 'no-submit'
  ].map((value) => String(value || '')).join('|');
}
