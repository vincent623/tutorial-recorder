import { performExecuteAiAgentAction } from './agent-action-executor.js';
import { runExclusiveOperation } from './op-safety.js';
import { S } from './runtime-state.js';

export async function executeAiAgentAction(action, executionContext) {
  const tabId = executionContext?.tabId ?? S.currentRuntime.tabId;
  const lockKey = `agentAction:${S.currentRuntime.recordingId || 'idle'}:${tabId}:${S.currentRuntime.aiAgent?.iteration || 0}`;
  return runExclusiveOperation(lockKey, () => performExecuteAiAgentAction(action, executionContext));
}
