import { LOG_EVENTS, log } from './logger.js';

/**
 * Enable/disable side effects when `extensionEnabled` changes in chrome.storage.local.
 * JOB-P0-2 — awaited paths + single catch → writeStatus(ERROR, 'resume_failed').
 * @param {boolean|undefined} newValue
 * @param {{
 *   reconcileRuntimeState: () => Promise<void>,
 *   runAuthCheck: () => Promise<unknown>,
 *   stopStateMachine: () => Promise<void>,
 *   writeStatus: (label: string, detail?: string) => Promise<void>,
 *   STATUS: { ERROR: string },
 * }} deps
 */
export async function executeStorageExtensionEnabledChange(newValue, deps) {
  try {
    if (newValue === false) {
      await deps.stopStateMachine();
    } else {
      await deps.reconcileRuntimeState();
      await deps.runAuthCheck();
    }
  } catch (err) {
    log('error', LOG_EVENTS.RUNTIME, { phase: 'storage_enable', err: err?.message || String(err) });
    await deps.writeStatus(deps.STATUS.ERROR, 'resume_failed');
  }
}
