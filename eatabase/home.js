import { dayTotals, goalStatus, trackedNutrients, localDay, shiftDay, fmt } from './nutrition.js';
import * as store from './store.js';
import { goalDaysBody } from './nutrient-charts.js';

import { $, escapeHtml, status as showStatus, loading, CHEVRON, toast } from './ui.js';
import { openQuicklog } from './quicklog.js';
import { APP_VERSION } from './version.js';

// Same two actions as Your day's footer: Add food opens the add sheet there; Quick logs right here.
let homeSettings = null, observedToday = localDay();
function renderActions() {
  $('home-actions').innerHTML = '<button type="button" id="home-add">Add food</button><button type="button" id="home-quick" class="secondary">Quick</button>';
  $('home-add').onclick = () => { location.href = './index.html#add'; };
  $('home-quick').onclick = () => openQuicklog({ settings: homeSettings, day: localDay(), onLogged: async row => {
    await loadOverview();
    toast('Logged', async () => { await store.deleteEntry(row.id); await loadOverview(); toast('Undone'); });
  } });
  $('home-actions').hidden = false;
}
$('about-version').textContent = `v${APP_VERSION}`;
$('open-about').onclick = () => { $('about-modal').hidden = false; $('close-about').focus(); };
$('close-about').onclick = () => { $('about-modal').hidden = true; };
$('about-modal').onclick = e => { if (e.target === $('about-modal')) $('about-modal').hidden = true; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('about-modal').hidden = true; });
const status = (...args) => showStatus('overview-status', ...args);

// ── Analytics section: the 7-day goal dots here (exposition), the chevron on to analytics.html (exploration). ──
function renderAnalytics(data) {
  const box = $('analytics-preview');
  box.innerHTML = `<p class="section-label">Analytics</p><a class="card goals-card analytics-card" href="./analytics.html" aria-label="Analytics: last 7 days on goal"><div class="goals-card-body">${goalDaysBody(trackedNutrients(data.settings), data)}</div><span class="list-item-chevron">${CHEVRON}</span></a>`;
  box.hidden = false;
}

async function loadOverview() {
  loading('overview-status'); $('analytics-preview').hidden = true;
  try {
    const today = localDay(); observedToday = today;
    const [settings, history, entries, firstDay] = await Promise.all([
      store.getSettings(), store.getGoalHistory(), store.entriesBetween(shiftDay(today, -27), today), store.firstLoggedDay(),
    ]);
    const todayEntries = entries.filter(entry => entry.day === today);
    const n = trackedNutrients(settings)[0], t = dayTotals(todayEntries)[n.key], g = settings.nutrients[n.key], st = goalStatus(n.key, t.value, g.goal, g.type);
    const value = t.missing === t.count && t.count ? '—' : `${t.missing ? '≥ ' : ''}${fmt(n.key, t.value)}`;
    const side = st ? `${fmt(n.key, Math.abs(st.left))} ${st.left >= 0 ? 'left' : 'over'}` : '';
    const at = g.goal && t.value > g.goal && g.type !== 'min' ? g.goal / t.value * 100 : (st?.share || 0) * 100;
    $('today-card').innerHTML = `<div class="summary-hero"><div><div class="stat-label">${n.label}</div><div class="nutrient-value"><span class="stat-value lg${st?.hit ? ' is-hit' : ''}">${value}<span class="unit">${g.goal ? `/ ${fmt(n.key,g.goal)} ` : ''}${n.unit}</span></span></div><span class="muted">${side}</span></div><span class="list-item-chevron">${CHEVRON}</span></div>${st ? `<div class="progress-track${st.hit ? ' is-hit' : ''}"><div class="progress-fill" style="width:${at}%"></div>${t.value > g.goal && g.type !== 'min' ? `<div class="progress-over" style="left:${at}%"></div>` : ''}</div>` : ''}`;
    $('today-card').hidden = false;
    homeSettings = settings; renderActions();
    // Axis labels use SVG text measurement, so lay them out with the loaded font.
    await document.fonts.ready;
    const container = $('analytics-preview'); container.replaceChildren(); container.hidden = false;
    renderAnalytics({ settings, history, entries, firstDay, today });
    status();
  } catch {
    $('analytics-preview').hidden = true;
    status("Couldn't load your overview. Please try again.", 'error', loadOverview);
  }
}

loadOverview();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && observedToday !== localDay()) loadOverview();
});
