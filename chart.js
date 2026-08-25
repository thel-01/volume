// ---------------------------------------------------------------------------
// The one line chart the app uses, in plain SVG with no library.
//
// Deliberately sparse: at least 3 y-labels (never forced to the range's own
// min/max, wherever round numbers land), only the first and last date on the
// x-axis, no grid lines at all. This is a trend visualiser — the shape
// matters, precise readings do not. Tap a point for the exact numbers.
//
// Extracted from exercise-trend.html so the dashboard can draw the same chart
// without a second copy of it, the same way every page shares supabase-client.js.
// ---------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 340;
const VIEW_H = 180;
// left is wide enough for the longest realistic label ("150.5 kg") now that
// a tick can carry a decimal — narrow-range series (bodyweight-scale
// numbers with no added/assisted weight) need one, per computeYAxis below.
const MARGIN = { top: 16, right: 16, bottom: 26, left: 48 };

// Finer-than-1 steps matter for anything tracking bodyweight-scale numbers,
// where a real, meaningful change can be under 1kg (a pull-up's "load" with
// no added/assisted weight is just your bodyweight that day, which moves in
// tenths). Each step's own decimal places are used for rounding below, so
// two labels still can never round to the same text.
const TICK_STEPS = [
  0.1, 0.2, 0.25, 0.5,
  1, 2, 3, 4, 5, 10, 15, 20, 25, 50,
  100, 150, 200, 250, 500, 1000, 2000, 2500, 5000, 10000,
];

