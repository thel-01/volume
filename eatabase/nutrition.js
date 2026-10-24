import { amountUnit, foodMetadata } from './food-product.js';
// Eatabase nutrition logic. DOM-free, so it runs under Node for tests
// (nutrition.test.mjs) exactly like strength-index.js does in the real app.
//
// Units: all nutrient values are per the stated basis — `per100` = per 100 g or ml (amountUnit),
// an entry's `values` = what was actually eaten. kcal in kcal, the rest in g.
// `null` always means "unknown", never 0 (a quicklog with only kcal has
// unknown protein).

export const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', short: 'kcal', unit: 'kcal' },
  { key: 'protein', label: 'Protein', short: 'P', unit: 'g' },
  { key: 'carbs', label: 'Carbs', short: 'C', unit: 'g' },
  { key: 'fat', label: 'Fat', short: 'F', unit: 'g' },
];
export const NUTRIENT_KEYS = NUTRIENTS.map(n => n.key);

export const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
];

/**
 * What a goal means:
 *   'min'    ≥  at least this much (protein)
 *   'target' =  about this much
 *   'max'    ≤  no more than this
 */
export const GOAL_TYPES = [
  { key: 'min', symbol: '≥', label: 'Over' },
  { key: 'target', symbol: '=', label: 'Exact' },
  { key: 'max', symbol: '≤', label: 'Under' },
];
const GOAL_TYPE_KEYS = GOAL_TYPES.map(t => t.key);

/** First-run settings: calories + protein, no goals yet, grouped by meal. */
export const DEFAULT_SETTINGS = {
  nutrients: {
    kcal: { on: true, goal: null, type: 'target' },
    protein: { on: true, goal: null, type: 'min' },
    carbs: { on: false, goal: null, type: 'target' },
    fat: { on: false, goal: null, type: 'target' },
  },
  meals: true,
};

/** Settings with every key present (older/partial saved settings → defaults filled in). */
export function normalizeSettings(s) {
  const out = { nutrients: {}, meals: !!(s?.meals ?? DEFAULT_SETTINGS.meals) };
  for (const k of NUTRIENT_KEYS) {
    const v = s?.nutrients?.[k] || {}, d = DEFAULT_SETTINGS.nutrients[k];
    out.nutrients[k] = {
      on: !!(v.on ?? d.on), goal: validGoal(k, v.goal ?? d.goal),
      type: GOAL_TYPE_KEYS.includes(v.type) ? v.type : d.type,
    };
  }
  return out;
}

/** Tracked nutrients in display order. At least one is always on (kcal if all were switched off). */
export function trackedNutrients(settings) {
  const s = normalizeSettings(settings);
  const on = NUTRIENTS.filter(n => s.nutrients[n.key].on);
  return on.length ? on : [NUTRIENTS[0]];
}

const GOAL_MAX = { kcal: 10000, protein: 500, carbs: 1000, fat: 500 };
function validGoal(key, g) {
  return Number.isFinite(g) && g > 0 && g <= GOAL_MAX[key] ? Math.round(g) : null;
}

const round1 = v => Math.round(v * 10) / 10;
const roundFor = (key, v) => (v == null ? null : key === 'kcal' ? Math.round(v) : round1(v));

/** Pick just the nutrient fields of any object (search result, product), unknowns as null. */
export function pickNutrients(o) {
  const out = {};
  for (const k of NUTRIENT_KEYS) out[k] = Number.isFinite(o?.[k]) ? round1(o[k]) : null;
  return out;
}

/** Per-100 g values → what `grams` of it contain. */
export function scaleValues(per100, grams) {
  const out = {};
  for (const k of NUTRIENT_KEYS) out[k] = per100[k] == null ? null : roundFor(k, (per100[k] * grams) / 100);
  return out;
}

/** A portion-based food (saved quicklog) × `portions`. */
export function multiplyValues(values, portions) {
  const out = {};
  for (const k of NUTRIENT_KEYS) out[k] = values[k] == null ? null : roundFor(k, values[k] * portions);
  return out;
}

