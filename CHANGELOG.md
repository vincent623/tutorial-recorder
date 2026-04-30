# Changelog

All notable changes to Tutorial Recorder are tracked using Semantic Versioning.

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
