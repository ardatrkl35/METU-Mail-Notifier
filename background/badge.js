import { LOG_EVENTS, log } from './logger.js';

const BADGE_ACCENT = '#1a73e8';

/**
 * Toolbar badge: show non-empty count or hide when zero.
 * @param {number} count
 */
export async function setUnreadBadge(count) {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const text = n > 0 ? String(n) : '';
  try {
    await chrome.action.setBadgeText({ text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_ACCENT });
    }
  } catch (e) {
    log('warn', LOG_EVENTS.NOTIFY_DELIVERY, { phase: 'badge', err: e?.message || String(e) });
  }
}

export async function clearActionBadge() {
  await setUnreadBadge(0);
}
