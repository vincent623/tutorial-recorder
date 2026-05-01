# Changelog

All notable changes to Tutorial Recorder are tracked using Semantic Versioning.

## [2.2.1] - 2026-05-01

### Added
- Scale stress script for synthetic 100, 300, and 1000 step recordings.
- Stress report generation under `output/stress/recording-scale-report.json` with metadata size, inline-equivalent size, ZIP entry count, asset payload size, and PDF strategy.
- v2.2.1 regression checks covering stress script registration, threshold assertions, and watchdog task registration.

## [2.2.0] - 2026-05-01

### Added
- AI Agent decision retry with one automatic retry before entering the existing takeover/failure branch.
- Post-action page stability checks that wait for the target tab to settle and fail safely on closed or browser-internal pages.
- Configurable AI Agent maximum steps and timeout minutes in the full settings page.

## [2.1.1] - 2026-05-01

### Changed
- ZIP export now writes entries incrementally with `fflate` streaming APIs instead of assembling one large archive input object.
- Export progress is reported while ZIP entries are packed, so large recordings expose forward motion during long exports.
- PDF generation now has protective thresholds for very large recordings; when the threshold is exceeded, export skips PDF and still emits Markdown, screenshots, audio, and video.

## [2.1.0] - 2026-05-01

### Added
- IndexedDB `assets` store for screenshots, audio, and video, indexed by `recordingId`.
- Atomic recording persistence that writes asset payloads and lightweight recording metadata in one IndexedDB transaction.
- Asset hydration for runtime recovery, detail loading, PDF payloads, Markdown/ZIP export, and history re-export.
- Cascading asset cleanup when a recording is deleted or edited screenshots are removed.
- v2.1.0 regression checks covering asset store schema, hydration, non-inline persisted screenshots, media assets, cleanup, and watchdog task registration.

## [2.0.3] - 2026-05-01

### Added
- Recording commit states for stop, media collection, description generation, download request, history update, completion, and recoverable failure.
- Startup recovery scan that marks interrupted exports as recoverable and reconciles missing history entries from IndexedDB recordings.
- Re-export failure handling that preserves the recording and records a recoverable error instead of leaving ambiguous state.
- v2.0.3 regression checks covering commit states, recovery scanning, history reconciliation, and watchdog task registration.

## [2.0.2] - 2026-05-01

### Added
- Backend operation locks for stop, screenshot capture, export, tutorial generation, and AI Agent tool execution.
- Idempotency keys and short-lived completed-operation result caching for repeated runtime messages.
- Collision-resistant screenshot IDs using recording id, monotonic sequence, and random suffix.
- Agent step IDs to prevent duplicate step append for the same screenshot/action pair.
- v2.0.2 regression checks covering operation locks, idempotency keys, screenshot IDs, Agent step dedupe, and watchdog task registration.

## [2.0.1] - 2026-05-01

### Changed
- Synced `.42cog` PRD, user story, reality, system, and UI specs with the implemented v1.4.0-v2.0.0 feature state.
- Clarified that Plasmo/React migration and background module split are postponed refactors, not blockers for the delivered Phase 1-3 capabilities.
- Reframed baseline gap metrics as historical findings and separated remaining AI Agent hardening items from completed MVP scope.

## [2.0.0] - 2026-05-01

### Added
- AI recording panel in popup with goal input, AI start, status list, and takeover control.
- Background AI recording lifecycle actions: `startAiRecording`, `pauseAiAgent`, `resumeAiAgent`, and `takeoverRecording`.
- CDP Agent loop that captures the page, asks the configured model for the next browser action, executes CDP tools, and reuses the existing stop/export pipeline.
- Agent tool schema and executor for `click_at_xy`, `type_text`, `scroll`, and `finish`.
- Default AI recording safety limits: 50 steps and 10 minutes.
- Failure handling that preserves completed screenshots, detaches the debugger, and offers takeover or stop/export.
- v2.0.0 regression checks covering AI UI, message routing, Agent loop, CDP tools, limits, failure handling, and export labels.

### Changed
- Tutorials created through AI recording are labeled as `AI 自动录制` in exported Markdown and detail metadata.

## [1.5.0] - 2026-05-01

### Added
- Optional realtime AI suggestion toggle in popup and the full settings page.
- Non-blocking latest-only realtime suggestion queue triggered after screenshot completion.
- Popup realtime suggestion panel with loading, generated, error, editing, and saved states.
- Editable realtime suggestion overrides that persist into the final Markdown, PDF, and ZIP export.
- v1.5.0 regression checks covering version alignment, toggle persistence, queue behavior, popup editing, and final-export precedence.

### Changed
- Final tutorial generation now preserves already-saved step descriptions and only batch-analyzes missing descriptions.

## [1.4.0] - 2026-05-01

### Added
- Optional CDP screenshot engine using `chrome.debugger` and `Page.captureScreenshot`.
- CDP debugger lifecycle handling with attach on recording start and detach before tutorial generation.
- Automatic fallback from CDP screenshots to standard `captureVisibleTab` screenshots when attach or capture fails.
- CDP crop-region settings and a popup status banner for Chrome debugging visibility.
- Click coordinate reporting and CDP DOM node lookup for more precise interaction context in CDP mode.
- v1.4.0 regression checks covering permission, settings UI, CDP paths, interaction coordinates, and popup status.

## [1.3.1] - 2026-05-01

### Fixed
- Keep manual screenshot capture available while recording is paused, matching the `.42cog` acceptance criteria.
- Include HTTP status details in AI analysis failure warnings before falling back to default step descriptions.

### Added
- Repo-local dev watchdog entry point and progress queue.
- Focused v1.3.1 regression checks for version alignment, paused manual capture, AI API error feedback, and history/export display.

## [1.3.0] - 2026-05-01

### Added
- Manual tutorial recording with automatic and manual screenshot capture.
- Screen/tab video capture and microphone audio capture through an offscreen document.
- AI vision analysis after recording, with multiple provider presets and prompt templates.
- ZIP export containing Markdown, PDF, screenshots, and available WebM media.
- Workspace mode for history review, step editing, screenshot replacement/insertion/deletion, ordering, and re-export.

### Notes
- This is the complete v1.3.0 baseline before the `.42cog` Phase 1-3 gap-alignment work.
- Future minor versions should implement additive capabilities such as CDP capture and realtime suggestions.
- The AI-driven recording milestone is reserved for v2.0.0 because it adds browser-control behavior and the `debugger` permission surface.
