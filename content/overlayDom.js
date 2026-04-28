/**
 * content/overlayDom.js — METU Mail Notifier toast DOM builder (Path B)
 *
 * Loaded before content.js via chrome.scripting.executeScript files[].
 * Exposes globalThis.__metuCreateOverlayDom(document) → { buildToast }.
 * No innerHTML — createElement + textContent only (OVERLAY-1 / P0-3).
 */
(function () {
  'use strict';

  const BRAND_COLOR = '#e31837';
  const TOAST_DURATION_MS = 5000;

  function normalizeThemePreference(value) {
    return value === 'dark' || value === 'light' ? value : 'system';
  }

  function resolveEffectiveTheme(preference, win) {
    const pref = normalizeThemePreference(preference);
    if (pref === 'dark' || pref === 'light') return pref;
    return win.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /**
   * @param {Document} doc
   */
  function createMetuOverlayDom(doc) {
    const win = doc.defaultView;
    if (!win) {
      throw new Error('createMetuOverlayDom: document has no defaultView');
    }

    function el(tag, attrs = {}, text = null) {
      const node = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') node.className = v;
        else if (k === 'style') Object.assign(node.style, v);
        else node.setAttribute(k, v);
      }
      if (text !== null) node.textContent = text;
      return node;
    }

    /**
     * @param {{
     *   kind: 'newMail'|'noNewMail'|'sessionExpired'|'pleaseLogin',
     *   count?: number,
     *   themePreference?: 'system'|'light'|'dark',
     *   onOpen?: () => void,
     *   onDismiss?: () => void,
     * }} opts
     */
    function buildToast({ kind, count = 0, themePreference = 'system', onOpen, onDismiss }) {
      let title = 'METU Mail Notifier';
      let bodyText = '';
      let showOpenBtn = false;
      let headerEmoji = '📧';
      let headerEmojiLabel = 'Mail';

      if (kind === 'newMail') {
        title = 'New Mail';
        bodyText = count === 1 ? 'You have 1 new email.' : `You have ${count} new emails.`;
        showOpenBtn = true;
        headerEmoji = '📬';
        headerEmojiLabel = 'New mail';
      } else if (kind === 'noNewMail') {
        title = 'All caught up';
        bodyText = 'No new mail.';
        showOpenBtn = true;
        headerEmoji = '📭';
        headerEmojiLabel = 'No new mail';
      } else if (kind === 'sessionExpired') {
        title = 'Session expired';
        bodyText = 'Please sign in to webmail.metu.edu.tr again.';
        showOpenBtn = true;
        headerEmoji = '🔑';
        headerEmojiLabel = 'Session sign-in';
      } else if (kind === 'pleaseLogin') {
        title = 'Not signed in';
        bodyText = 'Please log in to webmail.metu.edu.tr.';
        showOpenBtn = true;
        headerEmoji = '🔑';
        headerEmojiLabel = 'Sign in required';
      }

      const toast = el('div', { className: 'mm-toast' });
      const effectiveTheme = resolveEffectiveTheme(themePreference, win);
      toast.dataset.theme = effectiveTheme;
      toast.style.setProperty('--mm-accent', BRAND_COLOR);

      const header = el('div', { className: 'mm-header' });
      const titleNode = el('span', { className: 'mm-title' }, title);
      const mailEmoji = el('span', {
        className: 'mm-mail-emoji',
        role: 'img',
        'aria-label': headerEmojiLabel,
      }, headerEmoji);
      const closeBtn = el('button', { className: 'mm-close', 'aria-label': 'Dismiss notification' }, '×');

      header.appendChild(titleNode);
      header.appendChild(mailEmoji);
      header.appendChild(closeBtn);

      const body = el('div', { className: 'mm-body' }, bodyText);

      const actions = el('div', { className: 'mm-actions' });
      if (showOpenBtn) {
        const openBtn = el('button', { className: 'mm-btn mm-btn-primary' }, 'Open Inbox');
        openBtn.addEventListener('click', () => {
          if (onOpen) onOpen();
          dismiss();
        });
        actions.appendChild(openBtn);
      }
      const dismissBtn = el('button', { className: 'mm-btn mm-btn-secondary' }, 'Dismiss');
      dismissBtn.addEventListener('click', () => dismiss());
      actions.appendChild(dismissBtn);

      const progress = el('div', { className: 'mm-progress' });

      toast.appendChild(header);
      toast.appendChild(body);
      toast.appendChild(actions);
      toast.appendChild(progress);

      let dismissTimer = null;
      let dismissed = false;

      function dismiss() {
        if (dismissed) return;
        dismissed = true;
        win.clearTimeout(dismissTimer);
        toast.classList.remove('mm-visible');
        toast.classList.add('mm-hiding');
        win.setTimeout(() => {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
          if (onDismiss) onDismiss();
        }, 250);
      }

      closeBtn.addEventListener('click', () => dismiss());

      win.requestAnimationFrame(() => {
        toast.classList.add('mm-visible');
        progress.style.transition = `transform ${TOAST_DURATION_MS}ms linear`;
        progress.style.transform = 'scaleX(0) translateZ(0)';
      });

      dismissTimer = win.setTimeout(() => dismiss(), TOAST_DURATION_MS);

      return toast;
    }

    return { buildToast };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.__metuCreateOverlayDom = createMetuOverlayDom;
})();