/** How many decimal places a step like 0.25 needs so ticks round cleanly. */
function stepDecimals(step) {
  const s = String(step);
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

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
function computeYAxis(values, minRange = 0, fixedRange = null, paddingPct = 0.08) {
  // Some scales are already a meaningful, fixed bound (0-10 pain, for
  // instance) — auto-fitting to whatever data happens to exist would be
  // the one thing that could actually mislead there, the opposite problem
  // minRange below solves. fixedRange skips the data-driven computation
  // entirely; tick generation afterward is the same either way.
  let dataMin, dataMax, lo, hi;
  if (fixedRange) {
    lo = fixedRange.min;
    hi = fixedRange.max;
    dataMin = lo;
    dataMax = hi;
  } else {
    dataMin = Math.min(...values);
    dataMax = Math.max(...values);
    lo = dataMin;
    hi = dataMax;

    if (lo === hi) {
      // Flat or single-point series — fabricate a window so the point sits
      // mid-chart instead of on a zero-height axis.
      const pad = Math.max(1, Math.abs(lo) * 0.1);
      lo -= pad;
      hi += pad;
    } else {
      // Just enough room that the top and bottom dots aren't clipped.
      // paddingPct defaults to 8% everywhere; a chart whose points read as
      // a discrete jump rather than a smooth trend (a step chart) needs
      // more — the flat segment right before a jump reads as touching the
      // edge otherwise, in a way a single dot brushing it doesn't.
      const pad = (hi - lo) * paddingPct;
      lo -= pad;
      hi += pad;
    }

    // A genuinely tiny move (0.3kg of bodyweight noise, a 1-point index
    // wobble) would otherwise stretch to fill the whole chart height and
    // read as a dramatic swing. minRange floors the span so the chart's
    // own scale stays honest about how big the real change is — callers
    // pass a floor sized to their own unit, since e.g. 2kg means nothing
    // on an index chart and 2 index points means nothing on a weight chart.
    if (hi - lo < minRange) {
      const mid = (hi + lo) / 2;
      lo = mid - minRange / 2;
      hi = mid + minRange / 2;
    }
  }

  if (lo < 0 && dataMin >= 0) lo = 0; // never imply negative weight

  // Coarsest, roundest step that still clears a 3-label floor. This used to
  // stop at the FIRST step sparse enough to be <=3 labels, which could
  // undershoot straight past 3 to 2 whenever no step landed exactly on 3.
  // This keeps refining while a step still clears the floor, and only stops
  // once a coarser step would drop below it.
  let ticks = [];
  let usedStep = TICK_STEPS[0];
  for (const step of TICK_STEPS) {
    const factor = 10 ** stepDecimals(step);
    const candidate = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      candidate.push(Math.round(v * factor) / factor);
    }
    if (candidate.length < 3) break;
    ticks = candidate;
    usedStep = step;
  }
  if (ticks.length === 0) {
    // Range too narrow to clear 3 labels even at the finest step — take
    // whatever that finest step gives rather than falling back to whole
    // numbers, which for a sub-1-unit range can mean zero ticks at all
    // (this is what used to leave the axis blank for a pull-up's "top set
    // weight" — with no added or assisted weight, that's just bodyweight,
    // which moves by tenths, not whole kilos, session to session).
    const step = TICK_STEPS[0];
    const factor = 10 ** stepDecimals(step);
    usedStep = step;
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      ticks.push(Math.round(v * factor) / factor);
    }
  }
  if (ticks.length > 5) ticks = ticks.slice(0, 5);

  // Every label on one axis shares the step's own decimal precision, so a
  // "80" next to an "80.5" doesn't read as more/less precise than it is —
  // it becomes "80.0". formatValue receives this and decides how to apply
  // it (a kg label wants it, a whole-number index/count label doesn't).
  return { min: lo, max: hi, ticks, decimals: stepDecimals(usedStep) };
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
 * @param {Array}    opts.series        [{ points: [{date, value, ...}], color, width, dashed, dots, tappable, line, step }]
 *                                      Axes span every series; only `tappable` ones get tooltips.
 *                                      `line: false` draws the points alone, with no segments joining them.
 *                                      `step: true` connects points with a step-after path (flat at a point's
 *                                      own value until the next point, then a sharp-cornered vertical jump)
 *                                      instead of a straight diagonal — for a series where an in-between value
 *                                      never really existed (a logged PR holds until it's beaten, it doesn't
 *                                      climb gradually toward the next session).
 * @param {Function} opts.formatValue   (value, decimals) => y-axis label — decimals is the shared
 *                                      precision every tick on this axis was rounded to, so "80" next
 *                                      to a real "80.5" can render as "80.0" instead of implying more
 *                                      precision than the other labels on the same axis
 * @param {Function} opts.formatDate    (iso, showYear) => x-axis label
 * @param {Function} opts.tooltipLines  (point) => [primary, secondary]
 * @param {Function} [opts.ariaLabel]   (point) => string
 * @param {number}   [opts.minRange]    floor on the y-axis span, in the series' own unit — keeps a
 *                                      trivial real-world move from visually filling the whole chart
 * @param {{min: number, max: number}} [opts.fixedRange] locks the y-axis to an exact range regardless
 *                                      of the data (e.g. {min:0, max:10} for a 0-10 pain scale) —
 *                                      the scale itself is already meaningful, so auto-fitting to
 *                                      whatever data exists would be the one thing that could mislead
 * @param {number}   [opts.minTimeSpan] floor on the x-axis span, in milliseconds — the same idea as
 *                                      minRange but for time: two points three hours apart shouldn't
 *                                      stretch edge-to-edge and read as a whole day's trend
 * @param {number}   [opts.paddingPct]  y-axis headroom above/below the data's own range, as a fraction
 *                                      of that range — defaults to 0.08 (8%), same as every other chart.
 *                                      A step chart's flat segments read as touching the edge more than a
 *                                      smooth line's does, so exercise-trend.html's top-set chart raises this.
 */
