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
 * @param {Array}    opts.series        [{ points: [{date, value, ...}], color, width, dashed, dots, tappable, line }]
 *                                      Axes span every series; only `tappable` ones get tooltips.
 *                                      `line: false` draws the points alone, with no segments joining them.
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
    // `line: false` plots the points as a scatter. Joining up noisy readings
    // draws a shape that isn't really there — the connecting segments are an
    // invention, and they compete with whatever smoothed line is the actual
    // signal.
    if (s.line === false) continue;
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
      // `opacity` dims the whole series, dots included — so a scatter can sit
      // behind the line that matters without fighting it for attention, and
      // overlapping readings pile up into something visibly denser.
      if (s.opacity) dot.setAttribute('opacity', s.opacity);
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

// ---------------------------------------------------------------------------
// Donut chart — a share-of-total breakdown, e.g. sets per session type.
//
// Drawn as one <circle> per slice using stroke-dasharray, rather than arc
// paths: a ring is exactly what a dashed circle outline already is, so the
// only maths needed is "how much of the circumference is this slice".
// ---------------------------------------------------------------------------

const DONUT_VIEW = 120;
const DONUT_RADIUS = 45;
const DONUT_STROKE = 20;

/**
 * Draw a donut into an <svg>. Slices are drawn in the order given.
 *
 * @param {SVGElement} svg
 * @param {object}   opts
 * @param {Array}    opts.slices      [{ label, value, color }] — values in any unit; shares are computed here
 * @param {string}   [opts.centerLabel] big text in the hole (e.g. a total)
 * @param {string}   [opts.centerSub]   small text under it
 */
