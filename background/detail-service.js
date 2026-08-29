import { getRecording } from './asset-store.js';
import { buildRecordingTitle, formatDuration, getRecordingDuration, hasRecordingAudio, hasRecordingVideo } from './exporters.js';
import { buildHistoryEntry, getHistory, upsertHistoryEntry } from './history-service.js';
import { notifyPopup } from './notify.js';
import { ensureScreenshotAsset, getRecordingAssetIds, hydrateRecordingAssets, persistRecording, sanitizeImageDataUrl, sanitizeTimeOffsetMs, sanitizeTimestampValue } from './recording-assets.js';
import { DEFAULT_SETTINGS } from './settings-schema.js';
import { sanitizeEditableText, sanitizeTextValue } from './text-utils.js';

export function buildRecordingDetail(recording) {
  if (!recording) {
    return null;
  }

  return {
    id: recording.id,
    title: recording.title || buildRecordingTitle(recording),
    createdAt: recording.startTime,
    durationMs: getRecordingDuration(recording),
    screenshotCount: recording.screenshots.length,
    hasAudio: hasRecordingAudio(recording),
    hasVideo: hasRecordingVideo(recording),
    recordingMode: recording.recordingMode || 'manual',
    captureMode: recording.captureMode || DEFAULT_SETTINGS.captureMode,
    commitState: recording.commitState || '',
    recoverableError: recording.recoverableError || null,
    exportBaseName: recording.exportBaseName || '',
    lastExportPrompted: recording.lastExportPrompted === true,
    screenshots: recording.screenshots.map((screenshot, index) => ({
      id: screenshot.id,
      index: index + 1,
      description: screenshot.description || `步骤 ${index + 1}`,
      timeOffsetMs: screenshot.timeOffsetMs || 0,
      timestamp: screenshot.timestamp || recording.startTime + (screenshot.timeOffsetMs || 0),
      timestampLabel: formatDuration(screenshot.timeOffsetMs || 0),
      data: screenshot.data
    }))
  };
}

export async function getRecordingDetail(id) {
  const recording = await hydrateRecordingAssets(await getRecording(id));

  if (!recording) {
    throw new Error('这条历史记录已不存在');
  }

  return buildRecordingDetail(recording);
}

export async function updateRecordingDetails(id, updates) {
  const storedRecording = await getRecording(id);
  const recording = await hydrateRecordingAssets(storedRecording);

  if (!recording) {
    throw new Error('这条历史记录已不存在');
  }

  const previousAssetIds = getRecordingAssetIds(storedRecording);
  const nextTitle = sanitizeEditableText(updates.title, 80);
  const nextScreenshots = Array.isArray(updates.screenshots) ? updates.screenshots : null;
  const assets = [];

  if (nextScreenshots) {
    recording.screenshots = sanitizeUpdatedScreenshots(recording, nextScreenshots);
    recording.screenshots.forEach((screenshot, index) => {
      const asset = ensureScreenshotAsset(recording, screenshot, index);
      if (asset) {
        assets.push(asset);
      }
    });
  }

  recording.title = nextTitle || buildRecordingTitle(recording);
  recording.updatedAt = Date.now();

  const nextAssetIds = getRecordingAssetIds(recording);
  const deleteAssetIds = [...previousAssetIds].filter((assetId) => !nextAssetIds.has(assetId));

  await persistRecording(recording, assets, { deleteAssetIds });
  await upsertHistoryEntry(buildHistoryEntry(recording));
  notifyPopup('historyUpdated', { history: await getHistory() });
  return buildRecordingDetail(recording);
}

export function sanitizeUpdatedScreenshots(recording, screenshotUpdates) {
  const existingById = new Map(
    recording.screenshots
      .filter((screenshot) => typeof screenshot?.id === 'string' && screenshot.id)
      .map((screenshot) => [screenshot.id, screenshot])
  );

  const nextScreenshots = screenshotUpdates
    .map((screenshot, index) =>
      sanitizeUpdatedScreenshot(
        screenshot,
        index,
        recording.startTime,
        existingById,
        recording.screenshots[index] || null
      )
    )
    .filter(Boolean);

  if (!nextScreenshots.length) {
    throw new Error('至少保留一张截图');
  }

  return nextScreenshots;
}

export function sanitizeUpdatedScreenshot(screenshot, index, startTime, existingById, fallbackExisting) {
  if (!screenshot || typeof screenshot !== 'object') {
    return null;
  }

  const nextId = sanitizeTextValue(screenshot.id || '', 80);
  const existing = nextId ? existingById.get(nextId) || null : fallbackExisting || null;
  const data = sanitizeImageDataUrl(screenshot.data) || existing?.data || '';
  if (!data) {
    return null;
  }

  const timeOffsetMs = sanitizeTimeOffsetMs(screenshot.timeOffsetMs, existing?.timeOffsetMs ?? index * 1000);
  const timestamp = sanitizeTimestampValue(screenshot.timestamp, startTime + timeOffsetMs);

  return {
    ...existing,
    id: nextId || existing?.id || `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    data,
    timestamp,
    timeOffsetMs,
    description:
      sanitizeEditableText(screenshot.description, 400) ||
      existing?.description ||
      `步骤 ${index + 1}`,
    trigger: existing?.trigger || 'manual-edit',
    pageContext: existing?.pageContext || null
  };
}

