// ---------------------------------------------------------------------------
// Page-level action-result notifications ("Set logged.", "Session deleted.",
// "Could not delete the set: ...") as a floating overlay instead of a banner
// that pushes page content down. Every page gets one #toast-layer, created
// lazily here rather than hand-written into each page's HTML.
//
// This is only for transient results of something the user just did. A
// page's own load-time failure ("Could not load history: ...") stays as the
// existing in-flow #top-status — that's a blocking state shown before real
// content exists, not a notification layered on top of it, so it's left
// alone; each page still owns that locally, same as before.
// ---------------------------------------------------------------------------

// Same two icons used for every success/error status across the app —
// color-only otherwise, which doesn't hold up for anyone who can't rely on
// color alone.
const ICONS = {
  ok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13 L10 19 L20 5"/></svg>',
  error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 L22 20 H2 Z"/><line x1="12" y1="9" x2="12" y2="14.5"/><circle cx="12" cy="17.2" r="0.9" fill="var(--danger)" stroke="none"/></svg>',
};

function layer() {
  let el = document.getElementById('toast-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-layer';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}

/**
 * @param {string} message required — the primary line, plain text (never HTML — this can carry
 *                          a raw error message or a user-entered name, so it's always inserted as
 *                          a text node, matching the old show()'s createTextNode safety).
 * @param {'ok'|'error'|'info'} [kind]
 * @param {object} [opts]
 * @param {string} [opts.detail] secondary line, e.g. more context under the headline
 * @param {string} [opts.actionLabel] e.g. "Undo" — omit for a plain notification
 * @param {Function} [opts.onAction] called when actionLabel is tapped; the toast dismisses right after
 * @param {number} [opts.ms] auto-dismiss delay in ms. Default 3000. Pass 0 to disable auto-dismiss.
 * @returns {Function} dismiss — call to remove the toast early (e.g. a caller-driven timeout)
 */
export function showToast(message, kind = 'ok', opts = {}) {
  const { detail, actionLabel, onAction, ms = 3000 } = opts;

  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `
    ${ICONS[kind] || ''}
    <div class="toast-body">
      <div class="toast-title"></div>
      ${detail ? '<div class="toast-detail"></div>' : ''}
      ${actionLabel ? '<div class="toast-actions"><button type="button" class="toast-action"></button></div>' : ''}
    </div>
    <button type="button" class="toast-close" aria-label="Dismiss">&times;</button>
  `;
  // Text set separately as textContent, not interpolated into the innerHTML
  // template above — message/detail can contain a raw error string or a
  // user-entered exercise/session name.
  el.querySelector('.toast-title').textContent = message;
  if (detail) el.querySelector('.toast-detail').textContent = detail;
  if (actionLabel) el.querySelector('.toast-action').textContent = actionLabel;

  layer().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector('.toast-close').addEventListener('click', dismiss);
  if (actionLabel && onAction) {
    el.querySelector('.toast-action').addEventListener('click', () => {
      onAction();
      dismiss();
    });
  }
  if (ms > 0) timer = setTimeout(dismiss, ms);
  return dismiss;
}
