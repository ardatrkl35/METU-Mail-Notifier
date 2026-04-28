/**
 * content/content.js — METU Mail Notifier overlay host + chrome bridge
 *
 * Path B: must load after content/overlayDom.js (see background tryInjectOverlay).
 * Shadow DOM toast — mode: 'closed'. Styles + chrome.runtime listener live here;
 * toast DOM is built in overlayDom.js (createElement + textContent only).
 */

(function () {
  'use strict';

  const HOST_ID = 'metu-mail-notifier-host';
  const g = globalThis;

  /**
   * After an extension reload, the old host node can remain in the tab while the
   * previous isolated-world listener is gone — the old guard then skipped setup
   * and chrome.tabs.sendMessage hit "Receiving end does not exist".
   */
  const stale = document.getElementById(HOST_ID);
  if (stale) {
    stale.remove();
  }
  if (typeof g.__metuOverlayMessageListener === 'function') {
    try {
      chrome.runtime.onMessage.removeListener(g.__metuOverlayMessageListener);
    } catch (_) {
      /* ignore */
    }
    g.__metuOverlayMessageListener = undefined;
  }

  if (typeof globalThis.__metuCreateOverlayDom !== 'function') {
    console.error('[METU Mail Notifier] overlayDom.js must be injected before content.js');
    return;
  }

  const { buildToast } = globalThis.__metuCreateOverlayDom(document);

  // ── host element (invisible wrapper in the real DOM) ──────────────────────
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-atomic', 'true');
  host.setAttribute('role', 'status');
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
    width: '0',
    height: '0',
    overflow: 'visible',
  });

  const shadowRoot = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host-context(*) {}

    .mm-toast {
      --mm-bg: #ffffff;
      --mm-border: #ebebeb;
      --mm-shadow-main: 0 4px 20px rgba(227, 24, 55, 0.12);
      --mm-shadow-soft: 0 2px 10px rgba(0, 0, 0, 0.06);
      --mm-text-primary: #1a1a1a;
      --mm-text-body: #4b4b4b;
      --mm-close: #6b7280;
      --mm-close-hover: var(--mm-accent, #e31837);
      --mm-btn-secondary-bg: #f3f3f5;
      --mm-btn-secondary-hover-bg: #ebebef;
      --mm-btn-secondary-border: #e5e5e5;
      --mm-btn-secondary-hover-border: #d8d8dc;
      --mm-btn-secondary-fg: var(--mm-accent, #e31837);
      position: fixed;
      top: 20px;
      right: 20px;
      box-sizing: border-box;
      width: 320px;
      background: var(--mm-bg);
      border-radius: 10px;
      border: 1px solid var(--mm-border);
      border-left: 4px solid var(--mm-accent, #e31837);
      box-shadow:
        var(--mm-shadow-main),
        var(--mm-shadow-soft);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      color: var(--mm-text-primary);
      pointer-events: auto;
      cursor: default;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: translateX(24px);
      transition: opacity 0.22s ease, transform 0.22s ease;
    }

    .mm-toast[data-theme="dark"] {
      --mm-bg: #1a1f2b;
      --mm-border: #30384a;
      --mm-shadow-main: 0 6px 22px rgba(0, 0, 0, 0.45);
      --mm-shadow-soft: 0 2px 10px rgba(0, 0, 0, 0.35);
      --mm-text-primary: #f3f4f6;
      --mm-text-body: #d3d9e2;
      --mm-close: #a7b1bf;
      --mm-close-hover: #ff8da1;
      --mm-btn-secondary-bg: #1f2533;
      --mm-btn-secondary-hover-bg: #2a3242;
      --mm-btn-secondary-border: #394255;
      --mm-btn-secondary-hover-border: #4a5770;
      --mm-btn-secondary-fg: #ff8da1;
    }

    .mm-toast.mm-visible {
      opacity: 1;
      transform: translateX(0);
    }

    .mm-toast.mm-hiding {
      opacity: 0;
      transform: translateX(24px);
    }

    .mm-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 14px 8px;
    }

    .mm-mail-emoji {
      flex-shrink: 0;
      font-size: 22px;
      line-height: 1;
      user-select: none;
    }

    .mm-title {
      font-weight: 700;
      font-size: 13px;
      color: var(--mm-accent, #e31837);
      flex: 1;
    }

    .mm-close {
      background: none;
      border: none;
      color: var(--mm-close);
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      padding: 0 2px;
      display: flex;
      align-items: center;
    }

    .mm-close:hover { color: var(--mm-close-hover); }

    .mm-body {
      padding: 0 14px 10px;
      font-size: 13px;
      color: var(--mm-text-body);
      line-height: 1.45;
    }

    .mm-actions {
      display: flex;
      gap: 6px;
      padding: 0 14px 12px;
    }

    .mm-btn {
      flex: 1;
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, filter 0.15s ease, border-color 0.15s ease;
    }

    .mm-btn-primary {
      background: var(--mm-accent, #e31837);
      color: #ffffff;
      border: 1px solid var(--mm-accent, #e31837);
    }

    .mm-btn-primary:hover {
      filter: brightness(1.05);
    }

    .mm-btn-secondary {
      background: var(--mm-btn-secondary-bg);
      color: var(--mm-btn-secondary-fg);
      border: 1px solid var(--mm-btn-secondary-border);
    }

    .mm-btn-secondary:hover {
      background: var(--mm-btn-secondary-hover-bg);
      border-color: var(--mm-btn-secondary-hover-border);
    }

    .mm-progress {
      height: 4px;
      flex-shrink: 0;
      background: var(--mm-accent, #e31837);
      /* Bleed under left accent + bottom border so rounded corners do not show a subpixel white gap. */
      width: calc(100% + 4px);
      margin-left: -4px;
      margin-bottom: -1px;
      transform-origin: left;
      transform: scaleX(1) translateZ(0);
      transition: transform linear;
    }
  `;
  shadowRoot.appendChild(style);

  function onOverlayMessage(message, _sender, sendResponse) {
    if (!message || message.type !== 'SHOW_OVERLAY') return false;

    const { kind, count = 0, inboxUrl } = message;

    const existing = shadowRoot.querySelector('.mm-toast');
    if (existing) existing.parentNode?.removeChild(existing);

    const toast = buildToast({
      kind,
      count,
      themePreference: message.themePreference,
      onOpen: () => {
        chrome.runtime.sendMessage({ type: 'OPEN_INBOX', url: inboxUrl });
      },
      onDismiss: () => {},
    });

    shadowRoot.appendChild(toast);
    sendResponse({ ok: true });
    return true;
  }

  g.__metuOverlayMessageListener = onOverlayMessage;
  chrome.runtime.onMessage.addListener(onOverlayMessage);

  document.documentElement.appendChild(host);
})();
