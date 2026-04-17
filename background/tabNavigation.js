import { INBOX_URL } from './constants.js';

export function isRoundcubeMailTabUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== 'webmail.metu.edu.tr') return false;
    return u.searchParams.get('_task') === 'mail';
  } catch (_) {
    return false;
  }
}

export async function openOrFocusInbox(targetUrl) {
  const openUrl = (targetUrl && String(targetUrl).trim()) || INBOX_URL;
  const tabs = await chrome.tabs.query({ url: 'https://webmail.metu.edu.tr/*' });
  const existing = tabs.find((t) => isRoundcubeMailTabUrl(t.url));
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      try {
        await chrome.windows.update(existing.windowId, { focused: true });
      } catch (_) { /* fail-open: tab already activated */ }
    }
    return;
  }
  await chrome.tabs.create({ url: openUrl });
}
