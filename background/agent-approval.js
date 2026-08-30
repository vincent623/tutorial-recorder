import { buildAgentApprovalRequest } from './agent-policy.js';
import { isAiAgentLoopActive, updateAiAgentState } from './agent-state.js';
import { notifyContent, notifyPopup } from './notify.js';
import { S, updateBadge } from './runtime-state.js';
import { delay } from './text-utils.js';

export async function requestAiAgentApproval({ action, screenshotId, description, policy }) {
  const approval = buildAgentApprovalRequest({ action, screenshotId, description, policy });
  if (!S.currentRuntime.isPaused) {
    S.currentRuntime.isPaused = true;
    S.currentRuntime.pauseStartedAt = Date.now();
  }
  await updateAiAgentState({
    status: 'awaiting_confirmation',
    paused: true,
    pendingApproval: approval,
    message: policy.reason
  });
  await updateBadge();
  notifyPopup('warning', { message: policy.reason });

  const decision = await waitForAiAgentApproval(approval.id);
  if (decision === 'approved' && isAiAgentLoopActive()) {
    await updateAiAgentState({ pendingApproval: null });
  }
  return decision;
}

export async function resolveAiAgentApproval(approvalId, approved) {
  if (!S.currentRuntime.isRecording || S.currentRuntime.recordingMode !== 'ai') {
    throw new Error('当前没有进行中的 AI 录制');
  }

  const pendingApproval = S.currentRuntime.aiAgent?.pendingApproval;
  if (!pendingApproval || pendingApproval.id !== approvalId || pendingApproval.decision !== 'pending') {
    throw new Error('待确认动作已失效，请重新观察页面');
  }

  if (!approved) {
    await updateAiAgentState({
      pendingApproval: { ...pendingApproval, decision: 'rejected', resolvedAt: Date.now() },
      message: '已拒绝危险动作，正在切换为人工接管。'
    });
    await takeoverRecording();
    return { approved: false, takeover: true };
  }

  finishPausedDuration();
  await updateAiAgentState({
    status: 'running',
    paused: false,
    pendingApproval: { ...pendingApproval, decision: 'approved', resolvedAt: Date.now() },
    message: '已允许这一次动作，AI 正在继续执行。'
  });
  await updateBadge();
  notifyPopup('resumed');
  notifyContent('recordingResumed');
  return { approved: true, takeover: false };
}

export async function takeoverRecording() {
  if (!S.currentRuntime.isRecording || S.currentRuntime.recordingMode !== 'ai') {
    return;
  }

  finishPausedDuration();
  S.currentRuntime.recordingMode = 'manual';
  S.currentRuntime.mediaStatus = '人工接管';
  await updateAiAgentState({
    status: 'takeover',
    paused: false,
    awaitingTakeover: false,
    pendingApproval: null,
    message: '已切换为人工接管，可继续截图或停止导出。'
  });
  await updateBadge();
  notifyPopup('resumed');
  notifyContent('recordingResumed');
}

async function waitForAiAgentApproval(approvalId) {
  while (isAiAgentLoopActive()) {
    const pendingApproval = S.currentRuntime.aiAgent?.pendingApproval;
    if (!pendingApproval || pendingApproval.id !== approvalId) {
      return 'cancelled';
    }
    if (pendingApproval.decision !== 'pending') {
      return pendingApproval.decision;
    }
    await delay(250);
  }
  return 'cancelled';
}

function finishPausedDuration() {
  if (S.currentRuntime.pauseStartedAt) {
    S.currentRuntime.pausedDurationMs += Date.now() - S.currentRuntime.pauseStartedAt;
  }
  S.currentRuntime.isPaused = false;
  S.currentRuntime.pauseStartedAt = null;
}
