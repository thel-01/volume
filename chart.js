// ---------------------------------------------------------------------------
// The one line chart the app uses, in plain SVG with no library.
//
// Deliberately sparse: two or three y-labels, only the first and last date on
// the x-axis, no grid lines at all. This is a trend visualiser — the shape
// matters, precise readings do not. Tap a point for the exact numbers.
//
// Extracted from exercise-trend.html so the dashboard can draw the same chart
// without a second copy of it, the same way every page shares supabase-client.js.
// ---------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 340;
const VIEW_H = 180;
const MARGIN = { top: 16, right: 16, bottom: 26, left: 40 };

// Whole-number steps only, so two labels can never round to the same text.
const TICK_STEPS = [
  1, 2, 3, 4, 5, 10, 15, 20, 25, 50,
  100, 150, 200, 250, 500, 1000, 2000, 2500, 5000, 10000,
];

/**
 * The plot area is fitted to the DATA, and labels are then placed on whatever
 * round numbers happen to fall inside it.
 *
 * Doing it the other way round — rounding the range outwards first, so the top
 * and bottom labels are always the exact edges — is what strands a 100..122
 * series on a 50/100/150 axis with the whole trend squashed into the middle
 * third. The labels are only here for context, so the highest one does not
 * need to sit at the very top.
 */
function computeYAxis(values) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  let lo = dataMin;
  let hi = dataMax;

  if (lo === hi) {
    // Flat or single-point series — fabricate a window so the point sits
    // mid-chart instead of on a zero-height axis.
    const pad = Math.max(1, Math.abs(lo) * 0.1);
    lo -= pad;
    hi += pad;
  } else {
    // Just enough room that the top and bottom dots aren't clipped.
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
  }
  if (lo < 0 && dataMin >= 0) lo = 0; // never imply negative weight

  let ticks = [];
  for (const step of TICK_STEPS) {
    const candidate = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      candidate.push(Math.round(v));
    }
    if (candidate.length <= 3) { ticks = candidate; break; }
    ticks = candidate; // keep the last (finest) set in case nothing fits
  }
  if (ticks.length > 3) ticks = ticks.slice(0, 3);

  return { min: lo, max: hi, ticks };
}

function text(x, y, anchor, size, fill, content) {
  const el = document.createElementNS(NS, 'text');
  el.setAttribute('x', x);
  el.setAttribute('y', y);
  el.setAttribute('text-anchor', anchor);
  el.setAttribute('font-size', size);
  el.setAttribute('fill', fill);
  el.textContent = content;
  return el;
}

/**
 * Draw one or more line series into an <svg>.
 *
 * @param {SVGElement} svg
 * @param {object}   opts
 * @param {Array}    opts.series        [{ points: [{date, value, ...}], color, width, dashed, dots, tappable }]
 *                                      Axes span every series; only `tappable` ones get tooltips.
 * @param {Function} opts.formatValue   (value) => y-axis label
 * @param {Function} opts.formatDate    (iso, showYear) => x-axis label
 * @param {Function} opts.tooltipLines  (point) => [primary, secondary]
 * @param {Function} [opts.ariaLabel]   (point) => string
 */
