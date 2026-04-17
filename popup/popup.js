import { INBOX_URL } from '../background/constants.js';
import { reasonTextFor } from '../background/reasonText.js';
import { STORAGE_KEYS, normalizePopupActivityLog } from '../background/storageSchema.js';

const REPO_URL = "https://github.com/ardatrkl35/METU-Mail-Notifier";

const STATUS_CHECKING_LABEL = 'Checking...';

const masterToggle = document.getElementById("masterToggle");
const soundToggle = document.getElementById("soundToggle");
const popupFooter = document.getElementById("popupFooter");
const disabledOverlay = document.getElementById("disabledOverlay");
const statusNode = document.getElementById("status");
const lastCheckTimeNode = document.getElementById("lastCheckTime");
const manualCheckBtn = document.getElementById("manualCheckBtn");
const openInboxBtn = document.getElementById("openInboxBtn");
const repoLinkBtn = document.getElementById("repoLinkBtn");
const extensionVersionNode = document.getElementById("extensionVersion");
const overlayAllSitesStatus = document.getElementById("overlayAllSitesStatus");
const overlayAllSitesGrantBtn = document.getElementById("overlayAllSitesGrantBtn");
const unreadCountValue = document.getElementById("unreadCountValue");
const unreadHint = document.getElementById("unreadHint");
const activityList = document.getElementById("activityList");

const ALL_SITES_ORIGINS = { origins: ["<all_urls>"] };

function readStorage(keys) {
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

function writeStorage(values) {
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

function showToast(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("toast--error", isError);
  statusNode.classList.add("toast--visible");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    statusNode.classList.remove("toast--visible");
  }, 2500);
}

function applyMasterState(enabled) {
  disabledOverlay.classList.toggle("visible", !enabled);
  const blockSubtree = !enabled;
  document.querySelectorAll(".main-pausable").forEach((el) => {
    el.inert = blockSubtree;
  });
  if (popupFooter) popupFooter.inert = blockSubtree;
}

function formatTime(ts) {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateLastCheckTime(ts) {
  if (lastCheckTimeNode) {
    lastCheckTimeNode.textContent = formatTime(ts);
  }
}

function updateStatusUI(status) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  const detail = document.getElementById('status-detail');
  if (!status || !dot) return;
  dot.dataset.state = status.label;
  label.textContent = status.label;
  detail.textContent = status.detail ?? '';
  if (manualCheckBtn && status.label && status.label !== STATUS_CHECKING_LABEL) {
    manualCheckBtn.classList.remove('spinning');
    manualCheckBtn.disabled = false;
  }
}

function containsAllSitesPermission() {
  return new Promise((resolve) => {
    if (!chrome.permissions?.contains) {
      resolve(false);
      return;
    }
    chrome.permissions.contains(ALL_SITES_ORIGINS, resolve);
  });
}

function requestAllSitesPermission() {
  return new Promise((resolve) => {
    if (!chrome.permissions?.request) {
      resolve({ ok: false, granted: false, error: "permissions API unavailable" });
      return;
    }
    chrome.permissions.request(ALL_SITES_ORIGINS, (granted) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, granted: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve({ ok: true, granted: !!granted });
    });
  });
}

async function refreshOverlayAllSitesConsentUI() {
  if (!overlayAllSitesStatus || !overlayAllSitesGrantBtn) return;
  const granted = await containsAllSitesPermission();
  overlayAllSitesGrantBtn.hidden = granted;
  overlayAllSitesGrantBtn.disabled = false;
  overlayAllSitesStatus.dataset.state = granted ? "granted" : "pending";
  overlayAllSitesStatus.textContent = granted
    ? "Granted — in-page toast is allowed on supported tabs."
    : "Not granted — only native notifications until you allow access.";
}

