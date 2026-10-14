// Eatabase: food search over two sources, kept DOM-free so it runs in
// the browser and under Node (battery.mjs) alike.
//   BLS 4.0     generic foods, local file (bls-foods.json), per 100 g
//   Open Food Facts  packaged products, via the authenticated /api relay

/** Lowercase, fold umlauts both ways ("Hähnchen" = "Haehnchen" = "hahnchen"). */
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä|ae/g, 'a').replace(/ö|oe/g, 'o').replace(/ü|ue/g, 'u').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Same, with everything but letters/digits removed — "Hafer Flocken" matches "haferflocken". */
function compact(s) {
  return normalize(s).replace(/[^a-z0-9]/g, '');
}

function tokens(q) {
  return normalize(q).replace(/(\d)[.,](\d)/g, '$1$2').split(/[^a-z0-9]+/).filter(Boolean);
}

// ---- Generic foods (BLS) ---------------------------------------------------
//
// Every BLS food has a German and an English name; a query is scored against
// both and the better one counts, so either language works without a toggle.
// The core idea is the *head noun* — the word naming what the food actually is:
//   German: the end of a compound ("Hühnerei" is an egg, "Eiswein" is wine),
//           and a word followed by another capitalised noun is a modifier
//           ("Reis Mehl" is flour, "Hühnerei Eigelb" is yolk).
//   English: the word before the descriptors ("Chicken egg raw" is an egg,
//           "Egg pasta raw" is pasta, "Rice flour" is flour).

// Words that describe a food rather than name it; what precedes them is the head.
const EN_DESCRIPTORS = new Set(('raw boiled cooked fried baked steamed dried roasted grilled stewed braised ' +
  'poached canned frozen deep fresh smoked salted unsalted sweetened unsweetened whole without with in ' +
  'from and or of pasteurised pasteurized ultra heated low fat full skimmed semi plain natural peeled ' +
  'unpeeled drained pickled marinated min max mild light reduced instant chilled sliced preparation white brown red green yellow black dark sweet dry medium').split(' '));

// Words after which the rest of a name segment describes something else
// ("Wheat roll with quark" is a roll, "Joghurt aus entrahmter Milch" is yogurt).
const CONNECTORS = {
  en: new Set('with from in without filled made and of for on containing'.split(' ')),
  de: new Set('mit aus in im ohne und für fur gefüllt gefullt auf vom zum'.split(' ')),
};

// Everyday words that don't match BLS wording at all. Kept tiny on purpose:
// only cases the head-noun rules can't reach.
const ALIASES = {
  oats: 'oat flakes', oatmeal: 'oat flakes', porridge: 'oat flakes', 'porridge oats': 'oat flakes',
  'rolled oats': 'oat flakes', 'ground beef': 'beef mince', 'minced beef': 'beef mince', mince: 'beef mince',
  yoghurt: 'yogurt', eier: 'ei', nudeln: 'teigwaren', spaghetti: 'teigwaren', penne: 'teigwaren',
  noodles: 'pasta', brokkoli: 'broccoli', rinderhack: 'rind hackfleisch', rinderhackfleisch: 'rind hackfleisch',
  'oat milk': 'oat drink', hafermilch: 'haferdrink', 'almond milk': 'almond drink', mandelmilch: 'mandeldrink',
  'soy milk': 'soy drink', sojamilch: 'sojadrink', cola: 'colagetränk', fries: 'pommes frites',
  'french fries': 'pommes frites', 'käse': 'cheese', kase: 'cheese', kaese: 'cheese',
};

// Everyday staples — BLS has no "how common is this" signal, so on a tie
// "butter" would pick pear butter and "ei" tench (Schl-ei-e). These get a
// boost; the head-noun rules still decide everything else. BLS codes.
const STAPLES = new Set([
  'E111100', 'E111132',                       // hen's egg raw / boiled
  'C352000', 'C352032', 'C351000', 'C351032', // white / brown rice raw, boiled
  'K110100', 'K110132', 'K120134',            // potato
  'E401000', 'E401032',                       // pasta
  'C133000',                                  // oat flakes
  'B311000', 'B271000', 'B121000', 'B511000', // white, rye-wheat, wholemeal rye bread, wheat roll
  'M111200', 'M111300', 'M113200', 'M113300', // milk 1.5 / 3.5, fresh + UHT
  'M141300', 'M141200', 'M713100', 'M710100', // yogurt 3.5 / 1.5, low-fat quark, skyr
  'M710800', 'M711100', 'M402600', 'M304600', 'M032100', // cream cheese, cottage, gouda, emmentaler, mozzarella
  'Q611000', 'Q6A4000', 'Q120000', 'Q180000', 'M173900', // butter, olive oil, rapeseed oil, cream
  'S111000', 'S120000', 'H880200',            // sugar, honey, peanut butter
  'V4A6100', 'V416100', 'V486100', 'U010100', 'U020100', // chicken/turkey breast, beef/pork mince
  'T410100', 'T121902',                       // salmon, canned tuna
  'F110100', 'F503100', 'F603100', 'F301100', 'F502100', // apple, banana, orange, strawberry, avocado
  'G561100', 'G520100', 'G312100', 'G480100', 'G620100', 'G211100', 'G543100', // vegetables
  'H210100', 'H120100', 'G770432',            // almond, walnut, chickpeas boiled
  'N410100', 'P163000', 'C660000', 'N128000', // coffee, pilsner, oat drink, still water
  'P210000', 'P2A3000', 'B314000',            // white / red wine dry, toast bread
]);

