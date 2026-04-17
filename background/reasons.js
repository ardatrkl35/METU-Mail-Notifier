export const AUTH_STATE = Object.freeze({
  AUTHENTICATED: 'AUTHENTICATED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  UNKNOWN: 'UNKNOWN',
});

export const AUTH_REASON = Object.freeze({
  TOKEN_FOUND: 'token_found',
  TOKEN_MISSING: 'token_missing',
  LOGIN_MARKERS_FOUND: 'login_markers_found',
  LOGIN_REDIRECT: 'login_redirect',
  NO_WEBMAIL_COOKIE: 'no_webmail_cookie',
  HTTP_ERROR: 'http_error',
  NETWORK_ERROR: 'network_error',
  TIMEOUT: 'timeout',
});

export const REASON = Object.freeze({
  NEW_MAIL: 'new_mail',
  NO_NEW_MAIL: 'no_new_mail',
  LOGIN_REQUIRED: 'login_required',
  NETWORK_ERROR: 'network_error',
  AUTH_TIMEOUT: 'auth_timeout',
  AUTH_HTTP_ERROR: 'auth_http_error',
  AUTH_TOKEN_MISSING: 'auth_token_missing',
  AUTH_NETWORK_ERROR: 'auth_network_error',
  SKIPPED_IN_PROGRESS: 'skipped_in_progress',
  TOKEN_UNAVAILABLE: 'token_unavailable',
  UNKNOWN_ERROR: 'unknown_error',
  STALE_GENERATION: 'stale_generation',
  RUNTIME_RECONCILE: 'runtime_reconcile',
  EXTENSION_DISABLED: 'extension_disabled',
});

export const STATUS = Object.freeze({
  PAUSED: 'Paused',
  CHECKING: 'Checking...',
  LOGGED_OUT: 'Logged out',
  MONITORING: 'Monitoring',
  ERROR: 'Error',
});

/** Maps probeAuthState AUTH_REASON when state is UNKNOWN to public result.reason (P1-2). */
export function mapAuthUnknownProbeReasonToPublicReason(probeReason) {
  switch (probeReason) {
    case AUTH_REASON.TIMEOUT:
      return REASON.AUTH_TIMEOUT;
    case AUTH_REASON.HTTP_ERROR:
      return REASON.AUTH_HTTP_ERROR;
    case AUTH_REASON.TOKEN_MISSING:
      return REASON.AUTH_TOKEN_MISSING;
    case AUTH_REASON.NETWORK_ERROR:
      return REASON.AUTH_NETWORK_ERROR;
    default:
      return REASON.AUTH_NETWORK_ERROR;
  }
}