/** kcal from macros (4/4/9). null unless protein, carbs and fat are all known. */
export function kcalFromMacros({ protein, carbs, fat }) {
  if (protein == null || carbs == null || fat == null) return null;
  return Math.round(4 * protein + 4 * carbs + 9 * fat);
}

/**
 * Quicklog fields as typed → entry values. Anything left empty is unknown.
 * No kcal typed but all three macros → kcal computed (`kcalDerived: true`).
 * Returns null when nothing at all was entered.
 */
export function quickValues(fields) {
  const v = pickNutrients(fields);
  if (NUTRIENT_KEYS.every(k => v[k] == null)) return null;
  let kcalDerived = false;
  if (v.kcal == null) {
    const k = kcalFromMacros(v);
    if (k != null) { v.kcal = k; kcalDerived = true; }
  }
  return { values: v, kcalDerived };
}

/**
 * The day's totals for every nutrient. `missing` counts entries whose value
 * is unknown — the total is then a lower bound ("at least"), shown as such.
 */
export function dayTotals(entries) {
  const out = {};
  for (const k of NUTRIENT_KEYS) {
    let sum = 0, missing = 0;
    for (const e of entries) {
      const v = e.values?.[k];
      if (v == null) missing++; else sum += v;
    }
    out[k] = { value: roundFor(k, sum), missing, count: entries.length };
  }
  return out;
}

/**
 * How close counts as "on target": 2 % of the goal for calories (never
 * tighter than 40 kcal), 3 % for macros (never tighter than 3 g), so a small
 * goal doesn't need gram-exact eating. 3000 kcal → ±60, 150 g → ±4.5 g.
 */
export function goalBand(key, goal) {
  return key === 'kcal' ? Math.max(goal * 0.02, 40) : Math.max(goal * 0.03, 3);
}

/**
 * Where a day's total stands against its goal. No goal → null.
 *   share  0..1, the bar's fill up to the goal
 *   left   > 0 still to go, < 0 past the goal
 *   hit    on target, by the goal's type:
 *            min     total ≥ goal − band (and stays hit above it)
 *            target  within ± band
 *            max     within the band below the goal, not over it
 *   over   past the goal in a way that matters (target/max only, beyond the
 *          band for a target). Over a minimum is still just "hit".
 * Never a failure state beyond that: missing a goal isn't shown as an error.
 */
export function goalStatus(key, total, goal, type = 'target') {
  if (!goal) return null;
  const band = goalBand(key, goal);
  const hit = type === 'min' ? total >= goal - band
    : type === 'max' ? total <= goal && total >= goal - band
      : Math.abs(total - goal) <= band;
  const over = type === 'max' ? total > goal : type === 'target' ? total > goal + band : false;
  return { share: Math.min(1, total / goal), left: goal - total, hit, over, band };
}
/** @deprecated kept for older callers: goalStatus() without a type. */
export function progress(total, goal) {
  if (!goal) return null;
  return { share: Math.min(1, total / goal), left: goal - total, over: total > goal };
}

const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };
const MACROS = ['protein', 'carbs', 'fat'];

/**
 * Keep the calorie goal consistent with the macro goals (4/4/9 kcal per g).
 * The macro goals pin down a kcal range: at least Σ of the ≥/= goals, and at
 * most Σ of the ≤/= goals (only when all three have one). If the calorie
 * goal can't be met inside that range — beyond the calorie goal's own
 * on-target band (goalBand), so 3000 vs. a computed 2950 is left alone and
 * round goals stay round — the
 * calorie goal moves to the nearest edge of the range, rounded to 10 kcal.
 * Only macros that are on and have a goal count. Returns
 * { settings, changed, kcal: {from, to}, macroKcal: {lo, hi} }.
 */
