import { clearAllRecordingData, deleteRecording, getStorageUsageSummary, listRecordings } from './asset-store.js';
import { buildRecordingTitle, getRecordingDuration, hasRecordingAudio, hasRecordingVideo } from './exporters.js';
import { notifyPopup } from './notify.js';
import { COMMIT_STATES, RECOVERABLE_COMMIT_STATES, markRecordingRecoverableFailure } from './op-safety.js';
import { HISTORY_KEY, S, createIdleRuntime, persistRuntime } from './runtime-state.js';
import { DEFAULT_SETTINGS } from './settings-schema.js';
import { planHistoryRetention } from './history-retention.js';

export const HISTORY_MAX_ENTRIES = 100;
export const CLEANUP_QUEUE_KEY = 'recordingCleanupQueue';
export const CLEAR_ALL_PENDING_KEY = 'recordingClearAllPending';

export async function recoverInterruptedRecordings() {
  const recordings = await listRecordings().catch((error) => {
    console.warn('[Background] Failed to scan recordings for recovery:', error);
    return [];
  });

  if (!Array.isArray(recordings) || !recordings.length) {
    return;
  }

  let history = await getHistory();
  let historyChanged = false;
  const evictedIds = [];
  const now = Date.now();

  for (const recording of recordings) {
    if (!recording?.id || !Array.isArray(recording.screenshots) || !recording.screenshots.length) {
      continue;
    }

    const isCurrentActiveRecording =
      S.currentRuntime.isRecording &&
      S.currentRuntime.recordingId === recording.id &&
      !S.currentRuntime.isGenerating &&
      recording.commitState === COMMIT_STATES.RECORDING;

    if (!isCurrentActiveRecording && shouldRecoverInterruptedRecording(recording)) {
      const previousState = recording.commitState || recording.status || 'unknown';
      await markRecordingRecoverableFailure(recording, {
        message: `上次导出在 ${previousState} 阶段中断，可从历史记录重新导出。`
      }, 'recovery');

      if (S.currentRuntime.recordingId === recording.id) {
        S.currentRuntime = createIdleRuntime();
        S.currentRecording = null;
        await persistRuntime();
      }
    }

    if (shouldIndexRecording(recording)) {
      const entry = buildHistoryEntry(recording);
      const existingIndex = history.findIndex((item) => item?.id === recording.id);

      if (existingIndex < 0) {
        const retention = planHistoryRetention(history, entry, HISTORY_MAX_ENTRIES);
        history = retention.history;
        evictedIds.push(...retention.evictedIds);
        historyChanged = true;
      } else if (isHistoryEntryStale(history[existingIndex], entry)) {
        history = history.map((item, index) => (index === existingIndex ? entry : item));
        historyChanged = true;
      }
    }
  }

  if (historyChanged) {
    await persistHistoryAndQueueCleanup(history, evictedIds);
    await drainRecordingCleanupQueue();
  }

  if (historyChanged) {
    console.info(`[Background] Recovery scan reconciled history at ${now}`);
  }
}

export function shouldRecoverInterruptedRecording(recording) {
  if (recording.commitState === COMMIT_STATES.COMPLETE || recording.commitState === COMMIT_STATES.FAILED) {
    return false;
  }

  return RECOVERABLE_COMMIT_STATES.has(recording.commitState);
}

export function shouldIndexRecording(recording) {
  if (!recording?.id || !Array.isArray(recording.screenshots) || !recording.screenshots.length) {
    return false;
  }

  return (
    recording.status === 'ready' ||
    recording.status === 'failed' ||
    recording.commitState === COMMIT_STATES.COMPLETE ||
    recording.commitState === COMMIT_STATES.FAILED ||
    RECOVERABLE_COMMIT_STATES.has(recording.commitState)
  );
}

export function isHistoryEntryStale(currentEntry = {}, nextEntry = {}) {
  return (
    currentEntry.title !== nextEntry.title ||
    currentEntry.screenshotCount !== nextEntry.screenshotCount ||
    currentEntry.durationMs !== nextEntry.durationMs ||
    currentEntry.exportBaseName !== nextEntry.exportBaseName ||
    currentEntry.commitState !== nextEntry.commitState ||
    currentEntry.recoverable !== nextEntry.recoverable
  );
}

