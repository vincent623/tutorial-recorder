# Dev Loop Metrics

## 2026-05-01 - Tutorial Recorder Baseline and Gap Metrics

- Baseline version in GitHub history: `v1.3.0`.
- Existing remote tags observed: `v1.0.0`, `v1.1.0`, `v1.2.0`, `v1.2.1`, `v1.3.0`.
- Current implementation size: `background/background.js` 1741 lines, `popup/popup.js` 1275 lines, `offscreen/offscreen.js` 727 lines.
- Baseline `.42cog` scope at v1.3.0 review: MAS-1/MAS-2/MAS-3 marked implemented; MAS-5 Phase 1, MAS-6 Phase 2, MAS-4 Phase 3 were implementation gaps.
- Baseline Phase 1 gap, closed by v1.4.0: no `debugger` permission, no `chrome.debugger` usage, no CDP screenshot engine.
- Baseline Phase 2 gap, closed by v1.5.0: no realtime suggestion panel, no realtime suggestion toggle, no screenshot-time AI queue.
- Baseline Phase 3 gap, closed by v2.0.0: no `startAiRecording`, `takeoverRecording`, `pauseAiAgent`, `resumeAiAgent`, or `agentStep` implementation.
- Verification run before planning: `npm run check` passed.

## 2026-05-01 - v1.3.1 Watchdog Start Metrics

- Watchdog queue file: `memory/dev-loop-progress.md`.
- Watchdog script: `scripts/dev-watchdog.mjs`.
- First pending task selected: `v1.3.1-regression-checks`.
- Regression checks added: version alignment, paused manual screenshot behavior, AI API HTTP-status fallback warning, history cap/export path display.
- Stage result: `v1.3.1-regression-checks` completed and verified through `npm run watchdog`.

## 2026-05-01 - v1.4.0 CDP Metrics

- New permission surface: `debugger`.
- New settings keys: `screenshotEngine`, `cdpCropEnabled`, `cdpCropX`, `cdpCropY`, `cdpCropWidth`, `cdpCropHeight`.
- New CDP commands used: `Page.enable`, `DOM.enable`, `Page.captureScreenshot`, `DOM.getNodeForLocation`, `DOM.describeNode`.
- New regression checks added: 5.
- Stage result: `v1.4.0-cdp-engine` completed and verified through `npm run check`.

## 2026-05-01 - v1.5.0 Realtime Suggestion Metrics

- New setting key: `realtimeSuggestions`.
- New runtime message/action surface: `realtimeSuggestion`, `updateRealtimeSuggestion`.
- Queue capacity policy: one active AI analysis plus one latest pending screenshot.
- New popup UI surface: realtime suggestion toggle, status panel, editable suggestion textarea, save action.
- New regression checks added: 6.
- Stage result: `v1.5.0-realtime-suggestions` completed and verified through `npm run check`.

## 2026-05-01 - v2.0.0 AI Recording Metrics

- New recording mode: `ai` with `captureMode: agent`.
- New runtime message/action surface: `startAiRecording`, `pauseAiAgent`, `resumeAiAgent`, `takeoverRecording`, `aiStatus`, `agentStep`.
- New Agent limits: 50 steps, 10 minutes.
- New CDP tool commands used: `Input.dispatchMouseEvent`, `Input.insertText`.
- New Agent tools: `click_at_xy`, `type_text`, `scroll`, `finish`.
- New regression checks added: 7.
- Stage result: `v2.0.0-ai-recording` completed and verified through `npm run check`.

## 2026-05-01 - v2.0.1 Spec Status Sync and E2E Metrics

- Version metadata aligned at `2.0.1` across `package.json`, `package-lock.json`, and `manifest.json`.
- Synced `.42cog` status documents: `spec-prd.md`, `spec-userstory.md`, `real.md`, `sys.md`, and `spec-ui.md`.
- Remaining current gaps are explicitly marked as hardening or follow-up refactors: storage usage cleanup, Agent single-decision retry, navigation anomaly handling, configurable Agent limits, UI accessibility checklist, Plasmo migration, and background module split.
- Verification: `npm run check` passed after the version bump and status sync.
- E2E: `npm run validate:e2e` passed with all 16 report checks true; artifacts written under `output/playwright/`.

## 2026-05-01 - v2.0.2 Idempotent Operation Metrics

