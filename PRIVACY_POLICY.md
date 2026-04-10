# Privacy Policy — METU Mail Notifier

**Extension Name:** METU Mail Notifier  
**Version:** 1.1.0  
**Platform:** Google Chrome / Microsoft Edge (Manifest V3) — manual install  
**Last Updated:** April 11, 2026  

---

## 1. Introduction

METU Mail Notifier is a browser extension that periodically checks the METU Roundcube webmail inbox (`webmail.metu.edu.tr`) and shows an in-page notification when new emails arrive or when your session has expired. Its sole purpose is to save you from having to keep the webmail tab open all the time.

This Privacy Policy explains what data the extension accesses, how it uses that data, and your rights as a user. METU Mail Notifier is designed from the ground up with a privacy-first architecture: **all processing happens locally on your device and no data is ever transmitted to external servers by the extension itself.**

---

## 2. Data Collection

**METU Mail Notifier does not collect, process, store, transmit, or share any personal data.**

No information about you, your identity, your email contents, or any content on the websites you visit is ever sent off your device by the extension.

The following table describes every piece of information the extension interacts with, where it comes from, and what happens to it:

| Data | Source | Purpose | Leaves your device? |
|---|---|---|---|
| Master enable/disable toggle state | You, via the popup | Turns the extension on or off; takes effect instantly | **No** |
| Notification sound toggle state | You, via the popup | Controls whether a chime plays when a notification appears | **No** |
| `lastSeenId` (highest IMAP UID seen) | Computed from the webmail inbox response | Tracks which messages have already been notified so duplicates are not shown | **No** — stored only in `chrome.storage.local` |
| `lastSuccessfulCheckTs` (timestamp) | Written after each successful mail check | Records when the last check completed; not currently surfaced in the UI | **No** — stored only in `chrome.storage.local` |
| `hasWarnedLogin` (boolean) | Written when the "please log in" notification has been shown | Prevents showing the login warning repeatedly | **No** — stored only in `chrome.storage.local` |
| Roundcube `_token` value | Extracted from the webmail inbox HTML page | Required as a CSRF parameter in the mail-list API request | **No** — held only in service-worker memory; discarded when the service worker is recycled |
| Webmail inbox HTML response | Fetched from `webmail.metu.edu.tr` | Parsed locally to detect login state and extract the session token | **No** — read-only, never stored or transmitted beyond the extension |
| Webmail mail-list JSON response | Fetched from `webmail.metu.edu.tr` | Parsed locally to count message IDs and detect session expiry | **No** — read-only, never stored or transmitted beyond the extension |

### What is explicitly NOT collected

- Email subjects, senders, recipients, or body content  
- Browsing history outside `webmail.metu.edu.tr`  
- Full URLs visited on any site  
- Passwords, credentials, or any form data  
- Any personally identifiable information (PII)  
- Device identifiers  
- IP addresses  
- Telemetry or usage analytics  

---

## 3. How Settings Are Stored

METU Mail Notifier uses only **`chrome.storage.local`** — all data stays entirely on your device and is never synced across devices by the extension:

1. **`extensionEnabled`** — `true` or `false` from the master toggle in the popup. Determines whether the extension runs its alarm-based check loop.

2. **`playNotificationSound`** — `true` or `false` from the sound toggle in the popup. Controls whether an audio chime is played through the Web Audio API when a notification toast appears.

3. **`lastSeenId`** — the highest Roundcube IMAP UID observed in the last successful inbox check. Used to compute whether new messages have arrived since the previous check. Never contains email content.

4. **`lastSuccessfulCheckTs`** — a Unix timestamp (ms) written after each successful mail-list response. Reserved for future diagnostic use.

5. **`hasWarnedLogin`** — a boolean that becomes `true` after the "please log in" one-time notification has been shown, preventing repeated alerts while you are logged out.

---

## 4. Network Requests Made by the Extension

The extension makes exactly **two types of network requests**, both exclusively to `webmail.metu.edu.tr`, and only when the extension is enabled:

1. **Inbox page probe** (`GET https://webmail.metu.edu.tr/?_task=mail&_mbox=INBOX`) — fetched with `credentials: "include"` to determine whether your session cookie is valid. The response HTML is read locally to check for login-page markers and to extract the Roundcube CSRF token. The HTML is never stored or forwarded.

2. **Mail-list API request** (`GET https://webmail.metu.edu.tr/?_task=mail&_action=list&...`) — fetched with `credentials: "include"` once a valid session token is available. The JSON response is parsed locally to extract message UIDs. No email content (subjects, senders, bodies) is included in this response or read by the extension.

