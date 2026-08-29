# Changelog

All notable changes to Tutorial Recorder are tracked using Semantic Versioning.

## [2.7.0] - 2026-08-30

### Added
- DeepSeek 官方 Provider 预设，支持账号实时开放的 `deepseek-v4-flash-vision-exp` 视觉模型。
- 设置页本地存储治理：用量、教程/素材数量展示，以及带确认的一键清理。
- GitHub Actions 无密钥真实 Chromium E2E 门禁和浏览器证据 artifact。
- 受信任 CI 强制执行的 DeepSeek 官方视觉 smoke（fork PR 安全跳过），以及基于可见控件文字的点击坐标校准与动作坐标审计。
- AI smoke 主动删除含临时扩展设置的 Chromium Profile，CI 仅白名单上传脱敏浏览器证据。

### Changed
- 后台模块移除静态循环依赖，抽出设置读取与步骤描述纯模块，并通过回调解耦 Agent 停止流程。
- 扩展 ZIP 使用固定文件时间戳，同一提交可字节级复现并稳定校验。
- 系统规格、隐私约束和上架材料同步到当前 16 Provider、100 条历史和已实现存储治理状态。

## [2.6.1] - 2026-08-29

### Changed
- Background service worker fully modularized under a 500-line-per-file engineering budget: the entry file now only hosts message routing and top-level listeners, while 22 lifecycle modules (runtime state, operation safety, recording assets/targets/lifecycle, screenshot engine, agent loop/tools/state, tutorial generator, realtime suggestions, export pipeline, detail/history/media services, interaction capture, plus the earlier pure-function modules) own their concerns behind a shared `S` state container with auto-generated cross-module imports and a regression-enforced line budget.

## [2.6.0] - 2026-08-29

### Added
- Screenshot annotation editor in the workspace: arrows, highlight boxes, pixel-mosaic redaction, and text callouts with color/width pickers, undo (Ctrl+Z), and original-resolution PNG export into the step draft.
- Store submission kit: Chinese privacy policy (`docs/privacy-policy-zh.md`) and Chrome Web Store / Edge Add-ons listing material with per-permission review answers (`docs/store-listing.md`).
- `.env.example` template plus KEY=VALUE support in the AI smoke config loader (legacy three-line format still accepted).

### Changed
- Content script is now injected on demand via `chrome.scripting` while recording (re-injected on tab navigation) instead of a static `<all_urls>` content_scripts declaration; the redundant Ark host permission entry was removed.
- `getPopupState` no longer returns the plaintext API key (reports `apiKeyConfigured` instead); the full settings page reads secrets through a dedicated `getSecretSettings` action.
- Engineering split: background service worker decomposed into focused modules — `settings-schema.js` (presets + normalization), `ai-vision.js` (vision request pipeline), `exporters.js` (Markdown/HTML/PDF/ZIP builders), `text-utils.js`, and `notify.js` — with a cross-reference audit, directory-aware regression source loading, and a dynamic `scripts/check-syntax.mjs` gate that scans every source file.

## [2.5.0] - 2026-08-29

### Added
- Global provider compatibility: Groq and Mistral presets join OpenAI/Claude/Gemini for overseas users, plus Azure OpenAI (`/openai/v1` compatibility layer) and One API / New API self-hosted relay presets.
- Provider dropdown now groups presets into 国产模型 / 海外模型 / 中转与网关 so domestic-first positioning stays clear while remaining globally usable.
- One-click "测试连接" in the full settings page: sends a minimal real vision request through the exact configured chain (Base URL + Key + model + API style) and reports latency, the model reply, or a localized troubleshooting hint covering auth failures, missing models on relays, rate limits, timeouts, and http/https mismatches.
- E2E coverage for the connection-test guidance path when providers are unconfigured.
- API Key input opts out of browser password managers via `autocomplete="new-password"`.

## [2.4.0] - 2026-08-29