/** Crude per-language stemming, applied to query and food words alike. */
function stem(w, lang) {
  if (lang === 'en') {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }
  if (w.length >= 5) return w.replace(/(en|n|e)$/, '');
  return w;
}

/** One language's name → words with head/modifier flags, by segment (commas/brackets split segments). */
function analyseName(name, lang) {
  const out = [];
  String(name).split(/,\s|[(/)]/).forEach((segment, seg) => {
    const raw = segment.trim().split(/\s+/).filter(Boolean);
    let sub = false;   // past a connector: the rest describes something else
    raw.forEach((orig, i) => {
      const w = normalize(orig).replace(/[^a-z0-9]/g, '');
      if (!w) return;
      if (i > 0 && CONNECTORS[lang].has(orig.toLowerCase())) sub = true;
      const next = raw[i + 1];
      let head;
      if (!next || /^[\d<>%.,]/.test(next)) head = true;
      else if (lang === 'de') head = !/^[A-ZÄÖÜ]/.test(next);   // next word lowercase → no compound continues
      else {
        const n = normalize(next).replace(/[^a-z]/g, '');
        head = EN_DESCRIPTORS.has(n) || n.endsWith('free');   // "Pasta egg-free"
      }
      out.push({ w: stem(w, lang), r: w, seg, head, sub, first: seg === 0 && i === 0 });
      // BLS often splits German compounds ("Hafer Flocken", "Rind Hackfleisch"):
      // the joined pair counts as one word, carrying the second word's role.
      if (lang === 'de' && next && /^[A-ZÄÖÜ]/.test(next)) {
        const nextNext = raw[i + 2];
        const pairHead = !nextNext || /^[\d<>%.,]/.test(nextNext) || !/^[A-ZÄÖÜ]/.test(nextNext);
        const joined = w + normalize(next).replace(/[^a-z0-9]/g, '');
        out.push({ w: stem(joined, lang), r: joined, seg, head: pairHead, sub });
      }
    });
  });
  return out;
}

/** BLS rows → objects, with search keys precomputed once. */
export function prepareBls(json) {
  const f = json.fields;
  const foods = json.rows.map(r => {
    const o = Object.fromEntries(f.map((k, i) => [k, r[i]]));
    o.source = 'BLS';
    o.de = { words: analyseName(o.name_de, 'de'), compact: compact(o.name_de), len: o.name_de.length };
    o.en = { words: analyseName(o.name_en, 'en'), compact: compact(o.name_en), len: o.name_en.length };
    // BLS codes starting X/Y are composed dishes/recipes; everything else is a basic food.
    o.dish = /^[XY]/.test(o.code);
    o.family = o.code.slice(0, 4);
    return o;
  });
  // How many forms the MRI documents of a food (raw, boiled, fried, poached…)
  // is the only "how common is this" signal BLS has: hen's egg has 7, goose egg 2.
  // The first 4 code characters identify the food; the rest is its preparation.
  const sizes = {};
  for (const o of foods) sizes[o.family] = (sizes[o.family] || 0) + 1;
  for (const o of foods) o.familySize = sizes[o.family];
  // Whole-word vocabularies per language, to tell English query words from German ones.
  foods.vocab = { de: new Set(), en: new Set() };
  for (const o of foods) for (const l of ['de', 'en']) for (const x of o[l].words) foods.vocab[l].add(x.w);
  return foods;
}

