# Changelog

All notable changes to Tutorial Recorder are tracked using Semantic Versioning.

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
