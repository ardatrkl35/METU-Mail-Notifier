import { getStorage, setStorage } from './chromeStorage.js';
import { STORAGE_KEYS, normalizePopupActivityLog } from './storageSchema.js';

const MAX_ENTRIES = 5;

/** @typedef {{ type: string, n?: number }} PopupActivityInput */

/**
 * Append a short, non-PII activity row for the popup “Recent activity” list (JOB-P3-7).
 * @param {PopupActivityInput} entry
 */
export async function appendPopupActivity(entry) {
  if (!entry || typeof entry.type !== 'string') return;
  const normalizedType = normalizePopupActivityLog([{ ts: Date.now(), type: entry.type, n: entry.n }]);
  if (normalizedType.length === 0) return;
  const row = normalizedType[0];
  const stored = await getStorage([STORAGE_KEYS.popupActivityLog]);
  const prev = normalizePopupActivityLog(stored[STORAGE_KEYS.popupActivityLog]);
  const next = [...prev, row].slice(-MAX_ENTRIES);
  await setStorage({ [STORAGE_KEYS.popupActivityLog]: next });
}