### Added
- Sensitive input protection: password/OTP/card fields are never read into interaction summaries, and phone/ID-card/bank-card numbers are masked in both the content script and the background layer before they reach AI prompts.
- Zhipu GLM (`open.bigmodel.cn`) and Moonshot Kimi (`api.moonshot.cn`) provider presets across background, settings page, and popup labels.
- AI Agent tools `press_key` (Enter/Tab/Escape/Backspace/arrows), `navigate`, `hover`, and `wait`, unlocking search-submit and multi-page flows.
- Viewport-aware agent decisions: CSS layout metrics are attached to each decision, and decision screenshots are normalized to viewport size so click coordinates map 1:1.
- Standalone `tutorial.html` in every exported ZIP: a single file with inline screenshots and playable audio/video that opens directly in any browser.
- Vision analysis retry with exponential backoff on 429/5xx honoring `Retry-After`, plus pre-upload downscaling (1280px JPEG) that cuts image tokens and upload size.
- Concurrent batch description generation (3 workers) while preserving step order and fallback behavior.
- Media size circuit breakers: audio stops gracefully past 100MB and video past 400MB with Chinese warnings; screenshots and the rest of the export continue.
- History retention raised from 20 to 100 entries.

### Changed
- Offscreen media sessions now persist audio/video assets directly into IndexedDB and return asset IDs, removing the 64MB runtime-message ceiling for long recordings.
- IndexedDB access now recovers from stale service-worker connections via `versionchange`/`close` handling and one automatic reconnect per operation.
- Agent decision `max_tokens` raised to 512 to accommodate the expanded tool schema.

## [2.3.0] - 2026-05-07

### Added
- GitHub Actions CI/CD workflow that runs checks, packages the extension, uploads build artifacts, and publishes ZIP assets on `v*` tags.
- Local `npm run package` command that builds a Chrome extension ZIP and `.sha256` checksum under `dist/`.
- Release regression checks covering packaging scope, checksum generation, workflow triggers, artifacts, and tag releases.

## [2.2.7] - 2026-05-06

### Fixed
- Popup starts now pass the resolved target URL to the background so AI recording can match the intended tab instead of relying only on tab focus state.
- Background target resolution now waits briefly for a recordable `pendingUrl` to commit before rejecting or attaching CDP, covering pages launched from extension/internal tabs.
- AI recording can also infer a target URL from the goal text when a user includes a URL there.

## [2.2.6] - 2026-05-06

### Fixed
- AI recording now retries CDP attach with a fresh recordable target when a trusted popup start reaches a stale extension/internal target during debugger attachment.
- Recording target validation now requires the committed tab URL to be recordable, preventing a recordable `pendingUrl` from masking an extension/internal current page.
- CDP attach errors during AI startup now use the AI recording error context instead of the generic recording message.

## [2.2.5] - 2026-05-06

### Fixed
- Popup-initiated manual and AI recording now allow the background service worker to recover from a stale extension-page tab id by selecting a recordable http/https/file tab.
- Direct runtime messages that pass an extension/internal tab id still fail safely with a Chinese target-page error.
- CDP debugger attach now revalidates the live tab and normalizes Chrome's raw `Cannot access a chrome-extension:// URL of different extension` error into the target-page guidance.

## [2.2.4] - 2026-05-06

### Fixed
- AI startup and observing messages now live in popup/runtime state instead of transient DOM text, so render refreshes no longer overwrite them with `待启动`.
- Background AI startup now broadcasts a `starting` status before CDP attach and a `running` observing status after attach succeeds.

### Added
- Real AI recording smoke script for local provider-backed verification: `npm run smoke:ai`.

## [2.2.3] - 2026-05-06

### Fixed
- AI recording start is no longer silently disabled when provider settings are missing; clicking it now shows an explicit configuration prompt.
- AI recording startup now gives immediate popup feedback while the background service worker initializes CDP and the Agent loop.
- E2E validation now covers the missing-configuration click path.

## [2.2.2] - 2026-05-06

### Fixed
- AI and manual recording startup now resolve a recordable http/https/file tab instead of treating the extension workspace or settings page as the target.
- Background startup validation rejects extension and browser-internal pages before CDP/debugger attachment, returning a Chinese user-facing error instead of Chrome's raw cross-extension exception.
- E2E validation now covers the AI extension-page rejection path.

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
