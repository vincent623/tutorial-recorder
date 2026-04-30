# Dev Loop Patterns

## 2026-05-01 - Spec-to-Implementation Gap Review

- Treat `.42cog` documents as the source of product truth and compare them against concrete code paths, not README claims.
- If a local directory is missing `.git` but a GitHub URL exists, fetch the remote before creating new release commits; preserve any accidental local root commit on a backup branch before reconnecting to `origin/main`.
- Keep semantic-version planning aligned to risk: patch for metadata/tests/docs, minor for additive capabilities, major for AI browser-control behavior and new permission surfaces.
- Do not mix Phase 1 CDP implementation with Phase 3 Agent work; CDP capture and debugger lifecycle are prerequisites for reliable AI-driven recording.
- When introducing realtime AI calls, make them non-blocking and latest-only by design so recording cadence is independent from model latency.

## 2026-05-01 - Watchdog Task Execution

- Keep a repo-local progress file (`memory/dev-loop-progress.md`) as the single readable queue for automated dev-loop execution.
- Map watchdog tasks to deterministic local commands instead of arbitrary shell text from markdown; this keeps the automation auditable and avoids command injection through progress notes.
- Start patch work by converting known `.42cog` acceptance mismatches into regression checks, then make the smallest product change needed to satisfy the checks.

## 2026-05-01 - CDP Engine Pattern

- Keep `captureMode` for media capture separate from `screenshotEngine` for still-image capture; mixing them would make the existing displayMedia/tabCapture behavior harder to preserve.
- Detach the debugger before tutorial generation resets runtime state, otherwise the detach guard can lose the active tab reference.
- Use CDP as an optional enhancement with standard screenshot fallback; a debugger failure should degrade precision, not lose the recording.
