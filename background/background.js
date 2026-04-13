const AUTH_CHECK_ALARM = "auth_check";
const MAIL_CHECK_ALARM = "mail_check";
const AUTH_CHECK_INTERVAL_MINUTES = 1;
const MAIL_CHECK_INTERVAL_MINUTES = 5;
const BASE_URL = "https://webmail.metu.edu.tr/";
const INBOX_URL = "https://webmail.metu.edu.tr/?_task=mail&_mbox=INBOX";
// OVERLAY_AUTO_CLOSE_MS removed — unused constant (overlay close handled by content script)
const MAIL_NOTIFICATION_ID = 'metumail-new-mail';
const LOGIN_NOTIFICATION_ID = 'metumail-login-required';

const STORAGE_KEYS = {
  extensionEnabled:      "extensionEnabled",
  hasWarnedLogin:        "hasWarnedLogin",       // keep during migration — A5 reads old value on first load
  lastLoginWarningTs:    "lastLoginWarningTs",
  lastSeenId:            "lastSeenId",
  playNotificationSound: "playNotificationSound",
  lastSuccessfulCheckTs: "lastSuccessfulCheckTs",
  machineState:          "machineState",
};

const LOGIN_WARNING_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const AUTH_STATE = Object.freeze({
  AUTHENTICATED:   'AUTHENTICATED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  UNKNOWN:         'UNKNOWN',
});

const AUTH_REASON = Object.freeze({
  TOKEN_FOUND:          'token_found',
  TOKEN_MISSING:        'token_missing',
  LOGIN_MARKERS_FOUND:  'login_markers_found',
  LOGIN_REDIRECT:       'login_redirect',
  HTTP_ERROR:           'http_error',
  NETWORK_ERROR:        'network_error',
  TIMEOUT:              'timeout',
});

const REASON = Object.freeze({
  NEW_MAIL:            'new_mail',
  NO_NEW_MAIL:         'no_new_mail',
  LOGIN_REQUIRED:      'login_required',
  NETWORK_ERROR:       'network_error',
  SKIPPED_IN_PROGRESS: 'skipped_in_progress',
  TOKEN_UNAVAILABLE:   'token_unavailable',
  UNKNOWN_ERROR:       'unknown_error',
  STALE_GENERATION:    'stale_generation',
  RUNTIME_RECONCILE:   'runtime_reconcile',
  EXTENSION_DISABLED:  'extension_disabled',
});

const STATUS = Object.freeze({
  PAUSED:     'Paused',
  CHECKING:   'Checking...',
  LOGGED_OUT: 'Logged out',
  MONITORING: 'Monitoring',
  ERROR:      'Error',
});

async function writeStatus(label, detail = '') {
  await chrome.storage.local.set({
    extensionStatus: { label, detail, ts: Date.now() }
  });
}

/** After CHECKING was written, stale-generation exits must not leave the UI on "Checking...". */
async function writeStaleCheckStatus() {
  const stored = await getStorage([STORAGE_KEYS.machineState]);
  const persisted = stored[STORAGE_KEYS.machineState] === 'STATE_2' ? 'STATE_2' : 'STATE_1';
  const label = persisted === 'STATE_2' ? STATUS.MONITORING : STATUS.LOGGED_OUT;
  await writeStatus(label, '');
}

function isRoundcubeMailTabUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== 'webmail.metu.edu.tr') return false;
    return u.searchParams.get('_task') === 'mail';
  } catch (_) {
    return false;
  }
}

async function openOrFocusInbox(targetUrl) {
  const openUrl = (targetUrl && String(targetUrl).trim()) || INBOX_URL;
  const tabs = await chrome.tabs.query({ url: 'https://webmail.metu.edu.tr/*' });
  const existing = tabs.find((t) => isRoundcubeMailTabUrl(t.url));
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      try {
        await chrome.windows.update(existing.windowId, { focused: true });
      } catch (_) { /* may require optional windows permission */ }
    }
    return;
  }
  await chrome.tabs.create({ url: openUrl });
}

function makeResult(ok, state, reason, newCount = 0) {
  return { ok, state, reason, newCount, timestamp: Date.now() };
}

let tokenUnavailableCount = 0;
const TOKEN_UNAVAILABLE_THRESHOLD = 3;
// NOTE: tokenUnavailableCount resets on service worker recycle.
// This is acceptable — worst case, the threshold restarts after recycle.
// Do not persist to storage to avoid stale count across browser restarts.

