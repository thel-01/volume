// ---------------------------------------------------------------------------
// Bodyweight trend maths.
//
// DOM-free and Supabase-free on purpose, so it can be imported straight into
// a Node script and checked with plain assertions — same reasoning as
// strength-index.js, and so weight.html and dashboard.html can never
// disagree, since both compute from the exact same functions over the exact
// same rows.
//
// Two interchangeable methods — 'ewma' (default) and 'sma', the pre-EWMA
// behavior kept as a Settings fallback — but same-day dedup and the "enough
// history" honesty gate apply to both, since neither is specific to which
// averaging method is active.
//
// Both are pure functions of the full daily history, recomputed on every
// render, not persisted running state: weight.html supports editing or
// deleting any past reading, and both recurrences are path-dependent, so a
// cached value walked forward from an earlier point would go silently wrong
// the moment an old reading changes. A full replay just refits — same
// reasoning as the strength index's TPD-over-chaining choice.
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

export const DEFAULT_TREND_METHOD = 'ewma';
// Fixed, not configurable, per spec.
export const TREND_HALFLIFE_DAYS = 7;
// The old SMA's window — kept the same number as the halflife and the
// warmup gate below, but conceptually distinct: it bounds a hard trailing
// window, not a decay rate.
export const SMA_WINDOW_DAYS = 7;
// Reused, not reinvented, from the old 7-day SMA's own warmup gate — applies
// to both methods. EWMA has no hard window (its tail never fully "fills"),
// but the honesty rule it serves reads the same either way: don't show a
// number before there's enough real tracked history behind it.
export const TREND_WARMUP_DAYS = 7;

// Plain-language labels, centralized so the two pages and the Settings
// toggle can never drift apart on wording. Stat-label casing; capitalize
// the first letter for chart-legend use.
export const TREND_LABEL = { ewma: 'trend', sma: '7-day average' };

/** Local midnight, so day math is calendar-day based, never a raw 24h split. */
function dayFloor(iso) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dayKey(iso) {
  const d = dayFloor(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function daysBetween(isoA, isoB) {
  return Math.round((dayFloor(isoB) - dayFloor(isoA)) / DAY_MS);
}

/**
 * Collapse same-calendar-day readings into one mean value per day, ascending.
 * Applies regardless of which trend method is active — the raw scatter never
 * goes through this, every reading still gets its own dot.
 */
export function dailyValues(entries) {
  const byDay = new Map();
  for (const e of entries) {
    const key = dayKey(e.measured_at);
    if (!byDay.has(key)) byDay.set(key, { date: e.measured_at, sum: 0, count: 0 });
    const bucket = byDay.get(key);
    bucket.sum += Number(e.weight_kg);
    bucket.count += 1;
    if (new Date(e.measured_at) < new Date(bucket.date)) bucket.date = e.measured_at;
  }
  return [...byDay.values()]
    .map((b) => ({ date: b.date, value: b.sum / b.count }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/** EWMA replay. First point bootstraps trend_value directly (n=1), per spec. */
function ewmaSeries(daily) {
  if (daily.length === 0) return [];
  const out = [{ date: daily[0].date, value: daily[0].value }];
  let trend = daily[0].value;
  let lastDate = daily[0].date;
  for (let i = 1; i < daily.length; i++) {
    const point = daily[i];
    const elapsed = daysBetween(lastDate, point.date);
    const alpha = 1 - Math.pow(0.5, elapsed / TREND_HALFLIFE_DAYS);
    trend = trend + alpha * (point.value - trend);
    lastDate = point.date;
    out.push({ date: point.date, value: trend });
  }
  return out;
}

/** Mean of daily values in the trailing SMA_WINDOW_DAYS window ending at endMs. */
function smaWindowMean(daily, endMs) {
  const startMs = endMs - SMA_WINDOW_DAYS * DAY_MS;
  const inWindow = daily.filter((d) => {
    const t = new Date(d.date).getTime();
    return t > startMs && t <= endMs;
  });
  if (inWindow.length === 0) return null;
  return inWindow.reduce((sum, d) => sum + d.value, 0) / inWindow.length;
}

/** One point per distinct day (the retained improvement over the old per-raw-entry series). */
function smaSeries(daily) {
  return daily
    .map((d) => ({ date: d.date, value: smaWindowMean(daily, new Date(d.date).getTime()) }))
    .filter((p) => p.value !== null);
}

/** Full trend series for the chart line. Returns [{date, value}], one point per distinct day. */
export function trendSeries(daily, method = DEFAULT_TREND_METHOD) {
  return method === 'sma' ? smaSeries(daily) : ewmaSeries(daily);
}

/** The trend's current value, or null. For SMA this can revert to null after a gap (the trailing window empties) — that's expected, not a bug. */
export function currentTrend(daily, method = DEFAULT_TREND_METHOD) {
  if (method === 'sma') return smaWindowMean(daily, Date.now());
  const series = ewmaSeries(daily);
  return series.length ? series[series.length - 1].value : null;
}

/**
 * What the trend read as of some past instant. For EWMA: the same replay
 * truncated to daily values on or before the cutoff (reproduces exactly what
 * a live system would have shown that day). For SMA: the trailing window as
 * of that instant, same as currentTrend but anchored earlier. Powers the
 * "vs N days ago" comparison. Null if no daily value exists that far back.
 */
export function trendAsOf(daily, cutoffMs, method = DEFAULT_TREND_METHOD) {
  if (method === 'sma') return smaWindowMean(daily, cutoffMs);
  const truncated = daily.filter((d) => new Date(d.date).getTime() <= cutoffMs);
  return currentTrend(truncated, 'ewma');
}

/**
 * Same honesty gate the old 7-day SMA used, now shared by both methods: a
 * trend number only displays once tracked history spans TREND_WARMUP_DAYS
 * from the very first reading ever logged. See CLAUDE.md's "Rolling/trailing
 * averages" rule.
 */
export function hasEnoughHistory(daily, nowMs = Date.now()) {
  if (daily.length === 0) return false;
  return nowMs - new Date(daily[0].date).getTime() >= TREND_WARMUP_DAYS * DAY_MS;
}