No requests are ever made to any server other than `webmail.metu.edu.tr`. No analytics, telemetry, or third-party network calls are made.

---

## 5. Permissions — Justification for Each

The following permissions are declared in `manifest.json`. Each one is required for a specific, functional reason:

### `alarms`
**Why it is needed:** The extension uses `chrome.alarms` to schedule periodic checks — every 1 minute while waiting for a login, and every 5 minutes once logged in. Alarms are the correct MV3 mechanism for background work that must survive service-worker sleep cycles.

### `storage`
**Why it is needed:** Required to read and write the five local storage keys described in Section 3 (`extensionEnabled`, `playNotificationSound`, `lastSeenId`, `lastSuccessfulCheckTs`, `hasWarnedLogin`) via `chrome.storage.local`.

### `scripting`
**Why it is needed:** Required by Manifest V3 to dynamically inject `content.js` into the currently active browser tab when a notification needs to be displayed. The content script creates a Shadow DOM toast overlay and plays the Web Audio chime. It is injected on-demand only — not persistently on every page.

### `tabs`
**Why it is needed:** Used by the background service worker to query the currently active tab (`chrome.tabs.query`) so the notification overlay can be injected into it via `chrome.scripting.executeScript`.

### `notifications`
**Why it is needed:** Used as a fallback when no injectable tab is available (e.g. when the only open tab is a `chrome://` page). In that case a native OS notification is shown instead of the in-page overlay.

### `host_permissions: *://webmail.metu.edu.tr/*`
**Why it is needed:** Required to make credentialed `fetch` requests to `webmail.metu.edu.tr` from the service worker. Without this permission the browser would block the requests.

### `host_permissions: <all_urls>`
**Why it is needed:** Required to inject the notification content script into whichever tab the user is currently viewing, regardless of what website they are on. The content script only creates a toast overlay and plays a sound — it does not read, transmit, or interact with the host page's content in any way.

---

## 6. Third-Party Services & External Requests

METU Mail Notifier makes **no requests to any external server, API, or third-party service.**

All network activity is limited to `webmail.metu.edu.tr` as described in Section 4. No analytics SDKs, tracking pixels, advertising networks, or remote logging services of any kind are included in or used by this extension.

---

## 7. Data Sharing & Sale

METU Mail Notifier does not share, sell, rent, trade, or otherwise disclose any user data to any third party, because no user data is collected in the first place.

---

## 8. Data Security

Because METU Mail Notifier stores only five small preference/state values locally on your device and transmits nothing externally, the security surface area is minimal by design. All data is stored using the browser's native, sandboxed `chrome.storage.local` API and is protected by the browser's own security model and your OS user account. The storage is not accessible to web pages or other extensions.

The Roundcube CSRF token is held only in service-worker memory and is never written to disk. It is discarded automatically when the service worker is recycled by the browser.

---

## 9. Children's Privacy

METU Mail Notifier does not knowingly collect any information from anyone. Because no personal data is collected at all, the extension poses no risk to the privacy of minors.

---

## 10. Changes to This Privacy Policy

If a future update to METU Mail Notifier introduces any material change to how data is handled, this Privacy Policy will be updated accordingly and the "Last Updated" date at the top of this document will be revised. Significant changes will be noted in `CHANGELOG.md`.

---

## 11. Your Rights (GDPR & Applicable Law)

If you are located in the European Economic Area (EEA), the United Kingdom, or another jurisdiction with applicable data protection law, you have the right to access, correct, or delete any personal data held about you. **Since METU Mail Notifier does not collect or store any personal data, there is no personal data to access, correct, or delete.**

To remove all data stored by the extension:

1. Open the browser's DevTools on any page, open the **Application** tab, navigate to **Extension Storage → Local**, and delete any of the keys (`extensionEnabled`, `playNotificationSound`, `lastSeenId`, `lastSuccessfulCheckTs`, `hasWarnedLogin`), or  
2. Uninstall METU Mail Notifier — this will remove all locally stored state.

---

## 12. Contact

If you have any questions or concerns about this Privacy Policy or the behaviour of METU Mail Notifier, please contact:

**Developer / Publisher:** METU Mail Notifier  
**Email:** `arda.ege.turkeli@gmail.com`  
**Bug reports:** [github.com/ardatrkl35/METU-Mail-Notifier/issues](https://github.com/ardatrkl35/METU-Mail-Notifier/issues)  

---

*This privacy policy was written in good faith to comply with the General Data Protection Regulation (GDPR — EU 2016/679) and the UK Data Protection Act 2018.*
