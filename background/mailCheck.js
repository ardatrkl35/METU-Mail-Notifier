import { probeAuthState } from './authProbe.js';
import { createTimeoutController } from './createTimeoutController.js';
import { setUnreadBadge } from './badge.js';
import { TOKEN_UNAVAILABLE_THRESHOLD } from './constants.js';
import { getStorage, setStorage } from './chromeStorage.js';
import { LOG_EVENTS, log } from './logger.js';
import { makeGenerationGuard, makeResult } from './checkHelpers.js';
import {
  notifyNewMail,
  notifyNoNewMail,
  notifyPleaseLogin,
  notifySessionExpired,
} from './notifications.js';
import { showNotificationOverlay } from './overlay.js';
import { appendPopupActivity } from './popupActivityLog.js';
import { fetchListAndGetUnread, tryInboxUnseenFromGetUnread } from './mailRemoteFetch.js';
import { looksLikeRoundcubeLogin, parseMailExecResponse } from './roundcubeParse.js';
import { AUTH_STATE, REASON, STATUS } from './reasons.js';
import { STORAGE_KEYS } from './storageSchema.js';
import { handleStaleGenerationExit } from './staleTelemetry.js';
import { writeStatus } from './statusWrite.js';
import { isExtensionEnabled, transitionToState } from './stateMachine.js';
import { workerState } from './workerState.js';

