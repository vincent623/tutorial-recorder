# Security Policy

## Supported versions

Security fixes are provided for the latest published release only. Users should upgrade before reporting an issue that is already fixed on `main`.

## Reporting a vulnerability

Do not publish credentials, private screenshots, exported tutorials, or vulnerability details in a public issue.

Use GitHub Private Vulnerability Reporting for this repository. If that channel is unavailable, contact the developer through the address shown on the Chrome Web Store or Edge Add-ons listing and include only the minimum reproduction information. Never include a real AI API key.

Reports should include the affected version, browser version, impact, reproduction steps, and whether AI screenshot sharing or CDP automation was enabled. We will acknowledge a complete report within five business days and coordinate disclosure after a fix is available.

## Security boundaries

- AI screenshot sharing is opt-in and can be revoked in settings.
- API keys remain in extension-owned `chrome.storage.local`, restricted to trusted extension contexts. They must not appear in logs, exports, IndexedDB, screenshots, or CI artifacts.
- High-impact AI actions require one-time user approval. Approval never applies to later actions.
- The debugger must detach after stop, failure, takeover, or task completion.
