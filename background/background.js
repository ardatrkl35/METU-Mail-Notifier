const AUTH_CHECK_ALARM = "auth_check";
const MAIL_CHECK_ALARM = "mail_check";
const AUTH_CHECK_INTERVAL_MINUTES = 1;
const MAIL_CHECK_INTERVAL_MINUTES = 5;
const BASE_URL = "https://webmail.metu.edu.tr/";
const INBOX_URL = "https://webmail.metu.edu.tr/?_task=mail&_mbox=INBOX";
const OVERLAY_AUTO_CLOSE_MS = 30000;

const STORAGE_KEYS = {
  extensionEnabled: "extensionEnabled",
  hasWarnedLogin: "hasWarnedLogin",
  lastSeenId: "lastSeenId",
  playNotificationSound: "playNotificationSound",
  lastSuccessfulCheckTs: "lastSuccessfulCheckTs"
};

let checkInProgress = false;
let cachedRcToken = null;
const LOG_PREFIX = "[METU Mail Notifier]";

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

async function clearAlarm(name) {
  await new Promise((resolve) => {
    chrome.alarms.clear(name, resolve);
  });
  console.info(`${LOG_PREFIX} Cleared alarm: ${name}`);
}

async function ensureAuthCheckAlarm() {
  const existing = await new Promise((resolve) => {
    chrome.alarms.get(AUTH_CHECK_ALARM, resolve);
  });
  if (!existing) {
    chrome.alarms.create(AUTH_CHECK_ALARM, { periodInMinutes: AUTH_CHECK_INTERVAL_MINUTES });
    console.info(
      `${LOG_PREFIX} Created alarm: ${AUTH_CHECK_ALARM} (every ${AUTH_CHECK_INTERVAL_MINUTES} min)`
    );
  }
}

