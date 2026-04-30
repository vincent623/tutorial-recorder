# .42cog Gap Alignment Plan

Date: 2026-05-01
Baseline: `v1.3.0`
Branch: `gap-alignment-plan`

## Baseline

The GitHub remote already contains a complete `v1.3.0` baseline on `origin/main` and tag `v1.3.0`. That baseline implements the current manual tutorial recorder:

- Manual recording with automatic and manual screenshots.
- Screen/tab video and microphone audio capture.
- Post-recording AI vision analysis with provider presets and prompt templates.
- ZIP export with Markdown, PDF, screenshots, and available WebM media.
- Workspace editing for history, step text, screenshot CRUD, ordering, and re-export.

## Gap Summary

| Area | Spec Target | Current State | Gap |
| --- | --- | --- | --- |
| Version metadata | Semantic version baseline is consistently `1.3.0` | `package.json` and `manifest.json` are `1.3.0`; lockfile root was `1.0.0` | Align lockfile metadata |
| CDP capture | Standard/CDP screenshot engine, debugger lifecycle, background capture, crop, element locator | Only `chrome.tabs.captureVisibleTab` | No `debugger` permission or CDP path |
| Realtime AI suggestion | AI suggestion after each screenshot, editable in popup | AI runs only after stop/export | No realtime queue or UI |
| AI-driven recording | Goal input, Agent loop, CDP tools, takeover, AI pause/resume | Manual recording only | No Agent loop, tool schema, or UI |
| Architecture | Phase 1 migrates UI to Plasmo + React + TypeScript and splits background modules | Vanilla JS large-file architecture | No `src/`, React, TypeScript, or Plasmo build |
| Safety controls | Debugger detach and Agent step/time limits | Not applicable because Agent/CDP absent | Must be enforced when adding Phase 1/3 |
| Storage management | Storage usage visibility and batch cleanup | History capped at 20; no usage dashboard | Optional real.md gap |

## Semantic Version Roadmap

### v1.3.1 - Baseline Alignment Patch

Goal: keep behavior unchanged and make the existing `v1.3.0` baseline easier to maintain and verify.

- Align `package-lock.json` root/package version to `1.3.0`.
- Add `.42cog` specs to the repository so implementation work can be reviewed against the same source of truth.
- Add this gap plan and dev-loop memory logs.
- Add focused regression tests for known v1.3.0 acceptance details:
  - paused-state manual screenshot behavior;
  - API error status visibility;
  - history cap and re-export path display;
  - package/manifest/lockfile version consistency.

Exit criteria:

- `npm run check` passes.
- `npm run validate:e2e` passes in a local browser environment.
- No product behavior changes except version metadata and documentation.

### v1.4.0 - Phase 1 CDP Screenshot Enhancement

Goal: implement `.42cog` MAS-5 / CS-04.

- Add `debugger` permission and explicit CDP mode UI copy.
- Introduce a screenshot-engine abstraction:
  - standard engine: `chrome.tabs.captureVisibleTab`;
  - CDP engine: `chrome.debugger` + `Page.captureScreenshot`.
- Add debugger lifecycle manager:
  - attach on CDP recording start;
  - detach on stop, failure, and service-worker recovery;
  - never remain attached outside recording.
- Add CDP failure fallback to standard capture with user warning.
- Add element-location enrichment for interaction context.
- Add crop-region settings and screenshot clipping where CDP supports it.

Exit criteria:

- CDP mode can continue capturing the target tab when another tab is active.
- Debugger warning is visible during CDP recording and gone after stop.
- Attach failure falls back to standard mode without losing the recording.
- Standard mode remains backward compatible.

### v1.5.0 - Phase 2 Realtime AI Suggestions

Goal: implement `.42cog` MAS-6 / CS-05.

- Add a realtime suggestion queue triggered by screenshot completion.
- Keep AI calls asynchronous and non-blocking for recording.
- Keep only the latest pending suggestion when screenshots happen quickly.
- Add popup UI for:
  - loading state;
  - latest AI suggestion;
  - user override text;
  - realtime suggestion toggle.
- Persist user overrides so final export prefers corrected text.

Exit criteria:

- Screenshot cadence is not delayed by AI latency.
- Realtime suggestion failures do not block recording or export.
- Final tutorial uses user-edited realtime suggestions when present.

### v2.0.0 - Phase 3 AI-Driven Recording

Goal: implement `.42cog` MAS-4 / CS-06.

- Add AI recording panel with goal input and status list.
- Add Agent loop in the background service worker:
  - screenshot current page;
  - ask model for next action;
  - execute CDP tool;
  - capture step result;
  - repeat until finish/limit/failure.
- Add structured tool calls:
  - `click_at_xy`;
  - `type_text`;
  - `scroll`;
  - `finish`.
- Add controls for takeover, pause AI, resume AI, and stop.
- Enforce default safety limits: 50 steps and 10 minutes.
- Generate the same ZIP structure as manual recording.

Exit criteria:

- AI recording can complete a simple deterministic fixture task end to end.
- Takeover preserves timeline continuity and allows manual capture.
- Agent failure preserves completed steps and offers takeover/stop.
- Debugger is detached immediately after completion, stop, or failure.

## Execution Order

1. Finish `v1.3.1` patch hygiene and tests.
2. Implement CDP engine behind settings, with standard mode as default.
3. Split high-risk background code only where the CDP work needs boundaries.
4. Add realtime suggestion after the screenshot engine is stable.
5. Implement AI Agent loop last, because it depends on CDP capture and tool execution.

## Risks

- Chrome `debugger` permission changes user trust and install prompts.
- MV3 service-worker lifecycle can interrupt long Agent sessions.
- Realtime suggestions can increase API cost if not throttled.
- CDP and standard screenshot modes double the test matrix.
- Plasmo migration may be large; it should not be mixed with behavior-heavy changes unless the team accepts the review cost.
