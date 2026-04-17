import { runAuthCheck } from './authCheck.js';
import {
  AUTH_CHECK_ALARM,
  INBOX_URL,
  LOGIN_NOTIFICATION_ID,
  MAIL_CHECK_ALARM,
  MAIL_NOTIFICATION_ID,
  NO_NEW_MAIL_NOTIFICATION_ID,
} from './constants.js';
import { LOG_EVENTS, log, setVerboseDebugLogging } from './logger.js';
import { executeStorageExtensionEnabledChange } from './storageEnableFlow.js';
import { STORAGE_KEYS } from './storageSchema.js';
import { REASON, STATUS } from './reasons.js';
import { writeStatus } from './statusWrite.js';
import {
  getPersistedMachineState,
  isExtensionEnabled,
  reconcileRuntimeState,
  stopStateMachine,
  transitionToState,
} from './stateMachine.js';
import { getStorage, setStorage } from './chromeStorage.js';
import { isValidCheckResult, makeResult } from './checkHelpers.js';
import { runMailCheck } from './mailCheck.js';
import { openOrFocusInbox } from './tabNavigation.js';
import { workerState } from './workerState.js';

async function syncVerboseDebugFromStorage() {
  try {
    const s = await getStorage([STORAGE_KEYS.verboseDebugLogs]);
    setVerboseDebugLogging(s[STORAGE_KEYS.verboseDebugLogs] === true);
  } catch {
    setVerboseDebugLogging(false);
  }
}

void syncVerboseDebugFromStorage();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_INBOX') {
    (async () => {
      try {
        await openOrFocusInbox(message.url);
        sendResponse({ ok: true });
      } catch (e) {
        log('warn', LOG_EVENTS.RUNTIME, { phase: 'open_inbox', err: e?.message || String(e) });
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
  if (message.type === 'MANUAL_CHECK') {
    log('info', LOG_EVENTS.RUNTIME, { phase: 'manual_check' });
    (async () => {
      try {
        const persistedState = await getPersistedMachineState();
        const stateBefore = persistedState;
        workerState.currentState = persistedState;

        let result;
        if (persistedState === 'STATE_2') {
          result = await runMailCheck(true);
        } else {
          result = await runAuthCheck(true);
        }
        if (
          isValidCheckResult(result) &&
          result.reason !== REASON.STALE_GENERATION &&
          result.state !== stateBefore
        ) {
          await transitionToState(result.state, result.reason);
        }
        sendResponse(
          isValidCheckResult(result)
            ? result
            : makeResult(false, workerState.currentState, REASON.UNKNOWN_ERROR),
        );
      } catch (error) {
        log('error', LOG_EVENTS.RUNTIME, { phase: 'manual_check', err: error });
        sendResponse(makeResult(false, workerState.currentState, REASON.UNKNOWN_ERROR));
      }
    })();
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  log('info', LOG_EVENTS.RUNTIME, { phase: 'on_installed' });
  const existingFlags = await getStorage([STORAGE_KEYS.hasWarnedLogin]);
  if (existingFlags[STORAGE_KEYS.hasWarnedLogin] === undefined) {
    await setStorage({ [STORAGE_KEYS.hasWarnedLogin]: false });
  }
  await reconcileRuntimeState();
  if (await isExtensionEnabled()) await runAuthCheck();
});

chrome.runtime.onStartup.addListener(async () => {
  log('info', LOG_EVENTS.RUNTIME, { phase: 'on_startup' });
  await reconcileRuntimeState();
  if (await isExtensionEnabled()) await runAuthCheck();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm) return;
  if (alarm.name === AUTH_CHECK_ALARM) {
    log('info', LOG_EVENTS.RUNTIME, { phase: 'alarm', name: AUTH_CHECK_ALARM });
    runAuthCheck();
    return;
  }
  if (alarm.name === MAIL_CHECK_ALARM) {
    log('info', LOG_EVENTS.RUNTIME, { phase: 'alarm', name: MAIL_CHECK_ALARM });
    runMailCheck();
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const opensInbox =
    notificationId === MAIL_NOTIFICATION_ID ||
    notificationId === LOGIN_NOTIFICATION_ID ||
    notificationId === NO_NEW_MAIL_NOTIFICATION_ID;
  if (opensInbox) {
    chrome.tabs.create({ url: INBOX_URL });
    chrome.notifications.clear(notificationId);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (STORAGE_KEYS.verboseDebugLogs in changes) {
    setVerboseDebugLogging(changes[STORAGE_KEYS.verboseDebugLogs].newValue === true);
  }
  if (!(STORAGE_KEYS.extensionEnabled in changes)) return;
  (async () => {
    await executeStorageExtensionEnabledChange(changes[STORAGE_KEYS.extensionEnabled].newValue, {
      reconcileRuntimeState,
      runAuthCheck: () => runAuthCheck(),
      stopStateMachine,
      writeStatus,
      STATUS,
    });
  })();
});

reconcileRuntimeState().catch((error) => {
  log('error', LOG_EVENTS.RUNTIME, { phase: 'reconcile_startup', err: error });
});
