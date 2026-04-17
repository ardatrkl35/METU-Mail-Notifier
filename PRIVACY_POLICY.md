# Privacy Policy — METU Mail Notifier

**Extension Name:** METU Mail Notifier  
**Version:** 1.5.0  
**Platform:** Google Chrome / Microsoft Edge (Manifest V3) — manual install  
**Last Updated:** April 17, 2026

---

## 1. Introduction

METU Mail Notifier is a browser extension that periodically checks the METU Roundcube webmail inbox (`webmail.metu.edu.tr`) and alerts you when new mail arrives or when you need to sign in again. **By default it uses your operating system’s native notifications** (`chrome.notifications`). If you choose to, you can also grant optional access so a short **in-page banner** can appear on your **active** tab — this never replaces the OS notification.

Its purpose is to save you from having to keep the webmail tab open all the time.

This Privacy Policy explains what data the extension accesses, how it uses that data, and your rights as a user. METU Mail Notifier is designed with a privacy-first architecture: **all processing happens locally on your device and no data is ever transmitted to external servers by the extension itself.**

---

## 2. Data Collection

**METU Mail Notifier does not collect, process, store, transmit, or share any personal data.**

No information about you, your identity, your email contents, or any content on the websites you visit is ever sent off your device by the extension.

The following table describes information the extension interacts with, where it comes from, and what happens to it:

| Data | Source | Purpose | Leaves your device? |
|---|---|---|---|
| Master enable/disable toggle state | You, via the popup | Turns the extension on or off; takes effect instantly | **No** |
| Notification sound toggle state | You, via the popup | Controls whether optional chimes play for certain OS notifications | **No** |
| `lastSeenId` (highest IMAP UID seen) | Computed from the webmail inbox response | Tracks which messages have already been notified so duplicates are not shown | **No** — stored only in `chrome.storage.local` |
| `unreadCount` (non-negative integer) | Derived from the last successful mail-list parse | Shown in the popup and toolbar badge while monitoring; **not** email content | **No** — stored only in `chrome.storage.local` |
| `popupActivityLog` (short capped list) | Written after checks | Non-identifying activity rows for the popup (“recent activity”); **no** subjects or senders | **No** — stored only in `chrome.storage.local` |
| `lastSuccessfulCheckTs` (timestamp) | Written after each successful mail check | Records when the last check completed; displayed in the popup UI | **No** — stored only in `chrome.storage.local` |
| `hasWarnedLogin` (boolean) | Written for migration compatibility; kept in sync with `lastLoginWarningTs` | Legacy flag retained so older installs remain consistent with throttled login-reminder logic | **No** — stored only in `chrome.storage.local` |
| `lastLoginWarningTs` (timestamp) | Written when a login reminder is shown | Throttles repeated “please log in” notifications (minimum interval between reminders) | **No** — stored only in `chrome.storage.local` |
| `extensionStatus` (object: label, detail, timestamp) | Written after each check cycle | Supplies the current status label and detail text shown in the popup UI | **No** — stored only in `chrome.storage.local` |
| `machineState` (`STATE_1` or `STATE_2`) | Written on state transitions | Persists the state-machine phase so the worker can resume correctly after sleep | **No** — stored only in `chrome.storage.local` |
| `tokenUnavailableCount`, `staleAuthDiscardCount`, `staleMailDiscardCount` | Internal counters | Robustness around token extraction and superseded check runs | **No** — stored only in `chrome.storage.local` |
| `verboseDebugLogs` (boolean) | Optional developer-oriented setting | When enabled, emits more detailed **local** logs only; no remote logging | **No** |
| Roundcube `_token` value | Extracted from the webmail inbox HTML page | Required as a CSRF parameter in the mail-list API request | **No** — held only in service-worker memory; discarded when the service worker is recycled |
| Webmail inbox HTML response | Fetched from `webmail.metu.edu.tr` | Parsed locally to detect login state and extract the session token | **No** — read-only, never stored or transmitted beyond the extension |
| Webmail mail-list JSON response | Fetched from `webmail.metu.edu.tr` | Parsed locally to extract message UIDs / unread totals and detect session expiry | **No** — read-only, never stored or transmitted beyond the extension |
| Webmail cookie **names** (and presence of values) via `chrome.cookies.getAll` | Browser cookie jar for `webmail.metu.edu.tr` | Lightweight session gate before network probes (e.g. presence of typical Roundcube session cookies) | **No** — used only inside the extension; **not** uploaded by the extension |

