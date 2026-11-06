import { dayTotals, goalStatus, trackedNutrients, localDay, shiftDay, fmt } from './nutrition.js';
import * as store from './store.js';
import { updateSummary } from './nutrient-summary.js';
import { goalDaysBody } from './nutrient-charts.js';

import { $, escapeHtml, status as showStatus, loading, CHEVRON, toast } from './ui.js';
import { openQuicklog } from './quicklog.js';
import { APP_VERSION } from './version.js';

// Same two actions as Your day's footer: Add food opens the add sheet there; Quick logs right here.
let homeSettings = null, observedToday = localDay(), overviewVersion = 0, foregroundPending = false, loaded = false;
function renderActions() {
  $('home-actions').innerHTML = '<button type="button" id="home-add">Add food</button><button type="button" id="home-quick" class="secondary">Quick</button>';
  $('home-add').onclick = () => { location.href = './index.html#add'; };
  $('home-quick').onclick = () => openQuicklog({ settings: homeSettings, day: localDay(), onClose: ({ saved }) => { if (foregroundPending) { foregroundPending = false; if (!saved) loadOverview(); } }, onLogged: async row => {
    await loadOverview({ animate: true });
    toast('Logged', async () => { await store.deleteEntry(row.id); await loadOverview({ animate: true }); });
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

async function loadOverview({ animate = false } = {}) {
  const version = ++overviewVersion;
  if (!loaded) { loading('overview-status'); $('analytics-preview').hidden = true; }
  try {
    const today = localDay(); observedToday = today;
    const [settings, history, entries, firstDay] = await Promise.all([
      store.getSettings(), store.getGoalHistory(), store.entriesBetween(shiftDay(today, -27), today), store.firstLoggedDay(),
    ]);
    if (version !== overviewVersion) return;
    const todayEntries = entries.filter(entry => entry.day === today);
    const n = trackedNutrients(settings)[0], t = dayTotals(todayEntries)[n.key], g = settings.nutrients[n.key], st = goalStatus(n.key, t.value, g.goal, g.type);
    const value = t.missing === t.count && t.count ? '—' : `${t.missing ? '≥ ' : ''}${fmt(n.key, t.value)}`;
    const side = st ? `${fmt(n.key, Math.abs(st.left))} ${st.left >= 0 ? 'left' : 'over'}` : '';
    const at = g.goal && t.value > g.goal && g.type !== 'min' ? g.goal / t.value * 100 : (st?.share || 0) * 100;
    const markup = `<div class="summary-hero"><div><div class="stat-label">${n.label}</div><div class="nutrient-value"><span class="stat-value lg${st?.hit ? ' is-hit' : ''}"><span class="number" style="width:${Math.max(5, value.length)}ch">${value}</span><span class="unit">${g.goal ? `/ ${fmt(n.key,g.goal)} ` : ''}${n.unit}</span></span></div><span class="muted">${side}</span></div><span class="list-item-chevron">${CHEVRON}</span></div>${st ? `<div class="progress-track${t.value > g.goal && g.type !== 'min' ? ' over' : ''}${st.hit ? ' is-hit' : ''}"><div class="progress-fill" style="width:${at}%"></div>${t.value > g.goal && g.type !== 'min' ? `<div class="progress-over" style="left:${at}%;opacity:1"></div>` : '<div class="progress-over" style="left:100%;opacity:0"></div>'}</div>` : ''}`;
    $('today-card').hidden = false;
    const goals = trackedNutrients(settings).map(n => goalStatus(n.key, dayTotals(todayEntries)[n.key].value, settings.nutrients[n.key].goal, settings.nutrients[n.key].type)).filter(Boolean);
    updateSummary($('today-card'), markup, { key: JSON.stringify([today, n.key, g]), animate, tintAllHit: false, allHit: goals.length > 0 && goals.every(p => p.hit) });
    homeSettings = settings; renderActions();
    // Axis labels use SVG text measurement, so lay them out with the loaded font.
    await document.fonts.ready;
    if (version !== overviewVersion) return;
    const container = $('analytics-preview'); container.replaceChildren(); container.hidden = false;
    renderAnalytics({ settings, history, entries, firstDay, today });
    loaded = true;
    status();
  } catch {
    if (version !== overviewVersion) return;
    if (!loaded) $('analytics-preview').hidden = true;
    status("Couldn't load your overview. Please try again.", 'error', loadOverview);
  }
}

loadOverview();

function refreshOnReturn() {
  if ($('quicklog-modal') && !$('quicklog-modal').hidden) { foregroundPending = true; return; }
  foregroundPending = false;
  loadOverview();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshOnReturn(); });
window.addEventListener('pageshow', event => { if (event.persisted) refreshOnReturn(); });
