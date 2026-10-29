import { cachedDetail, foodMetadata } from './food-product.js';
// Production store. Entry nutrition is a snapshot; food edits never touch it.
import { supabase, fetchAllRows } from '../supabase-client.js';
import { normalizeSettings, localDay, setDayEndHour } from './nutrition.js';

const keys = ['kcal', 'protein', 'carbs', 'fat'];
const duplicate = 'You already have a product with this barcode.';
const restoreDuplicate = 'Another saved product uses this barcode. Change its barcode before restoring this food.';
const entryMissing = 'That entry no longer exists.';
const foodMissing = 'That food no longer exists.';
const uid = () => crypto.randomUUID();
const clone = v => structuredClone(v);
const iso = value => value == null ? null : new Date(value).toISOString();
async function userId() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data?.session) throw new Error('Please log in again.');
  return data.session.user.id;
}
function checked({ data, error }, missing, barcodeMessage) {
  if (error) {
    if (error.code === '23505' && barcodeMessage) throw new Error(barcodeMessage);
    throw new Error(error.code === '23514' ? 'Could not save these values. Please check your input.' : error.message || 'Could not save your data. Please try again.');
  }
  if (!data && missing) throw new Error(missing);
  return data;
}
// Every growing-table read pages with a unique final order, including exports.
async function rows(table, filter = q => q, order = ['created_at', 'id']) {
  const id = await userId();
  return checked(await fetchAllRows(() => {
    let q = filter(supabase.from(table).select('*').eq('user_id', id));
    for (const column of order) q = q.order(column);
    return q;
  }));
}
const nutrients = (row, prefix = '') => Object.fromEntries(keys.map(k => [k, row[prefix + k] == null ? null : Number(row[prefix + k])]));
const columns = (values, prefix = '') => Object.fromEntries(keys.map(k => [prefix + k, values?.[k] ?? null]));
const entryFields = { id:'id', day:'day', loggedAt:'logged_at', meal:'meal', source:'source', sourceRef:'source_ref', name:'name', nameDe:'name_de', brand:'brand', basis:'basis', grams:'grams', millilitres:'millilitres', portions:'portions' };
function entryToRow(entry) {
  const row = {};
  if ('amountUnit' in entry || 'productVersion' in entry) row.food_metadata = foodMetadata(entry);
  for (const [key, column] of Object.entries(entryFields)) if (key in entry) row[column] = entry[key];
  if ('values' in entry) Object.assign(row, columns(entry.values));
  if ('per100' in entry || 'portion' in entry) Object.assign(row, columns(entry.per100 || entry.portion, 'base_'));
  return row;
}
function entryFromRow(row) {
  const entry = Object.fromEntries(Object.entries(entryFields).map(([key, column]) => [key, row[column] ?? null]));
  entry.loggedAt = iso(entry.loggedAt);
  for (const key of ['grams','millilitres','portions']) if (entry[key] != null) entry[key] = Number(entry[key]);
  return { ...entry, ...(row.food_metadata || {}), per100: row.basis === 'per100' ? nutrients(row, 'base_') : null, portion: row.basis === 'portion' ? nutrients(row, 'base_') : null, values: nutrients(row) };
}
function foodToRow(food) {
  const row = {};
  if ('amountUnit' in food || 'productVersion' in food) row.food_metadata = foodMetadata(food);
  for (const key of ['name','brand','barcode','basis']) if (key in food) row[key] = food[key] || null;
  if ('per100' in food || 'portion' in food) Object.assign(row, columns(food.per100 || food.portion));
  return row;
}
function foodFromRow(row) {
  return { ...(row.food_metadata || {}), id:row.id, name:row.name, brand:row.brand ?? null, barcode:row.barcode ?? null, basis:row.basis, [row.basis === 'per100' ? 'per100' : 'portion']:nutrients(row), createdAt:iso(row.created_at), deletedAt:iso(row.deleted_at) };
}
async function mutate(table, action, value, id, missing, barcodeMessage, liveOnly = false) {
  const owner = await userId();
  let q = supabase.from(table);
  q = action === 'insert' ? q.insert({ ...value, user_id:owner }) : action === 'delete' ? q.delete() : q.update(value);
  if (action !== 'insert') q = q.eq('user_id', owner).eq('id', id);
  if (liveOnly) q = q.is('deleted_at', null);
  return checked(await q.select('*').maybeSingle(), missing, barcodeMessage);
}

