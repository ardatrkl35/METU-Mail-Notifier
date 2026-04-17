import { getStorage, setStorage } from './chromeStorage.js';
import { STORAGE_KEYS } from './storageSchema.js';
import { writeStaleCheckStatus } from './statusWrite.js';

/**
 * Persist stale-generation discard + refresh popup status (P2-7).
 * @param {'auth' | 'mail'} source
 */
export async function handleStaleGenerationExit(source) {
  const key =
    source === 'auth' ? STORAGE_KEYS.staleAuthDiscardCount : STORAGE_KEYS.staleMailDiscardCount;
  const cur = await getStorage([key]);
  const prev = Number.isFinite(cur[key]) ? cur[key] : 0;
  await setStorage({ [key]: prev + 1 });
  await writeStaleCheckStatus();
}