export function renderDonutChart(svg, opts) {
  const { slices, centerLabel, centerSub } = opts;

  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${DONUT_VIEW} ${DONUT_VIEW}`);

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!(total > 0)) return;

  const cx = DONUT_VIEW / 2;
  const cy = DONUT_VIEW / 2;
  const circumference = 2 * Math.PI * DONUT_RADIUS;

  // Track underneath, so a single-slice donut still reads as a ring rather
  // than an unexplained gap.
  const track = document.createElementNS(NS, 'circle');
  track.setAttribute('cx', cx);
  track.setAttribute('cy', cy);
  track.setAttribute('r', DONUT_RADIUS);
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--surface-2)');
  track.setAttribute('stroke-width', DONUT_STROKE);
  svg.appendChild(track);

  let offset = 0;
  for (const slice of slices) {
    if (!(slice.value > 0)) continue;
    const length = (slice.value / total) * circumference;

    const arc = document.createElementNS(NS, 'circle');
    arc.setAttribute('cx', cx);
    arc.setAttribute('cy', cy);
    arc.setAttribute('r', DONUT_RADIUS);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', slice.color);
    arc.setAttribute('stroke-width', DONUT_STROKE);
    arc.setAttribute('stroke-dasharray', `${length} ${circumference - length}`);
    arc.setAttribute('stroke-dashoffset', -offset);
    // Start at 12 o'clock instead of 3, which is where a dashed circle
    // otherwise begins — nobody reads a breakdown starting from the right.
    arc.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    svg.appendChild(arc);

    offset += length;
  }

  if (centerLabel) {
    svg.appendChild(text(cx, cy + (centerSub ? 0 : 5), 'middle', '18', 'var(--text)', centerLabel));
  }
  if (centerSub) {
    svg.appendChild(text(cx, cy + 14, 'middle', '9', 'var(--muted)', centerSub));
  }
}

// ---------------------------------------------------------------------------
// Gauge chart — a single 0..1 score on a banded semicircle, e.g. intensity.
//
// The bands are arc <path> elements (SVG's elliptical-arc command), not the
// donut's stroke-dasharray trick — that trick divides up a full circle's
// circumference, and a semicircle isn't one. The needle is a tapered
// <polygon>, not a <line>: a rotated line reads as a stick, not a needle.
// ---------------------------------------------------------------------------

const GAUGE_VIEW_W = 200;
// Tall enough that the band's OUTER edge (radius + half its stroke width)
// clears the top of the viewBox — sizing this off the centerline radius
// alone left the top of the ring clipped by a couple of pixels.
const GAUGE_VIEW_H = 116;
const GAUGE_CX = GAUGE_VIEW_W / 2;
const GAUGE_CY = GAUGE_VIEW_H - 16;
const GAUGE_RADIUS = 84;
const GAUGE_BAND_WIDTH = 26;
const GAUGE_BAND_GAP_DEG = 1.5; // thin dividers between bands, same idea as the donut's slice edges

// Left (0, low) to right (1, high) — the conventional danger-gauge order,
// not the accent palette used elsewhere, since red/green here mean
// something specific (low effort vs. all-out) that a themed color wouldn't.
const GAUGE_COLORS = ['#4caf50', '#a0c93a', '#f2d43f', '#f0932b', '#e0503a'];

function polarPoint(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

/**
 * Draw a 0..1 gauge into an <svg>.
 *
 * @param {SVGElement} svg
 * @param {object} opts
 * @param {number} opts.value    0..1 — 0 sits at the far left, 1 at the far right
 * @param {Array}  [opts.colors] band colors, left to right (defaults to GAUGE_COLORS)
 */
export function renderGaugeChart(svg, opts) {
  const { value } = opts;
  const colors = opts.colors || GAUGE_COLORS;

  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${GAUGE_VIEW_W} ${GAUGE_VIEW_H}`);

  const n = colors.length;
  const step = 180 / n;
  for (let i = 0; i < n; i++) {
    // i=0 is the leftmost band (highest angle), matching value=0 at the left.
    const startAngle = 180 - i * step - GAUGE_BAND_GAP_DEG / 2;
    const endAngle = 180 - (i + 1) * step + GAUGE_BAND_GAP_DEG / 2;
    const p0 = polarPoint(GAUGE_CX, GAUGE_CY, GAUGE_RADIUS, startAngle);
    const p1 = polarPoint(GAUGE_CX, GAUGE_CY, GAUGE_RADIUS, endAngle);

    const arc = document.createElementNS(NS, 'path');
    arc.setAttribute('d', `M ${p0.x} ${p0.y} A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 0 1 ${p1.x} ${p1.y}`);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', colors[i]);
    arc.setAttribute('stroke-width', GAUGE_BAND_WIDTH);
    svg.appendChild(arc);
  }

  const clamped = Math.max(0, Math.min(1, value));
  const angle = 180 - clamped * 180; // 0 -> left (180deg), 1 -> right (0deg)
  const rad = (angle * Math.PI) / 180;
  const dir = { x: Math.cos(rad), y: -Math.sin(rad) };
  const perp = { x: -dir.y, y: dir.x };

  // A true coffin outline has 6 points, not 4: a short flat trapezoid at the
  // butt as well as the long one at the tip, both narrower than the pivot
  // line between them — not a taper that starts at its widest right at the
  // pivot. The short tail also does double duty as a small counterweight
  // behind the pivot, the way a real gauge needle is balanced.
  const needleLen = GAUGE_RADIUS;
  const tailLen = 10;
  const baseHalf = 6;
  const tipHalf = 3.5;
  const tailHalf = 2.5;

  const tip = { x: GAUGE_CX + dir.x * needleLen, y: GAUGE_CY + dir.y * needleLen };
  const tail = { x: GAUGE_CX - dir.x * tailLen, y: GAUGE_CY - dir.y * tailLen };
  const baseLeft = { x: GAUGE_CX + perp.x * baseHalf, y: GAUGE_CY + perp.y * baseHalf };
  const baseRight = { x: GAUGE_CX - perp.x * baseHalf, y: GAUGE_CY - perp.y * baseHalf };
  const tipLeft = { x: tip.x + perp.x * tipHalf, y: tip.y + perp.y * tipHalf };
  const tipRight = { x: tip.x - perp.x * tipHalf, y: tip.y - perp.y * tipHalf };
  const tailLeft = { x: tail.x + perp.x * tailHalf, y: tail.y + perp.y * tailHalf };
  const tailRight = { x: tail.x - perp.x * tailHalf, y: tail.y - perp.y * tailHalf };

  const needle = document.createElementNS(NS, 'polygon');
  const pts = [tailLeft, baseLeft, tipLeft, tipRight, baseRight, tailRight]
    .map((p) => `${p.x},${p.y}`).join(' ');
  needle.setAttribute('points', pts);
  needle.setAttribute('fill', 'var(--text)');
  svg.appendChild(needle);
}
