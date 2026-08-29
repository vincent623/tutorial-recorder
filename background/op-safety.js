import { persistRecording } from './recording-assets.js';
import { S } from './runtime-state.js';
import { createRandomSuffix, sanitizeEditableText, sanitizeOperationId } from './text-utils.js';

export const OPERATION_RESULT_TTL_MS = 5 * 60 * 1000;

export const COMMIT_STATES = Object.freeze({
  RECORDING: 'recording',
  STOPPING: 'stopping',
  MEDIA_COLLECTED: 'media-collected',
  DESCRIPTIONS_READY: 'descriptions-ready',
  DOWNLOAD_REQUESTED: 'download-requested',
  HISTORY_UPDATED: 'history-updated',
  COMPLETE: 'complete',
  FAILED: 'failed'
});

export const RECOVERABLE_COMMIT_STATES = new Set([
  COMMIT_STATES.STOPPING,
  COMMIT_STATES.MEDIA_COLLECTED,
  COMMIT_STATES.DESCRIPTIONS_READY,
  COMMIT_STATES.DOWNLOAD_REQUESTED,
  COMMIT_STATES.HISTORY_UPDATED
]);




export function createOperationId(prefix = 'op') {
  S.operationSequence += 1;
  return `${sanitizeOperationId(prefix)}-${Date.now().toString(36)}-${S.operationSequence}-${createRandomSuffix()}`;
}



export function buildIdempotencyKey(scope, operationId) {
  const sanitizedOperationId = sanitizeOperationId(operationId);
  if (!sanitizedOperationId) {
    return '';
  }

  return `${scope}:${sanitizedOperationId}`;
}

export function pruneRecentOperationResults() {
  const now = Date.now();

  for (const [key, item] of S.recentOperationResults.entries()) {
    if (!item || item.expiresAt <= now) {
      S.recentOperationResults.delete(key);
    }
  }
}

export async function runExclusiveOperation(lockKey, operation) {
  if (S.operationLocks.has(lockKey)) {
    return S.operationLocks.get(lockKey);
  }

  const promise = Promise.resolve()
    .then(operation)
    .finally(() => {
      S.operationLocks.delete(lockKey);
    });

  S.operationLocks.set(lockKey, promise);
  return promise;
}

export async function runSerializedOperation(queueKey, operation) {
  const previous = S.operationSerialQueues.get(queueKey) || Promise.resolve();
  const promise = previous
    .catch(() => {})
    .then(operation)
    .finally(() => {
      if (S.operationSerialQueues.get(queueKey) === promise) {
        S.operationSerialQueues.delete(queueKey);
      }
    });

  S.operationSerialQueues.set(queueKey, promise);
  return promise;
}

export async function runIdempotentOperation(scope, operationId, operation) {
  const idempotencyKey = buildIdempotencyKey(scope, operationId);
  if (!idempotencyKey) {
    return operation();
  }

  pruneRecentOperationResults();

  const cached = S.recentOperationResults.get(idempotencyKey);
  if (cached) {
    return cached.result;
  }

  return runExclusiveOperation(idempotencyKey, async () => {
    const cachedAfterLock = S.recentOperationResults.get(idempotencyKey);
    if (cachedAfterLock) {
      return cachedAfterLock.result;
    }

    const result = await operation();
    S.recentOperationResults.set(idempotencyKey, {
      result,
      expiresAt: Date.now() + OPERATION_RESULT_TTL_MS
    });
    pruneRecentOperationResults();
    return result;
  });
}

export function createRecordingOperation(type, state, operationId = '') {
  return {
    id: sanitizeOperationId(operationId) || createOperationId(type || 'operation'),
    type: sanitizeOperationId(type || 'operation'),
    state,
    updatedAt: Date.now()
  };
}

export async function updateRecordingCommitState(recording, commitState, options = {}) {
  if (!recording) {
    return;
  }

  const {
    type = 'recording',
    operationId = recording.lastOperation?.id || '',
    status,
    recoverableError = null,
    assets = []
  } = options;

  recording.commitState = commitState;
  recording.lastOperation = createRecordingOperation(type, commitState, operationId);

  if (status) {
    recording.status = status;
  }

  if (recoverableError) {
    recording.recoverableError = {
      state: commitState,
      message: sanitizeEditableText(recoverableError.message || recoverableError, 240),
      at: Date.now()
    };
  } else if (commitState !== COMMIT_STATES.FAILED) {
    recording.recoverableError = null;
  }

  await persistRecording(recording, assets);
}

export async function markRecordingRecoverableFailure(recording, error, type = 'operation') {
  if (!recording) {
    return;
  }

  await updateRecordingCommitState(recording, COMMIT_STATES.FAILED, {
    type,
    operationId: recording.lastOperation?.id || '',
    status: 'failed',
    recoverableError: {
      message: error?.message || '上次操作中断，可从历史记录重新导出。'
    }
  });
}
