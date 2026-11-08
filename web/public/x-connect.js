import { api } from './api.js';
import { PROCESSOR } from './units.js';

const ERRORS = {
  unavailable: 'X sign-in is unavailable. Use email and paste links instead.',
  denied: 'X permission was declined. Try again or paste links instead.',
  invalid: 'That X sign-in expired. Try again.',
  failed: 'X sign-in could not finish. Try again or use email.',
  conflict: 'That X account is already linked to another Resurface account.',
};

export async function connectX(root, { onImported, onReady, onError } = {}) {
  root.innerHTML = `<a class="btn" href="/api/auth/x/start" data-x-start hidden>Continue with X</a>
    <p class="hint" data-x-note role="status">Checking X connection…</p>
    <button class="linkish" type="button" data-x-retry hidden>Retry bookmark import</button>
    <button class="linkish" type="button" data-x-disconnect hidden>Disconnect X</button>`;
  const $ = sel => root.querySelector(sel);
  const note = $('[data-x-note]'), start = $('[data-x-start]'), retry = $('[data-x-retry]'), disconnect = $('[data-x-disconnect]');
  let importing = false, cancelled = false;
  async function importPages() {
    if (importing) return;
    importing = true; retry.hidden = true; start.hidden = true;
    note.textContent = 'Extracting your X bookmarks…';
    try {
      let result;
      do {
        result = await api('/api/x/bookmarks', { method: 'POST', body: {} });
        if (cancelled) return;
        note.textContent = result.read === 0 ? 'No bookmarks were found. Save a bookmark on X or paste links instead.' : `Read ${result.read} bookmarks. ${PROCESSOR[result.processor] ?? ''}`;
        onImported?.(result);
      } while (!result.complete);
      if (result.capped) note.textContent += ' Reached the 100-bookmark limit for this import.';
    } catch (err) {
      if (!cancelled) { note.textContent = err.message; retry.hidden = false; onError?.(err); }
    } finally {
      importing = false;
      if (!cancelled) { start.hidden = false; start.textContent = 'Refresh X bookmarks'; }
    }
  }
  retry.addEventListener('click', importPages);
  disconnect.addEventListener('click', async () => {
    cancelled = true; disconnect.disabled = true;
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
    note.textContent = error ?? 'Sign in to import up to 100 of your X bookmarks.';
    if (state.connected) {
      disconnect.hidden = false; start.textContent = state.expired ? 'Reconnect X' : 'Refresh X bookmarks';
      note.textContent = error ?? (state.expired ? 'Your X connection expired. Reconnect to import bookmarks.' : `Connected as @${state.username}. ${state.error ?? (state.read ? `Read ${state.read} bookmarks.` : '')}`);
      retry.hidden = state.state !== 'failed' || state.expired;
      if (onImported && state.state === 'pending' && !state.expired) await importPages();
    }
    return state;
  } catch (err) { note.textContent = err.message; onReady?.({ available: false }); return { available: false }; }
}
