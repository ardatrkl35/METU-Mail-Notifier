(() => {
  if (window.__metuMailInjected) return;
  window.__metuMailInjected = true;

  let audioContext = null;
  let audioReady = false;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "metuMailNotification") return;
    showNotification(msg);
    sendResponse({ ok: true });
  });

  const unlockAudio = async () => {
    try {
      if (!audioContext || audioContext.state === "closed") {
        audioContext = new AudioContext();
      }
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      audioReady = audioContext.state === "running";
      if (audioReady) {
        window.removeEventListener("pointerdown", unlockAudio, true);
        window.removeEventListener("keydown", unlockAudio, true);
        window.removeEventListener("touchstart", unlockAudio, true);
      }
    } catch (_) {
      audioReady = false;
    }
  };

  unlockAudio();
  window.addEventListener("pointerdown", unlockAudio, { once: true, capture: true });
  window.addEventListener("keydown", unlockAudio, { once: true, capture: true });
  window.addEventListener("touchstart", unlockAudio, { once: true, capture: true });

  function showNotification({ title, message, kind, playSound, inboxUrl }) {
    const existing = document.getElementById("__metu-mail-overlay");
    if (existing) existing.remove();

    const host = document.createElement("div");
    host.id = "__metu-mail-overlay";
    const sr = host.attachShadow({ mode: "open" });

    const isNewMail = kind === "newMail";
    const isNoNewMail = kind === "noNewMail";

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        display: block;
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        border: none;
        z-index: 2147483647;
        pointer-events: none;
      }
      .mm-toast {
        pointer-events: auto;
        position: fixed; bottom: 20px; right: 20px;
        background: #ffffff; color: #e31837;
        border: 1px solid #e31837; border-radius: 8px;
        padding: 14px 16px; z-index: 2147483647;
        font: 14px/1.43 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
        box-shadow: 0 4px 16px rgba(227,24,55,0.12);
        max-width: 320px; min-width: 260px;
        animation: mmSlideIn .3s ease-out;
      }
      @keyframes mmSlideIn {
        from { transform: translateY(20px); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }
      @keyframes mmSlideOut {
        from { transform: translateY(0);    opacity: 1; }
        to   { transform: translateY(20px); opacity: 0; }
      }
      .mm-toast.mm-dismissing {
        animation: mmSlideOut .25s ease-in forwards;
      }
      .mm-header {
        display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
      }
      .mm-icon {
        display: flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 50%;
        font-size: 14px; flex-shrink: 0;
      }
      .mm-icon--mail {
        background: rgba(46, 125, 50, 0.12); color: #2e7d32;
      }
      .mm-icon--warn {
        background: rgba(198, 40, 40, 0.12); color: #c62828;
      }
      .mm-title {
        font-weight: 700; font-size: 16px; line-height: 1.25; color: #e31837;
      }
      .mm-body {
        font-size: 13px; color: #4b4b4b; margin-bottom: 12px; line-height: 1.5;
      }
      .mm-bar-bg {
        height: 3px; background: #efefef; border-radius: 999px;
        margin-bottom: 12px; overflow: hidden;
      }
      .mm-bar {
        height: 100%; border-radius: 999px; width: 100%;
        transition: width 1s linear;
      }
      .mm-bar--mail { background: #2e7d32; }
      .mm-bar--warn { background: #c62828; }
      .mm-bar--none { background: #e31837; }
      .mm-no {
        font-weight: 700;
        color: #e31837;
      }
      .mm-btns { display: flex; flex-wrap: wrap; gap: 8px; }
      button {
        border: none; border-radius: 999px; padding: 10px 12px;
        font: 12px/1.33 system-ui, sans-serif; font-weight: 500; cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .mm-primary {
        background: #e31837; color: #ffffff;
      }
      .mm-primary:hover { background: #c4152f; }
      .mm-primary:focus-visible { outline: 2px solid #e31837; outline-offset: 2px; }
      .mm-secondary {
        background: #ffffff; color: #e31837; border: 1px solid #e31837;
      }
      .mm-secondary:hover { background: #fdf0f2; }
      .mm-secondary:focus-visible { outline: 2px solid #e31837; outline-offset: 2px; }
    `;

    const toast = document.createElement("div");
    toast.className = "mm-toast";

    const iconClass = isNewMail || isNoNewMail ? "mm-icon--mail" : "mm-icon--warn";
    const iconChar = isNewMail || isNoNewMail ? "\u2709" : "\u26A0";
    const barClass = isNoNewMail ? "mm-bar--none" : isNewMail ? "mm-bar--mail" : "mm-bar--warn";
    const countdownSeconds = 30;

    const titleEl = document.createElement("span");
    titleEl.className = "mm-title";
    titleEl.textContent = title;

    toast.innerHTML = `
      <div class="mm-header">
        <div class="mm-icon ${iconClass}">${iconChar}</div>
      </div>
      <div class="mm-body"></div>
      <div class="mm-bar-bg"><div class="mm-bar ${barClass}"></div></div>
      <div class="mm-btns">
        <button class="mm-primary" id="mmOpenBtn">Open Inbox</button>
        <button class="mm-secondary" id="mmDismissBtn">Dismiss</button>
      </div>
    `;

    toast.querySelector(".mm-header").appendChild(titleEl);
    const bodyEl = toast.querySelector(".mm-body");
    if (isNoNewMail) {
      bodyEl.innerHTML = 'You have <span class="mm-no">NO</span> new emails.';
    } else {
      bodyEl.textContent = message;
    }

    sr.appendChild(style);
    sr.appendChild(toast);
    const mountTarget = document.body ?? document.documentElement;
    mountTarget.appendChild(host);

    const bar = sr.querySelector(".mm-bar");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bar.style.transition = `width ${countdownSeconds}s linear`;
        bar.style.width = "0%";
      });
    });

    const dismiss = () => {
      toast.classList.add("mm-dismissing");
      setTimeout(() => { try { host.remove(); } catch (_) {} }, 250);
    };

    sr.getElementById("mmOpenBtn").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_INBOX", url: inboxUrl }, () => {
        if (chrome.runtime.lastError) {
          console.warn("[METU Mail Notifier] OPEN_INBOX:", chrome.runtime.lastError.message);
        }
      });
      dismiss();
    });
    sr.getElementById("mmDismissBtn").addEventListener("click", dismiss);

    if (playSound) {
      void playDing(kind);
    }

    setTimeout(dismiss, countdownSeconds * 1000);
  }

  async function playDing(kind) {
    try {
      if (!audioContext || audioContext.state === "closed") {
        audioContext = new AudioContext();
      }
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch((e) => {
          if (e && e.name === "NotAllowedError") {
            /* autoplay policy — toast-only UX */
          }
        });
      }
      if (!audioContext || audioContext.state !== "running") {
        audioReady = false;
        return;
      }
      audioReady = true;
      const ctx = audioContext;
      const now = ctx.currentTime;
      if (kind === "newMail" || kind === "noNewMail") {
        tone(ctx, 523.25, now, 0.15, 0.3, "sine");
        tone(ctx, 659.25, now + 0.15, 0.2, 0.3, "sine");
      } else {
        tone(ctx, 329.63, now, 0.2, 0.25, "triangle");
        tone(ctx, 261.63, now + 0.25, 0.3, 0.25, "triangle");
      }
    } catch (_) {
      audioReady = false;
    }
  }

  function tone(ctx, freq, start, dur, vol, type) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur);
  }
})();
