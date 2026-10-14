import { $, pageHeader, escapeHtml, status, number, goalMax, toast } from './ui.js';
import { NUTRIENTS, trackedNutrients, reconcileGoals, fmt } from './nutrition.js';
import * as store from './store.js';
pageHeader('Goals', './settings.html', 'Back to settings');
let settings, queue = Promise.resolve();
const types = [{key:'max',label:'Under'}, {key:'target',label:'Exact'}, {key:'min',label:'Over'}];
function render() {
  $('goals-content').hidden = false;
  $('goals-content').innerHTML = `<p class="section-label">Track</p><div class="chips track-chips" role="group" aria-label="Track nutrients">${NUTRIENTS.map(n => `<button type="button" id="track-${n.key}" class="chip${settings.nutrients[n.key].on ? ' selected' : ''}" aria-pressed="${settings.nutrients[n.key].on}">${n.label}</button>`).join('')}</div><p class="section-label">Targets</p>${trackedNutrients(settings).map(n => {
    const g = settings.nutrients[n.key];
    return `<div class="goal-block" data-nutrient="${n.key}"><div class="goal-grid"><label for="goal-${n.key}" class="goal-name">${n.label}</label><div class="field"><div class="amount-input"><input type="text" id="goal-${n.key}" inputmode="numeric" value="${escapeHtml(g.goal ?? '')}" placeholder="No goal" aria-label="${n.label} goal" aria-describedby="goal-${n.key}-error" autocomplete="off"><span class="unit" aria-hidden="true">${n.unit}</span></div></div></div><div id="goal-${n.key}-error" class="status error" role="status" hidden></div><div class="chips goal-grid" role="group" aria-label="${n.label} goal type">${types.map(t => `<button type="button" class="chip${g.type === t.key ? ' selected' : ''}" data-type="${t.key}" aria-pressed="${g.type === t.key}">${t.label}</button>`).join('')}</div></div>`;
  }).join('')}`;
  for (const n of NUTRIENTS) {
    $(`track-${n.key}`).onclick = e => save(e.currentTarget, next => {
      if (next.nutrients[n.key].on && trackedNutrients(next).length === 1) { toast('Keep at least one nutrient on.'); return false; }
      next.nutrients[n.key].on = !next.nutrients[n.key].on; return true;
    }, n.key !== 'kcal', true);
    const input = $(`goal-${n.key}`);
    if (!input) continue;
    input.onchange = () => {
      const r = number(input.value, { min:1, max:goalMax[n.key], integer:true });
      status(`${input.id}-error`, r.error || '', 'error'); input.setAttribute('aria-invalid',String(!!r.error));
      if (!r.error) save(input, next => { next.nutrients[n.key].goal = r.value; return true; }, n.key !== 'kcal');
    };
    input.onfocus = () => input.select();
    input.closest('.goal-block').querySelectorAll('[data-type]').forEach(b => b.onclick = () => save(b, next => { next.nutrients[n.key].type = b.dataset.type; return true; }, n.key !== 'kcal'));
  }
}
function save(control, change, macroChange, rebuild = false) {
  control.disabled = true;
  queue = queue.then(async () => {
    let next = structuredClone(settings);
    if (!change(next)) { control.disabled = false; return; }
    const r = reconcileGoals(next), adjusted = macroChange && r.changed;
    if (adjusted) next = r.settings;
    try {
      settings = await store.saveSettings(next);
      if (adjusted) toast(`Calorie goal set to ${fmt('kcal',r.kcal.to)} kcal to match your macro goals`);
      else if (!macroChange && r.changed) toast(`Your macro goals add up to about ${fmt('kcal',r.kcal.to)} kcal`);
      if (rebuild) render();
      else {
        for (const n of NUTRIENTS) {
          const input = $(`goal-${n.key}`); if (!input) continue;
          if (document.activeElement !== input) input.value = settings.nutrients[n.key].goal ?? '';
          input.closest('.goal-block').querySelectorAll('[data-type]').forEach(b => { const on = settings.nutrients[n.key].type === b.dataset.type; b.classList.toggle('selected',on); b.setAttribute('aria-pressed',String(on)); });
        }
        control.disabled = false;
      }
    } catch(error) { control.disabled = false; toast(error?.message || "Couldn't save settings.",null,false,'error'); }
  }).catch(() => { control.disabled = false; toast("Couldn't save settings.",null,false,'error'); });
}
async function load() {
  try { settings = await store.getSettings(); render(); status('page-status'); }
  catch { status('page-status', "Couldn't load goals.",'error',load); }
}
load();
