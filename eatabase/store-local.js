import { cachedDetail } from './food-product.js';
// Rules mirrored from the real app:
//   - timestamps stored as UTC ISO strings; `day` is the local calendar day
//     the entry belongs to (what the user meant by "today")
//   - log entries hard-delete (like sets: cheap to redo); own foods soft-delete
//     (deleted_at), so a food you remove can't break a logged day

import { normalizeSettings, DEFAULT_SETTINGS, localDay } from './nutrition.js';

const KEY = 'eatabase-app-v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const fresh = () => ({ v: 2, settings: DEFAULT_SETTINGS, goalHistory: [], entries: [], foods: [], products: {} });
function load() {
  try {
    const db = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (db && db.entries && db.foods) {
      // v1 → v2: meal grouping became the default; goal history started.
      if (!db.v) { db.v = 2; db.settings = { ...db.settings, meals: true }; }
      db.goalHistory ||= [];
      return db;
    }
  } catch { /* corrupted → start fresh below */ }
  return fresh();
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) {
    db = load();   // the write failed: drop the in-memory change too, so screen and storage agree
    throw new Error(`Couldn't save on this phone: ${e.message}`);
  }
}
const clone = v => structuredClone(v);

// ---- settings (user_settings-style single row) ------------------------------
export async function getSettings() {
  return normalizeSettings(db.settings);
}
export async function saveSettings(settings) {
  db.settings = normalizeSettings(settings);
  recordGoals(localDay());
  save();
  return clone(db.settings);
}
/** One goal record per day (the day's last change wins); see goalsOnDay() in nutrition.js. */
function recordGoals(day) {
  const h = db.goalHistory, rec = { day, nutrients: clone(db.settings.nutrients) };
  if (h.length && h[h.length - 1].day === day) h[h.length - 1] = rec; else h.push(rec);
}
/** Goal history, oldest first. Empty history → today's settings stand for every day. */
export async function getGoalHistory() {
  return db.goalHistory.length ? clone(db.goalHistory) : [{ day: '0000-01-01', nutrients: clone(normalizeSettings(db.settings).nutrients) }];
}

// ---- log entries (cal_entries) ----------------------------------------------
/** One day's entries, oldest first. */
export async function listEntries(day) {
  return clone(db.entries.filter(e => e.day === day).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)));
}
/** Every entry with from <= day <= to (inclusive, 'YYYY-MM-DD'). */
export async function entriesBetween(from, to) {
  return clone(db.entries.filter(e => e.day >= from && e.day <= to));
}
/** The first day anything was ever logged, or null. */
export async function firstLoggedDay() {
  return db.entries.reduce((min, e) => (!min || e.day < min ? e.day : min), null);
}
/** Every entry from the last `days` days (for remembering foods). */
export async function recentEntries(days = 90) {
  const cutoff = new Date(Date.now() - days * 86400e3).toISOString();
  return clone(db.entries.filter(e => e.loggedAt >= cutoff));
}
/** `entry` as built by makeEntry() / a quicklog. Returns it with its id. */
export async function addEntry(entry) {
  const row = { ...clone(entry), id: entry.id || uid() };
  db.entries.push(row);
  save();
  return clone(row);
}
export async function updateEntry(id, patch) {
  const i = db.entries.findIndex(e => e.id === id);
  if (i < 0) throw new Error('That entry no longer exists.');
  db.entries[i] = { ...db.entries[i], ...clone(patch), id };
  save();
  return clone(db.entries[i]);
}
/** Hard delete. Returns the removed row, so the UI can offer Undo (re-add it via addEntry). */
export async function deleteEntry(id) {
  const i = db.entries.findIndex(e => e.id === id);
  if (i < 0) throw new Error('That entry no longer exists.');
  const [row] = db.entries.splice(i, 1);
  save();
  return row;
}

// ---- own foods (cal_foods): your products (per 100 g) and saved meals (per portion) ----
/**
 * food: { name, brand?, barcode?, basis: 'per100' | 'portion',
 *         per100?: {kcal, protein, carbs, fat}, portion?: {...same} }
 */
