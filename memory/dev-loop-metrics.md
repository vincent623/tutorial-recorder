# Dev Loop Metrics

## 2026-05-01 - Tutorial Recorder Baseline and Gap Metrics

- Baseline version in GitHub history: `v1.3.0`.
- Existing remote tags observed: `v1.0.0`, `v1.1.0`, `v1.2.0`, `v1.2.1`, `v1.3.0`.
- Current implementation size: `background/background.js` 1741 lines, `popup/popup.js` 1275 lines, `offscreen/offscreen.js` 727 lines.
- `.42cog` scope: MAS-1/MAS-2/MAS-3 marked implemented; MAS-5 Phase 1, MAS-6 Phase 2, MAS-4 Phase 3 remain implementation gaps.
- Missing Phase 1 permission/API surface: no `debugger` permission, no `chrome.debugger` usage, no CDP screenshot engine.
- Missing Phase 2 UI/control surface: no realtime suggestion panel, no realtime suggestion toggle, no screenshot-time AI queue.
- Missing Phase 3 message/API surface: no `startAiRecording`, `takeoverRecording`, `pauseAiAgent`, `resumeAiAgent`, or `agentStep` implementation.
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
