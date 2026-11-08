import { api } from './api.js';
import { PROCESSOR } from './units.js';

const ERRORS = {
  budget: 'X reads are paused for today. Use email or paste links, or try again tomorrow.',
  unavailable: 'X sign-in is unavailable. Use email and paste links instead.',
  denied: 'X permission was declined. Try again or paste links instead.',
  invalid: 'That X sign-in expired. Try again.',
  failed: 'X sign-in could not finish. Try again or use email.',
  conflict: 'That X account is already linked to another Resurface account.',
};

export async function connectX(root, { onImported, onReady, onError } = {}) {
  root.innerHTML = `<a class="btn" href="/api/auth/x/start" data-x-start hidden>Continue with X</a>
    <p class="hint" data-x-note role="status">Checking X connection…</p>
    <button class="linkish" type="button" data-x-refresh hidden>Refresh X bookmarks</button>
    <button class="linkish" type="button" data-x-retry hidden>Retry bookmark import</button>
    <button class="linkish" type="button" data-x-disconnect hidden>Disconnect X</button>`;
  const $ = sel => root.querySelector(sel);
  const note = $('[data-x-note]'), start = $('[data-x-start]'), retry = $('[data-x-retry]'), disconnect = $('[data-x-disconnect]'), refresh = $('[data-x-refresh]');
  let importing = false, cancelled = false;
  async function importPages(startRefresh = false) {
    if (importing) return;
    importing = true; retry.hidden = true; start.hidden = true; refresh.hidden = true;
    note.textContent = 'Extracting your X bookmarks…';
    try {
      let result;
      do {
        result = await api('/api/x/bookmarks', { method: 'POST', body: startRefresh ? { refresh: true } : {} });
        startRefresh = false;
        if (cancelled) return;
        note.textContent = result.read === 0 ? 'No bookmarks were found. Save a bookmark on X or paste links instead.' : `Read ${result.read} bookmark${result.read === 1 ? '' : 's'}. ${PROCESSOR[result.processor] ?? ''}`;
        onImported?.(result);
      } while (!result.complete);
      if (result.capped) note.textContent += ' Saved the newest 50 bookmarks. Future refreshes check for new bookmarks.';
    } catch (err) {
      if (!cancelled) { note.textContent = err.message; retry.hidden = false; if (err.status === 409) { start.hidden = false; start.textContent = 'Reconnect X'; } onError?.(err); }
    } finally {
      importing = false;
      if (!cancelled) refresh.hidden = !retry.hidden;
    }
  }
  retry.addEventListener('click', () => importPages());
  refresh.addEventListener('click', () => importPages(true));
  disconnect.addEventListener('click', async () => {
    cancelled = true; refresh.hidden = true; disconnect.disabled = true;
    try {
      await api('/api/x/disconnect', { method: 'POST', body: {} });
      note.textContent = 'X disconnected. Your previously imported skills and links are still here.';
      disconnect.hidden = true; retry.hidden = true; start.hidden = false; start.textContent = 'Reconnect X';
    } catch (err) { note.textContent = err.message; cancelled = false; }
    finally { disconnect.disabled = false; }
  });
  try {
    const state = await api('/api/x');
    const error = ERRORS[new URLSearchParams(location.search).get('x')];
    onReady?.(state);
    if (!state.available) { note.textContent = 'X sign-in is unavailable. Use email or paste links instead.'; disconnect.hidden = !state.connected; return state; }
    start.hidden = false;
    note.textContent = error ?? 'Sign in to import your newest 50 X bookmarks.';
    if (state.connected) {
      disconnect.hidden = false; start.textContent = 'Reconnect X'; start.hidden = !state.expired; refresh.hidden = state.expired || state.state === 'failed';
      note.textContent = error ?? (state.expired ? 'Your X connection expired. Reconnect to import bookmarks.' : `Connected as @${state.username}. ${state.error ?? (state.read ? `Read ${state.read} bookmarks.` : '')}`);
      retry.hidden = state.state !== 'failed' || state.expired;
      if (onImported && state.state === 'pending' && !state.expired) await importPages();
    }
    return state;
  } catch (err) { note.textContent = err.message; onReady?.({ available: false }); return { available: false }; }
}