export async function listFoods() {
  return clone(db.foods.filter(f => !f.deletedAt));
}
export async function addFood(food) {
  if (food.barcode && db.foods.some(f => !f.deletedAt && f.barcode === food.barcode)) {
    throw new Error('You already have a product with this barcode.');
  }
  const row = { ...clone(food), id: uid(), createdAt: new Date().toISOString(), deletedAt: null };
  db.foods.push(row);
  save();
  return clone(row);
}
export async function updateFood(id, patch) {
  const i = db.foods.findIndex(f => f.id === id && !f.deletedAt);
  if (i < 0) throw new Error('That food no longer exists.');
  const next = { ...db.foods[i], ...clone(patch), id };
  if (next.barcode && db.foods.some(f => f.id !== id && !f.deletedAt && f.barcode === next.barcode)) throw new Error('You already have a product with this barcode.');
  db.foods[i] = next;
  save();
  return clone(db.foods[i]);
}
export async function deleteFood(id) {
  const f = db.foods.find(f => f.id === id && !f.deletedAt);
  if (!f) throw new Error('That food no longer exists.');
  f.deletedAt = new Date().toISOString();
  save();
}
/** Your own product carrying this barcode (wins over Open Food Facts). */
export async function foodByBarcode(code) {
  const f = db.foods.find(f => !f.deletedAt && f.barcode === code);
  return f ? clone(f) : null;
}

// ---- barcode product cache (phone-local in the real app too) ------------------
// product = parsed OFF product, or null = "not in Open Food Facts" (kept 24 h).
export function cachedProduct(code, options) { return cachedDetail(db.products[code], options); }
export function cacheProduct(code, product) {
  db.products[code] = { product, at: Date.now() };
  try { save(); } catch { /* a full cache is not worth failing a scan over */ }
}

/** Soft-deleted foods remain recoverable in the UI for 30 days. */
export async function listDeletedFoods() {
  const cutoff = Date.now() - 30 * 86400e3;
  return clone(db.foods.filter(f => f.deletedAt && new Date(f.deletedAt).getTime() >= cutoff).sort((a,b) => b.deletedAt.localeCompare(a.deletedAt)));
}
export async function restoreFood(id) {
  const food = db.foods.find(f => f.id === id && f.deletedAt);
  if (!food) throw new Error('That deleted food no longer exists.');
  if (food.barcode && db.foods.some(f => !f.deletedAt && f.barcode === food.barcode)) throw new Error('Another saved product uses this barcode. Change its barcode before restoring this food.');
  food.deletedAt = null; save(); return clone(food);
}
export async function loggedDays() {
  const counts = new Map();
  for (const e of db.entries) counts.set(e.day, (counts.get(e.day) || 0) + 1);
  return [...counts].map(([day,count]) => ({ day,count })).sort((a,b) => b.day.localeCompare(a.day));
}
export async function exportAll() {
  return clone({ app: 'eatabase', exportedAt: new Date().toISOString(), settings: normalizeSettings(db.settings), goalHistory: db.goalHistory, entries: db.entries, foods: db.foods, bodyWeights: db.body_weights || [], user_settings: db.user_settings || { weight_trend_method: 'ewma' } });
}


// ---- body_weights (Volume snapshot UI uses the original column names) -------
function weightRow({ id, kg, measuredAt, timeKnown, weight_kg, measured_at, time_known }) {
  const value = Math.round(Number(kg ?? weight_kg) * 10) / 10;
  const instant = new Date(measuredAt ?? measured_at ?? Date.now());
  if (!Number.isFinite(value) || value <= 20 || value >= 500) throw new Error('That does not look like a bodyweight in kg.');
  if (!Number.isFinite(instant.getTime())) throw new Error('That date is not valid.');
  return { id: id || uid(), weight_kg: value, measured_at: instant.toISOString(), time_known: timeKnown ?? time_known ?? true };
}
/** All readings, oldest first; ties are ordered by id as in Volume. */
export async function listWeights() {
  return clone([...(db.body_weights || [])].sort((a,b) => a.measured_at.localeCompare(b.measured_at) || a.id.localeCompare(b.id)));
}
export async function addWeight(input) {
  const row = weightRow(input);
  (db.body_weights ||= []).push(row);
  save();
  return clone(row);
}
export async function updateWeight(id, patch) {
  const i = (db.body_weights || []).findIndex(row => row.id === id);
  if (i < 0) throw new Error('That entry no longer exists.');
  db.body_weights[i] = weightRow({ ...db.body_weights[i], ...clone(patch), id });
  save();
  return clone(db.body_weights[i]);
}
/** Hard delete, matching Volume's two-tap delete without Undo. */
export async function deleteWeight(id) {
  const i = (db.body_weights || []).findIndex(row => row.id === id);
  if (i < 0) throw new Error('That entry no longer exists.');
  const [row] = db.body_weights.splice(i, 1);
  save();
  return clone(row);
}
export async function getWeightTrendMethod() {
  return db.user_settings?.weight_trend_method === 'sma' ? 'sma' : 'ewma';
}
export async function setWeightTrendMethod(method) {
  if (!['ewma', 'sma'].includes(method)) throw new Error('Choose ewma or sma.');
  (db.user_settings ||= {}).weight_trend_method = method;
  save();
  return method;
}
