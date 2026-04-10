const KEYS = {
  extensionEnabled: "extensionEnabled",
  playNotificationSound: "playNotificationSound"
};

const masterToggle = document.getElementById("masterToggle");
const soundToggle = document.getElementById("soundToggle");
const disabledOverlay = document.getElementById("disabledOverlay");
const statusNode = document.getElementById("status");

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

async function initialize() {
  try {
    const stored = await readStorage([KEYS.extensionEnabled, KEYS.playNotificationSound]);
    const enabled = stored[KEYS.extensionEnabled] !== false;
    const soundOn = stored[KEYS.playNotificationSound] !== false;

    masterToggle.checked = enabled;
    soundToggle.checked = soundOn;
    applyMasterState(enabled);
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

initialize();
