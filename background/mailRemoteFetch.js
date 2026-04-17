/**
 * Parallel Roundcube mail AJAX fetches (JOB-P3-3): list + getunread.
 */
import { BASE_URL } from './constants.js';
import { LOG_EVENTS, log } from './logger.js';
import { parseGetUnreadExecResponse } from './roundcubeParse.js';

export function buildMailListUrl(token) {
  return `${BASE_URL}?_task=mail&_action=list&_mbox=INBOX&_remote=1&_token=${encodeURIComponent(token)}`;
}

export function buildGetUnreadUrl(token) {
  return `${BASE_URL}?_task=mail&_action=getunread&_mbox=INBOX&_remote=1&_token=${encodeURIComponent(token)}`;
}

/**
 * @param {string} token
 * @param {AbortSignal} signal
 * @returns {Promise<{ listResponse: Response, getUnreadResponse: Response }>}
 */
export async function fetchListAndGetUnread(token, signal) {
  const listUrl = buildMailListUrl(token);
  const getUnreadUrl = buildGetUnreadUrl(token);
  const init = {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    signal,
  };
  const [getUnreadResponse, listResponse] = await Promise.all([
    fetch(getUnreadUrl, init),
    fetch(listUrl, init),
  ]);
  return { listResponse, getUnreadResponse };
}

/**
 * @param {Response} getUnreadResponse
 * @returns {Promise<number | null>}
 */
export async function tryInboxUnseenFromGetUnread(getUnreadResponse) {
  if (!getUnreadResponse.ok) return null;
  try {
    const guText = await getUnreadResponse.text();
    const guUrl = getUnreadResponse.url || '';
    const guCt = (getUnreadResponse.headers.get('content-type') || '').toLowerCase();
    if (guUrl.includes('_task=login') || guCt.includes('text/html')) return null;
    const guData = JSON.parse(guText);
    const guParsed = parseGetUnreadExecResponse(guData?.exec ?? '');
    if (guParsed.ok && guParsed.unseen != null) {
      log('debug', LOG_EVENTS.MAIL_PARSE, { phase: 'getunread_ok', unseen: guParsed.unseen });
      return guParsed.unseen;
    }
  } catch {
    /* list path supplies fallback */
  }
  return null;
}
