import { LOGIN_NOTIFICATION_ID, MAIL_NOTIFICATION_ID, NO_NEW_MAIL_NOTIFICATION_ID } from './constants.js';
import { LOG_EVENTS, log } from './logger.js';
import { requestNotificationChime } from './notificationSound.js';

// Fixed `chrome.notifications` ids (MAIL_NOTIFICATION_ID, LOGIN_NOTIFICATION_ID, …)
// intentionally replace prior toasts of the same kind so rapid alarms do not stack.
// Unread volume remains visible on the toolbar badge after a notification is dismissed.

/**
 * @param {string} notificationId
 * @param {{ title: string, message: string }} opts
 * @returns {Promise<boolean>}
 */
async function createNativeNotification(notificationId, { title, message }) {
  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      title,
      message: message || ' ',
      iconUrl: chrome.runtime.getURL('icons/icon.png'),
    });
    return true;
  } catch (e) {
    log('warn', LOG_EVENTS.NOTIFY_DELIVERY, {
      phase: 'native_create',
      notificationId,
      err: e?.message || String(e),
    });
    return false;
  }
}

export async function notifyNewMail(count, playSound) {
  if (count <= 0) return;
  const message = count === 1 ? 'You have 1 new email' : `You have ${count} new emails`;
  await createNativeNotification(MAIL_NOTIFICATION_ID, {
    title: 'METU Mail Notifier',
    message,
  });
  if (playSound) await requestNotificationChime('newMail');
}

export async function notifySessionExpired(playSound) {
  const ok = await createNativeNotification(LOGIN_NOTIFICATION_ID, {
    title: 'METU Mail Notifier',
    message: 'Session expired. Please sign in to webmail.metu.edu.tr again.',
  });
  if (playSound) await requestNotificationChime('auth');
  return ok;
}

export async function notifyPleaseLogin(playSound) {
  void playSound;
  return createNativeNotification(LOGIN_NOTIFICATION_ID, {
    title: 'METU Mail Notifier',
    message: 'Please log in to webmail.metu.edu.tr.',
  });
}

export async function notifyNoNewMail(playSound) {
  await createNativeNotification(NO_NEW_MAIL_NOTIFICATION_ID, {
    title: 'METU Mail Notifier',
    message: 'No new mail.',
  });
  if (playSound) await requestNotificationChime('noNewMail');
}