export function reconcileGoals(settings) {
  const s = normalizeSettings(settings), k = s.nutrients.kcal;
  const goals = MACROS.map(m => ({ m, ...s.nutrients[m] })).filter(g => g.on && g.goal);
  const lo = goals.filter(g => g.type !== 'max').reduce((a, g) => a + g.goal * KCAL_PER_G[g.m], 0);
  const capped = goals.filter(g => g.type !== 'min');
  const hi = capped.length === MACROS.length ? capped.reduce((a, g) => a + g.goal * KCAL_PER_G[g.m], 0) : Infinity;
  const result = { settings: s, changed: false, kcal: null, macroKcal: { lo, hi } };
  if (!k.on || !k.goal || !goals.length) return result;
  // The calorie goal's own range.
  const kLo = k.type === 'max' ? 0 : k.goal, kHi = k.type === 'min' ? Infinity : k.goal;
  const tol = goalBand('kcal', k.goal);
  let to = null;
  if (lo > kHi + tol) to = Math.ceil(lo / 10) * 10;          // macros alone need more than the calorie goal allows
  else if (hi < kLo - tol) to = Math.floor(hi / 10) * 10;    // macros can't reach the calorie goal
  if (to == null || to === k.goal) return result;
  s.nutrients.kcal = { ...k, goal: to };
  return { ...result, settings: s, changed: true, kcal: { from: k.goal, to } };
}

/**
 * Goal history. Every settings save appends { day, nutrients } (one per day,
 * the day's last change wins), so a past day is judged against the goal it
 * actually had. A day before the first record has no goals.
 */
export function goalsOnDay(history, day) {
  if (!history?.length || day < history[0].day) return null;
  let found = history[0];
  for (const h of history) if (h.day <= day) found = h; else break;
  return normalizeSettings({ nutrients: found.nutrients }).nutrients;
}

// ---- How complete is a day's record of one nutrient? ------------------------
// Entries can leave a nutrient unknown (a quicklog with just calories +
// protein; a product whose label skips fat). A day with unknowns is a lower
// bound, not the real total. To tell "10 g of carbs not logged" from "100 g
// not logged", each unknown value is ESTIMATED from something the same entry
// does know (preferably its calories), using the user's own ratio between the
// two over the period (Σ carbs / Σ kcal across entries that know both), or a
// typical-diet ratio when there's no personal data yet.

/** Typical-diet fallback ratios, per kcal: ~16 % of energy from protein, 50 % carbs, 34 % fat. */
const TYPICAL_PER_KCAL = { kcal: 1, protein: 0.04, carbs: 0.125, fat: 0.038 };

/** Personal ratio of every nutrient to every other, from entries that know both. ratio(x, a) = Σx / Σa. */
export function personalRatios(entries) {
  const sums = {};
  for (const e of entries) for (const x of NUTRIENT_KEYS) for (const a of NUTRIENT_KEYS) {
    const vx = e.values?.[x], va = e.values?.[a];
    if (x === a || vx == null || va == null) continue;
    const k = `${x}/${a}`; sums[k] ||= { x: 0, a: 0 }; sums[k].x += vx; sums[k].a += va;
  }
  return (x, a) => {
    const t = sums[`${x}/${a}`];
    // Enough personal data behind it (≥ 500 kcal, or ≥ 50 g of a macro anchor) → use it; otherwise the typical diet.
    if (t && t.a > 0 && t.a >= (a === 'kcal' ? 500 : 50)) return t.x / t.a;
    return TYPICAL_PER_KCAL[x] / TYPICAL_PER_KCAL[a];
  };
}

/** Estimated amount of `key` an entry doesn't know (0 if it knows it). Anchored on kcal, else the first known macro. */
export function estimateMissing(entry, key, ratio) {
  if (entry.values?.[key] != null) return 0;
  const anchor = ['kcal', ...NUTRIENT_KEYS.filter(k => k !== 'kcal')].find(a => a !== key && entry.values?.[a] != null && entry.values[a] > 0);
  return anchor ? entry.values[anchor] * ratio(key, anchor) : 0;
}

