import { listAssetsForRecording, putRecording, putRecordingWithAssets } from './asset-store.js';
import { createRandomSuffix, sanitizeOperationId } from './text-utils.js';

export const ASSET_KINDS = Object.freeze({
  SCREENSHOT: 'screenshot',
  AUDIO: 'audio',
  VIDEO: 'video'
});

export async function persistRecording(recording, assets = [], options = {}) {
  const storedRecording = stripRecordingAssetData(recording);
  const deleteAssetIds = Array.isArray(options.deleteAssetIds) ? options.deleteAssetIds.filter(Boolean) : [];

  if (assets.length || deleteAssetIds.length) {
    return putRecordingWithAssets(storedRecording, assets, { deleteAssetIds });
  }

  return putRecording(storedRecording);
}

export function stripRecordingAssetData(recording) {
  if (!recording || typeof recording !== 'object') {
    return recording;
  }

  const next = {
    ...recording,
    screenshots: Array.isArray(recording.screenshots)
      ? recording.screenshots.map(stripScreenshotAssetData)
      : []
  };

  if (next.audioAssetId) {
    next.audioDataUrl = null;
  }

  if (next.videoAssetId) {
    next.videoDataUrl = null;
  }

  return next;
}

export function stripScreenshotAssetData(screenshot = {}) {
  const next = { ...screenshot };

  if (next.assetId) {
    delete next.data;
  }

  return next;
}

export async function hydrateRecordingAssets(recording) {
  if (!recording) {
    return null;
  }

  const assets = await listAssetsForRecording(recording.id).catch((error) => {
    console.warn('[Background] Failed to hydrate recording assets:', error);
    return [];
  });
  const assetsById = new Map(
    assets
      .filter((asset) => asset?.id)
      .map((asset) => [asset.id, asset])
  );

  const hydrated = {
    ...recording,
    screenshots: Array.isArray(recording.screenshots)
      ? recording.screenshots.map((screenshot) => hydrateScreenshotAsset(screenshot, assetsById))
      : []
  };

  if (!hydrated.audioDataUrl && hydrated.audioAssetId) {
    hydrated.audioDataUrl = assetsById.get(hydrated.audioAssetId)?.dataUrl || null;
  }

  if (!hydrated.videoDataUrl && hydrated.videoAssetId) {
    hydrated.videoDataUrl = assetsById.get(hydrated.videoAssetId)?.dataUrl || null;
  }

  return hydrated;
}

export function hydrateScreenshotAsset(screenshot = {}, assetsById) {
  const asset = screenshot.assetId ? assetsById.get(screenshot.assetId) : null;
  return {
    ...screenshot,
    data: screenshot.data || asset?.dataUrl || ''
  };
}

export function createAssetId(recordingId, kind, localId = '') {
  return [
    sanitizeOperationId(recordingId) || 'recording',
    'asset',
    sanitizeOperationId(kind) || 'data',
    sanitizeOperationId(localId) || Date.now().toString(36),
    createRandomSuffix()
  ].join(':');
}

export function createRecordingAsset(recordingId, kind, dataUrl, metadata = {}) {
  const sanitizedDataUrl = sanitizeAssetDataUrl(kind, dataUrl);
  if (!sanitizedDataUrl) {
    return null;
  }

  const details = getDataUrlDetails(sanitizedDataUrl);
  const id = metadata.id || createAssetId(recordingId, kind, metadata.localId || metadata.screenshotId || '');
  const now = Date.now();

  return {
    ...metadata,
    id,
    recordingId,
    kind,
    dataUrl: sanitizedDataUrl,
    mimeType: details.mimeType,
    size: details.size,
    createdAt: metadata.createdAt || now,
    updatedAt: now
  };
}

export function ensureScreenshotAsset(recording, screenshot, index = 0) {
  const asset = createRecordingAsset(recording.id, ASSET_KINDS.SCREENSHOT, screenshot.data, {
    id: screenshot.assetId || '',
    localId: screenshot.id || String(index + 1),
    screenshotId: screenshot.id || '',
    sequence: screenshot.sequence || index + 1,
    createdAt: screenshot.timestamp || Date.now()
  });

  if (!asset) {
    return null;
  }

  screenshot.assetId = asset.id;
  screenshot.dataMimeType = asset.mimeType;
  screenshot.dataSize = asset.size;
  screenshot.assetUpdatedAt = asset.updatedAt;
  return asset;
}

export function getRecordingAssetIds(recording = {}) {
  const ids = new Set();

  for (const screenshot of recording.screenshots || []) {
    if (screenshot?.assetId) {
      ids.add(screenshot.assetId);
    }
  }

  if (recording.audioAssetId) {
    ids.add(recording.audioAssetId);
  }

  if (recording.videoAssetId) {
    ids.add(recording.videoAssetId);
  }

  return ids;
}

export function sanitizeAssetDataUrl(kind, value) {
  if (kind === ASSET_KINDS.SCREENSHOT) {
    return sanitizeImageDataUrl(value);
  }

  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return /^data:.*?;base64,/i.test(trimmed) ? trimmed : '';
}

export function getDataUrlDetails(dataUrl) {
  const raw = String(dataUrl || '');
  const base64MarkerIndex = raw.toLowerCase().indexOf(';base64,');
  const header = raw.slice(0, base64MarkerIndex).match(/^data:([^;,]+)/i);
  const base64 = base64MarkerIndex >= 0 ? raw.slice(base64MarkerIndex + ';base64,'.length) : '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;

  return {
    mimeType: header?.[1] || 'application/octet-stream',
    size: Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
  };
}

export function sanitizeImageDataUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return /^data:image\/[-+\w.]+;base64,/i.test(trimmed) ? trimmed : '';
}

export function sanitizeTimeOffsetMs(value, fallbackValue = 0) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return Math.max(0, Number.parseInt(fallbackValue, 10) || 0);
  }

  return Math.min(parsed, 24 * 60 * 60 * 1000);
}

export function sanitizeTimestampValue(value, fallbackValue) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return parsed;
}
