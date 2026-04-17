import { createTimeoutController } from './createTimeoutController.js';
import { INBOX_URL } from './constants.js';
import { AUTH_REASON, AUTH_STATE } from './reasons.js';
import { extractRoundcubeToken, looksLikeRoundcubeLogin } from './roundcubeParse.js';
import {
  getWebmailCookiesForSessionGate,
  indicatesWebmailBrowserSession,
} from './webmailCookies.js';

/**
 * STATE_1 auth probe: try HEAD first (smaller than full HTML GET per roadmap §2.2).
 * If the server rejects HEAD (405 / 501), fall back to GET and classify from HTML.
 *
 * @param {AbortSignal} signal
 * @param {{ getWebmailCookiesForSessionGate?: () => Promise<Array<{ name?: string, value?: string }> | null> }} [deps]
 */
export async function probeAuthState(signal, deps = {}) {
  const cookieGetter = deps.getWebmailCookiesForSessionGate ?? getWebmailCookiesForSessionGate;
  const cookieList = await cookieGetter();
  if (cookieList !== null && !indicatesWebmailBrowserSession(cookieList)) {
    return { state: AUTH_STATE.UNAUTHENTICATED, reason: AUTH_REASON.NO_WEBMAIL_COOKIE, token: null };
  }

  const { signal: fetchSignal, cleanup } = createTimeoutController(10_000, signal);
  try {
    const headInit = {
      method: 'HEAD',
      credentials: 'include',
      cache: 'no-store',
      signal: fetchSignal,
    };

    const headRes = await fetch(INBOX_URL, headInit);

    let response;
    if (headRes.status === 405 || headRes.status === 501) {
      response = await fetch(INBOX_URL, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: fetchSignal,
      });
    } else if (!headRes.ok) {
      response = headRes;
    } else {
      const headUrl = headRes.url || '';
      if (headUrl.includes('_task=login')) {
        return { state: AUTH_STATE.UNAUTHENTICATED, reason: AUTH_REASON.LOGIN_REDIRECT, token: null };
      }
      response = await fetch(INBOX_URL, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: fetchSignal,
      });
    }

    if (!response.ok) {
      const finalUrl = response.url || '';
      if (finalUrl.includes('_task=login')) {
        return { state: AUTH_STATE.UNAUTHENTICATED, reason: AUTH_REASON.LOGIN_REDIRECT, token: null };
      }
      return { state: AUTH_STATE.UNKNOWN, reason: AUTH_REASON.HTTP_ERROR, token: null };
    }

    const html = await response.text();
    const finalUrl = response.url || '';

    if (finalUrl.includes('_task=login') || looksLikeRoundcubeLogin(html)) {
      return { state: AUTH_STATE.UNAUTHENTICATED, reason: AUTH_REASON.LOGIN_MARKERS_FOUND, token: null };
    }

    const token = extractRoundcubeToken(html);
    if (token) {
      return { state: AUTH_STATE.AUTHENTICATED, reason: AUTH_REASON.TOKEN_FOUND, token };
    }

    return { state: AUTH_STATE.UNKNOWN, reason: AUTH_REASON.TOKEN_MISSING, token: null };
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return { state: AUTH_STATE.UNKNOWN, reason: AUTH_REASON.TIMEOUT, token: null };
    }
    return { state: AUTH_STATE.UNKNOWN, reason: AUTH_REASON.NETWORK_ERROR, token: null };
  } finally {
    cleanup();
  }
}
