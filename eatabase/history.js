import { $, pageHeader, navRow, dateLabel, status } from './ui.js';
import { localDay, trackedNutrients, dayTotals, fmt, shiftDay } from './nutrition.js';
import * as store from './store.js';
pageHeader('History','./settings.html','Back to settings');
let loadVersion = 0;
async function load() {
  const version = ++loadVersion;
  try {
    const [settings, entries] = await Promise.all([store.getSettings(), store.entriesBetween('0001-01-01', shiftDay(localDay(), -1))]);
    if (version !== loadVersion) return;
    const nutrient = trackedNutrients(settings)[0];
    const groups = new Map();
    for (const entry of entries) {
      if (!groups.has(entry.day)) groups.set(entry.day, []);
      groups.get(entry.day).push(entry);
    }
    const days = [...groups].map(([day, entries]) => ({ day, count: entries.length, entries })).sort((a,b) => b.day.localeCompare(a.day));
    const rows = days.map(d => {
      const total = dayTotals(d.entries)[nutrient.key];
      const value = total.missing === total.count ? '—' : `${total.missing ? '≥ ' : ''}${fmt(nutrient.key,total.value)} ${nutrient.unit}`;
      return navRow(dateLabel(d.day),`${value}, ${d.count} ${d.count === 1 ? 'entry' : 'entries'}`,`./index.html?day=${d.day}`);
    });
    $('history-list').innerHTML = rows.length ? rows.join('') : '<li class="empty-state">No past days yet.</li>';
    $('history-list').hidden = false; status('page-status');
  } catch { if (version !== loadVersion) return; status('page-status', "Couldn't load history.",'error',load); }
}
load();

document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
window.addEventListener('pageshow', event => { if (event.persisted) load(); });
