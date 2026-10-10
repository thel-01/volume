// ---------------------------------------------------------------------------
// The one line chart the app uses, in plain SVG with no library.
//
// Deliberately sparse: at least 3 y-labels (never forced to the range's own
// min/max, wherever round numbers land), only the first and last date on the
// x-axis, no grid lines at all. This is a trend visualiser — the shape
// matters, precise readings do not. Press and hold, then drag, for the exact numbers.
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

/** Below this typical on-screen spacing, a line's dots count as crowded. */
const CROWDED_DOT_GAP_PX = 20;

/** Median on-screen distance between consecutive dots of one series. */
function medianDotGapPx(points, xScale, yScale, pxPerUnit) {
  if (points.length < 2) return Infinity;
  const gaps = [];
  for (let i = 1; i < points.length; i++) {
    const dx = xScale(new Date(points[i].date).getTime()) - xScale(new Date(points[i - 1].date).getTime());
    const dy = yScale(points[i].value) - yScale(points[i - 1].value);
    gaps.push(Math.hypot(dx, dy) * pxPerUnit);
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
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

// ---------------------------------------------------------------------------
// Scrubbing — press and hold on a line or bar chart, then drag to read exact
// values. Shared by renderLineChart, renderBarChart and renderIntensityBarChart,
// each of which hands over its own scales' results (x/y per data point), so
// nothing here ever reads positions back out of the drawn DOM.
//
// The chart itself never redraws: a vertical line plus highlight dot(s) (or,
// on bars, the other bars dimmed) move over it, and the page's `onChange`
// shows the value wherever it likes (usually in the stat above the chart).
// ---------------------------------------------------------------------------

const SCRUB_HOLD_MS = 100;        // how long a finger must rest before it counts as a scrub
const SCRUB_SLOP_PX = 8;          // drift allowed during that hold; past it the touch is a page scroll
const SCRUB_TAP_MS = 400;         // a touch shorter than this, barely moved, is a tap
const SCRUB_BAR_GAP_PX = 4;       // the line on a bar chart stops this far above the active bar
const SCRUB_BAR_MIN_LINE_PX = 6;  // …and is skipped when the bar leaves less room than this

const scrubControllers = new Map(); // svg -> controller, so a re-render can retire the old one
let lastTouchAt = 0;                // browsers fire fake mouse events after a touch; ignore those
let scrubDocumentBound = false;

function releaseScrub(svg) {
  const existing = scrubControllers.get(svg);
  if (existing) existing.destroy();
}

function hideOtherScrubs(except) {
  for (const c of scrubControllers.values()) if (c !== except) c.hide();
}

/** A tap that lands anywhere outside a pinned chart dismisses it. */
function dismissPinnedScrubs(target) {
  for (const c of [...scrubControllers.values()]) {
    if (!c.svg.isConnected) { c.destroy(); continue; }
    if (c.pinned && !c.svg.contains(target)) c.hide();
  }
}

function bindScrubDocument() {
  if (scrubDocumentBound) return;
  scrubDocumentBound = true;
  let tap = null;
  // Passive: these only watch, they never block scrolling.
  document.addEventListener('touchstart', (e) => {
    lastTouchAt = Date.now();
    const t = e.touches[0];
    tap = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, at: performance.now(), target: e.target } : null;
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', (e) => {
    lastTouchAt = Date.now();
    if (tap && Math.hypot(e.touches[0].clientX - tap.x, e.touches[0].clientY - tap.y) > SCRUB_SLOP_PX) tap = null;
  }, { capture: true, passive: true });
  document.addEventListener('touchend', () => {
    lastTouchAt = Date.now();
    const t = tap;
    tap = null;
    if (t && performance.now() - t.at < SCRUB_TAP_MS) dismissPinnedScrubs(t.target);
  }, { capture: true, passive: true });
  document.addEventListener('mousedown', (e) => {
    if (Date.now() - lastTouchAt < 700) return;
    dismissPinnedScrubs(e.target);
  }, true);
}

function svgEl(name, attrs) {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}

/**
 * Wire scrubbing onto an <svg> that a renderer has just drawn.
 *
 * @param {SVGElement} svg
 * @param {object} cfg
 * @param {Array}    cfg.items     one per snap target, ascending by x:
 *                                 { x, entries: [{ x, y, color, follow }], info }
 *                                 (bar charts: { x, barTop, info } instead of entries)
 * @param {number}   cfg.viewW     viewBox width the x values live in
 * @param {number}   cfg.top       y the vertical line starts from
 * @param {number}   cfg.bottom    y it ends at (line charts)
 * @param {Array}    [cfg.bars]    the bar <rect>s, in item order — present means bar chart
 * @param {Function} cfg.onChange  (info | null) — null when scrubbing ends
 */
function attachScrub(svg, cfg) {
  const { items, viewW, top, bottom, bars, onChange } = cfg;
  if (!items.length) return;

  const ac = new AbortController();
  const { signal } = ac;
  const ctl = { svg, pinned: false, idx: -1 };

  svg.classList.add('scrub-surface');

  const overlay = svgEl('g', { 'pointer-events': 'none' });
  overlay.style.display = 'none';
  const line = svgEl('line', { stroke: 'var(--muted)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
  overlay.appendChild(line);
  const dots = []; // pooled: a multi-series chart can need several at once
  svg.appendChild(overlay);

  function dotAt(n) {
    while (dots.length <= n) {
      const d = svgEl('circle', { stroke: 'var(--surface)', 'stroke-width': 2 });
      overlay.appendChild(d);
      dots.push(d);
    }
    return dots[n];
  }

  ctl.show = (i) => {
    if (i === ctl.idx) return; // same snap target: nothing to redraw
    const it = items[i];
    line.style.display = '';
    line.setAttribute('x1', it.x);
    line.setAttribute('x2', it.x);
    line.setAttribute('y1', top);

    if (bars) {
      // The line stops a few screen px above the bar so it never runs
      // through it. Too little room above (a near-full bar): no line at
      // all, the dimmed neighbours already mark the bar.
      const pxPerUnit = (svg.getBoundingClientRect().width || viewW) / viewW;
      if ((it.barTop - top) * pxPerUnit < SCRUB_BAR_MIN_LINE_PX) line.style.display = 'none';
      else line.setAttribute('y2', it.barTop - SCRUB_BAR_GAP_PX / pxPerUnit);
      bars.forEach((b, j) => b.setAttribute('opacity', j === i ? 1 : 0.35));
    } else {
      line.setAttribute('y2', bottom);
      dots.forEach((d) => { d.style.display = 'none'; });
      it.entries.forEach((en, n) => {
        const d = dotAt(n);
        d.setAttribute('cx', en.x);
        d.setAttribute('cy', en.y);
        d.setAttribute('r', en.follow ? 4.5 : 5);
        d.setAttribute('fill', en.color);
        d.style.display = '';
      });
    }

    overlay.style.display = '';
    ctl.idx = i;
    onChange(it.info);
  };

  ctl.hide = () => {
    ctl.pinned = false;
    if (ctl.idx === -1) return;
    ctl.idx = -1;
    overlay.style.display = 'none';
    if (bars) bars.forEach((b) => b.removeAttribute('opacity'));
    onChange(null);
  };

  /** Nearest data point by x — never a position between two points. */
  function nearest(vx) {
    let lo = 0, hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].x < vx) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(items[lo - 1].x - vx) <= Math.abs(items[lo].x - vx)) return lo - 1;
    return lo;
  }

  // The gesture in progress: 'pending' (finger down, waiting out the hold),
  // 'active' (scrubbing) or 'scroll' (moved too soon — the page's, not ours).
  let g = null;
  const toViewX = (clientX, gg) => (clientX - gg.left) * (viewW / gg.width);

  function begin(x, y, src) {
    abort();
    const r = svg.getBoundingClientRect();
    g = { left: r.left, width: r.width, sx: x, sy: y, x, src, state: 'pending', timer: null };
    g.timer = setTimeout(activate, SCRUB_HOLD_MS);
  }

  function activate() {
    if (!g || g.state !== 'pending') return;
    g.state = 'active';
    g.timer = null;
    ctl.pinned = false;
    hideOtherScrubs(ctl);
    ctl.show(nearest(toViewX(g.x, g)));
  }

  function move(x, y, e) {
    if (!g) return;
    g.x = x;
    if (g.state === 'pending') {
      // Moving before the hold fires means the user is scrolling the page.
      if (Math.hypot(x - g.sx, y - g.sy) > SCRUB_SLOP_PX) {
        clearTimeout(g.timer);
        g.timer = null;
        g.state = 'scroll';
      }
      return;
    }
    if (g.state !== 'active') return;
    // Only now take the gesture from the page, so a plain swipe still scrolls.
    if (e && e.cancelable) e.preventDefault();
    ctl.show(nearest(toViewX(x, g)));
  }

  function end() {
    if (!g) return;
    clearTimeout(g.timer);
    const gg = g;
    g = null;
    if (gg.state === 'scroll') return;
    if (gg.state === 'pending') { quickTap(toViewX(gg.x, gg)); return; }
    ctl.hide(); // letting go always hides
  }

  function abort() {
    if (!g) return;
    clearTimeout(g.timer);
    const wasActive = g.state === 'active';
    g = null;
    if (wasActive) ctl.hide();
  }

  /** A tap with no hold pins the nearest point; tapping that same point again unpins it. */
  function quickTap(vx) {
    const i = nearest(vx);
    if (ctl.pinned && ctl.idx === i) { ctl.hide(); return; }
    hideOtherScrubs(ctl);
    ctl.show(i);
    ctl.pinned = true;
  }

  // passive:false on the touch listeners is what lets touchmove call
  // preventDefault() once a scrub is active (a passive listener can't).
  svg.addEventListener('touchstart', (e) => {
    lastTouchAt = Date.now();
    if (e.touches.length > 1) { abort(); return; }
    const t = e.touches[0];
    begin(t.clientX, t.clientY, 'touch');
  }, { passive: false, signal });
  svg.addEventListener('touchmove', (e) => {
    lastTouchAt = Date.now();
    if (!g || g.src !== 'touch') return;
    const t = e.touches[0];
    move(t.clientX, t.clientY, e);
  }, { passive: false, signal });
  svg.addEventListener('touchend', (e) => {
    lastTouchAt = Date.now();
    if (g && g.state === 'active' && e.cancelable) e.preventDefault(); // no ghost click after a scrub
    end();
  }, { passive: false, signal });
  svg.addEventListener('touchcancel', () => { lastTouchAt = Date.now(); abort(); }, { passive: false, signal });

  // Mouse: press, hold, drag — same behaviour, for desktop.
  svg.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || Date.now() - lastTouchAt < 700) return;
    begin(e.clientX, e.clientY, 'mouse');
  }, { signal });
  window.addEventListener('mousemove', (e) => { if (g && g.src === 'mouse') move(e.clientX, e.clientY, e); }, { signal });
  window.addEventListener('mouseup', () => { if (g && g.src === 'mouse') end(); }, { signal });

  // A long-press would otherwise open the OS callout / text-selection menu.
  svg.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
  svg.addEventListener('selectstart', (e) => e.preventDefault(), { signal });

  ctl.destroy = () => {
    ac.abort();
    if (g) clearTimeout(g.timer);
    g = null;
    if (scrubControllers.get(svg) === ctl) scrubControllers.delete(svg);
    const wasShown = ctl.idx !== -1;
    ctl.idx = -1;
    ctl.pinned = false;
    if (wasShown) onChange(null);
  };

  scrubControllers.set(svg, ctl);
  bindScrubDocument();
}

