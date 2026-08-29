

// Shared pure text/number utilities.

export function createRandomSuffix() {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0].toString(36).slice(0, 8);
  }

  return Math.random().toString(36).slice(2, 10);
}

export function sanitizeOperationId(value) {
  return sanitizeTextValue(value, 160).replace(/[^a-zA-Z0-9:._-]/g, '-');
}

export function sanitizeTextValue(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

export function sanitizeCoordinate(value, fallback = NaN) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clampNumber(parsed, 0, 100_000, fallback);
}

export function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function sanitizeEditableText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function maskSensitiveText(text) {
  return String(text || '')
    .replace(/\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g, (id) =>
      `${id.slice(0, 4)}**********${id.slice(-2)}`
    )
    .replace(/\d{16,19}/g, (card) => `${card.slice(0, 4)} **** **** ${card.slice(-4)}`)
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, (phone) => `${phone.slice(0, 3)}****${phone.slice(-2)}`);
}