function setupOverlayConsentControls() {
  if (!overlayAllSitesGrantBtn) return;
  overlayAllSitesGrantBtn.addEventListener("click", async () => {
    overlayAllSitesGrantBtn.disabled = true;
    try {
      const result = await requestAllSitesPermission();
      if (!result.ok) {
        showToast(result.error || "Permission request failed.", true);
        return;
      }
      if (result.granted) {
        showToast("Access to all websites granted for in-page toast.");
      } else {
        showToast("Permission not granted — you can try again anytime.", false);
      }
    } finally {
      await refreshOverlayAllSitesConsentUI();
    }
  });
}

function setupRepoFooter() {
  if (extensionVersionNode) {
    try {
      extensionVersionNode.textContent = chrome.runtime.getManifest().version;
    } catch (_) {
      extensionVersionNode.textContent = "";
    }
  }
  if (repoLinkBtn) {
    repoLinkBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: REPO_URL });
    });
  }
}

function activitySummaryLine(entry) {
  const t = formatTime(entry.ts);
  let msg = '';
  switch (entry.type) {
    case 'new_mail':
      msg = entry.n ? `New mail (${entry.n})` : 'New mail';
      break;
    case 'no_new':
      msg = 'No new mail';
      break;
    case 'empty_inbox':
      msg = 'Inbox empty';
      break;
    case 'session_lost':
      msg = 'Session ended — sign in again';
      break;
    case 'signed_in':
      msg = 'Signed in — monitoring';
      break;
    default:
      break;
  }
  return msg ? `${t} · ${msg}` : '';
}

function renderActivityList(raw) {
  if (!activityList) return;
  const rows = normalizePopupActivityLog(raw).slice().reverse();
  while (activityList.firstChild) {
    activityList.removeChild(activityList.firstChild);
  }
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No events yet — run a check or wait for the next poll.';
    activityList.appendChild(li);
    return;
  }
  for (const e of rows) {
    const line = activitySummaryLine(e);
    if (!line) continue;
    const li = document.createElement('li');
    li.textContent = line;
    activityList.appendChild(li);
  }
}

function updateUnreadPanel(enabled, machineState, unreadCount) {
  if (!unreadCountValue || !unreadHint) return;
  const setHint = (text, subtle) => {
    unreadHint.textContent = text;
    unreadHint.classList.toggle('unread-hint--subtle', !!subtle);
  };
  if (!enabled) {
    unreadCountValue.textContent = '—';
    setHint('Enable the extension to monitor INBOX unread.', true);
    return;
  }
  if (machineState !== 'STATE_2') {
    unreadCountValue.textContent = '—';
    setHint('Sign in to METU webmail to load unread counts.', true);
    return;
  }
  const n = Number(unreadCount);
  const safe = Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 999_999) : 0;
  unreadCountValue.textContent = String(safe);
  setHint('(From the last successful check)', false);
}

async function initialize() {
  setupRepoFooter();
  setupOverlayConsentControls();
  await refreshOverlayAllSitesConsentUI();
  try {
    const stored = await readStorage([
      STORAGE_KEYS.extensionEnabled,
      STORAGE_KEYS.playNotificationSound,
      STORAGE_KEYS.lastSuccessfulCheckTs,
      STORAGE_KEYS.machineState,
      STORAGE_KEYS.unreadCount,
      STORAGE_KEYS.popupActivityLog,
    ]);
    const enabled = stored[STORAGE_KEYS.extensionEnabled] !== false;
    const soundOn = stored[STORAGE_KEYS.playNotificationSound] !== false;
    const machineState = stored[STORAGE_KEYS.machineState] === 'STATE_2' ? 'STATE_2' : 'STATE_1';

    masterToggle.checked = enabled;
    soundToggle.checked = soundOn;
    applyMasterState(enabled);
    updateLastCheckTime(stored[STORAGE_KEYS.lastSuccessfulCheckTs]);
    updateUnreadPanel(enabled, machineState, stored[STORAGE_KEYS.unreadCount]);
    renderActivityList(stored[STORAGE_KEYS.popupActivityLog]);

    try {
      const { extensionStatus } = await chrome.storage.local.get('extensionStatus');
      updateStatusUI(extensionStatus);
    } catch (_) { /* status not yet written — leave as Loading... */ }
  } catch (error) {
    console.error("[METU Mail Notifier] Failed to load popup state:", error);
    showToast("Could not load settings.", true);
  }
}