async function ensureMailCheckAlarm() {
  const existing = await new Promise((resolve) => {
    chrome.alarms.get(MAIL_CHECK_ALARM, resolve);
  });
  if (!existing) {
    chrome.alarms.create(MAIL_CHECK_ALARM, { periodInMinutes: MAIL_CHECK_INTERVAL_MINUTES });
    console.info(
      `${LOG_PREFIX} Created alarm: ${MAIL_CHECK_ALARM} (every ${MAIL_CHECK_INTERVAL_MINUTES} min)`
    );
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

async function probeSessionInvalidViaInboxPage() {
  try {
    const response = await fetch(INBOX_URL, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    const finalUrl = response.url || "";
    const text = await response.text();
    const invalidByUrl = finalUrl.includes("_task=login");
    const invalidByBody = looksLikeRoundcubeLogin(text);
    const result = invalidByUrl || invalidByBody;

    if (!result) {
      const tokenMatch = text.match(/name=['"]_token['"]\s+value=['"]([^'"]+)['"]/)
        || text.match(/request_token['"]\s*[:,]\s*['"]([^'"]+)['"]/);
      if (tokenMatch) cachedRcToken = tokenMatch[1];
    }
    return result;
  } catch (error) {
    return false;
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

async function showNotificationOverlay({ title, message, kind, playSound }) {
  const payload = {
    type: "metuMailNotification",
    title, message, kind, playSound,
    inboxUrl: INBOX_URL
  };

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

  // 3) For login/session warnings there is no injectable tab yet (e.g. browser
  //    just started). Return false so the caller knows delivery failed and should
  //    not mark the warning as sent — the auth_check alarm will retry next minute.
  if (kind !== "newMail") {
    console.info(`${LOG_PREFIX} No injectable tab for ${kind} notification; will retry on next alarm.`);
    return false;
  }

  console.info(`${LOG_PREFIX} No injectable tab; using native notification for new mail.`);
  try {
    await chrome.notifications.create(`metu-notify-${Date.now()}`, {
      type: "basic",
      title,
      message,
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

// ── State machine ──

async function runAuthCheck() {
  if (checkInProgress) {
    console.info(`${LOG_PREFIX} Auth check skipped: another check is in progress.`);
    return;
  }
  if (!(await isExtensionEnabled())) {
    console.info(`${LOG_PREFIX} Extension disabled; skipping auth check.`);
    return;
  }
  checkInProgress = true;

  try {
    console.info(`${LOG_PREFIX} STATE_1 (LOGGED_OUT): running auth check.`);
    const stored = await getStorage([STORAGE_KEYS.hasWarnedLogin, STORAGE_KEYS.playNotificationSound]);
    const hasWarnedLogin = stored[STORAGE_KEYS.hasWarnedLogin] === true;
    const playSound = stored[STORAGE_KEYS.playNotificationSound] !== false;
    const isUnauthenticated = await probeSessionInvalidViaInboxPage();

    if (isUnauthenticated) {
      if (!hasWarnedLogin) {
        console.info(`${LOG_PREFIX} Not authenticated. Showing one-time login warning.`);
        const delivered = await notifyPleaseLogin(playSound);
        if (delivered) {
          await setStorage({ [STORAGE_KEYS.hasWarnedLogin]: true });
        } else {
          console.info(`${LOG_PREFIX} Login warning not delivered (no tab); will retry on next alarm.`);
        }
      } else {
        console.info(`${LOG_PREFIX} Not authenticated. Login warning already shown; skipping.`);
      }
      return;
    }

    console.info(
      `${LOG_PREFIX} Authenticated. Transitioning STATE_1 -> STATE_2 (auth_check -> mail_check).`
    );
    await setStorage({ [STORAGE_KEYS.hasWarnedLogin]: false });
    await clearAlarm(AUTH_CHECK_ALARM);
    await ensureMailCheckAlarm();
  } catch (error) {
    console.error(`${LOG_PREFIX} Auth check failed safely:`, error);
  } finally {
    checkInProgress = false;
  }
}

async function runMailCheck(isManual = false) {
  if (checkInProgress) {
    console.info(`${LOG_PREFIX} Mail check skipped: another check is in progress.`);
    return;
  }
  if (!(await isExtensionEnabled())) {
    console.info(`${LOG_PREFIX} Extension disabled; skipping mail check.`);
    return;
  }
  checkInProgress = true;

  try {
    console.info(`${LOG_PREFIX} STATE_2 (LOGGED_IN): running mail check.`);
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
      await probeSessionInvalidViaInboxPage();
      if (!cachedRcToken) {
        console.warn(`${LOG_PREFIX} Still no token after re-probe; aborting mail check.`);
        return;
      }
    }

    const listUrl = `${BASE_URL}?_task=mail&_action=list&_mbox=INBOX&_remote=1&_token=${encodeURIComponent(cachedRcToken)}`;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 20000);
    let listData;
    try {
      const response = await fetch(listUrl, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          console.info(`${LOG_PREFIX} Session expired by HTTP ${response.status}. Transitioning STATE_2 -> STATE_1.`);
          cachedRcToken = null;
          await notifySessionExpired(playSound);
          await clearAlarm(MAIL_CHECK_ALARM);
          await ensureAuthCheckAlarm();
        } else {
          console.warn(`${LOG_PREFIX} Mail check HTTP ${response.status}; staying in STATE_2.`);
        }
        return;
      }

      listData = await response.json();
    } finally {
      clearTimeout(timeoutHandle);
    }

    const execStr = listData?.exec || "";
    if (!execStr) {
      if (looksLikeRoundcubeLogin(JSON.stringify(listData))) {
        console.info(`${LOG_PREFIX} Session expired (login detected in list response). Transitioning STATE_2 -> STATE_1.`);
        cachedRcToken = null;
        await notifySessionExpired(playSound);
        await clearAlarm(MAIL_CHECK_ALARM);
        await ensureAuthCheckAlarm();
      } else {
        console.warn(`${LOG_PREFIX} Empty exec in list response; skipping.`);
      }
      return;
    }

    if (execStr.includes("session_error") || execStr.includes("_task=login")) {
      console.info(`${LOG_PREFIX} Session expired (session_error in exec). Transitioning STATE_2 -> STATE_1.`);
      cachedRcToken = null;
      await notifySessionExpired(playSound);
      await clearAlarm(MAIL_CHECK_ALARM);
      await ensureAuthCheckAlarm();
      return;
    }

    const uidMatches = [...execStr.matchAll(/add_message_row\((\d+),/g)];
    const ids = uidMatches.map(m => Number(m[1])).filter(Number.isFinite).sort((a, b) => a - b);
    const highestId = ids.length > 0 ? ids[ids.length - 1] : null;

    if (highestId == null) {
      console.info(`${LOG_PREFIX} Valid response but no message IDs found; no-op.`);
      return;
    }

    let newCount = 0;
    let nextLastSeen = highestId;

    if (previousLastSeen != null) {
      newCount = ids.filter((id) => id > previousLastSeen).length;
      nextLastSeen = Math.max(previousLastSeen, highestId);
    }

    if (newCount > 0) {
      console.info(`${LOG_PREFIX} New mail detected: ${newCount} message(s).`);
      await notifyNewMail(newCount, playSound);
    } else {
      console.info(`${LOG_PREFIX} No new mail.`);
      if (isManual) {
        await showNotificationOverlay({
          title: "METU Mail Notifier",
          message: "You have no new emails.",
          kind: "newMail",
          playSound
        });
      }
    }

    await setStorage({
      [STORAGE_KEYS.lastSeenId]: nextLastSeen,
      [STORAGE_KEYS.lastSuccessfulCheckTs]: Date.now()
    });
    console.info(`${LOG_PREFIX} Updated lastSeenId to ${nextLastSeen}.`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Mail check failed safely:`, error);
  } finally {
    checkInProgress = false;
  }
}

async function initializeStateMachine() {
  if (!(await isExtensionEnabled())) {
    console.info(`${LOG_PREFIX} Extension disabled; clearing alarms.`);
    await clearAlarm(MAIL_CHECK_ALARM);
    await clearAlarm(AUTH_CHECK_ALARM);
    return;
  }
  console.info(`${LOG_PREFIX} Initializing state machine in STATE_1.`);
  await clearAlarm(MAIL_CHECK_ALARM);
  await ensureAuthCheckAlarm();
}

async function stopStateMachine() {
  console.info(`${LOG_PREFIX} Stopping state machine (extension disabled).`);
  await clearAlarm(AUTH_CHECK_ALARM);
  await clearAlarm(MAIL_CHECK_ALARM);
  cachedRcToken = null;
  checkInProgress = false;
}

// ── Manual Check via Message ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "MANUAL_CHECK") {
    console.info(`${LOG_PREFIX} Manual check triggered from popup.`);
    (async () => {
      const mailAlarm = await new Promise(resolve => chrome.alarms.get(MAIL_CHECK_ALARM, resolve));
      if (mailAlarm) {
        await clearAlarm(MAIL_CHECK_ALARM);
        await runMailCheck(true);
        await ensureMailCheckAlarm();
      } else {
        await clearAlarm(AUTH_CHECK_ALARM);
        await runAuthCheck();
        await ensureAuthCheckAlarm();
      }
      sendResponse({ ok: true });
    })();
    return true; // Keep message channel open for async response
  }
});

// ── Lifecycle ──

chrome.runtime.onInstalled.addListener(async () => {
  console.info(`${LOG_PREFIX} onInstalled fired.`);
  await setStorage({ [STORAGE_KEYS.hasWarnedLogin]: false });
  await initializeStateMachine();
  if (await isExtensionEnabled()) await runAuthCheck();
});

chrome.runtime.onStartup.addListener(async () => {
  console.info(`${LOG_PREFIX} onStartup fired.`);
  await initializeStateMachine();
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(STORAGE_KEYS.extensionEnabled in changes)) return;
  if (changes[STORAGE_KEYS.extensionEnabled].newValue === false) {
    stopStateMachine();
  } else {
    initializeStateMachine().then(() => runAuthCheck());
  }
});

initializeStateMachine().catch((error) => {
  console.error(`${LOG_PREFIX} Failed to initialize state machine:`, error);
});
