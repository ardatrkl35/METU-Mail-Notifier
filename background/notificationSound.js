import { LOG_EVENTS, log } from './logger.js';

export const CHIME_MESSAGE_TYPE = 'METU_PLAY_CHIME';

const OFFSCREEN_PATH = 'offscreen/sound.html';

/** @type {Promise<void>} */
let ensureChain = Promise.resolve();

/** Test hook: reset serialized chime queue between Vitest cases. */
export function resetNotificationSoundGateForTests() {
  ensureChain = Promise.resolve();
}

/**
 * Ensures the offscreen audio document exists. Returns whether it is safe to call
 * `chrome.runtime.sendMessage` for chime playback.
 *
 * @returns {Promise<boolean>}
 */
async function ensureOffscreenForChime() {
  if (!chrome.offscreen?.createDocument) {
    log('warn', LOG_EVENTS.NOTIFY_DELIVERY, { phase: 'chime_offscreen_unavailable' });
    return false;
  }

  const documentUrl = chrome.runtime.getURL(OFFSCREEN_PATH);

  if (chrome.runtime.getContexts) {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [documentUrl],
    });
    if (existing.length > 0) return true;
  }

  const reasons = chrome.offscreen.Reasons?.AUDIO_PLAYBACK
    ? [chrome.offscreen.Reasons.AUDIO_PLAYBACK]
    : ['AUDIO_PLAYBACK'];

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons,
      justification:
        'Play optional user-enabled notification chimes for mail checks (new mail, no new mail, session alerts).',
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes('already') || msg.includes('single offscreen') || msg.includes('Only a single')) {
      return true;
    }
    throw e;
  }
  return true;
}

/**
 * Plays a short chime in an offscreen document (serialized with other chimes).
 * Returns a promise that settles when this attempt finishes — **callers should await**
 * so the MV3 service worker stays alive until offscreen playback completes.
 * Never throws; logs and continues on failure.
 *
 * @param {'newMail' | 'auth' | 'noNewMail'} kind
 * @returns {Promise<void>}
 */
export function requestNotificationChime(kind) {
  ensureChain = ensureChain.then(async () => {
    try {
      const ready = await ensureOffscreenForChime();
      if (!ready) return;
      const chimeResponse = await chrome.runtime.sendMessage({ type: CHIME_MESSAGE_TYPE, kind });
      if (chimeResponse?.ok !== true) {
        log('warn', LOG_EVENTS.NOTIFY_DELIVERY, { phase: 'chime_bad_response', kind, chimeResponse });
      }
    } catch (e) {
      log('warn', LOG_EVENTS.NOTIFY_DELIVERY, { phase: 'chime', err: e?.message || String(e) });
    }
  });
  return ensureChain;
}
