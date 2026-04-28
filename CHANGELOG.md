# Changelog

All notable changes to **METU Mail Notifier** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

---

## [1.5.1] — 2026-04-28

### Added

- **Appearance (System / Light / Dark)** — popup theme preference is stored in `chrome.storage.local` (`appearanceTheme`); `popup/themeBoot.js` runs before `popup.css` so the first paint matches the saved or system theme without a flash.
- **Themed optional toast** — when overlay permission is granted, the in-page banner uses the same effective light/dark styling as your appearance choice (background passes preference into the content script).

### Changed

- **Popup** — layout and controls refresh, including an accessible segmented control for appearance and wiring to storage and system `prefers-color-scheme` updates.
- **Documentation** — README includes the Microsoft Edge Add-ons listing link and store-style banner (`docs/store-banner.png`); `PRIVACY_POLICY.md` notes the Edge Add-ons distribution channel and this version’s date.

---

## [1.5.0] — 2026-04-17

### Added

- **Popup INBOX unread + recent activity** — the popup shows the same persisted
  unread total as the toolbar badge while monitoring, plus a short capped list of
  non-identifying check outcomes (no subjects or senders).
- **Optional in-page toast** — you can grant access to **all websites** so
  the extension can show a short on-page banner on your active tab alongside
  Chrome notifications; native notifications always still fire. Grant or revoke
  from the popup when the extension is enabled.

### Changed

- **Service worker is now an ES module** — `background/background.js` is a small
  entry file; logic lives in focused modules for easier maintenance and testing.
- **Notifications** — new mail, “no new mail,” login reminders, and session
  expiry use `chrome.notifications` (OS-level) by default; optional overlay is
  additive when permitted.
- **Notification sound** — optional chimes play in a hidden **offscreen**
  extension page (short synthesized audio routed for reliable MV3 playback), not
  in arbitrary website tabs.
- **Toolbar badge** — shows INBOX unread count from the last successful list parse
  while monitoring (non-identifying integer only).
- **Popup** — clearer consent copy for optional overlay permission, improved
  accessibility (focus and `inert` when paused), layout polish, and **Open Inbox**
  in the header row.
- **Content script** — overlay UI built with DOM APIs and a closed Shadow root for
  isolation from host page styles (`overlayDom.js` + `content.js`).

### Fixed

- **Mail check on deceptive 200 responses** — treats login HTML and session edge
  cases more reliably before assuming the inbox JSON is valid.
- **Cold-start reconcile overlap** — `reconcileRuntimeState` is single-flight so
  the service worker’s initial reconcile and `runtime.onStartup` cannot
  interleave alarm repair work (avoids extra churn on Chrome / Edge wake timing).
- **Window focus after notification** — `windows` permission is declared so
  `chrome.windows.update` can focus the webmail window reliably; tab activation
  still runs even if focus fails.

---

## [1.4.1] — 2026-04-13

### Fixed

- **Service-worker race on cold wake** — added a read-only state fetch path so
  `reconcileRuntimeState` cannot overlap with itself when the worker wakes
  repeatedly; prevents duplicate reconciliation loops and keeps MV3 alarm alignment
  stable after suspension.
- **Toast layout vs. host CSS** — tightened Shadow DOM styling and isolation so
  strong or global rules on the host page cannot distort the in-page notification
  layout.
- **Web Audio autoplay timing** — notification audio now awaits
  `AudioContext.resume()` where needed and catches `NotAllowedError` so autoplay
  policy races no longer leave playback in a broken state.

### Added

- **GitHub link in popup footer** — footer control shows the installed version and
  opens the public repository in a new tab via `chrome.tabs.create` (no embedded
  content, no click tracking).

### Changed

- **Accessibility when paused** — the settings block and footer use the `inert`
  attribute while the extension is disabled so keyboard focus cannot escape into
  controls underneath the paused overlay; the header master toggle remains active.

---

## [1.4.0] — 2026-04-12

### Fixed

- **Service-worker state reset on wake** — `initializeStateMachine` unconditionally
  cleared `MAIL_CHECK_ALARM` on every worker evaluation, forcing a reset to auth flow
  and causing alarm churn. Replaced with `reconcileRuntimeState()`, which reads
  persisted `machineState` from `chrome.storage.local` and only repairs alarms when
  they are actually mismatched — a worker restart in Monitoring mode no longer drops
  back to auth-only polling.
