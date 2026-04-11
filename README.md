# ✉️ METU Mail Notifier

> Quietly checks your METU Roundcube inbox and shows an in-page notification the moment new email arrives — no tab switching required.

![Version](https://img.shields.io/badge/version-1.3.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-brightgreen)
![Platform](https://img.shields.io/badge/platform-Edge_%2F_Chrome-0078D4)
![License](https://img.shields.io/badge/license-MIT-lightgrey)
![Privacy](https://img.shields.io/badge/data_collected-none-success)

**Repository:** [github.com/ardatrkl35/METU-Mail-Notifier](https://github.com/ardatrkl35/METU-Mail-Notifier)

---

## What It Does

METU Mail Notifier runs a two-state check loop in the background:

| State | What happens |
|---|---|
| **STATE_1 — Logged out** | Probes the webmail inbox page every minute. When a valid session is detected, transitions to STATE_2. If no session exists, shows a one-time "please log in" toast. |
| **STATE_2 — Logged in** | Calls the Roundcube mail-list API every 5 minutes. Compares message UIDs to detect new mail and shows a notification. Detects session expiry and transitions back to STATE_1. |

---

## Features

- **In-page toast notifications** — a styled overlay appears in the corner of whatever page you are viewing; no new windows, no OS popups by default
- **Two notification sounds** — ascending chime for new mail, descending tone for login/session warnings (Web Audio API, no audio files needed)
- **Sound toggle** — enable or disable notification sounds from the popup
- **Master enable/disable toggle** — pause the entire extension with one click; the check loop stops and resumes instantly
- **Manual check** — instantly check for new mail at the click of a button in the popup, with visual feedback
- **Last checked time** — displays the exact time of the last successful background check in the popup
- **Session expiry detection** — detects logout via URL redirect, login-page HTML markers, and Roundcube's `session_error` exec response
- **Graceful fallback** — if no injectable tab is available, new-mail notifications fall back to a native OS notification; login/session warnings silently retry on the next alarm cycle instead (they are not actionable from an OS popup)
- **Shadow DOM isolation** — the in-page toast is rendered inside a Shadow Root so it never conflicts with the host page's CSS
- **Auto-dismiss** — toasts dismiss automatically after 30 seconds with an animated countdown bar
- **Zero data collection** — nothing leaves your device, ever

---

## Popup Settings

| Setting | What it does | Storage |
|---|---|---|
| **Extension Enabled** (header toggle) | Master switch — when off, all alarms are cleared and checking stops | `chrome.storage.local` |
| **Notification Sound** | Play a chime when a notification toast appears | `chrome.storage.local` |
| **Last checked** & **Refresh icon** | Displays the timestamp of the last successful check; clicking the icon checks for mail immediately | `chrome.storage.local` |

---

## How It Works

```
 ┌──────────────┐  Toggle / options  ┌────────────────────┐
 │  Popup UI    │ ──────────────────► │  chrome.storage    │
 │  popup.js    │  (auto-save)        │       .local       │
 └──────┬───────┘                     └────────────────────┘
        │ storage.onChanged                    │ get()
        ▼                                      ▼
 ┌──────────────────┐              ┌──────────────────────────┐
 │ Service Worker   │              │     background.js        │
 │ background.js    │              │                          │
 │                  │              │  1. initializeStateMachine│
 │  chrome.alarms   │              │     clearAlarm(mail_check)│
 │  auth_check (1m) │              │     ensureAuthCheckAlarm  │
 │  mail_check (5m) │              │                          │
 └──────┬───────────┘              │  2. runAuthCheck()        │
        │ alarm fired              │     probeInboxPage()      │
        ▼                          │     → detect login page   │
 ┌──────────────────────────────┐  │     → extract RC token    │
 │ STATE_1: auth_check alarm    │  │     transition → STATE_2  │
 │   probeSessionInvalid()      │  │                          │
 │   if invalid → notify login  │  │  3. runMailCheck()        │
 │   if valid   → STATE_2       │  │     fetch mail-list API   │
 └──────────────────────────────┘  │     compare UIDs          │
                                   │     → notify new mail     │
 ┌──────────────────────────────┐  │     detect session_error  │
 │ STATE_2: mail_check alarm    │  │     → transition STATE_1  │
 │   fetchMailList()            │  └──────────────────────────┘
 │   compareUIDs()              │
 │   if new mail → notify       │  ┌──────────────────────────┐
 │   if session_error → STATE_1 │  │     content.js           │
 └──────────────────────────────┘  │  (injected on demand)    │
                                   │                          │
                                   │  Shadow DOM toast overlay │
                                   │  Web Audio chime          │
                                   │  Open Inbox / Dismiss     │
                                   └──────────────────────────┘
```

### Step by step

1. On install or browser startup, `initializeStateMachine` clears any stale `mail_check` alarm and creates an `auth_check` alarm (fires every 1 minute).
2. `runAuthCheck` fetches the inbox page with `credentials: "include"`. If the response contains login-page markers (`_task=login`, `name="_user"`, etc. — checked across the **full** body), the session is invalid.
3. Once a valid session is detected, the CSRF token is extracted from the inbox HTML, `auth_check` is replaced by a `mail_check` alarm (fires every 5 minutes), and the state machine moves to STATE_2.
4. `runMailCheck` calls the Roundcube mail-list API. The `exec` field of the JSON response is checked for `session_error` (session expired) before looking for `add_message_row(UID, ...)` entries.
5. New message UIDs are compared to `lastSeenId` in storage. If any UID is higher, a notification is shown and `lastSeenId` is updated.
6. Notifications are delivered by injecting `content.js` into the active tab via `chrome.scripting.executeScript`, then sending a message. If no injectable tab exists, new-mail alerts fall back to `chrome.notifications` (OS popup); login/session warnings instead return `false` so `hasWarnedLogin` is not marked as sent and the next alarm cycle retries delivery.
7. The master toggle and sound preference are written to `chrome.storage.local`. A `storage.onChanged` listener in the service worker starts or stops the state machine instantly when `extensionEnabled` changes.

---

## Notification Toasts

Toasts appear in the **bottom-right corner** of the page you are currently viewing.

| Kind | Accent colour | Sound |
|---|---|---|
| New mail | Green (`#2e7d32`) | Ascending two-note chime (C5 → E5, sine) |
| Session expired / not logged in | Red (`#c62828`) | Descending two-note tone (E4 → C4, triangle) |

- Auto-dismisses after **30 seconds** with a countdown progress bar.
- **Open Inbox** — opens `webmail.metu.edu.tr` in a new tab.
- **Dismiss** — removes the toast immediately.
- Rendered in a **Shadow Root** — completely isolated from the host page's styles.

---

## Installation (Manual / Developer Mode)

1. **Download or clone** this repository:
   ```bash
   git clone https://github.com/ardatrkl35/METU-Mail-Notifier.git
   ```

2. Open **Chrome** and navigate to `chrome://extensions/`  
   *(For Edge, navigate to `edge://extensions/`)*

3. Enable **Developer Mode** using the toggle in the top-right corner.

4. Click **Load unpacked** and select the cloned **`METU-Mail-Notifier`** folder (or whatever you renamed it to).

5. The ✉️ icon will appear in your toolbar. Click it to configure settings.

6. **Log in** to [webmail.metu.edu.tr](https://webmail.metu.edu.tr) in the same browser profile. The extension will detect your session within one minute.

---

## Usage

1. Click the **METU Mail** icon in your browser toolbar.
2. Use the **Extension Enabled** toggle in the header to pause or resume checking.
3. Toggle **Notification Sound** to enable or disable the audio chime.
4. Keep a browser window open — the service worker needs the browser running to fire alarms.

> **Tip:** The extension only needs one browser window open anywhere. It does not require the webmail tab to be open.

---

## Project Structure

```
METU-Mail-Notifier/
├── manifest.json              # Extension manifest (MV3)
├── .gitignore
├── LICENSE
├── README.md                  # This file
├── CHANGELOG.md               # Version history
├── PRIVACY_POLICY.md          # Full privacy policy
├── icons/
│   └── icon.png               # Extension icon (128×128)
├── background/
│   └── background.js          # Service worker — state machine, fetch, alarm logic
├── content/
│   └── content.js             # Content script — Shadow DOM toast, Web Audio chime
└── popup/
    ├── popup.html             # Toolbar popup markup
    ├── popup.css              # Popup styles (Cookie Guardian design system)
    └── popup.js               # Popup logic — toggles, storage, disabled overlay
```

---

## Privacy

METU Mail Notifier collects **no personal data whatsoever.**

- All processing is local to your device.
- The only network requests made are to `webmail.metu.edu.tr`, using your existing browser session cookie — the same requests your browser would make if you had the tab open.
- No email content (subjects, senders, bodies) is ever read, stored, or transmitted. Only message UIDs (integers) are compared.
- No browsing data, analytics, or telemetry are ever collected or transmitted.

See [`PRIVACY_POLICY.md`](./PRIVACY_POLICY.md) for the full policy.

---

## Permissions Explained

| Permission | Reason |
|---|---|
| `alarms` | Schedule periodic auth and mail checks that survive service-worker sleep |
| `storage` | Save and read the five local state/preference keys |
| `scripting` | Inject `content.js` on-demand into the active tab to show the toast overlay |
| `tabs` | Query the active tab so the toast can be injected into the right page |
| `notifications` | Fallback OS notification when no injectable tab is available |
| `host_permissions: *://webmail.metu.edu.tr/*` | Make credentialed fetch requests to the METU webmail server |
| `host_permissions: <all_urls>` | Inject the notification toast into whichever tab is currently active |

---

## Browser Compatibility

| Browser | Status |
|---|---|
| Google Chrome | Fully supported |
| Microsoft Edge (Chromium) | Fully supported |
| Brave, Opera, Vivaldi | Compatible (Chromium-based) |
| Firefox | Not supported (requires MV2 port) |
| Safari | Not supported |

---

## Known Limitations

- The extension requires the **browser to be running** — alarms do not fire when the browser is closed.
- The extension uses your browser's existing session cookie for `webmail.metu.edu.tr`. It does not store or handle your METU credentials.
- If the browser restricts background service-worker wake-ups (e.g. after extended idle), the check interval may be delayed beyond the nominal 1/5-minute targets.

---

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for the full version history.

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

---

*METU Mail Notifier v1.3.0 · MV3 · Chrome / Edge · April 11, 2026*
