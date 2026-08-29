# Dev Loop Progress

The watchdog reads the first unchecked item and executes the mapped verification command immediately.

- [x] `v1.3.1-regression-checks` - Add baseline regression checks and fix the known paused manual capture/API error feedback gaps.
- [x] `v1.4.0-cdp-engine` - Add the standard/CDP screenshot engine and debugger lifecycle.
- [x] `v1.5.0-realtime-suggestions` - Add non-blocking realtime AI suggestions.
- [x] `v2.0.0-ai-recording` - Add AI-driven recording with CDP tools, takeover, and limits.
- [x] `v2.0.2-idempotent-operations` - Add backend operation locks, idempotency keys, and collision-resistant screenshot IDs.
- [x] `v2.0.3-transaction-recovery` - Add recording commit states, recovery scan, and history reconciliation.
- [x] `v2.1.0-asset-store` - Split large screenshot/audio/video payloads into IndexedDB assets and hydrate exports on demand.
- [x] `v2.1.1-export-scaling` - Stream ZIP packaging, report export progress, and gracefully skip oversized PDF generation.
- [x] `v2.2.0-agent-hardening` - Add Agent decision retry, page stability checks, navigation anomaly handling, and configurable limits.
- [x] `v2.2.1-scale-stress` - Add repeatable 100/300/1000 step scale stress scripts and record metrics.
- [x] `v2.2.2-target-tab-guard` - Reject extension/internal tabs before manual or AI recording and verify AI extension-page startup failure is friendly.
- [x] `v2.2.3-ai-start-feedback` - Keep AI start clickable when unconfigured and show immediate startup or configuration feedback.
- [x] `v2.2.4-ai-start-state` - Persist AI startup/observing feedback through popup render updates and add real AI recording smoke coverage.
- [x] `v2.2.5-background-target-fallback` - Add background fallback target selection and normalize raw chrome-extension target errors.
- [x] `v2.2.6-ai-cdp-target-retry` - Retry AI CDP attach with a fresh recordable target and tighten committed URL validation.
- [x] `v2.2.7-pending-target-url` - Pass target URLs through startup and wait for recordable pending URLs to commit.
- [x] `v2.3.0-github-release-automation` - Add GitHub Actions CI/CD packaging, release upload, and local package script.
- [x] `v2.4.0-privacy-and-media-hardening` - Mask sensitive interactions, persist media assets offscreen, harden IndexedDB recovery, expand agent tools, and speed up AI analysis.
- [x] `v2.5.0-global-provider-compatibility` - Add Groq/Mistral/Azure/One-API presets and a one-click provider connection test.
- [x] `v2.6.0-store-readiness-and-annotations` - On-demand content injection, API-key redaction, module split, annotate editor, and store submission docs.
- [x] `v2.6.1-background-module-budget` - Split the background service worker into 500-line lifecycle modules behind a shared state container.
- [x] `v2.7.0-risk-closure` - Add CI browser E2E, DeepSeek vision, storage governance, acyclic modules, reproducible packages, and current docs.
