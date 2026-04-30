# Dev Loop Patterns

## 2026-05-01 - Spec-to-Implementation Gap Review

- Treat `.42cog` documents as the source of product truth and compare them against concrete code paths, not README claims.
- If a local directory is missing `.git` but a GitHub URL exists, fetch the remote before creating new release commits; preserve any accidental local root commit on a backup branch before reconnecting to `origin/main`.
- Keep semantic-version planning aligned to risk: patch for metadata/tests/docs, minor for additive capabilities, major for AI browser-control behavior and new permission surfaces.
- Do not mix Phase 1 CDP implementation with Phase 3 Agent work; CDP capture and debugger lifecycle are prerequisites for reliable AI-driven recording.
- When introducing realtime AI calls, make them non-blocking and latest-only by design so recording cadence is independent from model latency.