export function renderLineChart(svg, opts) {
  const { series, formatValue, formatDate, tooltipLines, ariaLabel, minRange, fixedRange, minTimeSpan, paddingPct } = opts;

  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);

  const drawn = series.filter((s) => s.points && s.points.length > 0);
  if (drawn.length === 0) return;

  const allPoints = drawn.flatMap((s) => s.points);
  const times = allPoints.map((p) => new Date(p.date).getTime());
  let minT = Math.min(...times);
  let maxT = Math.max(...times);
  if (minTimeSpan && maxT - minT < minTimeSpan) {
    const mid = (minT + maxT) / 2;
    minT = mid - minTimeSpan / 2;
    maxT = mid + minTimeSpan / 2;
  }
  const axis = computeYAxis(allPoints.map((p) => p.value), minRange || 0, fixedRange || null, paddingPct);

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
      'end', '11', 'var(--muted)', formatValue(tickValue, axis.decimals),
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
    // step-after: flat at a point's own value until the next point's x,
    // then a vertical riser — two segments per point instead of one
    // diagonal. Corners are sharp (miter), not rounded like a normal
    // line's — a rounded jump reads as still interpolating, which is
    // exactly what step exists to rule out.
    let d = '';
    s.points.forEach((p, i) => {
      const x = xScale(new Date(p.date).getTime());
      const y = yScale(p.value);
      if (i === 0) { d += `M ${x},${y}`; return; }
      if (s.step) {
        const prevY = yScale(s.points[i - 1].value);
        d += ` L ${x},${prevY} L ${x},${y}`;
      } else {
        d += ` L ${x},${y}`;
      }
    });
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', s.color || 'var(--accent)');
    path.setAttribute('stroke-width', s.width || '2');
    path.setAttribute('stroke-linejoin', s.step ? 'miter' : 'round');
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
// Bar chart — one bar per calendar week, e.g. sets logged per week.
//
// Deliberately not the line chart re-skinned: a bar's length IS the value,
// so unlike computeYAxis this always anchors at 0 — padding the baseline
// the way the line chart does would make every bar-to-bar comparison
// quietly wrong. The most recent bar is always a week still being lived,
// not a finished one, so it gets its own amber diagonal-stripe fill
// instead of blending in with the rest.
// ---------------------------------------------------------------------------

const BAR_VIEW_W = 340;
const BAR_VIEW_H = 180;
const BAR_MARGIN = { top: 16, right: 12, bottom: 24, left: 28 };
const BAR_MAX_WIDTH = 30;
const BAR_LABEL_GUTTER = 6;
const CURRENT_STRIPE_ANGLE = 45;
const BAR_TICK_STEPS = [1, 2, 5, 10, 15, 20, 25, 50, 100, 150, 200, 250, 500, 1000];

/**
 * Zero-anchored, unlike computeYAxis — a bar's length is the value, so the
 * axis can never start anywhere but 0. Tick selection otherwise mirrors
 * computeYAxis: the coarsest, roundest step that still clears a 3-label
 * floor, capped at 5 labels.
 */
function computeBarYAxis(values) {
  const dataMax = Math.max(...values, 1);
  const hi = dataMax * 1.15; // headroom so the tallest bar isn't flush with the top edge

  let ticks = [];
  for (const step of BAR_TICK_STEPS) {
    const candidate = [];
    for (let v = step; v <= hi + 1e-9; v += step) candidate.push(v);
    if (candidate.length < 3) break;
    ticks = candidate;
  }
  if (ticks.length === 0) {
    for (let v = BAR_TICK_STEPS[0]; v <= hi + 1e-9; v += BAR_TICK_STEPS[0]) ticks.push(v);
  }
  if (ticks.length > 5) ticks = ticks.slice(0, 5);

  return { max: hi, ticks };
}

/** 4px on a wide, few-weeks bar, tapering to 2px once bars get thin. */
function stripeSizeForBarWidth(barW) {
  const NARROW = 8, WIDE = 30; // observed bar-width range across the 2..26-week span
  const t = Math.max(0, Math.min(1, (barW - NARROW) / (WIDE - NARROW)));
  return 2 + t * 2;
}

let barStripeIdCounter = 0;
/** Negative-space diagonal stripe — the bar's own material reads as "still being poured." */
function addCurrentWeekStripe(svg, size) {
  const id = `bar-stripe-${barStripeIdCounter++}`;
  const tile = size * 2;
  const defs = document.createElementNS(NS, 'defs');
  const pattern = document.createElementNS(NS, 'pattern');
  pattern.setAttribute('id', id);
  pattern.setAttribute('width', tile);
  pattern.setAttribute('height', tile);
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('patternTransform', `rotate(${CURRENT_STRIPE_ANGLE})`);
  const base = document.createElementNS(NS, 'rect');
  base.setAttribute('width', tile);
  base.setAttribute('height', tile);
  base.setAttribute('fill', 'var(--surface)');
  const stripe = document.createElementNS(NS, 'rect');
  stripe.setAttribute('width', size);
  stripe.setAttribute('height', tile);
  stripe.setAttribute('fill', 'var(--live)');
  pattern.appendChild(base);
  pattern.appendChild(stripe);
  defs.appendChild(pattern);
  svg.appendChild(defs);
  return `url(#${id})`;
}