- **Manual check returning undefined result** — stale-generation branches in
  `runAuthCheck` and `runMailCheck` returned a bare `return;`, causing the
  `MANUAL_CHECK` handler to call `ensureStateAlarms(undefined.state)`, wiping both
  alarms and corrupting state. All stale branches now return
  `makeResult(false, currentState, REASON.STALE_GENERATION)`. The handler is wrapped
  in `try/catch`, captures `stateBefore`, and guards `transitionToState` so it only
  fires on valid, non-stale, state-changing results.
- **Session expiry undetected when Roundcube returns HTML with 200 OK** — after
  session expiry the mail-list request received an HTML login page with HTTP 200;
  `response.json()` threw and the outer `catch` kept the extension in a false
  Monitoring state. `runMailCheck` now inspects `response.url` and `Content-Type`
  before any body read; if either indicates a login page the extension immediately
  transitions to STATE_1. The body is read once as text and parsed with
  `JSON.parse` inside `try/catch`; on failure `looksLikeRoundcubeLogin` provides a
  final login-marker check before falling back to an error result.
- **Status indicator stuck on "Checking…"** — several exit paths in `runAuthCheck`
  and `runMailCheck` returned without writing a terminal `extensionStatus`, leaving
  the popup spinner spinning indefinitely. Every post-`CHECKING` exit now writes one
  of `Monitoring`, `Logged out`, or `Error`. Specific paths corrected: auth success
  (missing `Monitoring`), HTTP non-401/403 network error (missing `Error`),
  token-unavailable below threshold (missing `Monitoring`), and empty exec response
  (missing `Monitoring`).

### Added

- **`transitionToState(nextState, reason)` gateway** — single function that owns all
  `chrome.alarms.create/clear` calls and all `machineState` writes to
  `chrome.storage.local`. No other code path mutates alarms or persisted state
  directly. Removed `ensureStateAlarms`, `ensureAuthCheckAlarm`,
  `ensureMailCheckAlarm`, and `clearAlarm` as separate public mutation paths.
- **`STORAGE_KEYS.machineState`** — persists the current state (`STATE_1`/`STATE_2`)
  across service-worker recycling so `reconcileRuntimeState` can restore the correct
  alarm on wake without resetting to auth flow.
- **`writeStaleCheckStatus()` helper** — stale-generation exits that fire after
  `CHECKING` was written derive the correct UI label (`Monitoring` or `Logged out`)
  from persisted `machineState` so the popup never remains on `Checking…` after a
  superseded check run.
- **`OPEN_INBOX` background message handler** — `openOrFocusInbox(targetUrl)` uses
  `chrome.tabs.query` to find an existing `webmail.metu.edu.tr` mail tab; if found
  it focuses the tab and its window via `chrome.tabs.update` /
  `chrome.windows.update`; otherwise opens a new tab with `chrome.tabs.create`.
- **`REASON.STALE_GENERATION`, `REASON.RUNTIME_RECONCILE`,
  `REASON.EXTENSION_DISABLED`** — new structured reason codes for the state gateway
  and stale-result paths.

### Changed

- **Popup spinner cleared via storage** — `manualCheckBtn`'s `spinning` class is now
  removed inside `updateStatusUI` whenever `extensionStatus.label` is not
  `Checking…`, in addition to the message-callback path. This prevents a stuck
  spinner if the background message callback is delayed or errors out.

### Security

- **Removed `window.open` from content script** — `window.open(inboxUrl, "_blank")`
  exposed a `window.opener` tabnabbing surface. Replaced with
  `chrome.runtime.sendMessage({ type: "OPEN_INBOX", url: inboxUrl })`, handled
  entirely in the background service worker.

---

## [1.3.1] — 2026-04-11

### Fixed

- **Empty inbox edge case** — when the mailbox contains no messages at all, a manual check now correctly shows the "no new emails" toast. The "Last checked" timestamp in the popup also updates correctly in this case. Previously the code returned early without updating state or showing any feedback.

---

## [1.3.0] — 2026-04-11

### Added