masterToggle.addEventListener("change", async () => {
  const next = masterToggle.checked;
  try {
    await writeStorage({ [STORAGE_KEYS.extensionEnabled]: next });
    applyMasterState(next);
    showToast(next ? "Extension resumed" : "Extension paused");
    const stored = await readStorage([
      STORAGE_KEYS.machineState,
      STORAGE_KEYS.unreadCount,
    ]);
    const machineState = stored[STORAGE_KEYS.machineState] === 'STATE_2' ? 'STATE_2' : 'STATE_1';
    updateUnreadPanel(next, machineState, stored[STORAGE_KEYS.unreadCount]);
  } catch (error) {
    console.error("[METU Mail Notifier] Failed to save master toggle:", error);
    masterToggle.checked = !next;
    showToast("Could not save setting.", true);
  }
});

soundToggle.addEventListener("change", async () => {
  const next = soundToggle.checked;
  try {
    await writeStorage({ [STORAGE_KEYS.playNotificationSound]: next });
    showToast(next ? "Sound enabled" : "Sound disabled");
  } catch (error) {
    console.error("[METU Mail Notifier] Failed to save sound toggle:", error);
    soundToggle.checked = !next;
    showToast("Could not save setting.", true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.lastSuccessfulCheckTs]) {
    updateLastCheckTime(changes[STORAGE_KEYS.lastSuccessfulCheckTs].newValue);
  }
  if (area === 'local' && changes.extensionStatus) {
    updateStatusUI(changes.extensionStatus.newValue);
  }
  if (area === 'local') {
    const ext = changes[STORAGE_KEYS.extensionEnabled];
    const ms = changes[STORAGE_KEYS.machineState];
    const ur = changes[STORAGE_KEYS.unreadCount];
    const act = changes[STORAGE_KEYS.popupActivityLog];
    if (ext || ms || ur || act) {
      (async () => {
        try {
          const s = await readStorage([
            STORAGE_KEYS.extensionEnabled,
            STORAGE_KEYS.machineState,
            STORAGE_KEYS.unreadCount,
            STORAGE_KEYS.popupActivityLog,
          ]);
          const enabled = s[STORAGE_KEYS.extensionEnabled] !== false;
          const machineState = s[STORAGE_KEYS.machineState] === 'STATE_2' ? 'STATE_2' : 'STATE_1';
          updateUnreadPanel(enabled, machineState, s[STORAGE_KEYS.unreadCount]);
          if (act) renderActivityList(s[STORAGE_KEYS.popupActivityLog]);
        } catch (_) { /* ignore */ }
      })();
    }
  }
});

manualCheckBtn.addEventListener("click", () => {
  if (manualCheckBtn.disabled) return;
  manualCheckBtn.disabled = true;
  manualCheckBtn.classList.add('spinning');
  chrome.runtime.sendMessage({ type: "MANUAL_CHECK" }, (result) => {
    manualCheckBtn.classList.remove('spinning');
    manualCheckBtn.disabled = false;
    if (chrome.runtime.lastError) {
      console.warn("[popup] MANUAL_CHECK error:", chrome.runtime.lastError.message);
      showToast("Could not reach background. Try again.", true);
      return;
    }
    const text = reasonTextFor(result?.reason);
    showToast(text);
  });
});

if (openInboxBtn) {
  openInboxBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_INBOX", url: INBOX_URL }, (res) => {
      if (chrome.runtime.lastError) {
        showToast("Could not reach background. Try again.", true);
        return;
      }
      if (!res?.ok) {
        showToast("Could not open inbox.", true);
      }
    });
  });
}

initialize();
