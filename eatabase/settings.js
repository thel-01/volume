import { $, escapeHtml, CHEVRON, pageHeader, navRow, status, toast, run, toggleMarkup, setToggle } from './ui.js';
import { trackedNutrients, fmt, localDay } from './nutrition.js';
import * as store from './store.js';
import { BACKEND } from './config.js';
pageHeader('Settings', './home.html', 'Back to home');
// Goals card: the day's tracking card reduced to just the goal numbers (types are detail, on the Goals page).
function goalText(n, g) { return g.goal ? `${fmt(n.key, g.goal)}<span class="unit">${n.unit}</span>` : '—'; }
function goalsCard(settings) {
  const [hero, ...rest] = trackedNutrients(settings);
  return `<a class="card goals-card" href="./goals.html" aria-label="Goals"><div class="goals-card-body"><div class="list-item-name goals-card-title">Goals</div><div class="stat-label">${escapeHtml(hero.label)}</div><div class="stat-value">${goalText(hero, settings.nutrients[hero.key])}</div>${rest.length ? `<div class="summary-columns" style="grid-template-columns:repeat(${rest.length},minmax(0,1fr))">${rest.map(n => `<div><div class="stat-label">${escapeHtml(n.label)}</div><div class="goal-value">${goalText(n, settings.nutrients[n.key])}</div></div>`).join('')}</div>` : ''}</div><span class="list-item-chevron">${CHEVRON}</span></a>`;
}
const messageFor = error => error?.message || 'Something went wrong. Please try again.';
async function loadSettings() {
  try {
    const [settings, foods] = await Promise.all([store.getSettings(), store.listFoods()]);
    $('settings-menu').innerHTML = `<li>${goalsCard(settings)}</li>` + navRow('Your foods', foods.length ? `${foods.length} saved` : 'None yet', './foods.html') + navRow('History', '', './history.html');
    $('meal-setting').innerHTML = toggleMarkup('group-meals', 'Group by meal', settings.meals);
    $('group-meals').onclick = async () => {
      const b = $('group-meals'); b.disabled = true;
      try { const next = await store.getSettings(); next.meals = !next.meals; await store.saveSettings(next); setToggle(b,next.meals); }
      catch(error) { toast(messageFor(error), null, false, 'error'); } finally { b.disabled = false; }
    };
    status('page-status');
  } catch(error) { status('page-status', "Couldn't load settings.", 'error', loadSettings); }
}
// Account: same as Volume's. The lab has no account, so it says so and can't log out.
async function renderAccount() {
  // Quickest way to tell why a change hasn't shown up yet: an installed
  // copy serves from its own cache until the service worker updates.
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('account-mode').textContent = standalone ? 'Installed app' : 'Browser tab';
  if (BACKEND !== 'supabase') { $('account-email').textContent = 'Lab (no account)'; $('log-out').disabled = true; return; }
  const { supabase } = await import('../supabase-client.js');
  const { data } = await supabase.auth.getSession();
  $('account-email').textContent = data?.session?.user?.email || 'Unknown';
  const button = $('log-out');
  button.onclick = async () => {
    button.disabled = true; button.textContent = 'Logging out…';
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (!error) return location.replace('./login.html');
    toast(`Could not log out: ${error.message}`, null, false, 'error');
    button.disabled = false; button.textContent = 'Log out';
  };
}
renderAccount();
function csvCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
}
async function download(format) {
  const data = await store.exportAll();
  const columns = ['day','logged_at','meal','name','brand','source','amount','kcal','protein','carbs','fat'];
  const content = format === 'json' ? JSON.stringify(data,null,2) : [columns.join(','), ...data.entries.map(e => [e.day,e.loggedAt,e.meal,e.name,e.brand,e.source,e.grams ?? e.portions,...['kcal','protein','carbs','fat'].map(k => e.values?.[k])].map(csvCell).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([content], {type:format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href=url; a.download=`eatabase-${localDay()}.${format}`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('Exported');
}
for (const format of ['json','csv']) $('export-'+format).onclick = e => run(e.currentTarget, () => download(format));
loadSettings();
