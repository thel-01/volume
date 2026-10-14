// Quicklog popup (stylebook "Quicklog popup"): just the numbers — calories plus
// whichever macros you track — logged as "Quicklog" into the meal the time of
// day suggests. Shared by Your day and Home, so both Quick buttons do the same.
import { NUTRIENTS, trackedNutrients, quickValues, defaultMeal, fmt, localDay } from './nutrition.js';
import * as store from './store.js';
import { $, field, number, fieldError, status, run, valueMax } from './ui.js';

let ctx = null;   // { settings, day, onLogged, mutate }

function ensureModal() {
  if ($('quicklog-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="quicklog-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="quicklog-title" hidden>
    <div class="modal-card">
      <div class="modal-header"><h2 id="quicklog-title">Quicklog</h2><button type="button" id="close-quicklog" class="modal-close" aria-label="Close">×</button></div>
      <div id="quicklog-fields" class="quicklog-fields"></div>
      <div id="ql-derived" class="caption" role="status" hidden></div>
      <div id="ql-status" class="status" role="status" aria-live="polite" hidden></div>
      <button type="button" id="ql-log" class="uppercase">Log</button>
    </div>
  </div>`);
  $('close-quicklog').onclick = closeQuicklog;
  $('quicklog-modal').onclick = e => { if (e.target === $('quicklog-modal')) closeQuicklog(); };
  $('ql-log').onclick = e => run(e.currentTarget, logQuicklog, 'ql-status');
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('quicklog-modal').hidden) closeQuicklog(); });
}

function readFields(showErrors) {
  const values = {}; let valid = true;
  for (const n of NUTRIENTS) {
    const input = $(`ql-${n.key}`);
    const r = number(input?.value ?? '', { max: valueMax[n.key] });
    if (r.error) valid = false;
    if (input && showErrors) fieldError(input.id, r.error);
    values[n.key] = r.value ?? null;
  }
  return { values, valid };
}

/** Open the popup. `day` = the day it logs onto; `onLogged(row)` runs after a successful log. */
export function openQuicklog({ settings, day, today = day === localDay(), onLogged, mutate = fn => fn() }) {
  ensureModal(); ctx = { settings, day, today, onLogged, mutate };
  const tracked = new Set(['kcal', ...trackedNutrients(settings).map(n => n.key)]);
  $('quicklog-fields').innerHTML = NUTRIENTS.filter(n => tracked.has(n.key)).map(n => field(`ql-${n.key}`, `${n.label} (${n.unit})`, '', {})).join('');
  $('ql-derived').hidden = true; status('ql-status'); $('quicklog-modal').hidden = false; $('ql-log').disabled = true;
  const update = () => {
    const r = readFields(false), q = r.valid ? quickValues(r.values) : null;
    $('ql-log').disabled = !q || q.values.kcal > valueMax.kcal;
    $('ql-derived').hidden = !q?.kcalDerived; $('ql-derived').textContent = q?.kcalDerived ? `≈ ${fmt('kcal', q.values.kcal)} kcal from macros` : '';
  };
  $('quicklog-fields').querySelectorAll('input').forEach(x => x.addEventListener('input', update));
  requestAnimationFrame(() => $('ql-kcal').focus());
}
export function closeQuicklog() { if ($('quicklog-modal')) $('quicklog-modal').hidden = true; }

async function logQuicklog() {
  const r = readFields(true), q = r.valid ? quickValues(r.values) : null;
  if (!r.valid || !q) { $('quicklog-fields').querySelector('[aria-invalid="true"]')?.focus(); return; }
  if (q.values.kcal > valueMax.kcal) { fieldError('ql-kcal', `Enter calories or macros totaling no more than ${valueMax.kcal} kcal.`); return; }
  const { settings, onLogged, mutate } = ctx;
  const day = ctx.today ? localDay() : ctx.day;
  const row = await mutate(() => store.addEntry({ day, loggedAt: new Date().toISOString(), meal: settings.meals ? defaultMeal() : null, source: 'quick', sourceRef: null, name: 'Quicklog', basis: 'once', grams: null, portions: null, per100: null, portion: null, values: q.values }));
  closeQuicklog(); await onLogged?.(row);
}
