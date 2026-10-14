// The per-nutrient day charts (one bar chart + averages prose each). Lives on
// the Analytics page, under the 7-day averages card.
import { fmt, dailySeries, averageSummary, chartGate, isUsable, goalStatus, shiftDay } from './nutrition.js';
import { renderDayBarChart, createRowReadout } from './chart.js';
import { escapeHtml } from './ui.js';

// Goal line: green, long dashes, one solid gap cut through the bars; today's bar in white stripes.

const dateLabel = (day, weekday = false) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', {
  ...(weekday ? { weekday: 'short' } : {}), day: 'numeric', month: 'short',
});


/** The sentence under a chart, or null (no sentence) while there's no honest 4-week average. */
export function summaryCopy(summary, nutrient) {
  if (!summary) return null;
  // Prose rounds calories to the nearest 10 ("2,400 kcal", not "2,398") once there's something to round.
  const amount = value => `${fmt(nutrient.key, nutrient.key === 'kcal' && value >= 100 ? Math.round(value / 10) * 10 : value)} ${nutrient.unit}`;
  let copy = `You averaged ${amount(summary.average)} a day over the last 4 weeks.`;
  if (summary.goal == null) return copy;
  // A difference that rounds away to nothing reads as on target, never "0 kcal over".
  const off = Math.abs(summary.diff), shown = amount(off), negligible = /^0(\.0)? /.test(shown);
  if (summary.type === 'max') {
    // Under a limit is the good side however far under; only going over gets a number.
    return copy + (summary.diff <= 0 || negligible ? " That's within your limit." : ` That's ${shown} over your limit.`);
  }
  if (summary.hit || negligible) return copy + (summary.type === 'min' ? ' That meets your minimum.' : " That's on your goal.");
  return copy + (summary.type === 'min' ? ` That's ${shown} short of your minimum.`
    : ` That's ${shown} ${summary.diff < 0 ? 'below' : 'above'} your goal.`);
}