export function renderLineChart(svg, opts) {
  const { series, formatValue, formatDate, tooltipLines, ariaLabel } = opts;

  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);

  const drawn = series.filter((s) => s.points && s.points.length > 0);
  if (drawn.length === 0) return;

  const allPoints = drawn.flatMap((s) => s.points);
  const times = allPoints.map((p) => new Date(p.date).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const axis = computeYAxis(allPoints.map((p) => p.value));

  const plotW = VIEW_W - MARGIN.left - MARGIN.right;
  const plotH = VIEW_H - MARGIN.top - MARGIN.bottom;
  const xScale = (t) => (maxT === minT
    ? MARGIN.left + plotW / 2
    : MARGIN.left + ((t - minT) / (maxT - minT)) * plotW);
  const yScale = (v) => MARGIN.top + plotH - ((v - axis.min) / (axis.max - axis.min)) * plotH;

  // Invisible backdrop: tapping empty chart space dismisses any open tooltip.
  const backdrop = document.createElementNS(NS, 'rect');
  backdrop.setAttribute('x', 0);
  backdrop.setAttribute('y', 0);
  backdrop.setAttribute('width', VIEW_W);
  backdrop.setAttribute('height', VIEW_H);
  backdrop.setAttribute('fill', 'transparent');
  backdrop.addEventListener('click', () => clearTooltip());
  svg.appendChild(backdrop);

  // Y-axis labels only — no tick marks, no grid lines.
  for (const tickValue of axis.ticks) {
    svg.appendChild(text(
      MARGIN.left - 8, yScale(tickValue) + 3.5,
      'end', '11', 'var(--muted)', formatValue(tickValue),
    ));
  }

  // X-axis: first and last day only.
  const sameYear = new Date(minT).getFullYear() === new Date(maxT).getFullYear();
  if (maxT === minT) {
    svg.appendChild(text(
      xScale(minT), VIEW_H - 6, 'middle', '11', 'var(--muted)',
      formatDate(new Date(minT).toISOString(), false),
    ));
  } else {
    svg.appendChild(text(
      MARGIN.left, VIEW_H - 6, 'start', '11', 'var(--muted)',
      formatDate(new Date(minT).toISOString(), !sameYear),
    ));
    svg.appendChild(text(
      VIEW_W - MARGIN.right, VIEW_H - 6, 'end', '11', 'var(--muted)',
      formatDate(new Date(maxT).toISOString(), !sameYear),
    ));
  }

  // Lines first, so dots and tooltips always sit on top.
  for (const s of drawn) {
    if (s.points.length < 2) continue;
    const d = s.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(new Date(p.date).getTime())},${yScale(p.value)}`)
      .join(' ');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', s.color || 'var(--accent)');
    path.setAttribute('stroke-width', s.width || '2');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    if (s.dashed) path.setAttribute('stroke-dasharray', '4 4');
    if (s.opacity) path.setAttribute('opacity', s.opacity);
    svg.appendChild(path);
  }

  let activeKey = null;

  for (const s of drawn) {
    if (!s.dots) continue;
    s.points.forEach((p, i) => {
      const cx = xScale(new Date(p.date).getTime());
      const cy = yScale(p.value);

      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', cy);
      dot.setAttribute('r', 3.5);
      dot.setAttribute('fill', s.color || 'var(--accent)');
      dot.setAttribute('stroke', 'var(--surface)');
      dot.setAttribute('stroke-width', '1.5');
      svg.appendChild(dot);

      if (!s.tappable) return;

      const key = `${s.key || 'main'}:${i}`;
      const hit = document.createElementNS(NS, 'circle');
      hit.setAttribute('cx', cx);
      hit.setAttribute('cy', cy);
      hit.setAttribute('r', 12);
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('pointer-events', 'all');
      hit.style.cursor = 'pointer';
      hit.setAttribute('tabindex', '0');
      hit.setAttribute('role', 'button');
      if (ariaLabel) hit.setAttribute('aria-label', ariaLabel(p));
      const toggle = (e) => {
        e.stopPropagation();
        if (activeKey === key) { clearTooltip(); return; }
        activeKey = key;
        showTooltip(cx, cy, tooltipLines(p));
      };
      hit.addEventListener('click', toggle);
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
      });
      svg.appendChild(hit);
    });
  }

  function clearTooltip() {
    activeKey = null;
    const existing = svg.querySelector('.chart-tip');
    if (existing) existing.remove();
  }

  function showTooltip(cx, cy, lines) {
    clearTooltip();
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'chart-tip');
    g.setAttribute('pointer-events', 'none');

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('rx', 6);
    rect.setAttribute('fill', 'var(--surface-2)');
    rect.setAttribute('stroke', 'var(--line)');
    g.appendChild(rect);

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('font-size', '11');
    label.setAttribute('fill', 'var(--text)');
    lines.forEach((line, i) => {
      const tspan = document.createElementNS(NS, 'tspan');
      tspan.setAttribute('x', 0);
      tspan.setAttribute('dy', i === 0 ? 0 : 13);
      if (i > 0) tspan.setAttribute('fill', 'var(--muted)');
      tspan.textContent = line;
      label.appendChild(tspan);
    });
    g.appendChild(label);
    svg.appendChild(g);

    const bbox = label.getBBox();
    const padX = 8, padY = 6;
    const boxW = bbox.width + padX * 2;
    const boxH = bbox.height + padY * 2;

    let boxX = cx - boxW / 2;
    boxX = Math.max(2, Math.min(VIEW_W - 2 - boxW, boxX));
    let boxY = cy - boxH - 12;
    if (boxY < 2) boxY = cy + 12;

    rect.setAttribute('x', boxX);
    rect.setAttribute('y', boxY);
    rect.setAttribute('width', boxW);
    rect.setAttribute('height', boxH);

    const textX = boxX + padX;
    const textY = boxY + padY + 9;
    label.setAttribute('x', textX);
    label.setAttribute('y', textY);
    for (const tspan of label.querySelectorAll('tspan')) tspan.setAttribute('x', textX);
  }
}
