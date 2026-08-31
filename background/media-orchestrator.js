import { getAsset } from './asset-store.js';
import { notifyPopup } from './notify.js';
import { S, persistRuntime } from './runtime-state.js';

export const OFFSCREEN_PATH = 'offscreen/offscreen.html';

export const OFFSCREEN_MESSAGE_TIMEOUT_MS = 120_000;

export async function handleOffscreenMediaUpdated(payload = {}) {
  if (!S.currentRuntime.isRecording) {
    return;
  }

  S.currentRuntime.audioStarted = payload.audioStarted === true;
  S.currentRuntime.videoStarted = payload.videoStarted === true;
  S.currentRuntime.mediaStatus = summarizeMediaState(S.currentRuntime.audioStarted, S.currentRuntime.videoStarted);
  await persistRuntime();

  notifyPopup('mediaUpdated', {
    audioStarted: S.currentRuntime.audioStarted,
    videoStarted: S.currentRuntime.videoStarted,
    mediaStatus: S.currentRuntime.mediaStatus
  });

  if (payload.message) {
    notifyPopup('warning', { message: payload.message });
  }
}

export function summarizeMediaState(audioStarted, videoStarted) {
  if (audioStarted && videoStarted) {
    return '音频+视频';
  }

  if (videoStarted) {
    return '仅视频';
  }

  if (audioStarted) {
    return '仅音频';
  }

  return '未授权';
}

export async function applyMediaResult(recording, mediaResult, fallbackDurationMs) {
  if (mediaResult?.audioAssetId) {
    recording.audioAssetId = mediaResult.audioAssetId;
    recording.audioDataUrl = await resolveAssetDataUrl(mediaResult.audioAssetId);
    recording.audioMeta = {
      mimeType: mediaResult.audioMimeType || 'audio/webm',
      size: mediaResult.audioSize || 0,
      assetId: mediaResult.audioAssetId,
      durationMs: mediaResult.audioDurationMs || fallbackDurationMs
    };
  } else {
    recording.audioAssetId = '';
    recording.audioDataUrl = null;
    recording.audioMeta = {
      mimeType: '',
      size: 0,
      durationMs: fallbackDurationMs,
      error: mediaResult?.audioError || ''
    };

    if (mediaResult?.audioError) {
      notifyPopup('warning', { message: `音频未导出：${mediaResult.audioError}` });
    }
  }

  if (mediaResult?.videoAssetId) {
    recording.videoAssetId = mediaResult.videoAssetId;
    recording.videoDataUrl = await resolveAssetDataUrl(mediaResult.videoAssetId);
    recording.videoMeta = {
      mimeType: mediaResult.videoMimeType || 'video/webm',
      size: mediaResult.videoSize || 0,
      assetId: mediaResult.videoAssetId,
      durationMs: mediaResult.videoDurationMs || fallbackDurationMs
    };
  } else {
    recording.videoAssetId = '';
    recording.videoDataUrl = null;
    recording.videoMeta = {
      mimeType: '',
      size: 0,
      durationMs: fallbackDurationMs,
      error: mediaResult?.videoError || ''
    };

    if (mediaResult?.videoError) {
      notifyPopup('warning', { message: `视频未导出：${mediaResult.videoError}` });
    }
  }

  if (mediaResult?.audioLimitWarning) {
    notifyPopup('warning', { message: mediaResult.audioLimitWarning });
  }

  if (mediaResult?.videoLimitWarning) {
    notifyPopup('warning', { message: mediaResult.videoLimitWarning });
  }
}

export async function resolveAssetDataUrl(assetId) {
  if (!assetId) {
    return null;
  }

  const asset = await getAsset(assetId).catch((error) => {
    console.warn('[Background] Failed to load media asset:', error);
    return null;
  });
  return asset?.dataUrl || null;
}

export async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });

    if (contexts.length) {
      return;
    }
  }

  if (S.offscreenCreationPromise) {
    return S.offscreenCreationPromise;
  }

  S.offscreenCreationPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'BLOBS'],
    justification: 'Record media, manage capture timers, render tutorial PDFs, and draw transient AI decision screenshots.'
  });

  try {
    await S.offscreenCreationPromise;
  } finally {
    S.offscreenCreationPromise = null;
  }
}

export async function closeOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
    });

    if (!contexts.length) {
      return;
    }
  }

  await chrome.offscreen.closeDocument().catch(() => {});
}

export async function sendOffscreenMessage(type, payload = {}) {
  await ensureOffscreenDocument();
  const response = await Promise.race([
    chrome.runtime.sendMessage({
      action: 'offscreenMessage',
      target: 'offscreen',
      type,
      payload
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Offscreen action timed out: ${type}`)), OFFSCREEN_MESSAGE_TIMEOUT_MS);
    })
  ]);

  if (!response?.ok) {
    throw new Error(response?.error || `Offscreen action failed: ${type}`);
  }

  return response;
}

