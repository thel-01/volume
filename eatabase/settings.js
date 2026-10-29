import { $, escapeHtml, CHEVRON, pageHeader, navRow, loading, status, toast, run, toggleMarkup, setToggle } from './ui.js';
import { trackedNutrients, fmt, localDay, MAX_DAY_END_HOUR } from './nutrition.js';
import * as store from './store.js';
import { BACKEND } from './config.js';
pageHeader('Settings', './home.html', 'Back to home');
// Goals card: the day's tracking card reduced to just the goal numbers (types are detail, on the Goals page).
function goalText(n, g) { return g.goal ? `${fmt(n.key, g.goal)}<span class="unit">${n.unit}</span>` : '—'; }
function goalsCard(settings) {
  const [hero, ...rest] = trackedNutrients(settings);
  return `<a class="card goals-card" href="./goals.html" aria-label="Goals"><div class="goals-card-body"><div class="list-item-name goals-card-title">Goals</div><div class="stat-label">${escapeHtml(hero.label)}</div><div class="stat-value">${goalText(hero, settings.nutrients[hero.key])}</div>${rest.length ? `<div class="summary-columns" style="grid-template-columns:repeat(${rest.length},minmax(0,1fr))">${rest.map(n => `<div><div class="stat-label">${escapeHtml(n.label)}</div><div class="goal-value">${goalText(n, settings.nutrients[n.key])}</div></div>`).join('')}</div>` : ''}</div><span class="list-item-chevron">${CHEVRON}</span></a>`;
}
// Day ends at: a card that opens a small chip picker (Midnight alone, then 1–5 am).
const hourLabel = h => h === 0 ? 'Midnight' : `${h} am`;
let dayEndFocus = null;
function closeDayEnd() { if ($('day-end-modal').hidden) return; $('day-end-modal').hidden = true; dayEndFocus?.focus(); }
function renderDayEnd(hour) {
  $('day-end-setting').innerHTML = `<ul class="list"><li><button type="button" class="list-item" id="day-end-row" aria-haspopup="dialog"><div class="list-item-body"><div class="list-item-name">Day ends at</div><div class="list-item-meta">${hourLabel(hour)}</div></div><span class="list-item-chevron">${CHEVRON}</span></button></li></ul><p class="caption" style="margin-top:0;">Before this time, food is logged to the previous day.</p>`;
  $('day-end-grid').innerHTML = Array.from({ length: MAX_DAY_END_HOUR + 1 }, (_, h) => `<button type="button" class="chip${h ? ' chip-num' : ' chip-nopain'}${h === hour ? ' selected' : ''}" data-hour="${h}" aria-pressed="${h === hour}">${hourLabel(h)}</button>`).join('');
  $('day-end-row').onclick = () => { dayEndFocus = $('day-end-row'); $('day-end-modal').hidden = false; $('day-end-grid').querySelector('.selected').focus(); };
  $('day-end-grid').querySelectorAll('button').forEach(b => b.onclick = async () => {
    const next = Number(b.dataset.hour); if (next === hour) { closeDayEnd(); return; }
    $('day-end-grid').querySelectorAll('button').forEach(x => x.disabled = true);
    try { const s = await store.getSettings(); s.dayEndHour = next; await store.saveSettings(s); hour = next; closeDayEnd(); renderDayEnd(next); }
    catch (error) {
      toast(messageFor(error), null, false, 'error');
      // A partly-saved change may still have taken effect: show what's actually saved.
      try { renderDayEnd((await store.getSettings()).dayEndHour); } catch { /* keep what is shown */ }
    }
    finally { $('day-end-grid').querySelectorAll('button').forEach(x => x.disabled = false); }
  });
}
$('close-day-end').onclick = closeDayEnd;
$('day-end-modal').onclick = e => { if (e.target === $('day-end-modal')) closeDayEnd(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDayEnd(); });
const messageFor = error => error?.message || 'Something went wrong. Please try again.';
async function loadSettings() {
  $('settings-content').hidden = true; loading('page-status');
  try {
    const [settings, foods] = await Promise.all([store.getSettings(), store.listFoods()]);
    await renderAccount();
    $('settings-menu').innerHTML = `<li>${goalsCard(settings)}</li>` + navRow('Your foods', foods.length ? `${foods.length} saved` : 'None yet', './foods.html') + navRow('History', '', './history.html');
    renderDayEnd(settings.dayEndHour);
    $('meal-setting').innerHTML = toggleMarkup('group-meals', 'Group by meal', settings.meals);
    $('group-meals').onclick = async () => {
      const b = $('group-meals'); b.disabled = true;
      try { const next = await store.getSettings(); next.meals = !next.meals; await store.saveSettings(next); setToggle(b,next.meals); }
      catch(error) { toast(messageFor(error), null, false, 'error'); } finally { b.disabled = false; }
    };
    status('page-status'); $('settings-content').hidden = false;
  } catch(error) { status('page-status', `Couldn't load settings. ${messageFor(error)}`, 'error', loadSettings); }
}
// Account: same as Volume's. The lab has no account, so it says so and can't log out.
async function renderAccount() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('account-mode').textContent = standalone ? 'Installed app' : 'Browser tab';
  if (BACKEND !== 'supabase') { $('account-email').textContent = 'Lab (no account)'; $('log-out').disabled = true; return; }
  const { supabase } = await import('../supabase-client.js');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  $('account-email').textContent = data?.session?.user?.email || 'Unknown';
  const button = $('log-out');
  button.onclick = async () => {
    button.disabled = true; button.textContent = 'Logging out…';
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      location.replace('./login.html');
    } catch(error) {
      toast(`Could not log out: ${messageFor(error)}`, null, false, 'error');
      button.disabled = false; button.textContent = 'Log out';
    }
  };
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
}
async function download(format) {
  const data = await store.exportAll();
  const columns = ['day','logged_at','meal','name','brand','source','amount','amount_unit','kcal','protein','carbs','fat'];
  const content = format === 'json' ? JSON.stringify(data,null,2) : [columns.join(','), ...data.entries.map(e => [e.day,e.loggedAt,e.meal,e.name,e.brand,e.source,e.millilitres ?? e.grams ?? e.portions,e.basis === 'portion' ? 'portion' : e.basis === 'once' ? '' : e.amountUnit || (e.millilitres != null ? 'ml' : 'g'),...['kcal','protein','carbs','fat'].map(k => e.values?.[k])].map(csvCell).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([content], {type:format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href=url; a.download=`eatabase-${localDay()}.${format}`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('Exported');
}
for (const format of ['json','csv']) $('export-'+format).onclick = e => run(e.currentTarget, () => download(format));
loadSettings();
