import { probeAuthState } from './authProbe.js';
import { LOGIN_WARNING_INTERVAL_MS } from './constants.js';
import { getStorage, setStorage } from './chromeStorage.js';
import { LOG_EVENTS, log } from './logger.js';
import { makeGenerationGuard, makeResult } from './checkHelpers.js';
import {
  notifyPleaseLogin,
} from './notifications.js';
import {
  AUTH_STATE,
  mapAuthUnknownProbeReasonToPublicReason,
  REASON,
  STATUS,
} from './reasons.js';
import { resolveLastLoginWarningTs, STORAGE_KEYS } from './storageSchema.js';
import { handleStaleGenerationExit } from './staleTelemetry.js';
import { appendPopupActivity } from './popupActivityLog.js';
import { writeStatus } from './statusWrite.js';
import { isExtensionEnabled, transitionToState } from './stateMachine.js';
import { workerState } from './workerState.js';

export async function runAuthCheck(isManual = false) {
  if (workerState.checkInProgress) {
    log('info', LOG_EVENTS.AUTH_PROBE, { phase: 'skipped', reason: 'in_progress' });
    return makeResult(false, 'STATE_1', REASON.SKIPPED_IN_PROGRESS);
  }
  if (!(await isExtensionEnabled())) {
    log('info', LOG_EVENTS.AUTH_PROBE, { phase: 'skipped', reason: 'extension_disabled' });
    return makeResult(false, 'STATE_1', REASON.SKIPPED_IN_PROGRESS);
  }

  const capturedGeneration = workerState.currentGeneration;
  const isStale = makeGenerationGuard(capturedGeneration);
  workerState.authCheckController = new AbortController();
  const signal = workerState.authCheckController.signal;

  workerState.checkInProgress = true;

  try {
    log('info', LOG_EVENTS.AUTH_PROBE, { phase: 'run' });
    await writeStatus(STATUS.CHECKING);
    const stored = await getStorage([
      STORAGE_KEYS.hasWarnedLogin,
      STORAGE_KEYS.lastLoginWarningTs,
      STORAGE_KEYS.playNotificationSound,
    ]);
    const legacyWarned = stored[STORAGE_KEYS.hasWarnedLogin] === true;
    const storedTs = stored[STORAGE_KEYS.lastLoginWarningTs];
    const lastLoginWarningTs = resolveLastLoginWarningTs(
      Number.isFinite(storedTs) ? storedTs : NaN,
      legacyWarned,
      Date.now(),
      LOGIN_WARNING_INTERVAL_MS,
    );
    const now = Date.now();
    const shouldWarnThrottle = now - lastLoginWarningTs > LOGIN_WARNING_INTERVAL_MS;
    const playSound = stored[STORAGE_KEYS.playNotificationSound] !== false;
    const probe = await probeAuthState(signal);

    if (probe.state === AUTH_STATE.AUTHENTICATED) {
      if (isStale()) {
        log('debug', LOG_EVENTS.AUTH_PROBE, { phase: 'stale_discard' });
        await handleStaleGenerationExit('auth');
        return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
      }
      workerState.cachedRcToken = probe.token;
      log('info', LOG_EVENTS.AUTH_PROBE, {
        phase: 'authenticated',
        probeReason: probe.reason,
        transition: 'STATE_1_to_STATE_2',
      });
      await transitionToState('STATE_2', REASON.NO_NEW_MAIL);
      await writeStatus(STATUS.MONITORING);
      await appendPopupActivity({ type: 'signed_in' });
      return makeResult(true, 'STATE_2', REASON.NO_NEW_MAIL);
    }
    if (probe.state === AUTH_STATE.UNAUTHENTICATED) {
      if (isStale()) {
        await handleStaleGenerationExit('auth');
        return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
      }
      await writeStatus(STATUS.LOGGED_OUT, probe.reason);
      if (isManual) await appendPopupActivity({ type: 'session_lost' });
      if (isManual || shouldWarnThrottle) {
        log('info', LOG_EVENTS.AUTH_PROBE, {
          phase: 'unauthenticated_warn',
          probeReason: probe.reason,
          isManual,
        });
        const delivered = await notifyPleaseLogin(playSound);
        if (delivered && !isManual) {
          await setStorage({
            [STORAGE_KEYS.lastLoginWarningTs]: now,
            [STORAGE_KEYS.hasWarnedLogin]: true,
          });
        } else if (!delivered) {
          log('info', LOG_EVENTS.NOTIFY_DELIVERY, { phase: 'login_warning', delivered: false });
        }
      } else {
        log('info', LOG_EVENTS.AUTH_PROBE, { phase: 'unauthenticated_throttled', probeReason: probe.reason });
      }
      return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
    }
    const publicReason = mapAuthUnknownProbeReasonToPublicReason(probe.reason);
    log('info', LOG_EVENTS.AUTH_PROBE, {
      phase: 'unknown',
      probeReason: probe.reason,
      publicReason,
    });
    await writeStatus(STATUS.ERROR, probe.reason);
    return makeResult(false, 'STATE_1', publicReason);
  } catch (error) {
    log('error', LOG_EVENTS.AUTH_PROBE, { phase: 'exception', err: error });
    await writeStatus(STATUS.ERROR, error.message);
    return makeResult(false, 'STATE_1', REASON.UNKNOWN_ERROR);
  } finally {
    workerState.checkInProgress = false;
    workerState.authCheckController = null;
  }
}