export async function runMailCheck(isManual = false) {
  if (workerState.checkInProgress) {
    log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'skipped', reason: 'in_progress' });
    return makeResult(false, 'STATE_2', REASON.SKIPPED_IN_PROGRESS);
  }
  if (!(await isExtensionEnabled())) {
    log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'skipped', reason: 'extension_disabled' });
    return makeResult(false, 'STATE_2', REASON.SKIPPED_IN_PROGRESS);
  }
  const capturedGeneration = workerState.currentGeneration;
  const isStale = makeGenerationGuard(capturedGeneration);
  workerState.mailCheckController = new AbortController();
  const signal = workerState.mailCheckController.signal;

  workerState.checkInProgress = true;
  try {
    log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'run' });
    await writeStatus(STATUS.CHECKING);
    const stored = await getStorage([
      STORAGE_KEYS.lastSeenId,
      STORAGE_KEYS.playNotificationSound,
      STORAGE_KEYS.tokenUnavailableCount,
    ]);
    const playSound = stored[STORAGE_KEYS.playNotificationSound] !== false;
    let tokenUnavailableCount = Number.isFinite(stored[STORAGE_KEYS.tokenUnavailableCount])
      ? stored[STORAGE_KEYS.tokenUnavailableCount]
      : 0;
    const previousLastSeen = Number.isFinite(stored[STORAGE_KEYS.lastSeenId])
      ? stored[STORAGE_KEYS.lastSeenId]
      : null;

    if (!workerState.cachedRcToken) {
      log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'reprobe_token' });
      const reprobe = await probeAuthState(signal);
      if (reprobe.token) {
        if (isStale()) {
          await handleStaleGenerationExit('mail');
          return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
        }
        workerState.cachedRcToken = reprobe.token;
        await setStorage({ [STORAGE_KEYS.tokenUnavailableCount]: 0 });
      }
      if (!workerState.cachedRcToken) {
        if (reprobe.state === AUTH_STATE.UNAUTHENTICATED) {
          if (isStale()) {
            await handleStaleGenerationExit('mail');
            return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
          }
          log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'session_invalid_no_token' });
          if (isManual) {
            await notifyPleaseLogin(playSound);
            void showNotificationOverlay({ kind: 'pleaseLogin' });
          } else {
            await notifySessionExpired(playSound);
            void showNotificationOverlay({ kind: 'sessionExpired' });
          }
          await setStorage({ [STORAGE_KEYS.tokenUnavailableCount]: 0 });
          await transitionToState('STATE_1', REASON.LOGIN_REQUIRED);
          await writeStatus(STATUS.LOGGED_OUT);
          await appendPopupActivity({ type: 'session_lost' });
          return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
        }
        if (isStale()) {
          await handleStaleGenerationExit('mail');
          return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
        }
        tokenUnavailableCount++;
        await setStorage({ [STORAGE_KEYS.tokenUnavailableCount]: tokenUnavailableCount });
        log('debug', LOG_EVENTS.MAIL_PARSE, {
          phase: 'token_unavailable',
          count: tokenUnavailableCount,
          threshold: TOKEN_UNAVAILABLE_THRESHOLD,
        });

        if (tokenUnavailableCount >= TOKEN_UNAVAILABLE_THRESHOLD) {
          log('debug', LOG_EVENTS.MAIL_PARSE, { phase: 'token_unavailable_threshold' });
          if (isStale()) {
            await handleStaleGenerationExit('mail');
            return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
          }
          workerState.cachedRcToken = null;
          await setStorage({ [STORAGE_KEYS.tokenUnavailableCount]: 0 });
          await transitionToState('STATE_1', REASON.TOKEN_UNAVAILABLE);
          await writeStatus(STATUS.LOGGED_OUT);
          await appendPopupActivity({ type: 'session_lost' });
          return makeResult(false, 'STATE_1', REASON.TOKEN_UNAVAILABLE);
        }
        await writeStatus(STATUS.MONITORING);
        return makeResult(false, 'STATE_2', REASON.TOKEN_UNAVAILABLE);
      }
    }
    const exitLoggedOutFromListResponse = async (detail) => {
      log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'session_lost', detail });
      workerState.cachedRcToken = null;
      await setStorage({ [STORAGE_KEYS.tokenUnavailableCount]: 0 });
      if (isStale()) {
        await handleStaleGenerationExit('mail');
        return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
      }
      if (isManual) {
        await notifyPleaseLogin(playSound);
        void showNotificationOverlay({ kind: 'pleaseLogin' });
      } else {
        await notifySessionExpired(playSound);
        void showNotificationOverlay({ kind: 'sessionExpired' });
      }
      await transitionToState('STATE_1', REASON.LOGIN_REQUIRED);
      await writeStatus(STATUS.LOGGED_OUT);
      await appendPopupActivity({ type: 'session_lost' });
      return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
    };

    let listResponse;
    let getUnreadResponse;
    const mailFetchTimeout = createTimeoutController(20_000, signal);
    try {
      ({ listResponse, getUnreadResponse } = await fetchListAndGetUnread(
        workerState.cachedRcToken,
        mailFetchTimeout.signal,
      ));
    } finally {
      mailFetchTimeout.cleanup();
    }
    if (!listResponse.ok) {
      if (listResponse.status === 401 || listResponse.status === 403) {
        log('info', LOG_EVENTS.MAIL_PARSE, {
          phase: 'http_session_expired',
          status: listResponse.status,
        });
        workerState.cachedRcToken = null;
        if (isStale()) {
          await handleStaleGenerationExit('mail');
          return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
        }
        await notifySessionExpired(playSound);
        void showNotificationOverlay({ kind: 'sessionExpired' });
        await setStorage({ [STORAGE_KEYS.tokenUnavailableCount]: 0 });
        await transitionToState('STATE_1', REASON.LOGIN_REQUIRED);
        await writeStatus(STATUS.LOGGED_OUT);
        await appendPopupActivity({ type: 'session_lost' });
        return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
      }
      log('warn', LOG_EVENTS.MAIL_PARSE, { phase: 'http_error', status: listResponse.status });
      await writeStatus(STATUS.ERROR, `HTTP ${listResponse.status}`);
      return makeResult(false, 'STATE_2', REASON.NETWORK_ERROR);
    }
    const finalUrl = listResponse.url || '';
    const contentType = (listResponse.headers.get('content-type') || '').toLowerCase();
    if (finalUrl.includes('_task=login') || contentType.includes('text/html')) {
      return await exitLoggedOutFromListResponse('login_url_or_html_list_response');
    }

    const rawText = await listResponse.text();
    let listData;
    try {
      listData = JSON.parse(rawText);
    } catch (parseErr) {
      if (looksLikeRoundcubeLogin(rawText)) {
        return await exitLoggedOutFromListResponse('login_html_after_json_parse_fail');
      }
      log('warn', LOG_EVENTS.MAIL_PARSE, { phase: 'json_parse', err: parseErr });
      await writeStatus(STATUS.ERROR, parseErr.message);
      return makeResult(false, 'STATE_2', REASON.UNKNOWN_ERROR);
    }
    const unseenFromGetUnread = await tryInboxUnseenFromGetUnread(getUnreadResponse);
    const execStr = listData?.exec ?? '';
    const parsed = parseMailExecResponse(execStr);

    if (!parsed.ok) {
      if (parsed.sessionError) {
        log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'exec_session_error' });
        workerState.cachedRcToken = null;
        if (isStale()) {
          await handleStaleGenerationExit('mail');
          return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
        }
        await notifySessionExpired(playSound);
        void showNotificationOverlay({ kind: 'sessionExpired' });
        await setStorage({ [STORAGE_KEYS.tokenUnavailableCount]: 0 });
        await transitionToState('STATE_1', REASON.LOGIN_REQUIRED);
        await writeStatus(STATUS.LOGGED_OUT);
        await appendPopupActivity({ type: 'session_lost' });
        return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
      }
      if (looksLikeRoundcubeLogin(JSON.stringify(listData))) {
        log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'login_in_list_json' });
        workerState.cachedRcToken = null;
        if (isStale()) {
          await handleStaleGenerationExit('mail');
          return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
        }
        await notifySessionExpired(playSound);
        void showNotificationOverlay({ kind: 'sessionExpired' });
        await setStorage({ [STORAGE_KEYS.tokenUnavailableCount]: 0 });
        await transitionToState('STATE_1', REASON.LOGIN_REQUIRED);
        await writeStatus(STATUS.LOGGED_OUT);
        await appendPopupActivity({ type: 'session_lost' });
        return makeResult(false, 'STATE_1', REASON.LOGIN_REQUIRED);
      }
      await setStorage({ [STORAGE_KEYS.tokenUnavailableCount]: 0 });
      log('warn', LOG_EVENTS.MAIL_PARSE, { phase: 'empty_exec' });
      await writeStatus(STATUS.MONITORING);
      return makeResult(true, 'STATE_2', REASON.NO_NEW_MAIL);
    }
    await setStorage({ [STORAGE_KEYS.tokenUnavailableCount]: 0 });

    const ids = parsed.uids.sort((a, b) => a - b);
    const highestId = ids.length > 0 ? ids[ids.length - 1] : null;

    if (highestId == null) {
      log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'inbox_empty' });
      if (isStale()) {
        await handleStaleGenerationExit('mail');
        return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
      }
      await setStorage({
        [STORAGE_KEYS.lastSuccessfulCheckTs]: Date.now(),
        [STORAGE_KEYS.unreadCount]: unseenFromGetUnread != null ? unseenFromGetUnread : 0,
      });
      await setUnreadBadge(unseenFromGetUnread != null ? unseenFromGetUnread : 0);
      if (isManual) {
        await notifyNoNewMail(playSound);
        void showNotificationOverlay({ kind: 'noNewMail' });
      }
      await writeStatus(STATUS.MONITORING);
      if (isManual) await appendPopupActivity({ type: 'empty_inbox' });
      return makeResult(true, 'STATE_2', REASON.NO_NEW_MAIL);
    }
    let newCount = 0;
    let nextLastSeen = highestId;

    if (previousLastSeen != null) {
      newCount = ids.filter((id) => id > previousLastSeen).length;
      nextLastSeen = Math.max(previousLastSeen, highestId);
    }
    if (isStale()) {
      await handleStaleGenerationExit('mail');
      return makeResult(false, workerState.currentState, REASON.STALE_GENERATION);
    }
    const unreadTotal = unseenFromGetUnread != null ? unseenFromGetUnread : ids.length;
    await setStorage({
      [STORAGE_KEYS.lastSeenId]: nextLastSeen,
      [STORAGE_KEYS.lastSuccessfulCheckTs]: Date.now(),
      [STORAGE_KEYS.tokenUnavailableCount]: 0,
      [STORAGE_KEYS.unreadCount]: unreadTotal,
    });
    await setUnreadBadge(unreadTotal);
    log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'last_seen_update', lastSeenId: nextLastSeen });
    if (newCount > 0) {
      log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'new_mail', newCount });
      await notifyNewMail(newCount, playSound);
      void showNotificationOverlay({ kind: 'newMail', count: newCount });
    } else {
      log('info', LOG_EVENTS.MAIL_PARSE, { phase: 'no_new_mail' });
      if (isManual) {
        await notifyNoNewMail(playSound);
        void showNotificationOverlay({ kind: 'noNewMail' });
      }
    }
    await writeStatus(STATUS.MONITORING);
    if (newCount > 0) await appendPopupActivity({ type: 'new_mail', n: newCount });
    else if (isManual) await appendPopupActivity({ type: 'no_new' });
    return newCount > 0
      ? makeResult(true, 'STATE_2', REASON.NEW_MAIL, newCount)
      : makeResult(true, 'STATE_2', REASON.NO_NEW_MAIL);
  } catch (error) {
    log('error', LOG_EVENTS.MAIL_PARSE, { phase: 'exception', err: error });
    await writeStatus(STATUS.ERROR, error.message);
    return makeResult(false, 'STATE_2', REASON.UNKNOWN_ERROR);
  } finally {
    workerState.checkInProgress = false;
    workerState.mailCheckController = null;
  }
}
