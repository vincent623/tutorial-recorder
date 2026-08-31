# Commercial Release Checklist

This checklist separates code readiness from external publication evidence. A release is commercially ready only when every blocking item has a current receipt for the exact release commit.

## Automated gates

- [x] Syntax, regression, scale, dependency-cycle, and reproducible-package checks
- [x] Real Chromium extension E2E with exported artifact inspection
- [x] Provider-backed DeepSeek vision smoke isolated from deterministic CI
- [x] Tag/version equality and SHA256 verification before GitHub Release
- [x] GitHub Actions pinned to immutable commits with read-only default token permissions
- [x] AI screenshot sharing explicit opt-in
- [x] One-time confirmation for destructive clicks, coordinate fallback, Enter submission, and high-risk or unknown-destination URL navigation
- [x] Visible-history retention also removes IndexedDB recording and asset payloads through a crash-recoverable cleanup queue
- [x] Formal AI recording uses synchronized Browser Observation, opaque element references, execution-time verification, and single-use in-memory action tickets
- [x] CDP and Scripting adapters pass the same DOM/Shadow DOM/same-origin iframe capability matrix; visual fallback remains approval-bound
- [x] DeepSeek formal search smoke completes with one referenced GET search action, zero routine confirmations, a clean completion screenshot, and local finish
- [x] Atomic dispatch is pinned to the authorized tab/document; email and number inputs work in Chromium, file input is explicitly unsupported, and non-GET submit has zero pre-approval side effects
- [x] High-risk repeats remain blocked, direct model navigation requires an exact user-provided URL token, and unavailable observation pauses for retry/takeover/stop

## Repository and release controls

- [ ] Push the v2.9.0 release candidate and obtain green CI for its exact commit (the previous v2.8.0 receipt was commit `612559a32c00797b9d4150e0e662557f8079f86b`, [run 33312330526](https://github.com/vincent623/tutorial-recorder/actions/runs/33312330526))
- [x] Configure the `DEEPSEEK_API_KEY` repository secret; never paste it into workflow YAML, logs, issues, or artifacts
- [x] Protect `main`: require pull request, require `Deterministic Quality Gate`, block force pushes and deletion
- [x] Add a `v*` tag ruleset that blocks tag updates and deletion; published release assets are immutable
- [x] Protect the `production-release` environment with an authorized reviewer
- [ ] Choose and publish the product's source-code license and commercial terms; this is an owner/legal decision
- [x] Enable GitHub Private Vulnerability Reporting
- [ ] Record the final v2.9.0 ZIP SHA256, release commit, and GitHub Actions run URL in the v2.9.0 release notes (the [v2.8.0 release notes](https://github.com/vincent623/tutorial-recorder/releases/tag/v2.8.0) are historical evidence only)

## Store submission

- [ ] Confirm legal publisher name, support email, privacy contact, and target markets
- [x] Review the [privacy policy URL](https://vincent623.github.io/tutorial-recorder/privacy-policy-zh.html) from a logged-out browser
- [x] Deploy the v2.8 privacy text and verify the public page no longer claims that no user data is uploaded
- [ ] Complete Chrome Web Store and Edge Add-ons data-use declarations using the wording in `memory/store-listing.md`
- [ ] Provide current screenshots showing recording, workspace editing, AI consent, and high-risk action confirmation
- [ ] Verify install/update/uninstall on stable Chrome and Edge on at least macOS and Windows
- [ ] Perform a clean-profile smoke without AI and an opt-in smoke with a non-production test account
- [ ] Ensure no customer, employee, credential, or internal-system data appears in screenshots or demo videos

## Commercial operations

- [ ] Define pricing, refund, entitlement, and support policy outside the extension; this repository currently contains no billing or account backend
- [ ] Define incident owner, support SLA, release rollback owner, and model-provider outage policy
- [ ] Review third-party notices and source license with counsel before first paid distribution
- [ ] Archive store-review receipts, signed-off ZIP checksum, privacy-policy version, and release commit SHA