export async function getSettings() {
  const id = await userId();
  const row = checked(await supabase.from('cal_settings').select('*').eq('user_id', id).maybeSingle()) || {};
  const settings = normalizeSettings({ ...row, dayEndHour: row.day_end_hour });
  // First load on this phone (or changed elsewhere): the page already picked its day with the old hour, so start over once.
  if (setDayEndHour(settings.dayEndHour) && typeof location !== 'undefined') location.reload();
  return settings;
}
export async function saveSettings(settings) {
  const id = await userId(), next = normalizeSettings(settings);
  const { dayEndHour, ...columns } = next;
  checked(await supabase.from('cal_settings').upsert({ user_id:id, ...columns, day_end_hour:dayEndHour, updated_at:new Date().toISOString() }, { onConflict:'user_id' }));
  setDayEndHour(dayEndHour);
  // Report a partial save explicitly; retrying safely replaces today's record.
  try {
    checked(await supabase.from('cal_goal_history').upsert({ user_id:id, day:localDay(), nutrients:next.nutrients }, { onConflict:'user_id,day' }));
  } catch (error) { throw new Error(`Settings saved, but goal history could not be saved. Please retry. ${error.message}`); }
  return clone(next);
}
async function goalRows() { return (await rows('cal_goal_history', q => q, ['day'])).map(({ day, nutrients }) => ({ day, nutrients })); }
export async function getGoalHistory() {
  const history = await goalRows();
  return history.length ? history : [{ day:'0000-01-01', nutrients:(await getSettings()).nutrients }];
}
export async function listEntries(day) { return (await rows('cal_entries', q => q.eq('day', day), ['logged_at','created_at','id'])).map(entryFromRow); }
export async function entriesBetween(from, to) { return (await rows('cal_entries', q => q.gte('day', from).lte('day', to))).map(entryFromRow); }
export async function firstLoggedDay() {
  const id = await userId();
  const entries = checked(await supabase.from('cal_entries').select('day').eq('user_id', id).order('day').limit(1));
  return entries[0]?.day || null;
}
export async function recentEntries(days = 90) { return (await rows('cal_entries', q => q.gte('logged_at', new Date(Date.now() - days * 86400e3).toISOString()))).map(entryFromRow); }
export async function addEntry(entry) { return entryFromRow(await mutate('cal_entries', 'insert', { ...entryToRow(entry), id:entry.id || uid() }, null, entryMissing)); }
export async function updateEntry(id, patch) {
  const value = entryToRow(patch); delete value.id;
  return entryFromRow(await mutate('cal_entries', 'update', value, id, entryMissing));
}
export async function deleteEntry(id) { return entryFromRow(await mutate('cal_entries', 'delete', null, id, entryMissing)); }

