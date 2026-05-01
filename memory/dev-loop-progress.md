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
