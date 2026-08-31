export function normalizeObservedElement(element = {}, ref) {
  return {
    ref,
    role: cleanText(element.role, 80),
    name: cleanText(element.name, 240),
    context: cleanText(element.context, 160),
    rect: normalizeRect(element.rect),
    targetType: cleanText(element.targetType, 80).toLowerCase(),
    targetRole: cleanText(element.targetRole, 80).toLowerCase(),
    targetFormMethod: cleanText(element.targetFormMethod, 16).toLowerCase()
  };
}

export function unavailableOutcome({ adapter = '', capabilities = {}, reasonCode, durationMs }) {
  return {
    status: 'unavailable',
    reasonCode,
    receipt: {
      status: 'unavailable',
      adapter,
      capabilities: { ...capabilities },
      elementCount: 0,
      truncated: false,
      degradedReasons: [],
      reasonCode,
      durationMs
    }
  };
}

export function refinementLimitOutcome(adapter = '', capabilities = {}) {
  return unavailableOutcome({
    adapter,
    capabilities,
    reasonCode: 'refinement-limit-reached',
    durationMs: 0
  });
}

export function capabilityDegradedReasons(capabilities = {}, observedRegions = {}) {
  const reasons = [];
  if (observedRegions.openShadowDom > 0 && capabilities.openShadowDom !== true) {
    reasons.push('open-shadow-dom-unavailable');
  }
  if (observedRegions.sameOriginFrames > 0 && capabilities.sameOriginFrames !== true) {
    reasons.push('same-origin-frame-content-unavailable');
  }
  if (
    (observedRegions.crossOriginFrames > 0 || observedRegions.inaccessibleFrames > 0) &&
    capabilities.crossOriginFrames !== true
  ) {
    reasons.push('cross-origin-frame-content-unavailable');
  }
  if (observedRegions.selfDrawnSurfaces > 0 && capabilities.selfDrawnSurfaces !== true) {
    reasons.push('self-drawn-surface-unavailable');
  }
  if (observedRegions.transformedFrames > 0 && capabilities.transformedFrames !== true) {
    reasons.push('transformed-frame-coordinate-unavailable');
  }
  return reasons;
}

function normalizeRect(rect = {}) {
  return {
    x: finiteNumber(rect.x),
    y: finiteNumber(rect.y),
    width: Math.max(0, finiteNumber(rect.width)),
    height: Math.max(0, finiteNumber(rect.height))
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
