// Analytics: every tracked nutrient's 4-week day chart, one after another.
import { trackedNutrients, localDay, shiftDay } from './nutrition.js';
import * as store from './store.js';
import { $, pageHeader, status as showStatus } from './ui.js';
import { renderNutrientCharts, averagesBody } from './nutrient-charts.js';

pageHeader('Analytics', './home.html', 'Back to home');
const status = (...args) => showStatus('analytics-status', ...args);

// Tapping a macro on the 7-day card scrolls to that macro's chart. RULE (revisit if the
// page order changes): only macros whose chart is actually drawn (not empty or switched
// off), and never the first chart on the page — it's already in view right under the card.
// The card itself is not tappable.
function linkMacrosToCharts(container) {
  const first = container.querySelector('.nutrient-section');
  for (const cell of container.querySelectorAll('.averages-card [data-nutrient]')) {
    const section = $(`label-${cell.dataset.nutrient}`)?.closest('.nutrient-section');
    if (!section || section === first || !section.querySelector('svg')) continue;
    const label = cell.querySelector('.stat-label').textContent;
    cell.classList.add('chart-jump'); cell.setAttribute('role', 'button'); cell.tabIndex = 0;
    cell.setAttribute('aria-label', `${label}: go to chart`);
    const go = () => section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    cell.onclick = go; cell.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  }
}

async function load() {
  status('Loading…'); $('nutrient-charts').hidden = true;
  try {
    const today = localDay();
    const [settings, history, entries, firstDay] = await Promise.all([
      store.getSettings(), store.getGoalHistory(), store.entriesBetween(shiftDay(today, -27), today), store.firstLoggedDay(),
    ]);
    // Axis labels use SVG text measurement, so lay them out with the loaded font.
    await document.fonts.ready;
    const container = $('nutrient-charts'); container.replaceChildren(); container.hidden = false;
    const data = { settings, entries, history, firstDay, today }, nutrients = trackedNutrients(settings);
    container.insertAdjacentHTML('beforeend', `<section class="card goals-card analytics-card averages-card" aria-label="7-day average">${averagesBody(nutrients, data)}</section>`);
    renderNutrientCharts(container, nutrients, data);
    linkMacrosToCharts(container);
    status();
  } catch {
    $('nutrient-charts').hidden = true;
    status("Couldn't load your analytics. Please try again.", 'error', load);
  }
}
load();