/** Append one section per nutrient to `container`. */
export function renderNutrientCharts(container, nutrients, { entries, history, firstDay, today }) {
  for (const nutrient of nutrients) {
    const days = dailySeries(entries, history, nutrient.key, today, 28);
    const section = document.createElement('section'); section.className = 'nutrient-section';
    section.setAttribute('aria-labelledby', `label-${nutrient.key}`);
    section.innerHTML = `<p class="section-label has-readout"><span id="label-${nutrient.key}">${escapeHtml(nutrient.label)}</span><span class="scrub-readout" hidden></span></p><div class="chart-card"></div>`;
    container.append(section);
    const card = section.querySelector('.chart-card');
    const missingMessage = `<p class="empty-state">Too many recent days are missing ${nutrient.key === 'kcal' ? 'calories' : nutrient.label.toLowerCase()} to chart this. Fill it in when you quicklog.</p>`;
    if (!days.some(p => p.logged)) {
      // Entries exist but none has this nutrient → it's missing, not "nothing logged".
      card.outerHTML = days.some(p => p.quality !== 'none') ? missingMessage : '<p class="empty-state">Nothing logged in the last 4 weeks.</p>';
      continue;
    }
    // Gate: if most recent days are missing a lot of this nutrient, the chart would show lower bounds, not eating.
    const gate = chartGate(days, today);
    if (!gate.ok) {
      card.outerHTML = missingMessage;
      continue;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${nutrient.label} logged per day over the last 28 days, with historical goals. Today is in progress.`);
    card.append(svg);
    // Legend inside the chart card, under the chart (stylebook: charts get one quiet card, legend included).
    if (days.some(p => p.goal)) card.insertAdjacentHTML('beforeend', '<div class="legend"><span><i class="goal-swatch"></i>Goal</span></div>');
    const readout = createRowReadout(section.querySelector('.scrub-readout'));
    renderDayBarChart(svg, { days, goalLine: true, scrub: { onChange(info) {
      if (!info) { readout.hide(); return; }
      const point = info.point;
      const value = !point.logged ? 'Not logged' : `${point.quality === 'partial' ? '≥ ' : ''}${fmt(nutrient.key, point.value)} ${nutrient.unit}${point.quality === 'partial' ? ' · incomplete' : ''}`;
      readout.show([{ value, date: dateLabel(point.day, true) }, { value, date: dateLabel(point.day) }]);
    } } });
    // No honest 4-week average yet → no sentence at all, like Volume's averages paragraph.
    const copy = summaryCopy(averageSummary(days, nutrient.key, firstDay, today), nutrient);
    if (copy) { const paragraph = document.createElement('p'); paragraph.className = 'averages-copy muted'; paragraph.textContent = copy; section.append(paragraph); }
  }
}

// ── 7-day previews (Home's Analytics card, Analytics page's averages card) ──
// The last 7 finished days (today is still in progress, so it isn't judged yet).
function weekOf(key, { entries, history, today }) {
  const days = dailySeries(entries, history, key, shiftDay(today, -1), 7);
  const gate = chartGate(dailySeries(entries, history, key, today, 28), today);
  return { days, ok: gate.ok };
}
const dayHit = (key, p) => p.logged && isUsable(p) && p.goal ? !!goalStatus(key, p.value, p.goal, p.type)?.hit : null;
// A rolling 7-day number only shows once history spans the whole window (Volume's rolling-average rule).
const fullWeek = data => !!data.firstDay && data.firstDay <= shiftDay(data.today, -7);

/** Card body: one row per nutrient — 7 dots (green = on goal, white ring = logged, faint = incomplete or not logged) and the count. */
export function goalDaysBody(nutrients, data) {
  const full = fullWeek(data);
  const rows = nutrients.map(n => {
    const { days, ok } = weekOf(n.key, data);
    if (!ok) return `<div class="ap-row"><span class="stat-label">${escapeHtml(n.label)}</span><span class="ap-off muted">Not tracked well enough</span></div>`;
    const hits = days.filter(p => dayHit(n.key, p)).length;
    const dots = days.map(p => { const h = dayHit(n.key, p); const cls = !p.logged || !isUsable(p) ? 'off' : h ? 'hit' : 'logged'; return `<span class="ap-dot ${cls}"></span>`; }).join('');
    return `<div class="ap-row"><span class="stat-label">${escapeHtml(n.label)}</span><span class="ap-dots" aria-hidden="true">${dots}</span><span class="ap-count">${full && days.some(p => p.goal) ? `${hits}/7` : ''}</span></div>`;
  }).join('');
  return `<div class="list-item-name goals-card-title">Last 7 days on goal</div>${rows}`;
}

/** Card body: the goals card's shape, filled with 7-day daily averages; green when that average is on goal. */
export function averagesBody(nutrients, data) {
  // Same rules as the 4-week sentence: full window, at least half the days usable, goal compared only when consistent.
  const avg = n => {
    const { days, ok } = weekOf(n.key, data), s = ok ? averageSummary(days, n.key, data.firstDay, data.today) : null;
    if (!s) return { text: '—', hit: false };
    const shown = n.key === 'kcal' && s.average >= 100 ? Math.round(s.average / 10) * 10 : s.average;
    return { text: `${fmt(n.key, shown)}<span class="unit">${n.unit}</span>`, hit: !!s.hit };
  };
  const [hero, ...rest] = nutrients, h = avg(hero);
  return `<div class="list-item-name goals-card-title">7-day average</div><div class="stat-label">${escapeHtml(hero.label)}</div><div class="stat-value${h.hit ? ' is-hit' : ''}">${h.text}</div>${rest.length ? `<div class="summary-columns" style="grid-template-columns:repeat(${rest.length},minmax(0,1fr))">${rest.map(n => { const a = avg(n); return `<div data-nutrient="${n.key}"><div class="stat-label">${escapeHtml(n.label)}</div><div class="goal-value${a.hit ? ' is-hit' : ''}">${a.text}</div></div>`; }).join('')}</div>` : ''}`;
}