/**
 * Show a scrub readout in a chart's section-label row (the chart has no
 * hero stat of its own). The row reads right-aligned, `value · date`.
 *
 * `show` takes one `{ value, date }` or a list of progressively shorter
 * variants; the first that fits the row on one line wins, and if none does
 * the last is left to truncate with an ellipsis. Measured, not guessed
 * from screen width.
 *
 * @param {HTMLElement} el  the `.scrub-readout` span inside the label
 */
export function createRowReadout(el) {
  return {
    show(variants) {
      const list = Array.isArray(variants) ? variants : [variants];
      el.hidden = false;
      for (const v of list) {
        el.textContent = '';
        const value = document.createElement('span');
        value.className = 'v';
        value.textContent = v.value;
        el.append(value, document.createTextNode(` · ${v.date}`));
        if (el.scrollWidth <= el.clientWidth) return;
      }
    },
    hide() {
      el.hidden = true;
      el.textContent = '';
    },
  };
}

/**
 * Draw one or more line series into an <svg>.
 *
 * @param {SVGElement} svg
 * @param {object}   opts
 * @param {Array}    opts.series        [{ points: [{date, value, ...}], color, width, dashed, dots, scrub, scrubFollow, line, step }]
 *                                      Axes span every series; only `scrub` ones are snap targets for scrubbing.
 *                                      `scrubFollow: true` marks a series that gets a highlight dot at the snapped
 *                                      point's own calendar day instead (the weight trend under its raw readings).
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
 * @param {{onChange: Function}} [opts.scrub] press-and-hold-then-drag readout. onChange gets
 *                                      `{ point, series, values, index }` for the snapped point — `point` is the
 *                                      data point itself, `series` its series' key, `values` every series' point
 *                                      at that date keyed by series key — and `null` when scrubbing ends.
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
  const { series, formatValue, formatDate, scrub, minRange, fixedRange, minTimeSpan, paddingPct } = opts;

  releaseScrub(svg);
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

  // Lines first, so dots always sit on top.
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

  // Rendered px per viewBox unit — the card is close to VIEW_W wide on a
  // phone, so fall back to 1:1 if the svg isn't laid out yet.
  const pxPerUnit = (svg.getBoundingClientRect().width || VIEW_W) / VIEW_W;

  for (const s of drawn) {
    if (!s.dots) continue;
    // A long history packs a line's dots into an overlapping smear. Once the
    // typical gap between neighbouring dots drops under CROWDED_DOT_GAP_PX
    // on screen, only the latest value keeps its dot; every point stays
    // scrubbable. A scatter (`line: false`) is exempt: there the dots ARE the
    // data, and their pile-up is meant to read as density.
    const onlyLastDot = s.line !== false && medianDotGapPx(s.points, xScale, yScale, pxPerUnit) < CROWDED_DOT_GAP_PX;
    s.points.forEach((p, i) => {
      const cx = xScale(new Date(p.date).getTime());
      const cy = yScale(p.value);
      const showDot = !onlyLastDot || i === s.points.length - 1;

      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', cy);
      dot.setAttribute('r', 3.5);
      dot.setAttribute('fill', s.color || 'var(--accent)');
      // A dot marking a point along a drawn line gets a ring in the card's
      // own background color, so it reads as sitting ON the line rather
      // than merging into its stroke. A scatter series (`line: false`) has
      // no line to separate from — the ring there was just visual noise.
      if (s.line !== false) {
        dot.setAttribute('stroke', 'var(--surface)');
        dot.setAttribute('stroke-width', '1.5');
      }
      // `opacity` dims the whole series, dots included — so a scatter can sit
      // behind the line that matters without fighting it for attention, and
      // overlapping readings pile up into something visibly denser.
      if (s.opacity) dot.setAttribute('opacity', s.opacity);
      if (showDot) svg.appendChild(dot);
    });
  }

  if (scrub) attachLineScrub(svg, drawn, xScale, yScale, scrub.onChange);
}

/** Local calendar day, so a day's trend value can sit under any of that day's readings. */
function localDayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Snap targets for a line chart: one per distinct timestamp across the
 * `scrub` series (a multi-series fan shares its dates, so one target holds
 * every series' point), plus a `scrubFollow` series' point from the same day.
 */
function attachLineScrub(svg, drawn, xScale, yScale, onChange) {
  const byTime = new Map();
  for (const s of drawn) {
    if (!s.scrub) continue;
    const key = s.key || 'main';
    const color = s.color || 'var(--accent)';
    for (const p of s.points) {
      const t = new Date(p.date).getTime();
      let it = byTime.get(t);
      if (!it) {
        it = { t, x: xScale(t), entries: [], info: { point: p, series: key, values: {}, index: 0 } };
        byTime.set(t, it);
      }
      it.entries.push({ x: it.x, y: yScale(p.value), color });
      it.info.values[key] = p;
      // Series are drawn in order, so the last one at a date is the topmost.
      it.info.point = p;
      it.info.series = key;
    }
  }
  const items = [...byTime.values()].sort((a, b) => a.t - b.t);

  for (const s of drawn) {
    if (!s.scrubFollow) continue;
    const key = s.key || 'main';
    const byDay = new Map(s.points.map((p) => [localDayKey(p.date), p]));
    for (const it of items) {
      const p = byDay.get(localDayKey(it.t));
      if (!p) continue;
      it.entries.push({ x: it.x, y: yScale(p.value), color: s.color || 'var(--accent)', follow: true });
      it.info.values[key] = p;
    }
  }
  items.forEach((it, i) => { it.info.index = i; });

  attachScrub(svg, { items, viewW: VIEW_W, top: MARGIN.top, bottom: VIEW_H - MARGIN.bottom, onChange });
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
function addCurrentWeekStripe(svg, size, color) {
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
  stripe.setAttribute('fill', color);
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
 * X-axis labels for any one-bar-per-week chart — measured, not guessed.
 * "This week" is reserved first and never dropped, colored with
 * `currentColor` (the one case a label can visually stretch back over a
 * neighboring bar, so color is what still ties it to the right one). The
 * oldest week is reserved next and is the only label allowed to drop.
 * Everything else is tried left-to-right and kept only if its real
 * measured width clears both its neighbor and the reserved "This week"
 * zone. Shared by renderBarChart and renderIntensityBarChart so the two
 * can never drift apart.
 */
function drawWeekAxisLabels(svg, weeks, xOfIndex, formatDate, M, currentColor) {
  const n = weeks.length;
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
    const t = text(k.x, BAR_VIEW_H - 6, k.anchor, labelSize, k.current ? currentColor : 'var(--muted)', k.txt);
    if (k.current) t.setAttribute('font-weight', '600');
    svg.appendChild(t);
  }
}

/**
 * Draw a bar chart into an <svg>, one bar per week.
 *
 * @param {SVGElement} svg
 * @param {object}   opts
 * @param {Array}    opts.weeks        [{ date, value }], oldest first — the last entry is
 *                                      always treated as the current, in-progress week
 * @param {Function} opts.formatDate   (iso, showYear) => x-axis label for a week
 * @param {{onChange: Function}} [opts.scrub] press-and-hold-then-drag readout; onChange gets
 *                                      `{ point: week, index }` for the snapped bar, `null` when scrubbing ends
 */
export function renderBarChart(svg, opts) {
  const { weeks, formatDate, scrub } = opts;

  releaseScrub(svg);
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

  // Y-axis labels only — no tick marks, no grid lines, same as the line chart.
  for (const tv of ticks) {
    svg.appendChild(text(M.left - 8, yScale(tv) + 3.5, 'end', '11', 'var(--muted)', String(Math.round(tv))));
  }

  const bandW = plotW / n;
  const barW = Math.max(3, Math.min(bandW - 3, BAR_MAX_WIDTH));
  const xOfIndex = (i) => M.left + bandW * i + bandW / 2;
  const currentFill = addCurrentWeekStripe(svg, stripeSizeForBarWidth(barW), 'var(--live)');

  const barEls = [];
  const scrubItems = [];
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

    barEls.push(bar);
    scrubItems.push({ x: cx, barTop: y, info: { point: wk, index: i } });
  });

  drawWeekAxisLabels(svg, weeks, xOfIndex, formatDate, M, 'var(--live)');

  if (scrub) {
    attachScrub(svg, { items: scrubItems, viewW: BAR_VIEW_W, top: M.top, bars: barEls, onChange: scrub.onChange });
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

// ---------------------------------------------------------------------------
// Intensity-over-time chart — one bar per week, each colored by the same
// good/warning/serious/critical quartile the intensity gauge already uses,
// so the two can never disagree about what "high" means. Shares its
// bar-chart mechanics (stripe, week-label placement) with renderBarChart
// rather than reimplementing them, diverging only where the value itself
// is different in kind: bounded 0..1, not an open-ended count.
// ---------------------------------------------------------------------------

/** Same quartile split renderGaugeChart uses for its bands, read off as a plain color lookup. */
function intensityColor(value) {
  const idx = Math.max(0, Math.min(GAUGE_COLORS.length - 1, Math.floor(value * GAUGE_COLORS.length)));
  return GAUGE_COLORS[idx];
}

/** Rendered svg width under which the intensity axis says "Mid" rather than "Medium". */
const INTENSITY_NARROW_PX = 300;

/**
 * @param {SVGElement} svg
 * @param {object}   opts
 * @param {Array}    opts.weeks      [{ date, value }], value 0..1, oldest first — last is the current week
 * @param {Function} opts.formatDate (iso, showYear) => x-axis label for a week
 * @param {{onChange: Function}} [opts.scrub] press-and-hold-then-drag readout; onChange gets
 *                                    `{ point: week, index }` for the snapped bar, `null` when scrubbing ends
 */
export function renderIntensityBarChart(svg, opts) {
  const { weeks, formatDate, scrub } = opts;

  releaseScrub(svg);
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${BAR_VIEW_W} ${BAR_VIEW_H}`);
  if (!weeks || weeks.length === 0) return;

  const n = weeks.length;
  const labelSize = 11;

  // Low/Medium/High centered on the same quartile bands that color the bars
  // (0.125 / 0.5 / 0.875 — the middle of the "good" band, the midpoint of
  // the middle two bands combined, and the middle of "critical"), not
  // evenly spaced, so the axis and the bar colors can never disagree about
  // what counts as which. "Medium" widens the measured left margin below;
  // on a very narrow chart that costs too much plot, so it falls back to "Mid".
  const narrow = (svg.getBoundingClientRect().width || BAR_VIEW_W) < INTENSITY_NARROW_PX;
  const AXIS_LABELS = [{ v: 0.125, txt: 'Low' }, { v: 0.5, txt: narrow ? 'Mid' : 'Medium' }, { v: 0.875, txt: 'High' }];

  // Measured, not guessed — same principle the x-axis labels already use,
  // just applied to the y-axis: whichever word is widest sets the left
  // margin, so a long label never clips against the chart's edge.
  function measureWidth(content) {
    const t = text(0, 0, 'start', labelSize, 'var(--muted)', content);
    svg.appendChild(t);
    const w = t.getComputedTextLength();
    svg.removeChild(t);
    return w;
  }
  const widestLabel = Math.max(...AXIS_LABELS.map((l) => measureWidth(l.txt)));
  const M = { top: 16, right: 12, bottom: 24, left: Math.ceil(widestLabel) + 16 };

  const plotW = BAR_VIEW_W - M.left - M.right;
  const plotH = BAR_VIEW_H - M.top - M.bottom;
  const baseline = M.top + plotH;
  const yScale = (v) => baseline - v * plotH; // fixed 0..1 axis — intensity can legitimately reach the top, no headroom needed like an open-ended count

  for (const { v, txt: t } of AXIS_LABELS) {
    svg.appendChild(text(M.left - 8, yScale(v) + 3.5, 'end', labelSize, 'var(--muted)', t));
  }

  const bandW = plotW / n;
  const barW = Math.max(3, Math.min(bandW - 3, BAR_MAX_WIDTH));
  const xOfIndex = (i) => M.left + bandW * i + bandW / 2;

  // A volume bar is amber while "in progress" because its color would
  // otherwise imply a final total it hasn't reached yet. An intensity
  // average doesn't have that problem — it's a real number the moment any
  // set is logged — so the current week keeps its own real quartile color,
  // stripe and label both, instead of a fixed "not done yet" amber.
  let currentWeekColor = 'var(--text)';
  const barEls = [];
  const scrubItems = [];
  weeks.forEach((wk, i) => {
    const cx = xOfIndex(i);
    const h = Math.max(3, wk.value * plotH); // 3px floor keeps a 0-intensity week visible
    const y = baseline - h;
    const isCurrent = i === n - 1;
    const color = intensityColor(wk.value);
    if (isCurrent) currentWeekColor = color;

    const fill = isCurrent ? addCurrentWeekStripe(svg, stripeSizeForBarWidth(barW), color) : color;
    const bar = document.createElementNS(NS, 'rect');
    bar.setAttribute('x', cx - barW / 2);
    bar.setAttribute('y', y);
    bar.setAttribute('width', barW);
    bar.setAttribute('height', h);
    bar.setAttribute('fill', fill);
    svg.appendChild(bar);

    barEls.push(bar);
    scrubItems.push({ x: cx, barTop: y, info: { point: wk, index: i } });
  });

  drawWeekAxisLabels(svg, weeks, xOfIndex, formatDate, M, currentWeekColor);

  if (scrub) {
    attachScrub(svg, { items: scrubItems, viewW: BAR_VIEW_W, top: M.top, bars: barEls, onChange: scrub.onChange });
  }
}