/**
 * A gap counts as minor (the day is treated as complete) when the estimated
 * missing amount is at most 10 % of the day's estimated real total, or tiny
 * in absolute terms (≤ 50 kcal / 5 g).
 */
export const GAP_SHARE = 0.10;
const GAP_FLOOR = { kcal: 50, protein: 5, carbs: 5, fat: 5 };

/**
 * The last `days` days ending at `endDay` (inclusive, oldest first), one
 * point per day: { day, value, logged, goal, type, quality, missing }.
 *   value    sum of the KNOWN values (a lower bound when quality is 'partial')
 *   logged   true when at least one entry that day knows this nutrient
 *   quality  'none' (no entries) · 'complete' · 'minor' (small gap, counts
 *            as complete) · 'partial' (a real gap: drawn lighter, left out of
 *            averages)
 *   missing  the estimated amount not logged
 * A day with no entries stays in the series (value 0, not logged), like
 * volume.html's empty weeks, so the bars stay evenly dated.
 */
export function dailySeries(entries, history, key, endDay, days = 28) {
  const ratio = personalRatios(entries);
  const byDay = new Map();
  for (const e of entries) {
    const v = e.values?.[key];
    const d = byDay.get(e.day) || { sum: 0, known: 0, count: 0, missing: 0 };
    d.count++;
    if (v != null) { d.sum += v; d.known++; } else d.missing += estimateMissing(e, key, ratio);
    byDay.set(e.day, d);
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = shiftDay(endDay, -i), d = byDay.get(day), g = goalsOnDay(history, day)?.[key];
    let quality = 'none';
    if (d) {
      if (d.known === d.count) quality = 'complete';
      else {
        const total = d.sum + d.missing;
        quality = d.known > 0 && (d.missing <= GAP_FLOOR[key] || d.missing <= total * GAP_SHARE) ? 'minor' : 'partial';
      }
    }
    out.push({
      day, value: d?.known ? roundFor(key, d.sum) : 0, logged: !!d?.known,
      goal: g?.on && g.goal ? g.goal : null, type: g?.type || null,
      quality, missing: d ? roundFor(key, d.missing) : 0,
    });
  }
  return out;
}

/** Days whose record of this nutrient can be trusted: complete, or only a minor gap. */
export const isUsable = p => p.quality === 'complete' || p.quality === 'minor';

/**
 * Is this nutrient tracked well enough to chart at all? Of the finished
 * days that have entries, at least 70 % must be usable; otherwise the chart
 * would mostly show lower bounds, not your eating. Only judged once there
 * are 3+ such days (one bad day out of two says little). Few days overall is
 * not a gap problem — the averages have their own 4-week rule for that.
 * Returns { ok, usable, withEntries }.
 */
export const CHART_MIN_USABLE_SHARE = 0.7;
export function chartGate(series, today) {
  const withEntries = series.filter(p => p.day < today && p.quality !== 'none');
  const usable = withEntries.filter(isUsable).length;
  return { ok: withEntries.length < 3 || usable >= withEntries.length * CHART_MIN_USABLE_SHARE, usable, withEntries: withEntries.length };
}

/**
 * "You averaged X over the last 4 weeks" + how that compares to the goal.
 * Averages finished days only (today is excluded: it's still being eaten),
 * and only days with something logged — an unlogged day is unknown, not 0 —
 * whose record is complete or only has a minor gap (see dailySeries).
 * The comparison goal is the average of each averaged day's own goal, so a
 * goal changed mid-period is compared fairly; no comparison at all unless
 * every averaged day had a goal of the same type. `series` = dailySeries()
 * ending today, `firstDay` = the first day ever logged.
 * Returns null while the history doesn't yet span the whole window, or when
 * fewer than half its finished days are usable (the app's rolling-average
 * rule: no partial window passed off as the full one).
 */
