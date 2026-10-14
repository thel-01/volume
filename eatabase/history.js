import { $, pageHeader, navRow, dateLabel, status } from './ui.js';
import { localDay, trackedNutrients, dayTotals, fmt, shiftDay } from './nutrition.js';
import * as store from './store.js';
pageHeader('History','./settings.html','Back to settings');
async function load() {
  try {
    const settings = await store.getSettings(), nutrient = trackedNutrients(settings)[0];
    const entries = await store.entriesBetween('0001-01-01', shiftDay(localDay(), -1));
    const groups = new Map();
    for (const entry of entries) {
      if (!groups.has(entry.day)) groups.set(entry.day, []);
      groups.get(entry.day).push(entry);
    }
    const days = [...groups].map(([day, entries]) => ({ day, count: entries.length, entries })).sort((a,b) => b.day.localeCompare(a.day));
    const rows = days.map(d => {
      const total = dayTotals(d.entries)[nutrient.key];
      const value = total.missing === total.count ? '—' : `${total.missing ? '≥ ' : ''}${fmt(nutrient.key,total.value)} ${nutrient.unit}`;
      return navRow(dateLabel(d.day),`${value} · ${d.count} ${d.count === 1 ? 'entry' : 'entries'}`,`./index.html?day=${d.day}`);
    });
    $('history-list').innerHTML = rows.length ? rows.join('') : '<li class="empty-state">No past days yet.</li>';
    $('history-list').hidden = false; status('page-status');
  } catch { status('page-status', "Couldn't load history.",'error',load); }
}
load();
