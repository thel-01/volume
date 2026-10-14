const $ = id => document.getElementById(id);
export { $ };
export const BACK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5 L7 12 L15 19"/></svg>';
export const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const CHEVRON = '<svg width="14" height="22" viewBox="0 0 14 22" fill="none" stroke="var(--text)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3 L11 11 L3 19"/></svg>';
export function number(raw, { required = false, min = 0, max = 100000, integer = false } = {}) {
  const text = String(raw ?? '').trim();
  if (!text) return required ? { error: 'Enter a number.' } : { value: null };
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return { error: 'Enter a number, using a dot or comma for decimals.' };
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value) || value < min || value > max) return { error: `Enter a number between ${min} and ${max}.` };
  if (integer && !Number.isInteger(value)) return { error: 'Enter a whole number.' };
  return { value };
}
// Volume's step loader (styles.css .loading-state/.step-loader), centered on the screen.
const LOADER = '<svg width="32" height="32" viewBox="0 0 40 40" class="step-loader" aria-hidden="true"><path d="M 6,30 L 18,30 L 18,18 L 30,18 L 30,6" pathLength="1" /></svg>';
export function loading(id) {
  const el = $(id); if (!el) return; el.className = 'loading-state'; el.hidden = false;
  el.setAttribute('aria-label', 'Loading'); el.innerHTML = LOADER;
}
export function status(id, message = '', kind = 'info', retry) {
  const el = $(id); if (!el) return; el.className = `status ${kind}`; el.hidden = !message; el.removeAttribute('aria-label');
  el.replaceChildren(document.createTextNode(message));
  if (retry) { const b = document.createElement('button'); b.type = 'button'; b.className = 'link-button'; b.textContent = 'Retry'; b.onclick = retry; el.append(b); }
}
export function field(id, label, value = '', { mode = 'decimal', placeholder = '', required = false, unit = '', maxlength = null } = {}) {
  const input = `<input type="text" id="${id}" value="${escapeHtml(value)}" inputmode="${mode}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" ${maxlength ? `maxlength="${maxlength}"` : ''} ${required ? 'aria-required="true"' : ''} aria-describedby="${id}-error">`;
  return `<div class="field"><label for="${id}">${escapeHtml(label)}</label>${unit ? `<div class="amount-input">${input}<span class="unit" aria-hidden="true">${escapeHtml(unit)}</span></div>` : input}<div id="${id}-error" class="status error" role="status" hidden></div></div>`;
}
export function fieldError(id, message = '') { status(`${id}-error`, message, 'error'); $(id).setAttribute('aria-invalid', String(!!message)); }
export function readNumber(id, options) { const r = number($(id).value, options); fieldError(id, r.error); return r; }
export function toast(message, undo, persistent = false, kind = 'info', extra = null) {
  const el = document.createElement('div'); el.className = `toast ${kind}`;
  const actions = (undo ? '<button type="button" class="toast-action">Undo</button>' : '') + (extra ? `<button type="button" class="toast-action toast-extra">${escapeHtml(extra.label)}</button>` : '');
  el.innerHTML = `<div class="toast-body"><div class="toast-title">${escapeHtml(message)}</div>${actions ? `<div class="toast-actions">${actions}</div>` : ''}</div><button type="button" class="toast-close" aria-label="Dismiss">×</button>`;
  $('toast-layer').append(el); requestAnimationFrame(() => el.classList.add('show'));
  let timer; const dismiss = () => { clearTimeout(timer); el.remove(); };
  el.querySelector('.toast-close').onclick = dismiss;
  if (undo) el.querySelector('.toast-action').onclick = e => run(e.currentTarget, async () => { await undo(); dismiss(); toast('Undone'); });
  if (extra) el.querySelector('.toast-extra').onclick = e => run(e.currentTarget, async () => { await extra.run(); dismiss(); });
  if (!persistent) timer = setTimeout(dismiss, undo ? 12000 : 4500);
}
export function arm(button, action, statusId) {
  let timer; const label = button.textContent, ariaLabel = button.getAttribute('aria-label');
  const reset = () => { button.classList.remove('confirming'); button.textContent = label; if (ariaLabel) button.setAttribute('aria-label', ariaLabel); else button.removeAttribute('aria-label'); };
  button.onclick = () => {
    if (!button.classList.contains('confirming')) {
      button.classList.add('confirming'); button.textContent = 'Confirm?'; button.setAttribute('aria-label', `Confirm ${label.toLowerCase()}`);
      timer = setTimeout(reset, 3000); return;
    }
    clearTimeout(timer); reset(); run(button, action, statusId);
  };
}
export function toggleMarkup(id, label, on, beforeToggle = '') {
  return `<div class="toggle-row"><span>${escapeHtml(label)}</span>${beforeToggle}<button type="button" id="${id}" class="row-toggle${on ? ' active' : ''}" role="switch" aria-checked="${on}" aria-label="${escapeHtml(label)}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${on ? 'var(--accent-ink)' : 'var(--muted)'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4L19 6"/></svg></button></div>`;
}
export function setToggle(button, on) { button.classList.toggle('active', on); button.setAttribute('aria-checked', String(on)); button.querySelector('svg').setAttribute('stroke', on ? 'var(--accent-ink)' : 'var(--muted)'); }

export const goalMax = { kcal: 10000, protein: 500, carbs: 1000, fat: 500 };
export const valueMax = { kcal: 10000, protein: 1000, carbs: 1000, fat: 1000 };
let actionRunner;
export function setActionRunner(fn) { actionRunner = fn; }
export async function run(button, fn, statusId) {
  if (actionRunner) return actionRunner(button, fn, statusId);
  if (button.disabled) return;
  const old = button.textContent; button.disabled = true; button.textContent = 'Saving…';
  try { await fn(); }
  catch (error) { toast(error?.message || 'Something went wrong. Please try again.', null, false, 'error'); }
  finally { if (button.isConnected) { button.disabled = false; button.textContent = old; } }
}
export function pageHeader(title, href, label) {
  $('page-header').innerHTML = `<a class="icon-link" href="${href}" aria-label="${label}">${BACK_ICON}</a><h1>${escapeHtml(title)}</h1><span class="icon-link header-blank" aria-hidden="true"></span>`;
}
export function navRow(name, meta, href) {
  return `<li><a class="list-item" href="${href}"><div class="list-item-body"><div class="list-item-name">${escapeHtml(name)}</div>${meta ? `<div class="list-item-meta">${escapeHtml(meta)}</div>` : ''}</div><span class="list-item-chevron">${CHEVRON}</span></a></li>`;
}
export function dateLabel(day) {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(day.slice(0,4) !== String(new Date().getFullYear()) ? {year:'numeric'} : {}) }).replace(',', '');
}