export const AVERAGE_MIN_SHARE = 0.5;
export function averageSummary(series, key, firstDay, today, { minShare = AVERAGE_MIN_SHARE } = {}) {
  const done = series.filter(p => p.day < today);
  if (!firstDay || !done.length || firstDay > done[0].day) return null;
  // Only days whose record can be trusted: a day with a real gap would drag the average down.
  const logged = done.filter(p => p.logged && (p.quality == null || isUsable(p)));
  // Too few trustworthy days, and it isn't really an average over the window any more —
  // same as a window that hasn't filled yet: hidden, never relabelled (Volume's rolling-average rule).
  if (!logged.length || logged.length < done.length * minShare) return null;
  const avg = logged.reduce((a, p) => a + p.value, 0) / logged.length;
  const out = { average: roundFor(key, avg), days: logged.length, goal: null, diff: null, type: null, hit: null };
  // Compare against goals only when every averaged day had one, of one type: otherwise the
  // number and the comparison would describe different days (or mix "Under" with "Over").
  const types = new Set(logged.map(p => (p.goal ? p.type : null)));
  if (types.size === 1 && !types.has(null)) {
    const [type] = types, goal = logged.reduce((a, p) => a + p.goal, 0) / logged.length;
    const st = goalStatus(key, avg, goal, type);
    Object.assign(out, { goal: roundFor(key, goal), diff: roundFor(key, avg - goal), type, hit: st.hit, changed: new Set(logged.map(p => p.goal)).size > 1 });
  }
  return out;
}

/** Meal a new entry defaults to, from the local time of day (only used when grouping is on). */
export function defaultMeal(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 4 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17 && h < 21.5) return 'dinner';
  return 'snack';
}

/** Entries grouped in meal order; entries without a meal (logged while grouping was off) go to "Other". */
export function groupByMeal(entries) {
  const groups = MEALS.map(m => ({ ...m, entries: entries.filter(e => e.meal === m.key) }));
  const other = entries.filter(e => !MEALS.some(m => m.key === e.meal));
  if (other.length) groups.push({ key: 'other', label: 'Other', entries: other });
  return groups.filter(g => g.entries.length);
}

/** Local calendar day 'YYYY-MM-DD' (the day a user means by "today"; timestamps themselves stay UTC). */
export function localDay(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
export function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + delta));
}

/** Identity of "the same food" across entries: where it came from + its id there. */
export const foodKey = e => `${e.source}:${e.sourceRef ?? e.name}`;

/**
 * Your foods, remembered from the log: one row per distinct food, ranked by
 * how often and how recently you logged it (frecency). Feeds the "Recent"
 * list shown before typing and searchMine() in food-search.js.
 * Own products/meals you created but never logged are included too (uses 0).
 *   score = ln(1 + uses in the last 90 days) × 10 − days since last use × 0.5
 */
export function rememberedFoods(entries, ownFoods = [], now = new Date()) {
  const byKey = new Map();
  const cutoff = now.getTime() - 90 * 86400e3;
  // newest first, so the first entry seen per food is its latest snapshot
  const sorted = [...entries].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
  for (const e of sorted) {
    if (e.source === 'quick') continue;   // one-off quicklogs aren't foods; saving one makes it an own food
    const key = foodKey(e);
    let f = byKey.get(key);
    if (!f) {
      f = {
        key, ref: e.source, id: e.sourceRef ?? e.name, source: e.source, sourceRef: e.sourceRef ?? null,
        name: e.name, nameDe: e.nameDe || null, brand: e.brand || null,
        basis: e.basis, per100: e.per100 || null, portion: e.portion || null,
        ...foodMetadata(e), lastGrams: e.grams ?? null, lastMillilitres: e.millilitres ?? null, lastAmountUnit: amountUnit(e), lastPortions: e.portions ?? null,
        uses: 0, lastUsed: e.loggedAt,
      };
      byKey.set(key, f);
    }
    if (new Date(e.loggedAt).getTime() >= cutoff) f.uses++;
  }
  for (const o of ownFoods) {
    const key = `own:${o.id}`;
    const f = byKey.get(key);
    // the product as it is now (you may have edited it) beats the old entry snapshot
    const fresh = { ...foodMetadata(o), servingSize:o.servingSize ?? null, name: o.name, brand: o.brand || null, basis: o.basis, per100: o.per100 || null, portion: o.portion || null };
    if (f) Object.assign(f, fresh);
    else byKey.set(key, { key, ref: 'own', id: o.id, source: 'own', sourceRef: o.id, nameDe: null, ...fresh,
      lastGrams: null, lastPortions: null, uses: 0, lastUsed: o.createdAt });
  }
  const list = [...byKey.values()].filter(f => !(f.source === 'own' && !ownFoods.some(o => o.id === f.sourceRef)));
  for (const f of list) {
    f.daysAgo = Math.max(0, (now - new Date(f.lastUsed)) / 86400e3);
    f.score = Math.log(1 + f.uses) * 10 - f.daysAgo * 0.5;
  }
  return list.sort((a, b) => b.score - a.score);
}

