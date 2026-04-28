/**
 * Runs before popup.css so the first paint uses the correct theme.
 * Mirrors chrome.storage `appearanceTheme` into localStorage for sync reads on next open.
 */
(function () {
  'use strict';

  var LS_KEY = 'mmn_appearanceTheme';
  var STORAGE_KEY = 'appearanceTheme';

  function applyEffectiveTheme(eff) {
    document.documentElement.dataset.theme = eff;
    document.documentElement.style.colorScheme = eff;
  }

  function normalizePref(v) {
    if (v === 'light' || v === 'dark') return v;
    return 'system';
  }

  function effectiveFromPref(pref) {
    if (pref === 'dark' || pref === 'light') return pref;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  var pref = 'system';
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') pref = raw;
  } catch (_) {
    pref = 'system';
  }

  applyEffectiveTheme(effectiveFromPref(pref));

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY], function (res) {
        if (chrome.runtime && chrome.runtime.lastError) return;
        var stored = res && res[STORAGE_KEY];
        var p = normalizePref(stored);
        try {
          localStorage.setItem(LS_KEY, p);
        } catch (_) { /* ignore */ }
        applyEffectiveTheme(effectiveFromPref(p));
      });
    }
  } catch (_) { /* ignore */ }
})();