export async function listFoods() { return (await rows('cal_foods', q => q.is('deleted_at', null))).map(foodFromRow); }
export async function addFood(food) { return foodFromRow(await mutate('cal_foods', 'insert', foodToRow(food), null, foodMissing, duplicate)); }
export async function updateFood(id, patch) { return foodFromRow(await mutate('cal_foods', 'update', foodToRow(patch), id, foodMissing, duplicate, true)); }
export async function deleteFood(id) { await mutate('cal_foods', 'update', { deleted_at:new Date().toISOString() }, id, foodMissing, null, true); }
export async function foodByBarcode(code) { return (await listFoods()).find(f => f.barcode === code) || null; }
export async function listDeletedFoods() {
  return (await rows('cal_foods', q => q.gte('deleted_at', new Date(Date.now() - 30 * 86400e3).toISOString()))).map(foodFromRow).sort((a,b) => b.deletedAt.localeCompare(a.deletedAt));
}
export async function restoreFood(id) {
  const owner = await userId();
  const row = checked(await supabase.from('cal_foods').select('*').eq('user_id', owner).eq('id', id).maybeSingle());
  if (!row?.deleted_at) throw new Error('That deleted food no longer exists.');
  return foodFromRow(await mutate('cal_foods', 'update', { deleted_at:null }, id, 'That deleted food no longer exists.', restoreDuplicate));
}
export async function loggedDays() {
  const counts = new Map();
  for (const row of await rows('cal_entries')) counts.set(row.day, (counts.get(row.day) || 0) + 1);
  return [...counts].map(([day,count]) => ({ day,count })).sort((a,b) => b.day.localeCompare(a.day));
}

// OFF cache stays on the device and never enters a database backup.
const CACHE_KEY = 'eatabase-off-cache-v2';
function products() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}
export function cachedProduct(code, options) { return cachedDetail(products()[code], options); }
export function cacheProduct(code, product) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...products(), [code]:{ product, at:Date.now() } })); }
  catch { /* cache failure must not prevent a scan, matching the local store */ }
}

// Volume owns these tables. Preserve its field names and don't overwrite metadata.
function weightRow({ id, kg, measuredAt, timeKnown, weight_kg, measured_at, time_known }) {
  const value = Math.round(Number(kg ?? weight_kg) * 10) / 10;
  const instant = new Date(measuredAt ?? measured_at ?? Date.now());
  if (!Number.isFinite(value) || value <= 20 || value >= 500) throw new Error('That does not look like a bodyweight in kg.');
  if (!Number.isFinite(instant.getTime())) throw new Error('That date is not valid.');
  return { id:id || uid(), weight_kg:value, measured_at:instant.toISOString(), time_known:timeKnown ?? time_known ?? true };
}
const weightFromRow = row => ({ id:row.id, weight_kg:Number(row.weight_kg), measured_at:iso(row.measured_at), time_known:row.time_known });
export async function listWeights() { return (await rows('body_weights', q => q, ['measured_at','id'])).map(weightFromRow); }
export async function addWeight(input) { return weightFromRow(await mutate('body_weights', 'insert', weightRow(input), null, entryMissing)); }
export async function updateWeight(id, patch) {
  const owner = await userId();
  const old = checked(await supabase.from('body_weights').select('*').eq('user_id', owner).eq('id', id).maybeSingle(), entryMissing);
  const row = weightRow({ ...old, ...patch, id }); delete row.id;
  return weightFromRow(await mutate('body_weights', 'update', row, id, entryMissing));
}
export async function deleteWeight(id) { return weightFromRow(await mutate('body_weights', 'delete', null, id, entryMissing)); }
export async function getWeightTrendMethod() {
  const id = await userId();
  const row = checked(await supabase.from('user_settings').select('*').eq('user_id', id).maybeSingle());
  return row?.weight_trend_method === 'sma' ? 'sma' : 'ewma';
}
export async function setWeightTrendMethod(method) {
  if (!['ewma','sma'].includes(method)) throw new Error('Choose ewma or sma.');
  const id = await userId();
  checked(await supabase.from('user_settings').upsert({ user_id:id, weight_trend_method:method, updated_at:new Date().toISOString() }, { onConflict:'user_id' }));
  return method;
}
export async function exportAll() {
  const [settings, goalHistory, entries, foods, bodyWeights, method] = await Promise.all([getSettings(), goalRows(), rows('cal_entries'), rows('cal_foods'), listWeights(), getWeightTrendMethod()]);
  return { app:'eatabase', exportedAt:new Date().toISOString(), settings, goalHistory, entries:entries.map(entryFromRow), foods:foods.map(foodFromRow), bodyWeights, user_settings:{ weight_trend_method:method } };
}