function labelExtent(anchor, x, w) {
  if (anchor === 'start') return [x, x + w];
  if (anchor === 'end') return [x - w, x];
  return [x - w / 2, x + w / 2];
}

/**
 * An edge label prefers to center on its own bar, like every label in
 * between — it only pins to the plot margin, growing inward, once
 * centering would push it past that margin. Keeps a few, widely-spaced
 * bars' labels sitting under them instead of drifting toward edges the
 * bars themselves never reach, while a dense chart's outermost bars
 * (which do sit near the margin) still get the anti-overflow pin.
 */
function placeEdgeLabel(barCenter, w, side, leftBound, rightBound) {
  const idealLeft = barCenter - w / 2;
  const idealRight = barCenter + w / 2;
  if (idealLeft >= leftBound && idealRight <= rightBound) return { anchor: 'middle', x: barCenter };
  return side === 'first' ? { anchor: 'start', x: leftBound } : { anchor: 'end', x: rightBound };
}

/**
 * Draw a bar chart into an <svg>, one bar per week.
 *
 * @param {SVGElement} svg
 * @param {object}   opts
 * @param {Array}    opts.weeks        [{ date, value }], oldest first — the last entry is
 *                                      always treated as the current, in-progress week
 * @param {Function} opts.formatDate   (iso, showYear) => x-axis label for a week
 * @param {Function} opts.tooltipLines (week) => [primary, secondary]
 * @param {Function} [opts.ariaLabel]  (week) => string
 */
