import { STORAGE_KEYS } from './storageSchema.js';
import { STATUS } from './reasons.js';
import { getStorage } from './chromeStorage.js';

export async function writeStatus(label, detail = '') {
  await chrome.storage.local.set({
    extensionStatus: { label, detail, ts: Date.now() },
  });
}

/** After CHECKING was written, stale-generation exits must not leave the UI on "Checking...". */
export async function writeStaleCheckStatus() {
  const stored = await getStorage([STORAGE_KEYS.machineState]);
  const persisted = stored[STORAGE_KEYS.machineState] === 'STATE_2' ? 'STATE_2' : 'STATE_1';
  const label = persisted === 'STATE_2' ? STATUS.MONITORING : STATUS.LOGGED_OUT;
  await writeStatus(label, '');
}
