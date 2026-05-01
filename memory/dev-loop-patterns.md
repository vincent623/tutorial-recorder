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

## 2026-05-01 - Realtime Suggestion Pattern

- Treat realtime AI as an optional recording overlay, not as part of the screenshot critical path; screenshots are saved first, then AI work is queued asynchronously.
- Use a single active AI request plus one replaceable pending job so slow providers cannot build an unbounded backlog during fast screenshot bursts.
- Persist realtime suggestions directly onto screenshot descriptions so later batch generation can skip completed steps and user edits naturally become prompt context for following steps.
- Keep the realtime panel hidden when AI is unconfigured; the popup toggle controls API cost without changing the stop-time batch analysis path.

## 2026-05-01 - AI Recording Pattern

- Keep AI recording as a new recording mode that reuses the existing screenshot, tutorial generation, history, and ZIP export pipeline instead of creating a separate artifact path.
- Let the Agent loop own only the browser-control cycle: capture page state, request one next action, execute one CDP tool, then repeat.
- Use explicit stop, pause, failure, and takeover states so a model failure preserves completed screenshots and lets the user decide whether to continue manually or export.
- Enforce step and time limits inside the loop before taking the next screenshot; limits should stop gracefully through the same export flow.

## 2026-05-01 - Spec Status Sync Pattern

- Keep baseline gap metrics in past tense once a gap is closed; current-state documents should not read like delivered phases are still missing.
- Regression checks for a feature milestone should verify the feature surface and version alignment, not freeze future patch releases to the original milestone number.
- When a planned framework migration is postponed, update UI and system specs together so component names remain design intent while file paths describe the implementation actually shipped.

## 2026-05-01 - Idempotent Operation Pattern

- Backend locks must protect mutation paths independently from popup disabled states; multiple popups and replayed messages can bypass UI-only guards.
- Use serialized queues for screenshot capture so concurrent auto/manual/final captures cannot interleave writes or collide on sequence numbers.
- Pair client-generated operation IDs with short-lived backend result caching for repeated runtime messages, while keeping resource-level locks for operations such as stop and export.
- Step-like Agent updates should be keyed by recording, screenshot, and action so duplicate loop callbacks cannot append duplicate progress items.

## 2026-05-01 - Transaction Recovery Pattern

- Persist commit state at each cross-store boundary: recording stop, media collection, description readiness, download request, history update, and final completion.
- Treat interrupted export states as recoverable, not destructive; preserve screenshots and expose the record through history so the user can re-export.
- Reconcile history from IndexedDB on startup because recording details and history summaries are stored in different browser stores.
- Refresh the history summary after the final `complete` commit so the index does not lag behind the recording detail state.

## 2026-05-01 - Asset Split Storage Pattern

- Store large screenshot/audio/video payloads in a recording-indexed `assets` store and keep `recordings` lightweight with asset references, descriptions, ordering, and commit state.
- Use one IndexedDB transaction when writing assets and the recording metadata together; a split store is only safer if the metadata cannot point at missing newly-created assets.
- Hydrate assets at API boundaries (`getRecordingDetail`, export, runtime restore) so popup/workspace contracts stay stable while persistence remains lightweight.
- Regression and E2E checks should inspect actual IndexedDB summaries, not only exported ZIPs, because exports can hide storage-shape regressions.
- Data URL parsing for media must search for `;base64,` rather than the first comma; WebM codec parameters can contain commas before the base64 marker.

## 2026-05-01 - Export Scaling Pattern

- After storage is split, inspect export memory separately: a lightweight database record can still become a huge in-memory ZIP/PDF job after hydration.
- Build ZIPs incrementally so only one entry is decoded and compressed at a time; avoid collecting all uncompressed archive entries before compression.
- Treat PDF as an optional derivative for very large recordings; skipping PDF is preferable to failing the entire export when Markdown and source assets are still useful.
- Long export loops should emit progress and yield periodically so extension UI can show forward motion instead of appearing stuck.

## 2026-05-01 - Agent Hardening Pattern

- Keep Agent failures recoverable: retry one transient decision failure, then route through the existing failure/takeover branch instead of continuing with uncertain state.
- After browser-control actions, wait for tab stability before the next screenshot; this prevents capturing half-loaded navigation states as tutorial steps.
- Detect hard navigation anomalies close to the executor boundary, including closed target tabs and browser-internal URLs that cannot be recorded safely.
- Promote fixed safety constants into settings only after defaults and clamps exist in the background normalizer; UI inputs alone are not guard rails.

## 2026-05-01 - Scale Stress Pattern

- Keep scale checks deterministic and browserless for daily watchdog use; reserve full browser E2E for representative workflows.
- Stress reports should compare the new storage shape against a pre-change inline equivalent so improvements are visible as ratios, not just pass/fail.
- Validate behavior at explicit step counts that map to operating modes: normal PDF generation, PDF-skip threshold, and 1000-step asset pressure.
- Write generated stress reports under ignored `output/` while appending stable headline metrics to `memory/dev-loop-metrics.md`.
