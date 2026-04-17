import { LOG_EVENTS, log } from './logger.js';

export function looksLikeRoundcubeLogin(text) {
  const probe = (text || '').toLowerCase();
  const hasLoginTask = probe.includes('_task=login');
  const hasUserField = probe.includes('name="_user"') || probe.includes("name='_user'");
  const hasPassField = probe.includes('name="_pass"') || probe.includes("name='_pass'");
  const hasLoginForm =
    probe.includes('id="rcmloginform"') || probe.includes("id='rcmloginform'");

  const markerScore = [hasLoginTask, hasUserField, hasPassField, hasLoginForm].filter(Boolean).length;
  return markerScore >= 2;
}

/**
 * Extracts Roundcube session token from inbox HTML.
 * Returns token string or null.
 */
export function extractRoundcubeToken(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const input =
      doc.querySelector('input[name="_token"]') || doc.querySelector('input[name="request_token"]');
    if (input?.value) return input.value;

    const scripts = Array.from(doc.querySelectorAll('script'));
    for (const s of scripts) {
      const match = s.textContent.match(/request_token\s*[:=]\s*['"]([a-zA-Z0-9_-]{10,})['"]/);
      if (match) return match[1];
    }
  } catch (_) { /* DOMParser unavailable */ }

  const hiddenInputMatch = html.match(/name=["']_?(?:request_)?token["']\s+value=["']([a-zA-Z0-9_-]{10,})["']/);
  if (hiddenInputMatch) return hiddenInputMatch[1];

  const jsTokenMatch = html.match(/request_token\s*[:=]\s*['"]([a-zA-Z0-9_-]{10,})['"]/);
  if (jsTokenMatch) return jsTokenMatch[1];

  return null;
}

/**
 * Parses the Roundcube mail-list exec response string.
 * Returns { ok, sessionError, uids }
 */
export function parseMailExecResponse(execStr) {
  if (!execStr || typeof execStr !== 'string') {
    log('warn', LOG_EVENTS.MAIL_PARSE, { phase: 'exec_empty' });
    return { ok: false, sessionError: false, uids: [] };
  }

  if (
    execStr.includes('session_error') ||
    execStr.includes('invalid_request') ||
    execStr.includes('_task=login')
  ) {
    log('warn', LOG_EVENTS.MAIL_PARSE, { phase: 'exec_session_marker' });
    return { ok: false, sessionError: true, uids: [] };
  }

  const uids = [];
  const regex = /add_message_row\s*\(\s*['"]?(\d+)['"]?/g;
  let match;
  while ((match = regex.exec(execStr)) !== null) {
    const id = Number(match[1]);
    if (Number.isFinite(id)) uids.push(id);
  }

  if (uids.length === 0 && execStr.length > 100) {
    log('warn', LOG_EVENTS.MAIL_PARSE, { phase: 'exec_no_uids' });
  }

  return { ok: true, sessionError: false, uids };
}

/**
 * Parses Roundcube `getunread` AJAX `exec` for INBOX UNSEEN count (JOB-P3-3).
 * Response lines look like: this.set_unread_count("INBOX",5,true,"");
 * @returns {{ ok: boolean, sessionError: boolean, unseen: number | null }}
 */
export function parseGetUnreadExecResponse(execStr) {
  if (!execStr || typeof execStr !== 'string') {
    return { ok: false, sessionError: false, unseen: null };
  }

  if (
    execStr.includes('session_error') ||
    execStr.includes('invalid_request') ||
    execStr.includes('_task=login')
  ) {
    log('warn', LOG_EVENTS.MAIL_PARSE, { phase: 'getunread_session_marker' });
    return { ok: false, sessionError: true, unseen: null };
  }

  const re = /set_unread_count\s*\(\s*['"]INBOX['"]\s*,\s*(\d+)/gi;
  let match;
  let last = null;
  while ((match = re.exec(execStr)) !== null) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) last = n;
  }

  if (last === null) {
    return { ok: false, sessionError: false, unseen: null };
  }

  return { ok: true, sessionError: false, unseen: last };
}
