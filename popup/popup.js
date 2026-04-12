const KEYS = {
  extensionEnabled: "extensionEnabled",
  playNotificationSound: "playNotificationSound",
  lastSuccessfulCheckTs: "lastSuccessfulCheckTs"
};

const STATUS_CHECKING_LABEL = 'Checking...';

const REASON_TEXT = {
  new_mail:            'New mail found!',
  no_new_mail:         'No new mail.',
  login_required:      'Not logged in — please open webmail to sign in.',
  network_error:       'Network error — check your connection.',
  skipped_in_progress: 'A check is already running.',
  token_unavailable:   'Could not read session — will retry.',
  unknown_error:       'An unexpected error occurred.',
};

const masterToggle = document.getElementById("masterToggle");
const soundToggle = document.getElementById("soundToggle");
const disabledOverlay = document.getElementById("disabledOverlay");
const statusNode = document.getElementById("status");
const lastCheckTimeNode = document.getElementById("lastCheckTime");
const manualCheckBtn = document.getElementById("manualCheckBtn");

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
  }
}

async function initialize() {
  try {
    const stored = await readStorage([KEYS.extensionEnabled, KEYS.playNotificationSound, KEYS.lastSuccessfulCheckTs]);
    const enabled = stored[KEYS.extensionEnabled] !== false;
    const soundOn = stored[KEYS.playNotificationSound] !== false;

    masterToggle.checked = enabled;
    soundToggle.checked = soundOn;
    applyMasterState(enabled);
    updateLastCheckTime(stored[KEYS.lastSuccessfulCheckTs]);

    try {
      const { extensionStatus } = await chrome.storage.local.get('extensionStatus');
      updateStatusUI(extensionStatus);
    } catch (_) { /* status not yet written — leave as Loading... */ }

    const overlayBtn = document.getElementById('btn-request-overlay');
    if (overlayBtn) {
      chrome.permissions.contains({ origins: ['<all_urls>'] }, (granted) => {
        overlayBtn.style.display = granted ? 'none' : 'block';
      });

      overlayBtn.addEventListener('click', () => {
        chrome.permissions.request({ origins: ['<all_urls>'] }, (granted) => {
          if (granted) {
            showToast('In-page overlay enabled.');
            overlayBtn.style.display = 'none';
          } else {
            showToast('Permission denied — using native notifications.', true);
          }
        });
      });
    }
  } catch (error) {
    console.error("[METU Mail Notifier] Failed to load popup state:", error);
    showToast("Could not load settings.", true);
  }
}

masterToggle.addEventListener("change", async () => {
  const next = masterToggle.checked;
  try {
    await writeStorage({ [KEYS.extensionEnabled]: next });
    applyMasterState(next);
    showToast(next ? "Extension resumed" : "Extension paused");
  } catch (error) {
    console.error("[METU Mail Notifier] Failed to save master toggle:", error);
    masterToggle.checked = !next;
    showToast("Could not save setting.", true);
  }
});

soundToggle.addEventListener("change", async () => {
  const next = soundToggle.checked;
  try {
    await writeStorage({ [KEYS.playNotificationSound]: next });
    showToast(next ? "Sound enabled" : "Sound disabled");
  } catch (error) {
    console.error("[METU Mail Notifier] Failed to save sound toggle:", error);
    soundToggle.checked = !next;
    showToast("Could not save setting.", true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KEYS.lastSuccessfulCheckTs]) {
    updateLastCheckTime(changes[KEYS.lastSuccessfulCheckTs].newValue);
  }
  if (area === 'local' && changes.extensionStatus) {
    updateStatusUI(changes.extensionStatus.newValue);
  }
});

manualCheckBtn.addEventListener("click", () => {
  if (manualCheckBtn.classList.contains("spinning")) return;
  manualCheckBtn.classList.add("spinning");
  chrome.runtime.sendMessage({ type: "MANUAL_CHECK" }, (result) => {
    manualCheckBtn.classList.remove("spinning");
    if (chrome.runtime.lastError) {
      showToast('Could not reach background. Try again.', true);
      return;
    }
    const text = REASON_TEXT[result?.reason] ?? 'Check complete.';
    showToast(text);
  });
});

initialize();
