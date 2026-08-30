# Commercial Release Checklist

This checklist separates code readiness from external publication evidence. A release is commercially ready only when every blocking item has a current receipt for the exact release commit.

## Automated gates

- [x] Syntax, regression, scale, dependency-cycle, and reproducible-package checks
- [x] Real Chromium extension E2E with exported artifact inspection
- [x] Provider-backed DeepSeek vision smoke isolated from deterministic CI
- [x] Tag/version equality and SHA256 verification before GitHub Release
- [x] GitHub Actions pinned to immutable commits with read-only default token permissions
- [x] AI screenshot sharing explicit opt-in
- [x] One-time confirmation for destructive clicks, coordinate fallback, Enter submission, and cross-origin navigation
- [x] Visible-history retention also removes IndexedDB recording and asset payloads through a crash-recoverable cleanup queue

## Repository and release controls

- [ ] Push the release candidate and obtain green CI for the exact commit SHA
- [ ] Configure the `DEEPSEEK_API_KEY` repository secret; never paste it into workflow YAML, logs, issues, or artifacts
- [ ] Protect `main`: require pull request, require `Deterministic Quality Gate`, block force pushes and deletion
- [ ] Add a `v*` tag ruleset that blocks tag updates and deletion; published release assets are immutable
- [ ] Protect the `production-release` environment with an authorized reviewer
- [ ] Choose and publish the product's source-code license and commercial terms; this is an owner/legal decision
- [ ] Enable GitHub Private Vulnerability Reporting
- [ ] Record the final ZIP SHA256 and GitHub Actions run URL in the release notes

## Store submission

- [ ] Confirm legal publisher name, support email, privacy contact, and target markets
- [ ] Review the privacy policy URL from a logged-out browser
- [ ] Deploy the v2.8 privacy text before submission and verify the public page no longer claims that no user data is uploaded
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