/** The part before a compound's head must look like a word itself: "Schwein" isn't "sch" + "Wein". */
function isCompoundStart(prefix, word) {
  return prefix.length >= 3 && /[aeiouy]/.test(prefix) && !FALSE_COMPOUNDS.has(word)
    // "-frei" means "free of": "eifrei" (egg-free) mustn't count as an egg
    && !(word.endsWith('frei') && 'frei'.endsWith(word.slice(prefix.length)));
}
// Compounds that aren't what their last part says: Fleischkäse/Leberkäse are meat loaf.
const FALSE_COMPOUNDS = new Set(['fleischkase', 'leberkase']);

/** How well one query token matches a name: head word > compound end > modifier > prefix. */
function tokenScore(words, t, lang, foreign) {
  let best = 0;
  for (const { w: stemmed, r, seg, head, sub, first } of words) {
    // Whole-word: stemmed or original form ("tomaten" = "tomate").
    // Compound end: original form only — stemming "Rotwein" to "rotwei"
    // must not make it end in "ei".
    let s = 0;
    if (stemmed === t || r === t) s = head ? 100 : 45;
    else if (foreign) s = 0;    // a word from the other language only counts as a whole word
    else if (lang === 'de' && t.length >= 2 && r.endsWith(t) && isCompoundStart(r.slice(0, -t.length), r)) s = head ? 85 : 35;
    else if (stemmed.startsWith(t) || r.startsWith(t)) s = head ? 40 : 30;
    else if (t.length >= 3 && r.includes(t)) s = 10;
    if (seg > 0 || sub) s *= 0.4;                  // matched only in a later part ("…, with rice")
    else if (first && head && s >= 85) s += 15;    // the name starts with it: "Butter salted" over "Peanut butter"
    best = Math.max(best, s);
  }
  return best;
}

function scoreFood(f, rawTokens, lang, vocab) {
  const L = f[lang];
  const other = lang === 'de' ? 'en' : 'de';
  const ts = rawTokens.map(t => stem(t, lang));
  if (!ts.every(t => L.compact.includes(t))) return null;
  let score = 0, min = Infinity, max = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    // "beer" is a whole English word and no German one, so it mustn't match "Erdbeere".
    const foreign = vocab[other].has(stem(rawTokens[i], other)) && !vocab[lang].has(t);
    const s = tokenScore(L.words, t, lang, foreign);
    if (s === 0) return null;
    score += s;
    min = Math.min(min, s);
    max = Math.max(max, s);
  }
  score /= ts.length;
  // How well the words matched, before any boosts. Strong needs one word to
  // name the food ("breast" in "Chicken breast") and none to be a stretch.
  const match = { strong: max >= 85 && min >= 40, real: min >= 40 };
  if (f.dish) score -= 40;
  if (STAPLES.has(f.code) && score >= 40) score += 30;   // only boosts a real match
  if (f.de.words.some(x => x.w === 'roh')) score += 12;
  else if (f.de.words.some(x => x.w === 'gekocht')) score += 6;
  score += 6 * Math.log(f.familySize);
  score -= L.len * 0.35;
  return { score, match };
}

/**
 * Search generic foods in German or English. Every query word must appear in
 * the name (spaces ignored, so "haferflocken" finds "Hafer Flocken").
 */
export function searchBls(foods, q, limit = 10) {
  const base = tokens(q);
  if (!base.length) return [];
  const queries = [base];
  const alias = ALIASES[base.join(' ')];
  if (alias) queries.push(tokens(alias));
  const hits = [];
  for (const f of foods) {
    let best = null, lang = null, match = null;
    for (const [qi, qt] of queries.entries()) {
      for (const l of ['de', 'en']) {
        const r = scoreFood(f, qt, l, foods.vocab);
        if (!r) continue;
        let s = r.score;
        if (qi > 0) s += 40;   // an alias means: you most likely meant this
        if (best == null || s > best) { best = s; lang = l; match = qi > 0 ? { strong: true, real: true } : r.match; }
      }
    }
    if (best != null) hits.push({ f, score: best, lang, match });
  }
  hits.sort((a, b) => b.score - a.score);
  // strong: the query names the food itself ("egg" in "Chicken egg raw");
  // okay: a real word match; weak: only inside a word or a side remark.
  return hits.slice(0, limit).map(h =>
    toResult(h.f, h.lang, h.match.strong && !h.f.dish ? 'strong' : h.match.real ? 'okay' : 'weak'));
}

function toResult(f, lang, strength) {
  return {
    // name_en: BLS spells "Potatoe" throughout; fixed for display only.
    source: 'BLS', id: f.code, name: f.name_en.replace(/\bPotatoe\b/g, 'Potato'),
    nameDe: f.name_de, matchedIn: lang, brand: null, quantity: null, strength,
    kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat,
    usable: f.kcal != null && f.protein != null,
  };
}

// ---- Packaged products (Open Food Facts) -----------------------------------