let checkInProgress = false;
let cachedRcToken = null;
let currentState = 'STATE_1';
const LOG_PREFIX = "[METU Mail Notifier]";

let currentGeneration = 0;
let authCheckController = null;
let mailCheckController = null;

function makeGenerationGuard(capturedGeneration) {
  return function isStale() {
    return capturedGeneration !== currentGeneration;
  };
}

function getStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

/**
 * Read-only: canonical machine state from storage. Does not update currentState,
 * currentGeneration, or alarms (unlike reconcileRuntimeState).
 */
async function getPersistedMachineState() {
  const stored = await getStorage([STORAGE_KEYS.machineState]);
  return stored[STORAGE_KEYS.machineState] === 'STATE_2' ? 'STATE_2' : 'STATE_1';
}

function setStorage(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function getAlarm(name) {
  return new Promise((resolve) => {
    chrome.alarms.get(name, resolve);
  });
}

async function clearAlarmForGateway(name) {
  await new Promise((resolve) => {
    chrome.alarms.clear(name, resolve);
  });
  console.info(`${LOG_PREFIX} Cleared alarm: ${name}`);
}

/**
 * Single gateway for machine state persistence and alarm schedule.
 * All chrome.alarms create/clear for this extension must go through here.
 */
async function transitionToState(nextState, reason) {
  if (reason === REASON.EXTENSION_DISABLED) {
    currentState = 'STATE_1';
    await setStorage({ [STORAGE_KEYS.machineState]: 'STATE_1' });
    await clearAlarmForGateway(AUTH_CHECK_ALARM);
    await clearAlarmForGateway(MAIL_CHECK_ALARM);
    console.info(`${LOG_PREFIX} Extension disabled: alarms cleared; ${STORAGE_KEYS.machineState}=STATE_1.`);
    return;
  }

  if (nextState !== 'STATE_1' && nextState !== 'STATE_2') {
    console.warn(`${LOG_PREFIX} transitionToState: invalid nextState`, nextState);
    return;
  }

  currentState = nextState;
  await setStorage({ [STORAGE_KEYS.machineState]: nextState });
  await clearAlarmForGateway(AUTH_CHECK_ALARM);
  await clearAlarmForGateway(MAIL_CHECK_ALARM);

  if (nextState === 'STATE_1') {
    chrome.alarms.create(AUTH_CHECK_ALARM, { periodInMinutes: AUTH_CHECK_INTERVAL_MINUTES });
    console.info(`${LOG_PREFIX} Alarms set for STATE_1 (auth check). reason=${reason}`);
  } else {
    chrome.alarms.create(MAIL_CHECK_ALARM, { periodInMinutes: MAIL_CHECK_INTERVAL_MINUTES });
    console.info(`${LOG_PREFIX} Alarms set for STATE_2 (mail check). reason=${reason}`);
  }
}

function looksLikeRoundcubeLogin(text) {
  const probe = (text || "").toLowerCase();
  const hasLoginTask = probe.includes("_task=login");
  const hasUserField = probe.includes("name=\"_user\"") || probe.includes("name='_user'");
  const hasPassField = probe.includes("name=\"_pass\"") || probe.includes("name='_pass'");
  const hasLoginForm =
    probe.includes("id=\"rcmloginform\"") || probe.includes("id='rcmloginform'");

  const markerScore = [hasLoginTask, hasUserField, hasPassField, hasLoginForm].filter(Boolean).length;
  return markerScore >= 2;
}

/**
 * Extracts Roundcube session token from inbox HTML.
 * Strategy 1: DOMParser (more reliable, handles attribute order variations).
 * Strategy 2: Raw regex fallback (handles cases where DOMParser is unavailable).
 * Returns token string or null.
 */
function extractRoundcubeToken(html) {
  // Strategy 1: DOMParser
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Hidden input: <input name="_token" value="..."> or <input name="request_token" ...>
    const input = doc.querySelector('input[name="_token"]')
                || doc.querySelector('input[name="request_token"]');
    if (input?.value) return input.value;

    // Script content: request_token: 'abc' or request_token = 'abc'
    const scripts = Array.from(doc.querySelectorAll('script'));
    for (const s of scripts) {
      const match = s.textContent.match(/request_token\s*[:=]\s*['"]([a-zA-Z0-9_-]{10,})['"]/);
      if (match) return match[1];
    }
  } catch (_) { /* DOMParser unavailable or threw — fall through to regex */ }

  // Strategy 2: Raw regex fallback
  const hiddenInputMatch = html.match(/name=["']_?(?:request_)?token["']\s+value=["']([a-zA-Z0-9_-]{10,})["']/);
  if (hiddenInputMatch) return hiddenInputMatch[1];

  const jsTokenMatch = html.match(/request_token\s*[:=]\s*['"]([a-zA-Z0-9_-]{10,})['"]/);
  if (jsTokenMatch) return jsTokenMatch[1];

  return null;
}

async function probeAuthState(signal) {
  try {
    const fetchSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000);

    const response = await fetch(INBOX_URL, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: fetchSignal,
    });

    if (!response.ok) {
      const finalUrl = response.url || "";
      if (finalUrl.includes("_task=login")) {
        return { state: AUTH_STATE.UNAUTHENTICATED, reason: AUTH_REASON.LOGIN_REDIRECT, token: null };
      }
      return { state: AUTH_STATE.UNKNOWN, reason: AUTH_REASON.HTTP_ERROR, token: null };
    }

    const html = await response.text();
    const finalUrl = response.url || "";

    if (finalUrl.includes("_task=login") || looksLikeRoundcubeLogin(html)) {
      return { state: AUTH_STATE.UNAUTHENTICATED, reason: AUTH_REASON.LOGIN_MARKERS_FOUND, token: null };
    }

    const token = extractRoundcubeToken(html);
    if (token) {
      return { state: AUTH_STATE.AUTHENTICATED, reason: AUTH_REASON.TOKEN_FOUND, token };
    }

    return { state: AUTH_STATE.UNKNOWN, reason: AUTH_REASON.TOKEN_MISSING, token: null };
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return { state: AUTH_STATE.UNKNOWN, reason: AUTH_REASON.TIMEOUT, token: null };
    }
    return { state: AUTH_STATE.UNKNOWN, reason: AUTH_REASON.NETWORK_ERROR, token: null };
  }
}

// ── Overlay notification via content script injection ──

function isInjectableUrl(url) {
  if (!url) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

async function tryInjectOverlay(tabId, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content.js"]
  });
  await chrome.tabs.sendMessage(tabId, payload);
}

function canInjectOverlay() {
  return new Promise((resolve) => {
    chrome.permissions.contains(
      { origins: ['<all_urls>'] },
      (granted) => resolve(granted)
    );
  });
}

async function showNotificationOverlay({ title, message, kind, playSound }) {
  const payload = {
    type: "metuMailNotification",
    title, message, kind, playSound,
    inboxUrl: INBOX_URL
  };

  const overlayGranted = await canInjectOverlay();

  if (overlayGranted) {
    // 1) Try the active tab in the focused window
    try {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active?.id && isInjectableUrl(active.url)) {
        await tryInjectOverlay(active.id, payload);
        return true;
      }
    } catch (_) { /* fall through */ }

    // 2) Try any active tab in any window
    try {
      const activeTabs = await chrome.tabs.query({ active: true });
      for (const tab of activeTabs) {
        if (tab.id && isInjectableUrl(tab.url)) {
          try {
            await tryInjectOverlay(tab.id, payload);
            return true;
          } catch (_) { continue; }
        }
      }
    } catch (_) { /* fall through */ }

    // 3) In overlay mode, keep login/session warnings tab-bound; if no injectable
    // tab exists, return false so automatic retries continue.
    if (kind !== "newMail") {
      console.info(`${LOG_PREFIX} No injectable tab for ${kind} notification; will retry on next alarm.`);
      return false;
    }

    console.info(`${LOG_PREFIX} No injectable tab; using native notification for new mail.`);
  } else {
    // Optional permission not granted: operate in native-notification mode.
    console.info(`${LOG_PREFIX} Overlay permission not granted; using native notification for ${kind}.`);
  }

  if (kind === "noNewMail") {
    return false;
  }

  const notificationId = kind === "newMail" ? MAIL_NOTIFICATION_ID : LOGIN_NOTIFICATION_ID;
  const fallbackMessage = message || (kind === "newMail"
    ? "You have new email."
    : "Please log in to webmail.metu.edu.tr.");
  try {
    await chrome.notifications.create(notificationId, {
      type: "basic",
      title,
      message: fallbackMessage,
      iconUrl: chrome.runtime.getURL("icons/icon.png")
    });
    return true;
  } catch (e) {
    console.warn(`${LOG_PREFIX} Native notification also failed:`, e.message);
    return false;
  }
}

async function notifyNewMail(count, playSound) {
  if (count <= 0) return;
  const message = count === 1 ? "You have 1 new email" : `You have ${count} new emails`;
  await showNotificationOverlay({
    title: "METU Mail Notifier",
    message,
    kind: "newMail",
    playSound
  });
}

async function notifySessionExpired(playSound) {
  return showNotificationOverlay({
    title: "METU Mail Notifier",
    message: "Session expired. Please sign in to webmail.metu.edu.tr again.",
    kind: "sessionExpired",
    playSound
  });
}

async function notifyPleaseLogin(playSound) {
  return showNotificationOverlay({
    title: "METU Mail Notifier",
    message: "Please log in to webmail.metu.edu.tr.",
    kind: "sessionExpired",
    playSound
  });
}

// ── Extension enabled check ──

async function isExtensionEnabled() {
  const stored = await getStorage([STORAGE_KEYS.extensionEnabled]);
  return stored[STORAGE_KEYS.extensionEnabled] !== false;
}

async function reconcileRuntimeState() {
  currentGeneration++;
  if (!(await isExtensionEnabled())) {
    console.info(`${LOG_PREFIX} Reconcile: extension disabled; clearing alarms.`);
    await transitionToState('STATE_1', REASON.EXTENSION_DISABLED);
    return;
  }

  const stored = await getStorage([STORAGE_KEYS.machineState]);
  const persisted = stored[STORAGE_KEYS.machineState] === 'STATE_2' ? 'STATE_2' : 'STATE_1';
  currentState = persisted;

  const authAlarm = await getAlarm(AUTH_CHECK_ALARM);
  const mailAlarm = await getAlarm(MAIL_CHECK_ALARM);

  if (persisted === 'STATE_2') {
    if (mailAlarm && !authAlarm) {
      console.info(`${LOG_PREFIX} Reconcile: STATE_2 and mail_check alarm OK; no gateway call.`);
      return;
    }
    console.info(`${LOG_PREFIX} Reconcile: repairing STATE_2 alarms (mail=${!!mailAlarm} auth=${!!authAlarm}).`);
    await transitionToState('STATE_2', REASON.RUNTIME_RECONCILE);
    return;
  }

  if (authAlarm && !mailAlarm) {
    console.info(`${LOG_PREFIX} Reconcile: STATE_1 and auth_check alarm OK; no gateway call.`);
    return;
  }
  console.info(`${LOG_PREFIX} Reconcile: repairing STATE_1 alarms (auth=${!!authAlarm} mail=${!!mailAlarm}).`);
  await transitionToState('STATE_1', REASON.RUNTIME_RECONCILE);
}

function isValidCheckResult(r) {
  return (
    r != null &&
    typeof r === 'object' &&
    typeof r.ok === 'boolean' &&
    (r.state === 'STATE_1' || r.state === 'STATE_2') &&
    typeof r.reason === 'string'
  );
}

// ── State machine ──

async function runAuthCheck(isManual = false) {
  if (checkInProgress) {
    console.info(`${LOG_PREFIX} Auth check skipped: another check is in progress.`);
    return makeResult(false, 'STATE_1', REASON.SKIPPED_IN_PROGRESS);
  }
  if (!(await isExtensionEnabled())) {
    console.info(`${LOG_PREFIX} Extension disabled; skipping auth check.`);
    return makeResult(false, 'STATE_1', REASON.SKIPPED_IN_PROGRESS);
  }

  const capturedGeneration = currentGeneration;
  const isStale = makeGenerationGuard(capturedGeneration);
  authCheckController = new AbortController();
  const signal = authCheckController.signal;

  checkInProgress = true;

  try {
    console.info(`${LOG_PREFIX} STATE_1 (LOGGED_OUT): running auth check.`);
    await writeStatus(STATUS.CHECKING);
    const stored = await getStorage([
      STORAGE_KEYS.hasWarnedLogin,
      STORAGE_KEYS.lastLoginWarningTs,
      STORAGE_KEYS.playNotificationSound
    ]);
    // One-time migration: if old boolean flag was set, treat it as if warned 30 min ago
    // so the user gets reminded again soon rather than never.
    const legacyWarned = stored[STORAGE_KEYS.hasWarnedLogin] === true;
    const storedTs = stored[STORAGE_KEYS.lastLoginWarningTs];
    const lastLoginWarningTs = Number.isFinite(storedTs)
      ? storedTs
      : (legacyWarned ? Date.now() - LOGIN_WARNING_INTERVAL_MS : 0);
    const now = Date.now();
    const shouldWarnThrottle = (now - lastLoginWarningTs) > LOGIN_WARNING_INTERVAL_MS;
    const playSound = stored[STORAGE_KEYS.playNotificationSound] !== false;
    const probe = await probeAuthState(signal);

    if (probe.state === AUTH_STATE.AUTHENTICATED) {
      if (isStale()) {
        console.log('[auth] stale generation — discarding result');
        await writeStaleCheckStatus();
        return makeResult(false, currentState, REASON.STALE_GENERATION);
      }
      cachedRcToken = probe.token;
      console.info(`${LOG_PREFIX} Authenticated (${probe.reason}). Transitioning STATE_1 -> STATE_2.`);
      await transitionToState('STATE_2', REASON.NO_NEW_MAIL);
      await writeStatus(STATUS.MONITORING);
      return makeResult(true, 'STATE_2', REASON.NO_NEW_MAIL);
    } else if (probe.state === AUTH_STATE.UNAUTHENTICATED) {
      if (isManual || shouldWarnThrottle) {
        if (isStale()) {
          await writeStaleCheckStatus();
          return makeResult(false, currentState, REASON.STALE_GENERATION);
        }
        console.info(`${LOG_PREFIX} Not authenticated (${probe.reason}). Showing login warning (manual=${isManual}).`);
        const delivered = await notifyPleaseLogin(playSound);
        if (delivered && !isManual) {
          // Only update throttle timestamp for automatic warnings — manual checks never update it
          await setStorage({
            [STORAGE_KEYS.lastLoginWarningTs]: now,
            [STORAGE_KEYS.hasWarnedLogin]: true   // keep in sync during migration
          });
        } else if (!delivered) {
          console.info(`${LOG_PREFIX} Login warning not delivered (no tab); will retry on next alarm.`);
        }
      } else {
        console.info(`${LOG_PREFIX} Not authenticated (${probe.reason}). Login warning throttled; skipping.`);
      }
      await writeStatus(STATUS.LOGGED_OUT, probe.reason);
      return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
    } else {
      console.info(`${LOG_PREFIX} Auth probe unknown — staying in STATE_1: ${probe.reason}`);
      await writeStatus(STATUS.ERROR, probe.reason);
      return makeResult(false, 'STATE_1', REASON.NETWORK_ERROR);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Auth check failed safely:`, error);
    await writeStatus(STATUS.ERROR, error.message);
    return makeResult(false, 'STATE_1', REASON.UNKNOWN_ERROR);
  } finally {
    checkInProgress = false;
    authCheckController = null;
  }
}

/**
 * Parses the Roundcube mail-list exec response string.
 * Guards against null/non-string input, session errors, and missing UIDs.
 * Returns { ok, sessionError, uids }
 */
function parseMailExecResponse(execStr) {
  if (!execStr || typeof execStr !== 'string') {
    console.warn(`${LOG_PREFIX} [mail] mail-list exec is empty or non-string`);
    return { ok: false, sessionError: false, uids: [] };
  }

  if (execStr.includes('session_error') || execStr.includes('invalid_request') || execStr.includes('_task=login')) {
    console.warn(`${LOG_PREFIX} [mail] session error detected in exec response`);
    return { ok: false, sessionError: true, uids: [] };
  }

  const uids = [];
  const regex = /add_message_row\s*\(\s*['"]?(\d+)['"]?/g;
  let match;
  while ((match = regex.exec(execStr)) !== null) {
    const id = Number(match[1]);
    if (Number.isFinite(id)) uids.push(id);
  }

  if (uids.length === 0 && execStr.length > 100) {
    console.warn(`${LOG_PREFIX} [mail] exec has content but no parseable UIDs`);
  }

  return { ok: true, sessionError: false, uids };
}

async function runMailCheck(isManual = false) {
  if (checkInProgress) {
    console.info(`${LOG_PREFIX} Mail check skipped: another check is in progress.`);
    return makeResult(false, 'STATE_2', REASON.SKIPPED_IN_PROGRESS);
  }
  if (!(await isExtensionEnabled())) {
    console.info(`${LOG_PREFIX} Extension disabled; skipping mail check.`);
    return makeResult(false, 'STATE_2', REASON.SKIPPED_IN_PROGRESS);
  }

  const capturedGeneration = currentGeneration;
  const isStale = makeGenerationGuard(capturedGeneration);
  mailCheckController = new AbortController();
  const signal = mailCheckController.signal;

  checkInProgress = true;

  try {
    console.info(`${LOG_PREFIX} STATE_2 (LOGGED_IN): running mail check.`);
    await writeStatus(STATUS.CHECKING);
    const stored = await getStorage([
      STORAGE_KEYS.lastSeenId,
      STORAGE_KEYS.playNotificationSound
    ]);
    const playSound = stored[STORAGE_KEYS.playNotificationSound] !== false;
    const previousLastSeen = Number.isFinite(stored[STORAGE_KEYS.lastSeenId])
      ? stored[STORAGE_KEYS.lastSeenId]
      : null;

    if (!cachedRcToken) {
      console.info(`${LOG_PREFIX} No Roundcube token cached; re-probing inbox page.`);
      const reprobe = await probeAuthState(signal);
      if (reprobe.token) {
        if (isStale()) {
          await writeStaleCheckStatus();
          return makeResult(false, currentState, REASON.STALE_GENERATION);
        }
        cachedRcToken = reprobe.token;
      }
      if (!cachedRcToken) {
        if (reprobe.state === AUTH_STATE.UNAUTHENTICATED) {
          if (isStale()) {
            await writeStaleCheckStatus();
            return makeResult(false, currentState, REASON.STALE_GENERATION);
          }
          console.info(`${LOG_PREFIX} Session invalid (no token after re-probe). Transitioning STATE_2 -> STATE_1.`);
          if (isManual) {
            await notifyPleaseLogin(playSound);
          } else {
            await notifySessionExpired(playSound);
          }
          await transitionToState('STATE_1', REASON.LOGIN_REQUIRED);
          await writeStatus(STATUS.LOGGED_OUT);
          return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
        } else {
          if (isStale()) {
            await writeStaleCheckStatus();
            return makeResult(false, currentState, REASON.STALE_GENERATION);
          }
          tokenUnavailableCount++;
          console.log(`[mail] token unavailable (${tokenUnavailableCount}/${TOKEN_UNAVAILABLE_THRESHOLD}), reason: token_unavailable`);

          if (tokenUnavailableCount >= TOKEN_UNAVAILABLE_THRESHOLD) {
            console.log('[mail] threshold reached — clearing token cache, falling back to STATE_1');
            if (isStale()) {
              await writeStaleCheckStatus();
              return makeResult(false, currentState, REASON.STALE_GENERATION);
            }
            tokenUnavailableCount = 0;
            cachedRcToken = null;
            await transitionToState('STATE_1', REASON.TOKEN_UNAVAILABLE);
            await writeStatus(STATUS.LOGGED_OUT);
            return makeResult(false, 'STATE_1', REASON.TOKEN_UNAVAILABLE);
          }
          await writeStatus(STATUS.MONITORING);
          return makeResult(false, 'STATE_2', REASON.TOKEN_UNAVAILABLE);
        }
      }
    }

    const exitLoggedOutFromListResponse = async (logMsg) => {
      console.info(logMsg);
      cachedRcToken = null;
      if (isStale()) {
        await writeStaleCheckStatus();
        return makeResult(false, currentState, REASON.STALE_GENERATION);
      }
      if (isManual) {
        await notifyPleaseLogin(playSound);
      } else {
        await notifySessionExpired(playSound);
      }
      await transitionToState('STATE_1', REASON.LOGIN_REQUIRED);
      await writeStatus(STATUS.LOGGED_OUT);
      return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
    };

    const listUrl = `${BASE_URL}?_task=mail&_action=list&_mbox=INBOX&_remote=1&_token=${encodeURIComponent(cachedRcToken)}`;

    const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    const response = await fetch(listUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: fetchSignal
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.info(`${LOG_PREFIX} Session expired by HTTP ${response.status}. Transitioning STATE_2 -> STATE_1.`);
        cachedRcToken = null;
        if (isStale()) {
          await writeStaleCheckStatus();
          return makeResult(false, currentState, REASON.STALE_GENERATION);
        }
        await notifySessionExpired(playSound);
        await transitionToState('STATE_1', REASON.LOGIN_REQUIRED);
        await writeStatus(STATUS.LOGGED_OUT);
        return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
      } else {
        console.warn(`${LOG_PREFIX} Mail check HTTP ${response.status}; staying in STATE_2.`);
        await writeStatus(STATUS.ERROR, `HTTP ${response.status}`);
        return makeResult(false, 'STATE_2', REASON.NETWORK_ERROR);
      }
    }

    const finalUrl = response.url || "";
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (finalUrl.includes("_task=login") || contentType.includes("text/html")) {
      return await exitLoggedOutFromListResponse(
        `${LOG_PREFIX} Session expired (login URL or HTML content-type on mail list). Transitioning STATE_2 -> STATE_1.`
      );
    }

    const rawText = await response.text();
    let listData;
    try {
      listData = JSON.parse(rawText);
    } catch (parseErr) {
      if (looksLikeRoundcubeLogin(rawText)) {
        return await exitLoggedOutFromListResponse(
          `${LOG_PREFIX} Session expired (login HTML after failed JSON parse). Transitioning STATE_2 -> STATE_1.`
        );
      }
      console.warn(`${LOG_PREFIX} Mail list response is not valid JSON:`, parseErr);
      await writeStatus(STATUS.ERROR, parseErr.message);
      return makeResult(false, 'STATE_2', REASON.UNKNOWN_ERROR);
    }

    const execStr = listData?.exec ?? '';
    const parsed = parseMailExecResponse(execStr);

    if (!parsed.ok) {
      if (parsed.sessionError) {
        console.info(`${LOG_PREFIX} Session expired (session error in exec). Transitioning STATE_2 -> STATE_1.`);
        cachedRcToken = null;
        if (isStale()) {
          await writeStaleCheckStatus();
          return makeResult(false, currentState, REASON.STALE_GENERATION);
        }
        await notifySessionExpired(playSound);
        await transitionToState('STATE_1', REASON.LOGIN_REQUIRED);
        await writeStatus(STATUS.LOGGED_OUT);
        return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
      } else {
        if (looksLikeRoundcubeLogin(JSON.stringify(listData))) {
          console.info(`${LOG_PREFIX} Session expired (login detected in list response). Transitioning STATE_2 -> STATE_1.`);
          cachedRcToken = null;
          if (isStale()) {
            await writeStaleCheckStatus();
            return makeResult(false, currentState, REASON.STALE_GENERATION);
          }
          await notifySessionExpired(playSound);
          await transitionToState('STATE_1', REASON.LOGIN_REQUIRED);
          await writeStatus(STATUS.LOGGED_OUT);
          return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
        } else {
          tokenUnavailableCount = 0;
          console.warn(`${LOG_PREFIX} Empty exec in list response; skipping.`);
          await writeStatus(STATUS.MONITORING);
          return makeResult(true, 'STATE_2', REASON.NO_NEW_MAIL);
        }
      }
    }

    tokenUnavailableCount = 0;

    const ids = parsed.uids.sort((a, b) => a - b);
    const highestId = ids.length > 0 ? ids[ids.length - 1] : null;

    if (highestId == null) {
      console.info(`${LOG_PREFIX} Valid response but inbox is empty; updating timestamp.`);
      if (isStale()) {
        await writeStaleCheckStatus();
        return makeResult(false, currentState, REASON.STALE_GENERATION);
      }
      await setStorage({ [STORAGE_KEYS.lastSuccessfulCheckTs]: Date.now() });
      if (isManual) {
        await showNotificationOverlay({
          title: "METU Mail Notifier",
          message: "",
          kind: "noNewMail",
          playSound
        });
      }
      await writeStatus(STATUS.MONITORING);
      return makeResult(true, 'STATE_2', REASON.NO_NEW_MAIL);
    }

    let newCount = 0;
    let nextLastSeen = highestId;

    if (previousLastSeen != null) {
      newCount = ids.filter((id) => id > previousLastSeen).length;
      nextLastSeen = Math.max(previousLastSeen, highestId);
    }

    if (newCount > 0) {
      console.info(`${LOG_PREFIX} New mail detected: ${newCount} message(s).`);
      if (isStale()) {
        await writeStaleCheckStatus();
        return makeResult(false, currentState, REASON.STALE_GENERATION);
      }
      await notifyNewMail(newCount, playSound);
    } else {
      console.info(`${LOG_PREFIX} No new mail.`);
      if (isManual) {
        if (isStale()) {
          await writeStaleCheckStatus();
          return makeResult(false, currentState, REASON.STALE_GENERATION);
        }
        await showNotificationOverlay({
          title: "METU Mail Notifier",
          message: "",
          kind: "noNewMail",
          playSound
        });
      }
    }

    if (isStale()) {
      await writeStaleCheckStatus();
      return makeResult(false, currentState, REASON.STALE_GENERATION);
    }
    await setStorage({
      [STORAGE_KEYS.lastSeenId]: nextLastSeen,
      [STORAGE_KEYS.lastSuccessfulCheckTs]: Date.now()
    });
    console.info(`${LOG_PREFIX} Updated lastSeenId to ${nextLastSeen}.`);
    await writeStatus(STATUS.MONITORING);
    return newCount > 0
      ? makeResult(true, 'STATE_2', REASON.NEW_MAIL, newCount)
      : makeResult(true, 'STATE_2', REASON.NO_NEW_MAIL);
  } catch (error) {
    console.error(`${LOG_PREFIX} Mail check failed safely:`, error);
    await writeStatus(STATUS.ERROR, error.message);
    return makeResult(false, 'STATE_2', REASON.UNKNOWN_ERROR);
  } finally {
    checkInProgress = false;
    mailCheckController = null;
  }
}

async function stopStateMachine() {
  console.info(`${LOG_PREFIX} Stopping state machine (extension disabled).`);
  await writeStatus(STATUS.PAUSED);
  await transitionToState('STATE_1', REASON.EXTENSION_DISABLED);
  cachedRcToken = null;
  tokenUnavailableCount = 0;
  checkInProgress = false;

  currentGeneration++;

  if (authCheckController) {
    authCheckController.abort();
    authCheckController = null;
  }
  if (mailCheckController) {
    mailCheckController.abort();
    mailCheckController = null;
  }
}

// ── Manual Check via Message ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_INBOX') {
    (async () => {
      try {
        await openOrFocusInbox(message.url);
        sendResponse({ ok: true });
      } catch (e) {
        console.warn(`${LOG_PREFIX} OPEN_INBOX failed:`, e?.message || e);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
  if (message.type === 'MANUAL_CHECK') {
    console.info(`${LOG_PREFIX} Manual check triggered from popup.`);
    (async () => {
      try {
        const persistedState = await getPersistedMachineState();
        const stateBefore = persistedState;
        currentState = persistedState;

        let result;
        if (persistedState === 'STATE_2') {
          result = await runMailCheck(true);
        } else {
          result = await runAuthCheck(true);
        }
        if (
          isValidCheckResult(result) &&
          result.reason !== REASON.STALE_GENERATION &&
          result.state !== stateBefore
        ) {
          await transitionToState(result.state, result.reason);
        }
        sendResponse(
          isValidCheckResult(result)
            ? result
            : makeResult(false, currentState, REASON.UNKNOWN_ERROR)
        );
      } catch (error) {
        console.error(`${LOG_PREFIX} Manual check failed:`, error);
        sendResponse(makeResult(false, currentState, REASON.UNKNOWN_ERROR));
      }
    })();
    return true;
  }
});

// ── Lifecycle ──

chrome.runtime.onInstalled.addListener(async () => {
  console.info(`${LOG_PREFIX} onInstalled fired.`);
  const existingFlags = await getStorage([STORAGE_KEYS.hasWarnedLogin]);
  if (existingFlags[STORAGE_KEYS.hasWarnedLogin] === undefined) {
    await setStorage({ [STORAGE_KEYS.hasWarnedLogin]: false });
  }
  await reconcileRuntimeState();
  if (await isExtensionEnabled()) await runAuthCheck();
});

chrome.runtime.onStartup.addListener(async () => {
  console.info(`${LOG_PREFIX} onStartup fired.`);
  await reconcileRuntimeState();
  if (await isExtensionEnabled()) await runAuthCheck();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm) return;
  if (alarm.name === AUTH_CHECK_ALARM) {
    console.info(`${LOG_PREFIX} Alarm fired: ${AUTH_CHECK_ALARM}.`);
    runAuthCheck();
    return;
  }
  if (alarm.name === MAIL_CHECK_ALARM) {
    console.info(`${LOG_PREFIX} Alarm fired: ${MAIL_CHECK_ALARM}.`);
    runMailCheck();
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === MAIL_NOTIFICATION_ID || notificationId === LOGIN_NOTIFICATION_ID) {
    chrome.tabs.create({ url: INBOX_URL });
    chrome.notifications.clear(notificationId);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(STORAGE_KEYS.extensionEnabled in changes)) return;
  if (changes[STORAGE_KEYS.extensionEnabled].newValue === false) {
    stopStateMachine();
  } else {
    reconcileRuntimeState().then(() => runAuthCheck());
  }
});

reconcileRuntimeState().catch((error) => {
  console.error(`${LOG_PREFIX} Failed to reconcile runtime state:`, error);
});
