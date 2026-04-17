/**
 * Offscreen document: notification chimes (extension context, AUDIO_PLAYBACK reason).
 * Keep in sync with background/notificationSound.js CHIME_MESSAGE_TYPE.
 *
 * Uses HTMLAudioElement + in-memory WAV blobs: reliable routing in extension offscreen
 * on Windows/Chrome compared to Web Audio AudioContext in this context.
 */
const CHIME_MESSAGE_TYPE = 'METU_PLAY_CHIME';

const CHIME_SR = 24000;

/**
 * @param {number} freq
 * @param {number} durationSec
 * @param {number} peak 0..1
 * @returns {Int16Array}
 */
function sinePcmMono(freq, durationSec, peak) {
  const n = Math.max(1, Math.floor(CHIME_SR * durationSec));
  const out = new Int16Array(n);
  const omega = (2 * Math.PI * freq) / CHIME_SR;
  const fade = Math.min(120, Math.floor(n / 6));
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (fade > 0) {
      if (i < fade) env = i / fade;
      else if (i > n - fade - 1) env = (n - 1 - i) / fade;
    }
    out[i] = Math.round(32767 * Math.min(0.98, peak) * env * Math.sin(omega * i));
  }
  return out;
}

/**
 * @param {Int16Array} pcm
 * @returns {string} object URL (caller must revoke)
 */
function wavBlobUrlFromPcm(pcm) {
  const dataSize = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  let o = 0;
  const wStr = (s) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i));
  };
  wStr('RIFF');
  dv.setUint32(o, 36 + dataSize, true);
  o += 4;
  wStr('WAVE');
  wStr('fmt ');
  dv.setUint32(o, 16, true);
  o += 4;
  dv.setUint16(o, 1, true);
  o += 2;
  dv.setUint16(o, 1, true);
  o += 2;
  dv.setUint32(o, CHIME_SR, true);
  o += 4;
  dv.setUint32(o, CHIME_SR * 2, true);
  o += 4;
  dv.setUint16(o, 2, true);
  o += 2;
  dv.setUint16(o, 16, true);
  o += 2;
  wStr('data');
  dv.setUint32(o, dataSize, true);
  o += 4;
  for (let i = 0; i < pcm.length; i++, o += 2) dv.setInt16(o, pcm[i], true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/**
 * @param {string} url
 */
function playUrlOnce(url) {
  return new Promise((resolve, reject) => {
    const a = new Audio(url);
    const cleanup = () => {
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('error', onErr);
    };
    const onEnd = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(a.error || new Error('audio_element_error'));
    };
    a.addEventListener('ended', onEnd);
    a.addEventListener('error', onErr);
    void a.play().catch((e) => {
      cleanup();
      reject(e);
    });
  });
}

/**
 * Chime characters:
 * - newMail: bright ascending (C5 → E5)
 * - auth: descending warning (A4 → E4)
 * - noNewMail: neutral small rise (A4 → B4-ish 466 Hz) — between session and new-mail energy
 *
 * @param {'newMail'|'auth'|'noNewMail'|string} kind
 */
async function playChime(kind) {
  const urls = [];
  try {
    /** @type {Array<{ freq: number, dur: number, peak: number }>} */
    let tones;
    if (kind === 'newMail') {
      tones = [
        { freq: 523, dur: 0.16, peak: 0.32 },
        { freq: 659, dur: 0.18, peak: 0.34 },
      ];
    } else if (kind === 'auth') {
      tones = [
        { freq: 440, dur: 0.2, peak: 0.28 },
        { freq: 330, dur: 0.22, peak: 0.24 },
      ];
    } else if (kind === 'noNewMail') {
      tones = [
        { freq: 440, dur: 0.11, peak: 0.24 },
        { freq: 466, dur: 0.13, peak: 0.26 },
      ];
    } else {
      tones = [{ freq: 392, dur: 0.12, peak: 0.26 }];
    }
    for (const t of tones) {
      const pcm = sinePcmMono(t.freq, t.dur, t.peak);
      const url = wavBlobUrlFromPcm(pcm);
      urls.push(url);
      await playUrlOnce(url);
    }
  } finally {
    for (const u of urls) {
      try {
        URL.revokeObjectURL(u);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== CHIME_MESSAGE_TYPE) return false;
  const kind = message.kind;
  void playChime(kind)
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});