function num(v) {
  if (typeof v === 'string' && !v.trim()) return null;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null;
}

/** One Open Food Facts product (search hit or barcode lookup) → the shared result shape. */
export function parseOffProduct(p) {
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal == null && num(n['energy-kj_100g']) != null) kcal = Math.round(num(n['energy-kj_100g']) / 4.184);
  const brands = Array.isArray(p.brands) ? p.brands : String(p.brands || '').split(',');
  const r = {
    source: 'OFF', id: p.code,
    name: (p.product_name_de || p.product_name || '').trim() || null,
    brand: brands.map(s => s.trim()).filter(Boolean)[0] || null,
    allBrands: brands.join(' '),
    quantity: p.quantity || null,
    kcal, protein: num(n.proteins_100g), carbs: num(n.carbohydrates_100g), fat: num(n.fat_100g),
    scans: p.unique_scans_n || 0,
  };
  r.usable = !!r.name && r.kcal != null && r.protein != null;
  r.check = plausibility(r.kcal, r.protein, r.carbs, r.fat, num(n.fiber_100g), num(n.alcohol_100g));
  return r;
}

/**
 * Do the label's calories match its macros? Energy = 4·protein + 4·carbs
 * + 9·fat (+ 2·fibre, + 7·alcohol), the EU label formula. `off` is how far
 * apart the two are on a log scale: 0 = identical, 0.69 = a factor of 2.
 * Up to ~0.2 is normal (rounding, sugar alcohols in protein bars count
 * 2.4 kcal/g, not 4); beyond that someone most likely typed a number wrong.
 * The +5 keeps near-zero foods (water, diet cola) from looking wildly off.
 */
export function plausibility(kcal, protein, carbs, fat, fiber, alcohol) {
  if (kcal == null || protein == null || carbs == null || fat == null) return { known: false, off: 0, flag: false };
  const expected = 4 * protein + 4 * carbs + 9 * fat + 2 * (fiber || 0) + 7 * (alcohol || 0);
  const off = Math.abs(Math.log((kcal + 5) / (expected + 5)));
  return { known: true, expected: Math.round(expected), off: Math.round(off * 100) / 100, flag: off > 0.35 };
}

/**
 * Re-rank of OFF hits. OFF's search matches *any* typed word, so
 * "milbona skyr" returns every Milbona product and every skyr. Order:
 * products matching every word (in name or brand) first, products missing
 * a name/kcal/protein last; within that, OFF's own order, nudged by
 * popularity (scans = people who bought and checked it).
 */
export function rerankOff(results, q, brand = null) {
  const qt = tokens(q);
  return results
    .map((r, i) => {
      const hay = compact(`${r.name || ''} ${r.allBrands || ''}`);
      const all = qt.every(t => hay.includes(t));
      const ofBrand = !!brand && compact(r.allBrands || '').includes(compact(brand));
      // strong: every word matches, sane numbers, and a brand you named or a well-known product
      r.strength = !all || !r.usable || r.check.flag ? 'weak'
        : (ofBrand || r.scans >= 10) ? 'strong' : 'okay';
      // From a 20% mismatch up, sink steadily: 320 kcal labelled vs 73 from
      // the macros (off ≈ 1.4) drops ~700 places, i.e. below every sane result.
      const nonsense = Math.min(Math.max(0, r.check.off - 0.2) * 600, 900);
      return { r, s: (all ? 0 : 500) + (r.usable ? 0 : 1000) + nonsense + i - Math.log10(1 + r.scans) * 2 };
    })
    .sort((a, b) => a.s - b.s)
    .map(x => x.r);
}

/**
 * A brand the user typed: among the hits' brands, one whose every word is
 * in the query ("milbona skyr" → "Milbona", "gut günstig quark" →
 * "Gut & Günstig"), leaving at least one other word to search for.
 * The most frequent such brand wins. Returns its spelling as on the products.
 */
