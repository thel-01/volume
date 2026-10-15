// Product details use a different contract from Search-a-licious previews.
export const PRODUCT_VERSION = 2;
export const PRODUCT_FIELDS = 'code,schema_version,product_name,product_name_de,product_name_en,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,serving_quantity_unit,nutrition.input_sets,last_modified_t';
export const PRODUCT_TTL = 7 * 86400e3;
export const MISS_TTL = 86400e3;
const keys = ['kcal', 'protein', 'carbs', 'fat'];
const finite = v => typeof v === 'number' ? (Number.isFinite(v) ? v : null)
  : typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : null;
const unit = u => ({ g:'g', kg:'g', ml:'ml', l:'ml' })[u] || null;
const factor = u => ['kg','l'].includes(u) ? 1000 : 1;
export function productSize(amount, u) {
  const n = finite(amount), normalized = unit(u);
  const normalizedAmount = n * factor(u);
  return n > 0 && normalized && Number.isFinite(normalizedAmount) ? { amount:normalizedAmount, unit:normalized } : null;
}
function nutrient(n, energy = false) {
  const value = finite(n?.value);
  if (value == null || value < 0 || !['', '~', undefined, null].includes(n?.modifier)) return null;
  if (energy) return n.unit === 'kcal' ? value : n.unit === 'kJ' ? value / 4.184 : null;
  return n.unit === 'g' ? value : n.unit === 'mg' ? value / 1000 : n.unit === 'µg' || n.unit === 'μg' ? value / 1e6 : null;
}
function normalizeSet(s, index) {
  if (!['packaging','manufacturer'].includes(s.source) || s.preparation !== 'as_sold') return null;
  let size;
  if (s.per === '100g' || s.per === '100ml') {
    const expected = s.per === '100g' ? 'g' : 'ml';
    if (s.per_unit && unit(s.per_unit) !== expected) return null;
    if (s.per_quantity != null && finite(s.per_quantity) * factor(s.per_unit) !== 100) return null;
    size = { amount:100, unit:expected };
  } else if (s.per === 'serving') size = productSize(s.per_quantity, s.per_unit);
  if (!size) return null;
  const n = s.nutrients || {};
  const values = {
    kcal:nutrient(n['energy-kcal'], true) ?? nutrient(n['energy-kj'], true) ?? nutrient(n.energy, true),
    protein:nutrient(n.proteins), carbs:nutrient(n.carbohydrates), fat:nutrient(n.fat),
  };
  const count = keys.filter(k => values[k] != null).length;
  if (!count) return null; // Ignore e.g. a NOVA-only set with an unrelated basis.
  for (const k of keys) if (values[k] != null) values[k] = values[k] * 100 / size.amount;
  if (keys.some(k => values[k] > (k === 'kcal' ? 1000 : 100))) return null;
  return { values, unit:size.unit, count, source:s.source, index, per:s.per,
    serving:s.per === 'serving' ? size : null };
}
export function parseProduct(p) {
  const pack = productSize(p.product_quantity, p.product_quantity_unit);
  const declaredServing = productSize(p.serving_quantity, p.serving_quantity_unit);
  let sets = (Array.isArray(p.nutrition?.input_sets) ? p.nutrition.input_sets : []).map(normalizeSet).filter(Boolean);
  // A compatible explicit set is required; package units never convert nutrition.
  const compatible = sets.filter(s => s.unit === pack?.unit);
  if (compatible.length) sets = compatible;
  const units = new Set(sets.map(s => s.unit));
  const ambiguous = units.size > 1;
  sets.sort((a,b) => b.count - a.count || (a.per === 'serving') - (b.per === 'serving') || (a.source === 'manufacturer' ? -1 : 1) - (b.source === 'manufacturer' ? -1 : 1) || (a.per === 'serving') - (b.per === 'serving') || a.index - b.index);
  const chosen = ambiguous ? null : sets[0];
  const conflict = chosen && sets.some(s => s.unit === chosen.unit && (s.per === 'serving') === (chosen.per === 'serving') && keys.some(k => {
    const a = s.values[k], b = chosen.values[k];
    return a != null && b != null && Math.abs(a-b) > Math.max(k === 'kcal' ? 10 : 0.2, Math.max(a,b) * 0.15);
  }));
  const amountUnit = chosen?.unit || null;
  const serving = declaredServing || chosen?.serving || null;
  const sizeConflict = !!(pack && serving && pack.unit === serving.unit && serving.amount > pack.amount);
  const name = String(p.product_name_de || p.product_name || p.product_name_en || '').trim() || null;
  // Match stored nutrition precision so the amount preview equals its saved snapshot.
  const per100 = Object.fromEntries(keys.map(k => [k, chosen?.values[k] == null ? null : Math.round(chosen.values[k] * 10) / 10]));
  const usable = !!name && !!amountUnit && !conflict && per100.kcal != null && per100.protein != null;
  return {
    source:'OFF', id:String(p.code), name, brand:String(p.brands || '').split(',').map(s => s.trim()).find(Boolean) || null,
    quantity:p.quantity || null, basis:'per100', per100, amountUnit,
    packageSize:pack, servingSize:serving, sizeConflict, usable,
    productVersion:PRODUCT_VERSION, nutritionSource:chosen?.source || null,
    nutritionIssue:conflict ? 'conflicting' : ambiguous ? 'ambiguous' : !chosen ? 'missing' : !usable ? 'incomplete' : null,
  };
}
export function foodMetadata(food) {
  return Object.fromEntries(['amountUnit','quantity','packageSize','servingSize','sizeConflict','productVersion','nutritionSource']
    .filter(k => food[k] != null).map(k => [k,structuredClone(food[k])]));
}
export const amountUnit = food => food.amountUnit === 'ml' || food.millilitres != null ? 'ml' : 'g';
export const entryAmount = entry => amountUnit(entry) === 'ml' ? entry.millilitres : entry.grams;
export function amountOptions(food) {
  const u = amountUnit(food), valid = s => s?.unit === u && s.amount > 0;
  const pack = valid(food.packageSize) ? food.packageSize : null;
  const serving = valid(food.servingSize) ? food.servingSize : null;
  const conflict = food.sizeConflict || (pack && serving && serving.amount > pack.amount);
  const options = [];
  if (!conflict && serving && !(pack && pack.amount === serving.amount)) options.push({ id:'serving', label:'Serving', factor:serving.amount });
  if (!conflict && pack) options.push({ id:'package', label:'Package', factor:pack.amount });
  options.push({ id:'manual', label:u === 'ml' ? 'Millilitres' : 'Grams', factor:1 });
  return options;
}
export function initialAmount(food, editing = null) {
  const u = amountUnit(food), options = amountOptions(food);
  const previous = editing ? entryAmount(editing) : u === 'ml' ? food.lastMillilitres : food.lastGrams;
  const rememberedUnit = food.lastAmountUnit || u;
  const validPrevious = (editing || rememberedUnit === u) && Number.isFinite(previous) && previous > 0 && previous <= 5000;
  const serving = options.find(o => o.id === 'serving') || (food.servingSize?.unit === u && !food.sizeConflict && food.servingSize?.amount === food.packageSize?.amount ? options.find(o => o.id === 'package') : null);
  const selected = serving && serving.factor <= 5000 ? serving : options.at(-1);
  return { total:validPrevious ? previous : selected.id === 'manual' ? 100 : selected.factor,
    mode:validPrevious ? 'manual' : selected.id };
}
export function cachedDetail(record, { stale = false, now = Date.now() } = {}) {
  if (!record || !Number.isFinite(record.at) || (record.product !== null && record.product?.productVersion !== PRODUCT_VERSION)) return undefined;
  const ttl = record.product === null ? MISS_TTL : PRODUCT_TTL;
  if (now - record.at > ttl && !(stale && record.product !== null)) return undefined;
  return structuredClone(record.product);
}
export class ProductError extends Error {
  constructor(message, kind = 'unavailable') { super(message); this.kind = kind; }
}
const pending = new Map();
export async function fetchProduct(code, { base = '', fetchFn = fetch } = {}) {
  if (!/^\d{8,14}$/.test(code)) throw new ProductError('That barcode is not valid.', 'invalid');
  const key = `${base}:${code}`;
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    let response;
    try { response = await fetchFn(`${base}/api/off-product?code=${encodeURIComponent(code)}`, { signal:AbortSignal.timeout(15000) }); }
    catch (error) { if (error.kind) throw error; throw new ProductError('Product details couldn’t load. Check your connection and try again.'); }
    let body;
    try { body = await response.json(); } catch { throw new ProductError('Product details are temporarily unavailable. Try again.'); }
    if (response.status === 429 || body.kind === 'throttled') throw new ProductError('Product lookups are busy. Wait a moment, then try again.', 'throttled');
    if (body.result?.id === 'product_not_found' && (response.status === 404 || response.ok)) return null;
    if (!response.ok || !['success','success_with_warnings'].includes(body.status) || body.result?.id !== 'product_found' || !body.product) {
      throw new ProductError('Product details couldn’t load. Try again or enter the label values.');
    }
    const product = parseProduct(body.product);
    if (product.id !== code) throw new ProductError('This barcode resolved to a different product. Enter the label values to continue.', 'invalid');
    return product;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
