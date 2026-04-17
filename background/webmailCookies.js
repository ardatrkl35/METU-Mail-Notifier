import { BASE_URL } from './constants.js';

/**
 * True when the browser cookie jar for webmail includes a non-empty cookie that
 * typically indicates the user has opened METU Roundcube in this profile (JOB-P3-2).
 * When false, we skip the inbox fetch and treat the probe as logged out.
 *
 * @param {Array<{ name?: string, value?: string }>} cookies
 * @returns {boolean}
 */
export function indicatesWebmailBrowserSession(cookies) {
  if (!Array.isArray(cookies)) return false;
  for (const c of cookies) {
    const name = c?.name;
    const value = c?.value;
    if (typeof name !== 'string' || !value) continue;
    if (name === 'PHPSESSID') return true;
    if (name.startsWith('roundcube_')) return true;
  }
  return false;
}

/**
 * @param {typeof chrome | undefined} chromeObj
 * @returns {Promise<Array<{ name?: string, value?: string }> | null>} null if the API is missing, fails, or returns a non-array (fail-open to fetch).
 */
export function getWebmailCookiesForSessionGate(chromeObj = typeof chrome !== 'undefined' ? chrome : undefined) {
  const api = chromeObj?.cookies;
  if (!api?.getAll) return Promise.resolve(null);
  return new Promise((resolve) => {
    api.getAll({ url: BASE_URL }, (list) => {
      if (chromeObj.runtime?.lastError) {
        resolve(null);
        return;
      }
      resolve(Array.isArray(list) ? list : null);
    });
  });
}
