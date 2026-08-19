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

// ---------------------------------------------------------------------------
// Daily Noise — "how big a day-to-day swing is normal for you".
//
// Deliberately a SEPARATE detrending step from the trend line above, not a
// reuse of it: the displayed trend is causal (EWMA/SMA), so it lags behind
// real weight change — comparing raw readings against it would count some of
// that lag as "noise" whenever the user is actually gaining or losing. A
// centered moving average has no lag (it looks both forward and backward), so
// residuals against it reflect noise, not a mix of noise and trend-catch-up.
// ---------------------------------------------------------------------------

const NOISE_RADIUS_DAYS = 7;
const NOISE_BUFFER_DAYS = 45;
const NOISE_MIN_READINGS = 10;
const NOISE_MAX_MEDIAN_GAP_DAYS = 2;
const NOISE_PERCENTILE = 0.8;
const NOISE_GENERIC_PCT = 0.006;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Linear-interpolation percentile, p in [0,1], over an already-sorted array. */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Residual of each day's value against a centered (non-causal) ±radiusDays
 * moving average — gaps in the surrounding window are just skipped, not
 * interpolated, per spec. Edge-trimmed: a day only gets a residual once it
 * has a genuinely full window on both sides, which — since there's no such
 * thing as future data — means dropping the most recent radiusDays days
 * (relative to `now`, the same anchor hasEnoughHistory/STALE_AFTER_DAYS
 * already use elsewhere, not the most recent logged entry) and the first
 * radiusDays days of the user's whole history (no past data yet there).
 */
export function centeredInnovations(daily, radiusDays = NOISE_RADIUS_DAYS, now = Date.now()) {
  if (daily.length === 0) return [];
  const firstMs = new Date(daily[0].date).getTime();
  const radiusMs = radiusDays * DAY_MS;
  const out = [];
  for (const point of daily) {
    const t = new Date(point.date).getTime();
    if (t < firstMs + radiusMs || t > now - radiusMs) continue;
    const window = daily.filter((d) => {
      const dt = new Date(d.date).getTime();
      return dt >= t - radiusMs && dt <= t + radiusMs;
    });
    const centeredMean = window.reduce((sum, d) => sum + d.value, 0) / window.length;
    out.push({ date: point.date, innovation: point.value - centeredMean });
  }
  return out;
}

/** The trailing bufferDays-calendar-day slice of centeredInnovations — the one window used for both the density gate and the percentile below. */
export function dailyNoiseBuffer(daily, bufferDays = NOISE_BUFFER_DAYS, now = Date.now()) {
  const cutoff = now - bufferDays * DAY_MS;
  return centeredInnovations(daily, NOISE_RADIUS_DAYS, now).filter((p) => new Date(p.date).getTime() >= cutoff);
}

/**
 * Personalized "normal swing" band in kg, or null if the density gate fails
 * (too few readings, or too gappy) — callers should fall back to
 * genericNoiseBand() in that case, not show nothing.
 */
export function personalizedNoiseBand(daily, now = Date.now()) {
  const buffer = dailyNoiseBuffer(daily, NOISE_BUFFER_DAYS, now);
  if (buffer.length < NOISE_MIN_READINGS) return null;

  const times = buffer.map((p) => new Date(p.date).getTime()).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / DAY_MS);
  if (median(gaps) >= NOISE_MAX_MEDIAN_GAP_DAYS) return null;

  const absSorted = buffer.map((p) => Math.abs(p.innovation)).sort((a, b) => a - b);
  const band = percentile(absSorted, NOISE_PERCENTILE);
  return Math.round(band * 10) / 10;
}

/** Population-average fallback when personalizedNoiseBand() can't earn a personal number yet — 0.6% of the current trend weight, per published day-to-day weight variability data. */
export function genericNoiseBand(trendKg) {
  return Math.round(trendKg * NOISE_GENERIC_PCT * 10) / 10;
}
