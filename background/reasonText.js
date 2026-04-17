/**
 * User-visible copy for each `REASON` code (JOB-P2-5 / P1-2).
 * Popup imports this module — keep strings extension-safe (no raw HTML).
 */
import { REASON } from './reasons.js';

const TABLE = {
  [REASON.NEW_MAIL]: 'New mail found!',
  [REASON.NO_NEW_MAIL]: 'No new mail.',
  [REASON.LOGIN_REQUIRED]: 'Not logged in — please open webmail to sign in.',
  [REASON.NETWORK_ERROR]: 'Network error — check your connection.',
  [REASON.AUTH_TIMEOUT]: 'Connection to webmail timed out.',
  [REASON.AUTH_HTTP_ERROR]: 'Webmail returned an error — try again later.',
  [REASON.AUTH_TOKEN_MISSING]: 'No session token found — open webmail to sign in or retry.',
  [REASON.AUTH_NETWORK_ERROR]: 'Could not reach webmail — check your connection.',
  [REASON.SKIPPED_IN_PROGRESS]: 'A check is already running.',
  [REASON.TOKEN_UNAVAILABLE]: 'Could not read session — will retry.',
  [REASON.UNKNOWN_ERROR]: 'An unexpected error occurred.',
  [REASON.STALE_GENERATION]: 'Check was superseded — status updated.',
  [REASON.RUNTIME_RECONCILE]: 'Extension resynced its schedule.',
  [REASON.EXTENSION_DISABLED]: 'Extension is paused — enable it to check mail.',
};

for (const v of Object.values(REASON)) {
  if (!(v in TABLE)) {
    throw new Error(`[reasonText] Missing copy for REASON: ${v}`);
  }
}

export const REASON_TEXT = Object.freeze({ ...TABLE });

const FALLBACK = 'Check complete.';

/**
 * @param {string | undefined | null} reason
 * @param {string} [fallback]
 * @returns {string}
 */
export function reasonTextFor(reason, fallback = FALLBACK) {
  if (reason != null && typeof reason === 'string' && Object.hasOwn(REASON_TEXT, reason)) {
    return REASON_TEXT[reason];
  }
  return fallback;
}
