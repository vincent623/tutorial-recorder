const activeAiRequestControllers = new Set();

let aiRequestConfigurationEpoch = 0;
let aiRequestsBlocked = false;
let aiRequestConfigurationChangeDepth = 0;

export function getAiRequestConfigurationEpoch() {
  return aiRequestConfigurationEpoch;
}

export function createTrackedAiRequestController(expectedEpoch = aiRequestConfigurationEpoch) {
  if (aiRequestsBlocked || expectedEpoch !== aiRequestConfigurationEpoch) {
    throw createAiRequestBlockedError();
  }

  const controller = new AbortController();
  activeAiRequestControllers.add(controller);

  if (aiRequestsBlocked || expectedEpoch !== aiRequestConfigurationEpoch) {
    controller.abort(createAiRequestBlockedError());
    activeAiRequestControllers.delete(controller);
    throw createAiRequestBlockedError();
  }

  return controller;
}

export function releaseTrackedAiRequestController(controller) {
  activeAiRequestControllers.delete(controller);
}

export function abortActiveAiRequests() {
  const error = createAiRequestBlockedError();
  for (const controller of activeAiRequestControllers) {
    controller.abort(error);
  }
  activeAiRequestControllers.clear();
}

export function beginAiRequestConfigurationChange() {
  aiRequestConfigurationChangeDepth += 1;
  aiRequestsBlocked = true;
  aiRequestConfigurationEpoch += 1;
  abortActiveAiRequests();
}

export function finishAiRequestConfigurationChange() {
  abortActiveAiRequests();
  aiRequestConfigurationEpoch += 1;
  aiRequestConfigurationChangeDepth = Math.max(0, aiRequestConfigurationChangeDepth - 1);
  aiRequestsBlocked = aiRequestConfigurationChangeDepth > 0;
}

function createAiRequestBlockedError() {
  const error = new Error('AI 截图发送授权或连接配置已变更，已停止当前请求。');
  error.name = 'AISharingRevokedError';
  return error;
}
