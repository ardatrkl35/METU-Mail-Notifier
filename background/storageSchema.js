/**
 * Typed defaults and coercion for chrome.storage.local keys (JOB-P2-1).
 * Pure module — safe to import from unit tests without chrome.
 */

export const STORAGE_KEYS = Object.freeze({
  extensionEnabled: 'extensionEnabled',
  appearanceTheme: 'appearanceTheme',
  hasWarnedLogin: 'hasWarnedLogin',
  lastLoginWarningTs: 'lastLoginWarningTs',
  lastSeenId: 'lastSeenId',
  playNotificationSound: 'playNotificationSound',
  lastSuccessfulCheckTs: 'lastSuccessfulCheckTs',
  machineState: 'machineState',
  tokenUnavailableCount: 'tokenUnavailableCount',
  /** Messages visible in last list parse (P2-7). */
  unreadCount: 'unreadCount',
  staleAuthDiscardCount: 'staleAuthDiscardCount',
  staleMailDiscardCount: 'staleMailDiscardCount',
  /** When true, emit `debug`-level structured logs (JOB-P3-4). */
  verboseDebugLogs: 'verboseDebugLogs',
  /**
   * Last few popup activity rows (JOB-P3-7): `{ ts, type, n? }`, capped server-side.
   * Types: new_mail, no_new, empty_inbox, session_lost, signed_in
   */
  popupActivityLog: 'popupActivityLog',
});

/** Written only via writeStatus in background.js */
export const EXTENSION_STATUS_KEY = 'extensionStatus';

const DEFAULT_LOGIN_WARNING_INTERVAL_MS = 30 * 60 * 1000;

function normalizeBooleanPreference(value, defaultWhenMissing) {
  if (value === false) return false;
  if (value === true) return true;
  return defaultWhenMissing;
}

export function normalizeExtensionEnabled(value) {
  return normalizeBooleanPreference(value, true);
}

export function normalizeAppearanceTheme(value) {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Legacy flag: only literal true counts as warned (matches onInstalled + auth path). */
export function normalizeHasWarnedLogin(value) {
  return value === true;
}

/**
 * When lastLoginWarningTs is missing or invalid, derive from legacy hasWarnedLogin === true
 * so throttle semantics match runAuthCheck migration.
 */
export function resolveLastLoginWarningTs(storedTs, legacyHasWarnedLogin, now, intervalMs) {
  if (Number.isFinite(storedTs)) return storedTs;
  return legacyHasWarnedLogin ? now - intervalMs : 0;
}

export function normalizeLastSeenId(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizePlayNotificationSound(value) {
  return normalizeBooleanPreference(value, true);
}

export function normalizeLastSuccessfulCheckTs(value) {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeMachineState(value) {
  return value === 'STATE_2' ? 'STATE_2' : 'STATE_1';
}

export function normalizeTokenUnavailableCount(value) {
  if (!Number.isFinite(value)) return 0;
  const n = Math.floor(Number(value));
  return n < 0 ? 0 : n;
}

export function normalizeUnreadCount(value) {
  return normalizeTokenUnavailableCount(value);
}

export function normalizeStaleDiscardCount(value) {
  return normalizeTokenUnavailableCount(value);
}

export function normalizeVerboseDebugLogs(value) {
  return normalizeBooleanPreference(value, false);
}

const POPUP_ACTIVITY_TYPES = new Set([
  'new_mail',
  'no_new',
  'empty_inbox',
  'session_lost',
  'signed_in',
]);

/**
 * @param {unknown} value
 * @returns {Array<{ ts: number, type: string, n?: number }>}
 */
export function normalizePopupActivityLog(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const ts = Number(item.ts);
    const type = typeof item.type === 'string' ? item.type : '';
    if (!Number.isFinite(ts) || ts < 0 || !POPUP_ACTIVITY_TYPES.has(type)) continue;
    /** @type {{ ts: number, type: string, n?: number }} */
    const row = { ts, type };
    if (item.n !== undefined && item.n !== null) {
      const n = Math.floor(Number(item.n));
      if (Number.isFinite(n) && n > 0 && n < 1_000_000) row.n = n;
    }
    out.push(row);
  }
  return out.length <= 5 ? out : out.slice(-5);
}

export function normalizeExtensionStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { label: '', detail: '', ts: 0 };
  }
  const label = typeof value.label === 'string' ? value.label : '';
  const detail = typeof value.detail === 'string' ? value.detail : '';
  const ts = Number.isFinite(value.ts) ? value.ts : 0;
  return { label, detail, ts };
}

/**
 * Normalize all schema keys; unknown top-level keys are preserved (forward compatibility).
 */
export function normalizeStorageSnapshot(raw, options = {}) {
  const now = options.now ?? Date.now();
  const loginWarningIntervalMs =
    options.loginWarningIntervalMs ?? DEFAULT_LOGIN_WARNING_INTERVAL_MS;

  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const out = { ...base };

  const warned = normalizeHasWarnedLogin(base[STORAGE_KEYS.hasWarnedLogin]);
  const storedTsRaw = base[STORAGE_KEYS.lastLoginWarningTs];
  const storedTsNum = Number(storedTsRaw);

  out[STORAGE_KEYS.extensionEnabled] = normalizeExtensionEnabled(base[STORAGE_KEYS.extensionEnabled]);
  out[STORAGE_KEYS.appearanceTheme] = normalizeAppearanceTheme(base[STORAGE_KEYS.appearanceTheme]);
  out[STORAGE_KEYS.hasWarnedLogin] = warned;
  out[STORAGE_KEYS.lastLoginWarningTs] = resolveLastLoginWarningTs(
    Number.isFinite(storedTsNum) ? storedTsNum : NaN,
    warned,
    now,
    loginWarningIntervalMs,
  );
  out[STORAGE_KEYS.lastSeenId] = normalizeLastSeenId(base[STORAGE_KEYS.lastSeenId]);
  out[STORAGE_KEYS.playNotificationSound] = normalizePlayNotificationSound(
    base[STORAGE_KEYS.playNotificationSound],
  );
  out[STORAGE_KEYS.lastSuccessfulCheckTs] = normalizeLastSuccessfulCheckTs(
    base[STORAGE_KEYS.lastSuccessfulCheckTs],
  );
  out[STORAGE_KEYS.machineState] = normalizeMachineState(base[STORAGE_KEYS.machineState]);
  out[STORAGE_KEYS.tokenUnavailableCount] = normalizeTokenUnavailableCount(
    base[STORAGE_KEYS.tokenUnavailableCount],
  );
  out[STORAGE_KEYS.unreadCount] = normalizeUnreadCount(base[STORAGE_KEYS.unreadCount]);
  out[STORAGE_KEYS.staleAuthDiscardCount] = normalizeStaleDiscardCount(
    base[STORAGE_KEYS.staleAuthDiscardCount],
  );
  out[STORAGE_KEYS.staleMailDiscardCount] = normalizeStaleDiscardCount(
    base[STORAGE_KEYS.staleMailDiscardCount],
  );
  out[STORAGE_KEYS.verboseDebugLogs] = normalizeVerboseDebugLogs(
    base[STORAGE_KEYS.verboseDebugLogs],
  );
  out[STORAGE_KEYS.popupActivityLog] = normalizePopupActivityLog(
    base[STORAGE_KEYS.popupActivityLog],
  );
  out[EXTENSION_STATUS_KEY] = normalizeExtensionStatus(base[EXTENSION_STATUS_KEY]);

  return out;
}
