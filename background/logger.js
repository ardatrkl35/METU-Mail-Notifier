/**
 * Structured logging (JOB-P3-4): JSON-shaped lines for DevTools filtering.
 * Verbose `debug` level is gated by STORAGE_KEYS.verboseDebugLogs.
 */
import { LOG_PREFIX } from './constants.js';

export const LOG_EVENTS = Object.freeze({
  AUTH_PROBE: 'auth_probe',
  MAIL_PARSE: 'mail_parse',
  STATE_TRANSITION: 'state_transition',
  NOTIFY_DELIVERY: 'notify_delivery',
  /** Lifecycle, alarms, storage wiring — not one of the four core domains. */
  RUNTIME: 'runtime',
});

let verboseDebug = false;

export function setVerboseDebugLogging(enabled) {
  verboseDebug = !!enabled;
}

export function isVerboseDebugLoggingEnabled() {
  return verboseDebug;
}

/**
 * @param {unknown} meta
 * @returns {Record<string, unknown>}
 */
function normalizeMeta(meta) {
  if (meta === undefined || meta === null) return {};
  if (meta instanceof Error) {
    return { err: meta.message || String(meta), errName: meta.name };
  }
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    return { value: meta };
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v instanceof Error) {
      out[k] = v.message || String(v);
      out[`${k}Name`] = v.name;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * @param {'debug' | 'info' | 'warn' | 'error'} level
 * @param {string} event
 * @param {Record<string, unknown> | Error | undefined} [meta]
 */
export function log(level, event, meta) {
  if (level === 'debug' && !verboseDebug) return;

  const payload = { lvl: level, event, ...normalizeMeta(meta) };
  let line;
  try {
    line = `${LOG_PREFIX} ${JSON.stringify(payload)}`;
  } catch {
    line = `${LOG_PREFIX} {"lvl":"${level}","event":"${String(event)}","meta":"[unserializable]"}`;
  }

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'debug') console.debug(line);
  else console.info(line);
}