- **Manual Check Button** — added a refresh icon to the popup to instantly trigger a mail check.
- **Last Checked Time** — added a timestamp display in the popup showing the exact time of the last successful mail check.
- **Manual Check Feedback** — manually checking now provides a "You have no new emails" visual toast if the inbox is unchanged.

### Fixed

- **Toggle Switch Styling** — removed the red outline on UI toggles when they are in the "off" state for a cleaner neutral look.
- **Popup Markup** — fixed invalid nested `<label>` HTML structure in the popup.

---

## [1.2.0] — 2026-04-11

### Fixed

- **Login warning shown as OS notification on startup** — `showNotificationOverlay` now returns `true`/`false` to indicate whether the notification was actually delivered to a tab. Login and session-expired notifications no longer fall back to the native OS notification when no injectable tab is available (e.g. browser just started, only `chrome://newtab` is open). Instead, they return `false` and `runAuthCheck` skips marking `hasWarnedLogin: true`, so the next `auth_check` alarm (≤1 min later) retries delivery once a real tab exists. New-mail alerts continue to fall back to `chrome.notifications` as before.

---

## [1.1.0] — 2026-04-11

### Added

- **In-page toast notifications** — replaced the `chrome.windows` popup with a Shadow DOM overlay injected into the user's active tab via `chrome.scripting.executeScript`. The toast is fully isolated from the host page's CSS using `attachShadow({ mode: 'open' })`.
- **Notification sounds** — Web Audio API chimes synthesised on the fly (no audio files): ascending two-note sine chime for new mail; descending triangle-wave tone for session/login warnings.
- **Sound toggle** — enables or disables the audio chime from the popup.
- **Master enable/disable toggle** — pauses the entire extension (clears all alarms, stops checks) and resumes it instantly. Powered by a `chrome.storage.onChanged` listener in the service worker so changes take effect without a reload.
- **Disabled overlay** — a blurred overlay with a paused-state message covers the popup's settings section when the extension is disabled, matching the Cookie Guardian design pattern.
- **Native notification fallback** — when no injectable `http/https` tab is available (e.g. the only open tab is `chrome://newtab`), falls back to `chrome.notifications` for an OS-level notification.
- **Popup redesign** — adopted the Cookie Guardian Uber-inspired design system: system-ui font stack, `#000`/`#fff` neutrals, 8 px card radius, pill toggles, card shadow, section labels, option-list layout, and animated status toast chips.
- **Popup CSS split** — extracted all popup styles into a dedicated `popup.css` file.

### Fixed

- **Login-page detection false negative** — `looksLikeRoundcubeLogin` previously scanned only the first 2 000 characters of the inbox HTML response. METU Roundcube's `<head>` section pushes login-form markers beyond that cutoff. Fixed by removing the `.slice(0, 2000)` so the full body is checked.
- **Session expiry not detected in STATE_2** — after logout, the Roundcube mail-list API returns HTTP 200 with `exec` containing `this.session_error("/?_task=login&_err=session")` rather than `add_message_row(...)` entries. The old code treated this as an empty inbox. Fixed by checking the `exec` string for `session_error` or `_task=login` before looking for UIDs.

### Changed

- **Permissions** — added `scripting`, `tabs`, and `notifications`; removed `windows` (no longer used).
- **`host_permissions`** — added `<all_urls>` to allow toast injection into any active tab.
- **`manifest.json`** — version bumped to `1.1.0`; `icon.png` registered under `icons`.

---

## [1.0.0] — Initial release

### Added

- Two-state alarm-based check loop: `auth_check` (every 1 min) in STATE_1, `mail_check` (every 5 min) in STATE_2.
- Session detection via full-page fetch of `webmail.metu.edu.tr/?_task=mail&_mbox=INBOX` with `credentials: "include"`.
- CSRF token extraction from inbox HTML; mail-list API request using extracted token.
- New mail detection by comparing highest IMAP UID to `lastSeenId` in `chrome.storage.local`.
- Notification pop-up via `chrome.windows.create` (replaced in v1.1.0).
- Sound toggle stored in `chrome.storage.local`.
- Popup with sound toggle and status label.

---

**Source:** [github.com/ardatrkl35/METU-Mail-Notifier](https://github.com/ardatrkl35/METU-Mail-Notifier)