export async function getHistory() {
  const { [HISTORY_KEY]: history } = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(history) ? history : [];
}

export async function upsertHistoryEntry(entry) {
  const history = await getHistory();
  const retention = planHistoryRetention(history, entry, HISTORY_MAX_ENTRIES);
  await persistHistoryAndQueueCleanup(retention.history, retention.evictedIds);
  await drainRecordingCleanupQueue();
}

export function buildHistoryEntry(recording) {
  return {
    id: recording.id,
    title: recording.title || buildRecordingTitle(recording),
    createdAt: recording.startTime,
    screenshotCount: recording.screenshots.length,
    durationMs: getRecordingDuration(recording),
    hasAudio: hasRecordingAudio(recording),
    hasVideo: hasRecordingVideo(recording),
    recordingMode: recording.recordingMode || 'manual',
    captureMode: recording.captureMode || DEFAULT_SETTINGS.captureMode,
    commitState: recording.commitState || '',
    recoverable: Boolean(recording.recoverableError),
    exportedAt: recording.lastExportAt || Date.now(),
    exportBaseName: recording.exportBaseName || '',
    lastExportPrompted: recording.lastExportPrompted === true
  };
}

export async function deleteRecordingById(id) {
  const history = await getHistory();
  await persistHistoryAndQueueCleanup(history.filter((item) => item.id !== id), [id]);
  await drainRecordingCleanupQueue();

  notifyPopup('historyUpdated', { history: await getHistory() });
}

export async function getStorageUsage() {
  return getStorageUsageSummary();
}

export async function clearAllRecordings() {
  if (S.currentRuntime.isRecording || S.currentRuntime.isGenerating) {
    throw new Error('录制或导出进行中，暂时不能清理全部教程');
  }

  await chrome.storage.local.set({ [CLEAR_ALL_PENDING_KEY]: true });
  await completePendingClearAll();
  notifyPopup('historyUpdated', { history: [] });
  return getStorageUsageSummary();
}

export async function recoverPendingStorageCleanup() {
  const { [CLEAR_ALL_PENDING_KEY]: clearAllPending } = await chrome.storage.local.get(CLEAR_ALL_PENDING_KEY);
  if (clearAllPending === true) {
    await completePendingClearAll();
    return;
  }

  await drainRecordingCleanupQueue();
}

export async function drainRecordingCleanupQueue() {
  const { [CLEANUP_QUEUE_KEY]: storedQueue } = await chrome.storage.local.get(CLEANUP_QUEUE_KEY);
  const queue = normalizeCleanupIds(storedQueue);
  if (!queue.length) {
    return { deletedIds: [], pendingIds: [] };
  }

  const deletedIds = [];
  const pendingIds = [];
  for (const id of queue) {
    try {
      await deleteRecording(id);
      deletedIds.push(id);
    } catch (error) {
      console.warn(`[Background] Deferred recording cleanup failed for ${id}:`, error);
      pendingIds.push(id);
    }
  }

  await chrome.storage.local.set({ [CLEANUP_QUEUE_KEY]: pendingIds });
  return { deletedIds, pendingIds };
}

async function persistHistoryAndQueueCleanup(history, cleanupIds) {
  const { [CLEANUP_QUEUE_KEY]: storedQueue } = await chrome.storage.local.get(CLEANUP_QUEUE_KEY);
  await chrome.storage.local.set({
    [HISTORY_KEY]: history,
    [CLEANUP_QUEUE_KEY]: normalizeCleanupIds([...normalizeCleanupIds(storedQueue), ...cleanupIds])
  });
}

async function completePendingClearAll() {
  await clearAllRecordingData();
  await chrome.storage.local.set({
    [HISTORY_KEY]: [],
    [CLEANUP_QUEUE_KEY]: [],
    [CLEAR_ALL_PENDING_KEY]: false
  });
}

function normalizeCleanupIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((id) => typeof id === 'string' && id))];
}
