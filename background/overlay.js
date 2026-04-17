import { INBOX_URL } from './constants.js';
import { LOG_EVENTS, log } from './logger.js';

/**
 * Check whether the user has granted optional <all_urls> (Path B).
 * @returns {Promise<boolean>}
 */
export async function canInjectOverlay() {
  return new Promise((resolve) => {
    if (!chrome.permissions?.contains) {
      resolve(false);
      return;
    }
    chrome.permissions.contains({ origins: ['<all_urls>'] }, resolve);
  });
}

/**
 * @param {number} tabId
 * @param {{ kind: string, count?: number, inboxUrl?: string }} payload
 * @returns {Promise<boolean>}
 */
export async function tryInjectOverlay(tabId, payload) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/overlayDom.js', 'content/content.js'],
    });
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_OVERLAY',
      ...payload,
      inboxUrl: INBOX_URL,
    });
    return response?.ok === true;
  } catch (e) {
    log('info', LOG_EVENTS.NOTIFY_DELIVERY, {
      phase: 'overlay_inject',
      tabId,
      err: e?.message || String(e),
    });
    return false;
  }
}

/**
 * @param {{ kind: string, count?: number }} opts
 * @returns {Promise<boolean>} overlayShown
 */
export async function showNotificationOverlay({ kind, count = 0 }) {
  let overlayShown = false;

  if (await canInjectOverlay()) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (
        tab?.id != null &&
        tab.url &&
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('chrome-extension://')
      ) {
        overlayShown = await tryInjectOverlay(tab.id, { kind, count });
      }
    } catch (e) {
      log('info', LOG_EVENTS.NOTIFY_DELIVERY, { phase: 'overlay_tab_query', err: e?.message || String(e) });
    }
  }

  return overlayShown;
}