export function renderBarChart(svg, opts) {
  const { weeks, formatDate, tooltipLines, ariaLabel } = opts;

  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${BAR_VIEW_W} ${BAR_VIEW_H}`);
  if (!weeks || weeks.length === 0) return;

  const n = weeks.length;
  const M = BAR_MARGIN;
  const plotW = BAR_VIEW_W - M.left - M.right;
  const plotH = BAR_VIEW_H - M.top - M.bottom;
  const baseline = M.top + plotH;

  const { max: axisMax, ticks } = computeBarYAxis(weeks.map((w) => w.value));
  const yScale = (v) => baseline - (v / axisMax) * plotH;

  // Invisible backdrop: tapping empty chart space dismisses any open tooltip.
  const backdrop = document.createElementNS(NS, 'rect');
  backdrop.setAttribute('x', 0);
  backdrop.setAttribute('y', 0);
  backdrop.setAttribute('width', BAR_VIEW_W);
  backdrop.setAttribute('height', BAR_VIEW_H);
  backdrop.setAttribute('fill', 'transparent');
  backdrop.addEventListener('click', () => clearTooltip());
  svg.appendChild(backdrop);

  // Y-axis labels only — no tick marks, no grid lines, same as the line chart.
  for (const tv of ticks) {
    svg.appendChild(text(M.left - 8, yScale(tv) + 3.5, 'end', '11', 'var(--muted)', String(Math.round(tv))));
  }

  const bandW = plotW / n;
  const barW = Math.max(3, Math.min(bandW - 3, BAR_MAX_WIDTH));
  const xOfIndex = (i) => M.left + bandW * i + bandW / 2;
  const currentFill = addCurrentWeekStripe(svg, stripeSizeForBarWidth(barW));

  let activeKey = null;

  weeks.forEach((wk, i) => {
    const cx = xOfIndex(i);
    const h = Math.max(3, (wk.value / axisMax) * plotH); // 3px floor keeps a 0-set week visible
    const y = baseline - h;
    const isCurrent = i === n - 1;

    const bar = document.createElementNS(NS, 'rect');
    bar.setAttribute('x', cx - barW / 2);
    bar.setAttribute('y', y);
    bar.setAttribute('width', barW);
    bar.setAttribute('height', h);
    bar.setAttribute('fill', isCurrent ? currentFill : 'var(--accent)');
    svg.appendChild(bar);

    // Hit target is the full band, not just the bar — a thin bar at 26
    // weeks is still a full band-width tappable column.
    const hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', M.left + bandW * i);
    hit.setAttribute('y', M.top);
    hit.setAttribute('width', bandW);
    hit.setAttribute('height', plotH);
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('pointer-events', 'all');
    hit.style.cursor = 'pointer';
    hit.setAttribute('tabindex', '0');
    hit.setAttribute('role', 'button');
    if (ariaLabel) hit.setAttribute('aria-label', ariaLabel(wk));
    const toggle = (e) => {
      e.stopPropagation();
      if (activeKey === i) { clearTooltip(); return; }
      activeKey = i;
      showTooltip(cx, y, tooltipLines(wk));
    };
    hit.addEventListener('click', toggle);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
    });
    svg.appendChild(hit);
  });

  // X-axis labels — measured, not guessed. "This week" is reserved first
  // and never dropped, colored to match its bar (the one case it can
  // visually stretch back over a neighboring bar, so color is what still
  // ties it to the right one). The oldest week is reserved next and is the
  // only label allowed to drop. Everything else is tried left-to-right and
  // kept only if its real measured width clears both its neighbor and the
  // reserved "This week" zone.
  const leftBound = M.left, rightBound = BAR_VIEW_W - M.right;
  const labelSize = 10.5;

  function measure(content, bold) {
    const t = text(0, 0, 'start', labelSize, 'var(--muted)', content);
    if (bold) t.setAttribute('font-weight', '600');
    svg.appendChild(t);
    const w = t.getComputedTextLength();
    svg.removeChild(t);
    return w;
  }

  const lastW = measure('This week', true);
  const lastPlace = placeEdgeLabel(xOfIndex(n - 1), lastW, 'last', leftBound, rightBound);
  const lastLeft = labelExtent(lastPlace.anchor, lastPlace.x, lastW)[0];

  const firstLabel = formatDate(weeks[0].date, false);
  const firstW = measure(firstLabel, false);
  const firstPlace = placeEdgeLabel(xOfIndex(0), firstW, 'first', leftBound, rightBound);
  const firstRight = labelExtent(firstPlace.anchor, firstPlace.x, firstW)[1];

  const showFirst = n < 2 || (firstRight + BAR_LABEL_GUTTER <= lastLeft);
  const keep = [{ i: n - 1, ...lastPlace, txt: 'This week', current: true }];
  if (showFirst) keep.push({ i: 0, ...firstPlace, txt: firstLabel });

  let cursor = showFirst ? firstRight : -Infinity;
  for (let i = 1; i <= n - 2; i++) {
    const cx = xOfIndex(i);
    const label = formatDate(weeks[i].date, false);
    const w = measure(label, false);
    const left = cx - w / 2, right = cx + w / 2;
    if (left < cursor + BAR_LABEL_GUTTER) continue;
    if (right > lastLeft - BAR_LABEL_GUTTER) continue;
    keep.push({ i, x: cx, anchor: 'middle', txt: label });
    cursor = right;
  }

  keep.sort((a, b) => a.i - b.i);
  for (const k of keep) {
    const t = text(k.x, BAR_VIEW_H - 6, k.anchor, labelSize, k.current ? 'var(--live)' : 'var(--muted)', k.txt);
    if (k.current) t.setAttribute('font-weight', '600');
    svg.appendChild(t);
  }

  function clearTooltip() {
    activeKey = null;
    const existing = svg.querySelector('.chart-tip');
    if (existing) existing.remove();
  }

  function showTooltip(cx, topY, lines) {
    clearTooltip();
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'chart-tip');
    g.setAttribute('pointer-events', 'none');

    const rectEl = document.createElementNS(NS, 'rect');
    rectEl.setAttribute('fill', 'var(--surface-2)');
    rectEl.setAttribute('stroke', 'var(--line)');
    g.appendChild(rectEl);

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
    boxX = Math.max(2, Math.min(BAR_VIEW_W - 2 - boxW, boxX));
    let boxY = topY - boxH - 12;
    if (boxY < 2) boxY = topY + 12;

    rectEl.setAttribute('x', boxX);
    rectEl.setAttribute('y', boxY);
    rectEl.setAttribute('width', boxW);
    rectEl.setAttribute('height', boxH);

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
const GAUGE_CX = GAUGE_VIEW_W / 2;
const GAUGE_CY = 100;
// Bottom edge sits 18 below the pivot — just enough for the needle's tail
// (base 9 + tail 11, ~14.2 at its worst-case angle) plus a clean margin, not
// a coincidental near-miss. GAUGE_CY itself is unchanged from before — only
// the space below it grew, so the bands sit exactly where they always have.
const GAUGE_VIEW_H = GAUGE_CY + 18;
const GAUGE_RADIUS = 84;
const GAUGE_BAND_WIDTH = 26;
const GAUGE_BAND_GAP_DEG = 1.5; // thin dividers between bands, same idea as the donut's slice edges

// Left (0, low) to right (1, high) — the conventional danger-gauge order,
// not the accent palette used elsewhere, since red/green here mean
// something specific (low effort vs. all-out) that a themed color wouldn't.
const GAUGE_COLORS = [
  'var(--chart-status-good)',
  'var(--chart-status-warning)',
  'var(--chart-status-serious)',
  'var(--chart-status-critical)',
];

// Locked needle shape — one trapezoid, pivot inset from the end so a butt
// extends behind it (marked with a dot in the card's own background color,
// like a hole punched through the needle) rather than the old two-piece
// "coffin" outline.
const NEEDLE_BASE_HALF = 9;
const NEEDLE_TIP_HALF = 5;
const NEEDLE_PIVOT_R = 4.5;
const NEEDLE_TAIL_LEN = 11;

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
 * @param {boolean} [opts.showPivotDot] false at mini sizes, where the dot is
 *                                      too small to read as a hole punched
 *                                      through the needle
 * @param {boolean} [opts.showNeedle] false for an unlit empty state — grey
 *                                    bands with nothing to point at, rather
 *                                    than a fabricated reading. Implies no
 *                                    pivot dot either (nothing to punch a
 *                                    hole through without a needle).
 */
export function renderGaugeChart(svg, opts) {
  const { value } = opts;
  const colors = opts.colors || GAUGE_COLORS;
  const showPivotDot = opts.showPivotDot !== false;
  const showNeedle = opts.showNeedle !== false;

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

  if (showNeedle) {
    const clamped = Math.max(0, Math.min(1, value));
    const angle = 180 - clamped * 180; // 0 -> left (180deg), 1 -> right (0deg)
    const rad = (angle * Math.PI) / 180;
    const dir = { x: Math.cos(rad), y: -Math.sin(rad) };
    const perp = { x: -dir.y, y: dir.x };

    const needleLen = GAUGE_RADIUS; // tip reaches the ring
    const tip = { x: GAUGE_CX + dir.x * needleLen, y: GAUGE_CY + dir.y * needleLen };
    const butt = { x: GAUGE_CX - dir.x * NEEDLE_TAIL_LEN, y: GAUGE_CY - dir.y * NEEDLE_TAIL_LEN };
    const tipLeft = { x: tip.x + perp.x * NEEDLE_TIP_HALF, y: tip.y + perp.y * NEEDLE_TIP_HALF };
    const tipRight = { x: tip.x - perp.x * NEEDLE_TIP_HALF, y: tip.y - perp.y * NEEDLE_TIP_HALF };
    const buttLeft = { x: butt.x + perp.x * NEEDLE_BASE_HALF, y: butt.y + perp.y * NEEDLE_BASE_HALF };
    const buttRight = { x: butt.x - perp.x * NEEDLE_BASE_HALF, y: butt.y - perp.y * NEEDLE_BASE_HALF };

    const needle = document.createElementNS(NS, 'polygon');
    const pts = [buttLeft, tipLeft, tipRight, buttRight].map((p) => `${p.x},${p.y}`).join(' ');
    needle.setAttribute('points', pts);
    needle.setAttribute('fill', 'var(--text)');
    svg.appendChild(needle);

    if (showPivotDot) {
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', GAUGE_CX);
      dot.setAttribute('cy', GAUGE_CY);
      dot.setAttribute('r', NEEDLE_PIVOT_R);
      dot.setAttribute('fill', 'var(--surface)');
      svg.appendChild(dot);
    }
  }
}