/**
 * Build a log entry from a food and an amount. `food` is any of:
 *   - a search/scan result (source 'BLS' | 'OFF') with per-100 g values
 *   - a remembered food or own product (basis 'per100' | 'portion')
 * The nutrition is COPIED into the entry (a snapshot): editing the product
 * later, or Open Food Facts changing it, never rewrites a logged day.
 */
export function makeEntry(food, { grams = null, millilitres = null, portions = null, meal = null, day, now = new Date() }) {
  const basis = food.basis || 'per100';
  grams = grams == null ? null : round1(grams);
  millilitres = millilitres == null ? null : round1(millilitres);
  const unit = amountUnit(food), amount = unit === 'ml' ? millilitres : grams;
  portions = portions == null ? null : round1(portions);
  if (basis === 'per100' && (!(amount > 0) || amount > 5000)) throw new Error('Enter an amount greater than zero and no more than 5000.');
  const per100 = basis === 'per100' ? pickNutrients(food.per100 || food) : null;
  const portion = basis === 'portion' ? pickNutrients(food.portion || food) : null;
  const values = basis === 'per100' ? scaleValues(per100, amount) : multiplyValues(portion, portions ?? 1);
  return {
    day: day || localDay(now),
    loggedAt: now.toISOString(),
    meal,
    source: food.source === 'MINE' ? food.ref : food.source,
    sourceRef: food.sourceRef ?? food.id ?? null,
    name: food.name?.slice(0, 160),
    nameDe: food.nameDe || null,
    brand: food.brand || null,
    basis,
    ...foodMetadata(food), amountUnit: unit,
    grams: basis === 'per100' && unit === 'g' ? grams : null,
    millilitres: basis === 'per100' && unit === 'ml' ? millilitres : null,
    portions: basis === 'portion' ? (portions ?? 1) : null,
    per100,
    portion,
    values,
  };
}

/** Same entry, new amount: recomputed from its own snapshot. */
export function withAmount(entry, { grams, millilitres, portions }) {
  if (entry.basis === 'per100') {
    const unit = amountUnit(entry), amount = round1(unit === 'ml' ? millilitres : grams);
    if (!(amount > 0) || amount > 5000) throw new Error('Enter a valid amount.');
    return { ...entry, grams: unit === 'g' ? round1(amount) : null, millilitres: unit === 'ml' ? round1(amount) : null, values: scaleValues(entry.per100, round1(amount)) };
  }
  if (entry.basis === 'portion') return { ...entry, portions, values: multiplyValues(entry.portion, portions) };
  return entry;   // a one-off quicklog has no basis to rescale from
}

/** Number display: kcal whole, grams with one decimal under 10 ("4.5 g", "32 g"). */
export function fmt(key, v) {
  if (v == null) return '—';
  if (key === 'kcal') return Math.round(v).toLocaleString('en-US');
  return v < 10 && v % 1 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US');
}