- Version metadata aligned at `2.0.2` across `package.json`, `package-lock.json`, and `manifest.json`.
- New backend guard surfaces: `operationLocks`, `operationSerialQueues`, and `recentOperationResults`.
- Guarded mutation paths: stop recording, screenshot capture, export, tutorial generation, and AI Agent tool execution.
- New idempotent client actions: `stopRecording`, `manualCapture`, and `downloadRecording` attach `operationId`.
- Screenshot IDs now include recording id, monotonic sequence, and random suffix; Agent steps include deterministic `agent-step` IDs.
- Watchdog task registered and executed: `v2.0.2-idempotent-operations`.
- Verification: `npm run check`, `npm run watchdog`, and `npm run validate:e2e` passed.

## 2026-05-01 - v2.0.3 Transaction Recovery Metrics

- Version metadata aligned at `2.0.3` across `package.json`, `package-lock.json`, and `manifest.json`.
- New IndexedDB scan surface: `listRecordings()` for recovery and history reconciliation.
- New commit states: `recording`, `stopping`, `media-collected`, `descriptions-ready`, `download-requested`, `history-updated`, `complete`, and `failed`.
- Recovery behavior: startup marks interrupted export states recoverable and rebuilds missing history summaries from IndexedDB recordings.
- Export failure behavior: failed re-export preserves the recording and writes `recoverableError`.
- E2E observation: final history summary reports `commitState: complete` after detail re-export.
- Verification: `npm run check`, `npm run watchdog`, and `npm run validate:e2e` passed.

## 2026-05-01 - v2.1.0 Asset Store Metrics

- Version metadata aligned at `2.1.0` across `package.json`, `package-lock.json`, and `manifest.json`.
- IndexedDB schema upgraded to version `2` with stores: `recordings` and `assets`; `assets` is indexed by `recordingId`.
- New asset kinds: `screenshot`, `audio`, and `video`.
- New atomic persistence surface: `putRecordingWithAssets(recording, assets, { deleteAssetIds })`.
- E2E storage observation after workspace edit: persisted recording had `3` screenshots, `0` inline screenshot data fields, `3` screenshot asset ids, `hasInlineAudio=false`, `hasInlineVideo=false`, `hasAudioAsset=true`, and `hasVideoAsset=true`.
- E2E asset observation: `5` assets for the fixture recording (`3` screenshots, `1` audio, `1` video), all with data payloads.
- E2E report checks added: `assetStoreSplitWorked`, `assetHydrationWorked`, `assetStoreHasScreenshotPayloads`, and `mediaAssetsSplitWorked`.
- Verification: `npm run check`, `npm run watchdog`, and `npm run validate:e2e` passed.

## 2026-05-01 - v2.1.1 Export Scaling Metrics

- Version metadata aligned at `2.1.1` across `package.json`, `package-lock.json`, and `manifest.json`.
- ZIP bundling switched from `zipSync(archiveEntries)` to `Zip` + `ZipDeflate` incremental entry writes.
- ZIP progress cadence: first entry, every `10` entries, and final entry.
- PDF protection thresholds: `150` screenshots or `200 MB` of estimated screenshot payload.
- Oversized PDF behavior: skip PDF with warning, while ZIP still includes Markdown, all screenshots, and available audio/video.
- E2E result: standard fixture still produced `2` valid ZIP downloads with Markdown, PDF, audio, video, and screenshots after the streaming ZIP change.
- Verification: `npm run check`, `npm run watchdog`, and `npm run validate:e2e` passed.

## 2026-05-01 - v2.2.0 Agent Hardening Metrics

- Version metadata aligned at `2.2.0` across `package.json`, `package-lock.json`, and `manifest.json`.
- Agent decision retry policy: `1` automatic retry after a failed model decision before the existing failure/takeover branch.
- Page stability guard: waits up to `8000 ms`, polling every `400 ms`, and requires two stable completed tab snapshots.
- Configurable Agent limits: default `50` steps and `10` minutes; clamped range `1-500` steps and `1-120` minutes.
- Settings E2E observation: custom Agent limits persisted as `75` steps and `15` minutes in `chrome.storage.local`.
- Regression checks added: version alignment, configurable limit normalization, settings UI fields, loop usage, retry, stability/anomaly detection, popup runtime fields, and watchdog registration.
- Verification: `npm run check`, `npm run watchdog`, and `npm run validate:e2e` passed.