function typedBrand(results, qt) {
  const counts = new Map();
  for (const r of results) {
    for (const b of (r.allBrands || '').split(/,\s*|\s{2,}/).map(x => x.trim()).filter(Boolean)) {
      const bt = tokens(b);
      if (bt.length && bt.length < qt.length && bt.every(t => qt.includes(t))) counts.set(b, (counts.get(b) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Search OFF through the food relay. `base` is '' in the browser, the server URL under Node.
 * OFF matches any single word, so when the query contains a brand the
 * products of that brand can drown in "every Milbona product" + "every skyr".
 * If the first answer shows a brand was typed, a second request filters by
 * that brand, and its hits go first.
 */
export async function searchOff(q, { base = '', limit = 10, fetchFn = fetch } = {}) {
  const t0 = Date.now();
  const n = Math.max(limit * 5, 50);
  const get = async (query, brand) => {
    const url = `${base}/api/off-search?q=${encodeURIComponent(query)}&n=${n}` + (brand ? `&brand=${encodeURIComponent(brand)}` : '');
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`OFF search ${res.status}`);
    return res.json();
  };
  const body = await get(q);
  let results = (body.hits || []).map(parseOffProduct);
  const qt = tokens(q);
  const brand = qt.length >= 2 ? typedBrand(results, qt) : null;
  if (brand) {
    const brandWords = tokens(brand);
    const rest = qt.filter(t => !brandWords.includes(t)).join(' ');
    const branded = ((await get(rest, brand)).hits || []).map(parseOffProduct);
    const seen = new Set(branded.map(r => r.id));
    results = branded.concat(results.filter(r => !seen.has(r.id)));
  }
  return { results, total: body.count ?? null, brand, ms: Date.now() - t0 };
}

export async function lookupBarcode(code, { base = '', fetchFn = fetch } = {}) {
  const res = await fetchFn(`${base}/api/off-product?code=${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error(`OFF product ${res.status}`);
  const body = await res.json();
  return body.status === 1 && body.product ? parseOffProduct({ ...body.product, code }) : null;
}

// ---- Your own foods ----------------

/**
 * Your foods matching the query: every word in the name/brand, ranked by how
 * often and how recently you logged them. `uses` = times logged,
 * `daysAgo` = last time. A food logged 20× a week ago beats one logged once today.
 */
export function searchMine(mine, q, limit = 3) {
  const qt = tokens(q);
  if (!qt.length) return [];
  return mine
    .filter(m => {
      const words = normalize(`${m.name} ${m.nameDe || ''} ${m.brand || ''}`).split(/[^a-z0-9]+/).filter(Boolean);
      // each typed word starts a word, or ends one ("ei" → Hühnerei), but "ei" isn't in "Protein"
      return qt.every(t => {
        const forms = [t, stem(t, 'en'), stem(t, 'de')];   // "eggs" finds "egg", "kartoffeln" "Kartoffel"
        return words.some(w => forms.some(f => w.startsWith(f) || (f.length >= 2 && w.endsWith(f))));
      });
    })
    .map(m => ({ m, s: Math.log(1 + m.uses) * 10 - m.daysAgo * 0.5 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => ({ ...x.m, source: 'MINE', strength: 'strong', usable: true }));
}

// ---- One merged list ---------------------------------------------------------

/**
 * Merge your foods, generic foods and products into one list.
 *   1. your matching foods (they already are what you eat)
 *   2. the lead: named a brand → its products; else a strong generic match →
 *      the top 2 generic foods, then strong products; else strong products lead
 *   3. the rest by strength (okay before weak), never more than 3 rows in a
 *      row from one source, so neither side buries the other
 * `pinned`: rows already on screen from the instant local pass; they keep
 * their place, so nothing jumps under your thumb when products arrive.
 */
export function mergeResults({ mine = [], bls = [], off = [], brand = null, pinned = [], limit = 15 }) {
  const out = [];
  const seen = new Set();
  const key = r => `${r.source}:${r.ref ?? ''}:${r.id}`;
  const push = r => { if (r && !seen.has(key(r)) && out.length < limit) { seen.add(key(r)); out.push(r); } };
  // your foods hide their own source row ("OFF:123" logged as yours shows once, as yours)
  for (const m of mine) seen.add(`${m.ref}::${m.id}`);

  for (const r of pinned) push(r);
  for (const r of mine) push(r);

  const strongBls = bls.filter(r => r.strength === 'strong');
  const strongOff = off.filter(r => r.strength === 'strong');
  if (brand) { strongOff.forEach(push); strongBls.slice(0, 2).forEach(push); }
  else if (strongBls.length) { strongBls.slice(0, 2).forEach(push); strongOff.slice(0, 3).forEach(push); }
  else strongOff.slice(0, 3).forEach(push);

  for (const level of [['strong', 'okay'], ['weak']]) {
    const a = bls.filter(r => level.includes(r.strength) && !seen.has(key(r)));
    const b = off.filter(r => level.includes(r.strength) && !seen.has(key(r)));
    let turn = brand || !strongBls.length ? b : a, other = turn === a ? b : a, run = 0;
    while (a.length || b.length) {
      if (!turn.length || run === 3) { [turn, other] = [other, turn]; run = 0; if (!turn.length) continue; }
      push(turn.shift()); run++;
    }
  }
  return out;
}
