export function verifyObservedElement({ record, inspection, elementRef }) {
  if (
    !inspection?.documentToken ||
    inspection.documentToken !== record.documentToken ||
    (record.pageUrl && inspection.url && inspection.url !== record.pageUrl)
  ) {
    return invalidOutcome('observation-page-changed');
  }

  const source = record.elementsByRef.get(elementRef);
  if (!source) return invalidOutcome('observation-target-changed');
  const current = (inspection.elements || []).find((element) =>
    element.fingerprint && element.fingerprint === source.fingerprint
  );
  if (!current || !hasSameTargetIdentity(source, current)) {
    return invalidOutcome('observation-target-changed');
  }

  const sourceRect = normalizeRect(source.rect);
  const currentRect = normalizeRect(current.rect);
  const status = sameRect(sourceRect, currentRect) ? 'verified' : 'moved';
  return {
    status,
    target: {
      ref: elementRef,
      role: cleanText(current.role, 80),
      name: cleanText(current.name, 240),
      context: cleanText(current.context, 160),
      rect: currentRect,
      center: {
        x: Math.round(currentRect.x + currentRect.width / 2),
        y: Math.round(currentRect.y + currentRect.height / 2)
      },
      targetType: cleanText(current.targetType, 80).toLowerCase(),
      targetRole: cleanText(current.targetRole, 80).toLowerCase(),
      targetHref: String(current.targetHref || ''),
      targetFormAction: String(current.targetFormAction || ''),
      targetFormMethod: cleanText(current.targetFormMethod, 16).toLowerCase()
    },
    receipt: { verification: status }
  };
}

function hasSameTargetIdentity(source, current) {
  return [
    ['role', 80],
    ['name', 240],
    ['context', 160],
    ['targetType', 80],
    ['targetRole', 80],
    ['targetHref', 2_000],
    ['targetFormAction', 2_000],
    ['targetFormMethod', 16]
  ].every(([key, maxLength]) => cleanText(source[key], maxLength) === cleanText(current[key], maxLength));
}

function normalizeRect(rect = {}) {
  return {
    x: finiteNumber(rect.x),
    y: finiteNumber(rect.y),
    width: Math.max(0, finiteNumber(rect.width)),
    height: Math.max(0, finiteNumber(rect.height))
  };
}

function sameRect(left, right) {
  return ['x', 'y', 'width', 'height'].every((key) => left[key] === right[key]);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function invalidOutcome(reasonCode) {
  return {
    status: 'invalid',
    reasonCode,
    receipt: { verification: 'invalid', reasonCode }
  };
}
