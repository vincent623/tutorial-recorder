import { pauseAiAgent, resumeAiAgent, takeoverRecording } from './agent-loop.js';
import { deleteRecording } from './asset-store.js';
import { getRecordingDetail, updateRecordingDetails } from './detail-service.js';
import { exportRecording } from './export-pipeline.js';
import { deleteRecordingById, getHistory } from './history-service.js';
import { recordInteraction } from './interaction-capture.js';
import { handleOffscreenMediaUpdated } from './media-orchestrator.js';
import { notifyPopup } from './notify.js';
import { updateRealtimeSuggestionOverride } from './realtime-suggestions.js';
import { pauseRecording, resumeRecording, startAiRecording, startRecording, stopRecording } from './recording-lifecycle.js';
import { S, serializeRuntimeForUi } from './runtime-state.js';
import { captureScreenshot, injectContentScript } from './screenshot-engine.js';
import { ensureInitialized, getPopupStateSettings, getSettings, initialize, saveSettings } from './settings-service.js';
import { testProviderConnection } from './tutorial-generator.js';

console.log('[Background] Service worker booted');

chrome.runtime.onInstalled.addListener(() => {
  S.initPromise = initialize();
});

chrome.runtime.onStartup.addListener(() => {
  S.initPromise = initialize();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.action) {
    return false;
  }

  (async () => {
    await ensureInitialized();

    switch (message.action) {
      case 'getPopupState':
        sendResponse({
          ok: true,
          settings: await getPopupStateSettings(),
          runtime: serializeRuntimeForUi(),
          history: await getHistory()
        });
        break;
      case 'getSecretSettings':
        sendResponse({ ok: true, settings: await getSettings() });
        break;
      case 'saveSettings':
        sendResponse({ ok: true, settings: await saveSettings(message.settings || {}) });
        break;
      case 'testProviderConnection':
        sendResponse(await testProviderConnection(message.operationId));
        break;
      case 'startRecording':
        await startRecording(message.tabId, {
          allowFallbackTarget: message.allowFallbackTarget === true,
          targetUrl: message.targetUrl || ''
        });
        sendResponse({ ok: true });
        break;
      case 'startAiRecording':
        await startAiRecording(message.tabId, message.targetDescription || '', {
          allowFallbackTarget: message.allowFallbackTarget === true,
          targetUrl: message.targetUrl || ''
        });
        sendResponse({ ok: true });
        break;
      case 'pauseRecording':
        await pauseRecording();
        sendResponse({ ok: true });
        break;
      case 'resumeRecording':
        await resumeRecording();
        sendResponse({ ok: true });
        break;
      case 'pauseAiAgent':
        await pauseAiAgent();
        sendResponse({ ok: true });
        break;
      case 'resumeAiAgent':
        await resumeAiAgent();
        sendResponse({ ok: true });
        break;
      case 'takeoverRecording':
        await takeoverRecording();
        sendResponse({ ok: true });
        break;
      case 'stopRecording':
        await stopRecording(message.operationId);
        sendResponse({ ok: true });
        break;
      case 'manualCapture':
        sendResponse(
          await captureScreenshot({
            trigger: 'manual',
            allowWhenPaused: true,
            operationId: message.operationId
          })
        );
        break;
      case 'recordInteraction':
        await recordInteraction(message.payload || {}, sender);
        sendResponse({ ok: true });
        break;
      case 'downloadRecording':
        await exportRecording(message.id, message.operationId);
        sendResponse({ ok: true });
        break;
      case 'getRecordingDetail':
        sendResponse({ ok: true, recording: await getRecordingDetail(message.id) });
        break;
      case 'updateRecording':
        sendResponse({
          ok: true,
          recording: await updateRecordingDetails(message.id, message.updates || {}),
          history: await getHistory()
        });
        break;
      case 'updateRealtimeSuggestion':
        sendResponse({
          ok: true,
          suggestion: await updateRealtimeSuggestionOverride(message)
        });
        break;
      case 'deleteRecording':
        await deleteRecordingById(message.id);
        sendResponse({ ok: true });
        break;
      case 'offscreenCaptureTick':
        sendResponse(await captureScreenshot({ trigger: 'auto' }));
        break;
      case 'offscreenMediaUpdated':
        await handleOffscreenMediaUpdated(message.payload || {});
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown action' });
    }
  })().catch((error) => {
    console.error('[Background] Action failed:', message.action, error);
    notifyPopup('error', { message: error.message || '发生未知错误' });
    sendResponse({ ok: false, error: error.message || 'Unknown error' });
  });

  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-screenshot') {
    ensureInitialized()
      .then(() => captureScreenshot({ trigger: 'manual' }))
      .catch((error) => console.error('[Background] Command failed:', error));
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') {
    return;
  }

  ensureInitialized()
    .then(() => {
      if (S.currentRuntime.isRecording && tabId === S.currentRuntime.tabId) {
        return injectContentScript(tabId);
      }
      return false;
    })
    .catch(() => {});
});

export function notifyContent(action, payload = {}) {
  if (!S.currentRuntime.tabId) {
    return;
  }

  chrome.tabs.sendMessage(S.currentRuntime.tabId, { action, ...payload }).catch(() => {});
}
