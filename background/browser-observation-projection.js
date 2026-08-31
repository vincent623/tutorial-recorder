import { sendOffscreenMessage } from './media-orchestrator.js';
import { maskSensitiveText } from './text-utils.js';

export function createRemoteObservationProjection(record = {}) {
  return {
    observationId: record.observationId || '',
    page: summarizeRemoteUrl(record.pageUrl),
    viewport: normalizeViewport(record.viewport),
    truncated: record.truncated === true,
    capabilities: { ...(record.capabilities || {}) },
    elements: Array.from(record.elementsByRef || [], ([ref, element], index) => ({
      ref,
      label: index + 1,
      role: cleanText(element.role, 80),
      name: cleanRemoteText(element.name, 240),
      context: cleanRemoteText(element.context, 160),
      rect: normalizeRect(element.rect),
      targetType: cleanText(element.targetType, 80).toLowerCase(),
      targetRole: cleanText(element.targetRole, 80).toLowerCase(),
      destination: summarizeRemoteDestination(element, record.pageUrl)
    }))
  };
}

export async function renderBrowserObservationDecisionScreenshot(payload) {
  const result = await sendOffscreenMessage('renderDecisionScreenshot', payload);
  if (!/^data:image\/png;base64,/.test(result?.data || '')) {
    throw new Error('Decision screenshot renderer returned no PNG image');
  }
  return result.data;
}

export function summarizeRemoteDestination(element = {}, pageUrl = '') {
  const rawTarget = String(element.targetHref || element.targetFormAction || '').trim();
  const method = cleanText(
    element.targetFormMethod || (element.targetHref ? 'GET' : ''),
    16
  ).toUpperCase();
  if (!rawTarget) {
    return method ? { relation: 'same-site', host: '', path: '', method } : null;
  }
  try {
    const target = new URL(rawTarget, pageUrl || undefined);
    if (!['http:', 'https:'].includes(target.protocol)) return null;
    const page = new URL(pageUrl);
    return {
      relation: target.hostname === page.hostname ? 'same-site' : 'cross-site',
      host: cleanText(target.host, 160),
      path: cleanPath(target.pathname),
      method: method || 'GET'
    };
  } catch {
    return null;
  }
}

export function summarizeRemoteUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) return { host: '', path: '' };
    return {
      host: cleanText(parsed.host, 160),
      path: cleanPath(parsed.pathname)
    };
  } catch {
    return { host: '', path: '' };
  }
}

function cleanPath(value) {
  const path = String(value || '/').replace(/[\r\n\t]/g, '').slice(0, 500);
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeViewport(viewport = {}) {
  return {
    width: finiteNumber(viewport.width),
    height: finiteNumber(viewport.height),
    scrollX: finiteNumber(viewport.scrollX),
    scrollY: finiteNumber(viewport.scrollY),
    zoomFactor: finiteNumber(viewport.zoomFactor, 1),
    pageScaleFactor: finiteNumber(viewport.pageScaleFactor, 1)
  };
}

function normalizeRect(rect = {}) {
  return {
    x: finiteNumber(rect.x),
    y: finiteNumber(rect.y),
    width: Math.max(0, finiteNumber(rect.width)),
    height: Math.max(0, finiteNumber(rect.height))
  };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanRemoteText(value, maxLength) {
  return maskSensitiveText(cleanText(value, maxLength));
}
