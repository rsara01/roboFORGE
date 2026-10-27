/**
 * Toasts (bottom-left of the viewport, gone after 4 s) and one shared
 * confirm dialog, instead of the browser's alert() / confirm().
 */

const TOAST_MS = 4000;

/** Show a short message. kind: 'info' | 'error'. */
export function toast(message, kind = 'info') {
  const host = document.getElementById('toasts');
  if (!host) { console.warn(message); return; }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, TOAST_MS);
}

/**
 * Ask before doing something destructive.
 * @param {string} message  the question
 * @param {string} okLabel  what the confirm button says ("Clear", "Remove"…)
 * @returns {Promise<boolean>}
 */
export function ask(message, okLabel = 'OK') {
  const dlg = document.getElementById('ask-dialog');
  if (!dlg?.showModal) return Promise.resolve(true);
  document.getElementById('ask-text').textContent = message;
  document.getElementById('ask-ok').textContent = okLabel;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}