### What is Explicitly NOT Collected

- Email subjects, senders, recipients, or body content  
- Browsing history outside what the browser exposes for the active tab when you **opt in** to optional overlay injection (the extension does not read page text, forms, or passwords)  
- Full URLs stored or transmitted by the extension  
- Passwords, credentials, or any form data  
- Any personally identifiable information (PII) beyond what your browser already has for METU webmail  
- Device identifiers  
- IP addresses  
- Telemetry or usage analytics  

---

## 3. How Settings Are Stored

METU Mail Notifier uses only **`chrome.storage.local`** — all data stays entirely on your device and is not synced across devices by the extension:

1. **`extensionEnabled`** — `true` or `false` from the master toggle in the popup. Determines whether the extension runs its alarm-based check loop.

2. **`playNotificationSound`** — `true` or `false` from the sound toggle in the popup. Controls whether optional chimes play for selected OS notifications (see in-product copy for which events include sound).

3. **`lastSeenId`** — the highest Roundcube IMAP UID observed in the last successful inbox check. Used to compute whether new messages have arrived since the previous check. Never contains email content.

4. **`unreadCount`** — a non-negative integer from the last successful list parse, used for the popup and toolbar badge. Not message bodies or metadata.

5. **`popupActivityLog`** — a short, capped list of structured rows (`ts`, `type`, optional `n`) describing recent outcomes (e.g. new mail, no new mail, session lost). **No** subjects or senders.

6. **`lastSuccessfulCheckTs`** — a Unix timestamp (ms) written after each successful mail-list response. Displayed in the popup UI.

7. **`hasWarnedLogin`** — a boolean kept for migration compatibility and updated in sync with **`lastLoginWarningTs`**.

8. **`lastLoginWarningTs`** — a Unix timestamp (ms) recording when the last “please log in” reminder was shown. Used to throttle reminders while you are logged out.

9. **`extensionStatus`** — a small object (`label`, optional `detail`, `ts`) written after checks complete so the popup can display status text.

10. **`machineState`** — either `STATE_1` or `STATE_2`, persisted whenever the check loop transitions between logged-out and logged-in phases.

11. **`tokenUnavailableCount`**, **`staleAuthDiscardCount`**, **`staleMailDiscardCount`** — small internal counters for robustness.

12. **`verboseDebugLogs`** — optional flag for richer **local** logging only.

---

## 4. Network Requests Made by the Extension

The extension makes exactly **two types of network requests**, both exclusively to `webmail.metu.edu.tr`, and only when the extension is enabled:

1. **Inbox page probe** (`GET` the Roundcube mail inbox URL on `webmail.metu.edu.tr`) — fetched with `credentials: "include"` to determine whether your session cookie is valid. The response HTML is read locally to check for login-page markers and to extract the Roundcube CSRF token. The HTML is never stored or forwarded.

2. **Mail-list API request** (`GET` Roundcube list action on `webmail.metu.edu.tr`) — fetched with `credentials: "include"` once a valid session token is available. The JSON response is parsed locally to extract message UIDs / counts. No email content (subjects, senders, bodies) is read by the extension.

No requests are ever made to any server other than `webmail.metu.edu.tr` for mail checking. No analytics, telemetry, or third-party network calls are made for core functionality.

---

## 5. Permissions — Justification for Each

The following permissions are declared in `manifest.json`. Each one is required for a specific, functional reason:

### `alarms`

**Why it is needed:** The extension uses `chrome.alarms` to schedule periodic checks — every 1 minute while waiting for a login, and every 5 minutes once logged in. Alarms are the correct MV3 mechanism for background work that must survive service-worker sleep cycles.

### `storage`

**Why it is needed:** Required to read and write the local storage keys described in Section 3 via `chrome.storage.local`.

### `scripting`

**Why it is needed:** Required by Manifest V3 to inject the extension’s own content scripts when you have granted optional overlay permission, so a short banner can appear on your active tab. Injection is tied to notification delivery — not a persistent blanket injection on every site.

### `tabs`

**Why it is needed:** Used to query the active tab for optional overlay injection, to find or open METU webmail tabs (`chrome.tabs.query` / `chrome.tabs.create` / `chrome.tabs.update`), and to open the public GitHub repository from the popup footer (`chrome.tabs.create`) — ordinary HTTPS navigation; nothing is logged or transmitted about that action by the extension.

