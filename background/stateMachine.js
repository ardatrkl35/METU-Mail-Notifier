import {
  AUTH_CHECK_ALARM,
  AUTH_CHECK_INTERVAL_MINUTES,
  MAIL_CHECK_ALARM,
  MAIL_CHECK_INTERVAL_MINUTES,
} from './constants.js';
import { clearActionBadge } from './badge.js';
import { getStorage, setStorage } from './chromeStorage.js';
import { LOG_EVENTS, log } from './logger.js';
import { REASON, STATUS } from './reasons.js';
import { STORAGE_KEYS } from './storageSchema.js';
import { writeStatus } from './statusWrite.js';
import { workerState } from './workerState.js';

function getAlarm(name) {
  return new Promise((resolve) => {
    chrome.alarms.get(name, resolve);
  });
}

async function clearAlarmForGateway(name) {
  await new Promise((resolve) => {
    chrome.alarms.clear(name, resolve);
  });
  log('info', LOG_EVENTS.STATE_TRANSITION, { phase: 'alarm_cleared', name });
}

/**
 * Read-only: canonical machine state from storage.
 */
export async function getPersistedMachineState() {
  const stored = await getStorage([STORAGE_KEYS.machineState]);
  return stored[STORAGE_KEYS.machineState] === 'STATE_2' ? 'STATE_2' : 'STATE_1';
}

export async function isExtensionEnabled() {
  const stored = await getStorage([STORAGE_KEYS.extensionEnabled]);
  return stored[STORAGE_KEYS.extensionEnabled] !== false;
}

/**
 * Single gateway for machine state persistence and alarm schedule.
 */
export async function transitionToState(nextState, reason) {
  if (reason === REASON.EXTENSION_DISABLED) {
    workerState.currentState = 'STATE_1';
    await setStorage({
      [STORAGE_KEYS.machineState]: 'STATE_1',
      [STORAGE_KEYS.unreadCount]: 0,
    });
    await clearAlarmForGateway(AUTH_CHECK_ALARM);
    await clearAlarmForGateway(MAIL_CHECK_ALARM);
    await clearActionBadge();
    log('info', LOG_EVENTS.STATE_TRANSITION, { phase: 'extension_disabled', machineState: 'STATE_1' });
    return;
  }

  if (nextState !== 'STATE_1' && nextState !== 'STATE_2') {
    log('warn', LOG_EVENTS.STATE_TRANSITION, { phase: 'invalid_next_state', nextState });
    return;
  }

  workerState.currentState = nextState;
  const persist = { [STORAGE_KEYS.machineState]: nextState };
  if (nextState === 'STATE_1') {
    persist[STORAGE_KEYS.unreadCount] = 0;
  }
  await setStorage(persist);
  await clearAlarmForGateway(AUTH_CHECK_ALARM);
  await clearAlarmForGateway(MAIL_CHECK_ALARM);

  if (nextState === 'STATE_1') {
    await clearActionBadge();
    chrome.alarms.create(AUTH_CHECK_ALARM, { periodInMinutes: AUTH_CHECK_INTERVAL_MINUTES });
    log('info', LOG_EVENTS.STATE_TRANSITION, { phase: 'alarms_set', state: 'STATE_1', reason });
  } else {
    chrome.alarms.create(MAIL_CHECK_ALARM, { periodInMinutes: MAIL_CHECK_INTERVAL_MINUTES });
    log('info', LOG_EVENTS.STATE_TRANSITION, { phase: 'alarms_set', state: 'STATE_2', reason });
  }
}

/**
 * Single-flight queue: module load, onStartup, and onInstalled can all call
 * reconcile in the same tick; serialize so two passes never interleave reads
 * and duplicate alarm repairs (Chrome vs Edge cold-start timing).
 */
let reconcileTail = Promise.resolve();

async function executeReconcileRuntimeState() {
  workerState.currentGeneration++;
  if (!(await isExtensionEnabled())) {
    log('info', LOG_EVENTS.STATE_TRANSITION, { phase: 'reconcile', detail: 'extension_disabled' });
    await transitionToState('STATE_1', REASON.EXTENSION_DISABLED);
    return;
  }

  const stored = await getStorage([STORAGE_KEYS.machineState]);
  const persisted = stored[STORAGE_KEYS.machineState] === 'STATE_2' ? 'STATE_2' : 'STATE_1';
  workerState.currentState = persisted;

  const authAlarm = await getAlarm(AUTH_CHECK_ALARM);
  const mailAlarm = await getAlarm(MAIL_CHECK_ALARM);

  if (persisted === 'STATE_2') {
    if (mailAlarm && !authAlarm) {
      log('info', LOG_EVENTS.STATE_TRANSITION, { phase: 'reconcile', detail: 'state2_ok' });
      return;
    }
    log('info', LOG_EVENTS.STATE_TRANSITION, {
      phase: 'reconcile',
      detail: 'repair_state2',
      mailAlarm: !!mailAlarm,
      authAlarm: !!authAlarm,
    });
    await transitionToState('STATE_2', REASON.RUNTIME_RECONCILE);
    return;
  }

  if (authAlarm && !mailAlarm) {
    log('info', LOG_EVENTS.STATE_TRANSITION, { phase: 'reconcile', detail: 'state1_ok' });
    return;
  }
  log('info', LOG_EVENTS.STATE_TRANSITION, {
    phase: 'reconcile',
    detail: 'repair_state1',
    authAlarm: !!authAlarm,
    mailAlarm: !!mailAlarm,
  });
  await transitionToState('STATE_1', REASON.RUNTIME_RECONCILE);
}

export async function reconcileRuntimeState() {
  const next = reconcileTail.then(() => executeReconcileRuntimeState());
  reconcileTail = next.catch(() => {});
  return next;
}

export async function stopStateMachine() {
  log('info', LOG_EVENTS.STATE_TRANSITION, { phase: 'stop', reason: 'extension_disabled' });
  await writeStatus(STATUS.PAUSED);
  await transitionToState('STATE_1', REASON.EXTENSION_DISABLED);
  workerState.cachedRcToken = null;
  await setStorage({
    [STORAGE_KEYS.tokenUnavailableCount]: 0,
    [STORAGE_KEYS.popupActivityLog]: [],
  });
  workerState.checkInProgress = false;

  workerState.currentGeneration++;

  if (workerState.authCheckController) {
    workerState.authCheckController.abort();
    workerState.authCheckController = null;
  }
  if (workerState.mailCheckController) {
    workerState.mailCheckController.abort();
    workerState.mailCheckController = null;
  }
}