### `windows`

**Why it is needed:** Used to focus the browser window that contains METU webmail when bringing an existing inbox tab to the front after a notification interaction, improving reliability when multiple windows are open.

### `notifications`

**Why it is needed:** Used to show **native OS-level notifications** for new mail, manual “no new mail,” login reminders, and session expiry — the default user-visible alert path.

### `offscreen`

**Why it is needed:** Used to create a minimal hidden extension page that plays **optional** notification chimes in an extension-controlled context (AUDIO_PLAYBACK), consistent with MV3 service worker constraints.

### `cookies`

**Why it is needed:** Used to read **cookie names and values for `webmail.metu.edu.tr` only** via `chrome.cookies.getAll` as a lightweight local gate before fetching the inbox page. Cookie data is **not** sent to external servers by the extension.

### `host_permissions: https://webmail.metu.edu.tr/*`

**Why it is needed:** Required to make credentialed `fetch` requests to METU webmail from the service worker and to scope cookie reads to that origin.

### `optional_host_permissions: <all_urls>`

**Why it is needed:** This is **not** granted automatically at install. The browser only activates it if you explicitly approve it (for example via the in-extension control that enables the optional in-page toast). Once granted, it allows injecting the extension’s own overlay script into the **active** tab’s page when a notification is shown. The overlay does not read, transmit, or scrape host page content.

---

## 6. Third-Party Services & External Requests

METU Mail Notifier makes **no automated requests to any external server, API, or third-party service** for mail-check functionality.

All **automatic** network activity for checking mail is limited to `webmail.metu.edu.tr` as described in Section 4. No analytics SDKs, tracking pixels, advertising networks, or remote logging services of any kind are included in or used by this extension for that purpose.

If you **voluntarily** open the project’s GitHub page from the popup footer, your browser loads that site under its own terms — the extension only issues a standard tab open to the public repository URL; it does not embed GitHub, fingerprint you, or record that you clicked.

---

## 7. Data Sharing & Sale

METU Mail Notifier does not share, sell, rent, trade, or otherwise disclose any user data to any third party, because no user data is collected in the first place.

---

## 8. Data Security

Because METU Mail Notifier stores only a small set of preference/state values locally on your device and transmits nothing externally for mail checks, the security surface area is minimal by design. Local state is stored using the browser’s native, sandboxed `chrome.storage.local` API and is protected by the browser’s security model and your OS user account. It is not accessible to ordinary web pages or other extensions.

The Roundcube CSRF token is held only in service-worker memory and is not written to `chrome.storage.local`. It is discarded automatically when the service worker is recycled by the browser.

---

## 9. Children's Privacy

METU Mail Notifier does not knowingly collect any information from anyone. Because no personal data is collected at all, the extension poses no material privacy risk to minors from extension-side collection.

---

## 10. Changes to This Privacy Policy

If a future update to METU Mail Notifier introduces any material change to how data is handled, this Privacy Policy will be updated accordingly and the “Last Updated” date at the top of this document will be revised. Significant changes will be noted in `CHANGELOG.md`.

---

## 11. Your Rights (GDPR & Applicable Law)

If you are located in the European Economic Area (EEA), the United Kingdom, or another jurisdiction with applicable data protection law, you have the right to access, correct, or delete any personal data held about you. **Since METU Mail Notifier does not collect or store personal data in a remote database operated by the extension, there is no such off-device dataset to access, correct, or delete.**

To remove all data stored by the extension on your device:

1. Open the browser’s DevTools on any page, open the **Application** tab, navigate to **Extension Storage → Local**, and delete the keys the extension uses, or  
2. Uninstall METU Mail Notifier — this will remove locally stored extension state.

---

## 12. Contact

If you have any questions or concerns about this Privacy Policy or the behaviour of METU Mail Notifier, please contact:

**Developer / Publisher:** METU Mail Notifier  
**Email:** `arda.ege.turkeli@gmail.com`  
**Bug reports:** [github.com/ardatrkl35/METU-Mail-Notifier/issues](https://github.com/ardatrkl35/METU-Mail-Notifier/issues)

---

*This privacy policy was written in good faith to comply with the General Data Protection Regulation (GDPR — EU 2016/679) and the UK Data Protection Act 2018.*
