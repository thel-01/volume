import { $, BACK_ICON, escapeHtml, valueMax, number, status, loading, field, fieldError, readNumber, toast, arm, setActionRunner } from './ui.js';
import {
  NUTRIENTS, MEALS, trackedNutrients, dayTotals, goalStatus, defaultMeal, groupByMeal,
  localDay, shiftDay, rememberedFoods, makeEntry, withAmount, quickValues,
  scaleValues, multiplyValues, fmt,
} from './nutrition.js';
import * as store from './store.js';
import { createScanner } from './scanner.js';
import { openQuicklog as showQuicklog, closeQuicklog } from './quicklog.js';
import { API_BASE } from './config.js';
import { foodFetch } from './food-fetch.js';
import { fetchProduct, amountUnit, entryAmount, amountOptions, initialAmount, PRODUCT_VERSION } from './food-product.js';
import { prepareBls, searchBls, searchOff, rerankOff, searchMine, mergeResults, plausibility } from './food-search.js';

const requestedDay = new URLSearchParams(location.search).get('day');
const validPastDay = /^\d{4}-\d{2}-\d{2}$/.test(requestedDay || '') && !Number.isNaN(new Date(`${requestedDay}T12:00:00`).getTime()) && localDay(new Date(`${requestedDay}T12:00:00`)) === requestedDay && requestedDay < localDay();
const pastDay = !!validPastDay;
let pastEditing = false, explicitDay = pastDay, addToday = false;
let observedToday = localDay();
let day = pastDay ? requestedDay : localDay(), settings, entries = [], remembered = [], ownFoods = [];
let view = 'day', tab = 'search', step = null, returnStep = null, currentFood = null, editing = null;
let amountState = null;
let selectedMeal = null, portions = 1, searchQuery = '', searchRows = [], searchVersion = 0, searchTimer;
let bls = null, blsError = false, blsPromise, cameraPending, cameraRun = 0;
let cameraMessage = '', scanCode = null, lookupVersion = 0, loadVersion = 0, writeBlocked = false;
let dayScroll = 0, infoFocus = null;
const productCache = new Map(), productPending = new Map();
try { const saved = localStorage.getItem('eatabase-last-add-tab'); if (['search', 'scan'].includes(saved)) tab = saved; } catch { /* Report on the next attempt to remember the tab. */ }

// Normal day navigation logs today; History explicitly selects older days.
// One exception: between midnight and 5:00 the previous day is still reachable
// (home after a night out, or adding things to the day you're ending).
const LATE_NIGHT_END_HOUR = 5;
const isLateNight = () => new Date().getHours() < LATE_NIGHT_END_HOUR;


// Full-string parsing: no partial numbers, units, exponents, or non-finite values.
function readNutrients(prefix, { required = [], per100 = false, showErrors = true } = {}) {
  const values = {}; let valid = true;
  for (const n of NUTRIENTS) {
    const input = $(`${prefix}-${n.key}`);
    const r = number(input?.value ?? '', { required: required.includes(n.key), max: per100 ? (n.key === 'kcal' ? 1000 : 100) : valueMax[n.key] });
    if (r.error) valid = false;
    if (input && showErrors) fieldError(input.id, r.error);
    values[n.key] = r.value ?? null;
  }
  return { values, valid };
}
function messageFor(error) {
  return error?.message === 'You already have a product with this barcode.' ? 'You already have a product with this barcode.'
    : error?.message?.includes('no longer exists') ? 'This item no longer exists. Reopen your day.'
      : writeBlocked ? "Couldn't save on this phone. Reload before trying again." : 'Something went wrong. Please try again.';
}
async function mutate(fn) {
  // The mock store changes memory before saving. Do not retry an unpersisted mutation.
  if (writeBlocked) throw new Error('Reload before saving again.');
  try { return await fn(); }
  catch (error) {
    if (error?.message?.includes("Couldn't save on this phone")) {
      writeBlocked = true;
      status('day-status', "Couldn't save on this phone. Reload to return to your saved data.", 'error');
      $('day-title').disabled = true;
      toast("Couldn't save on this phone. Reload to return to your saved data.", null, true, 'error');
      const el = $('toast-layer').lastElementChild;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-action'; b.textContent = 'Reload'; b.onclick = () => location.reload(); el.querySelector('.toast-body').append(b);
    }
    throw error;
  }
}
async function run(button, fn, statusId = 'sheet-status') {
  if (button.disabled) return;
  const old = button.textContent; button.disabled = true; button.textContent = 'Saving…'; status(statusId);
  try { await fn(); }
  catch (error) { status(statusId, messageFor(error), 'error'); toast(messageFor(error), null, false, 'error'); }
  finally { if (button.isConnected) { button.disabled = writeBlocked; button.textContent = old; } }
}
function showView(next) {
  view = next; $('day-view').hidden = next !== 'day';
  $('add-view').classList.toggle('inactive', next !== 'add'); $('add-view').setAttribute('aria-hidden', String(next !== 'add')); $('add-view').inert = next !== 'add';
  $('bottom-actions').hidden = false; window.scrollTo(0, next === 'day' ? dayScroll : 0);
}
function bottom(label, fn, { disabled = false, id = '' } = {}) {
  const b = document.createElement('button'); b.type = 'button'; if (id) b.id = id; b.textContent = label; b.disabled = disabled || writeBlocked; b.onclick = fn; $('bottom-actions').replaceChildren(b); $('bottom-actions').hidden = false;
}
// Day footer: Add food (primary) and Quick (secondary) side by side.
function dayAction() {
  if (pastDay && !pastEditing) { bottom('Edit', () => { pastEditing = true; renderDay(); dayAction(); }); $('bottom-actions').firstElementChild.className = 'secondary'; return; }
  const row = document.createElement('div'); row.className = 'day-actions';
  for (const [id, label, cls, fn] of [['add-food', 'Add food', '', () => openAdd()], ['quick-log', 'Quick', 'secondary', () => openQuicklog()]]) {
    const b = document.createElement('button'); b.type = 'button'; b.id = id; b.textContent = label; if (cls) b.className = cls; b.disabled = !settings || writeBlocked; b.onclick = fn; row.append(b);
  }
  $('bottom-actions').replaceChildren(row); $('bottom-actions').hidden = false;
}
function titleForDay(d = day) {
  if (pastDay) return new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  if (d === localDay()) return 'Today'; if (d === shiftDay(localDay(), -1)) return 'Yesterday';
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}
async function loadDay() {
  if (writeBlocked) { status('day-status', "Couldn't save on this phone. Reload to return to your saved data.", 'error'); if (view === 'day') dayAction(); return; }
  if (!explicitDay) day = localDay();
  observedToday = localDay();
  const version = ++loadVersion, requestedDay = day; $('day-title').textContent = titleForDay();
  // Late night (0:00–5:00) only: the title switches between today and yesterday.
  // A small caret marks it as tappable; the rest of the day it's plain text.
  const canSwitch = !pastDay && isLateNight();
  if (canSwitch) $('day-title').insertAdjacentHTML('beforeend', '<svg class="day-switch-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9 L12 15 L18 9"/></svg>');
  $('day-title').setAttribute('aria-label', canSwitch ? (day === localDay() ? 'Today. Switch to yesterday' : 'Yesterday. Back to today') : titleForDay());
  $('day-navigation').classList.toggle('past-day', pastDay);
  // A day from History is finished, not in progress: no live amber on it (green 'on target' stays).
  $('summary').classList.toggle('finished', pastDay);
  $('day-title').disabled = !canSwitch;
  loading('day-status'); $('summary').hidden = true; $('entries').hidden = true;
  try {
    const data = await Promise.all([store.getSettings(), store.listEntries(requestedDay), store.recentEntries(), store.listFoods()]);
    if (version !== loadVersion) return;
    [settings, entries, , ownFoods] = data; remembered = rememberedFoods(data[2], ownFoods);
    status('day-status'); renderDay(); if (view === 'day') dayAction();
  } catch { if (version === loadVersion) status('day-status', "Couldn't load your day.", 'error', loadDay); }
}
function statusFor(n, total) {
  const g = settings.nutrients[n.key];
  return goalStatus(n.key, total.value, g.goal, g.type);
}
function nutrientSummary(n, total, hero = false) {
  const g = settings.nutrients[n.key], goal = g.goal, p = statusFor(n, total);
  // Nothing known at all → "—" ("≥ 0 g" says nothing); some gaps → "≥ total".
  const value = total.missing && total.missing === total.count ? '—' : `${total.missing ? '≥ ' : ''}${fmt(n.key, total.value)}`;
  const info = total.missing ? `<button type="button" class="info-btn" data-info="${n.key}" aria-label="About missing ${n.label.toLowerCase()} values">?</button>` : '';
  // No ≥/≤ symbol here: "≥" already means "at least, some values unknown" on the total.
  const goalText = goal ? fmt(n.key, goal) : '';
  const cls = `stat-value${hero ? ' lg' : ''}${p?.hit ? ' is-hit' : ''}`;
  // Past the goal reads "over" for a target or limit; past a minimum is just more ("above").
  const side = p ? (p.left > 0 ? `${fmt(n.key, p.left)} left` : p.left < 0 ? `${fmt(n.key, -p.left)} ${g.type === 'min' ? 'above' : 'over'}` : 'Right on it') : '';
  return `<div><div class="stat-label">${n.label}${hero ? '' : info}</div><div class="nutrient-value"><span class="${cls}">${hero ? value : `<span class="summary-total">${value}</span>`}${!hero && goal ? `<span class="goal"> / ${goalText}</span>` : ''}<span class="unit">${hero && goal ? `/ ${goalText} ` : ''}${hero ? '' : ' '}${n.unit}</span></span>${hero ? info : ''}</div></div>${hero && p ? `<span class="muted">${side}</span>` : ''}`;
}
/**
 * The goal bar. Up to the goal it fills normally; past it (target/limit
 * only) the bar rescales so the goal sits at a tick and the overshoot
 * continues striped in the same color — visible, never red.
 */
function progressBar(n, total) {
  const g = settings.nutrients[n.key], p = statusFor(n, total);
  if (!p) return '';
  const state = p.hit ? ' is-hit' : '';
  const aria = `role="progressbar" aria-label="${n.label} goal" aria-valuemin="0" aria-valuemax="${g.goal}" aria-valuenow="${Math.round(total.value)}"`;
  if (total.value > g.goal && g.type !== 'min') {
    const at = (g.goal / total.value) * 100;
    return `<div class="progress-track over${state}" ${aria}><div class="progress-fill" style="width:${at}%"></div><div class="progress-over" style="left:${at}%"></div></div>`;
  }
  return `<div class="progress-track${state}" ${aria}><div class="progress-fill" style="width:${p.share * 100}%"></div></div>`;
}
function entryMeta(e) {
  if (e.basis === 'once') return ''; if (e.basis === 'portion') return `${e.portions} portion${e.portions === 1 ? '' : 's'}`;
  return `${entryAmount(e)} ${amountUnit(e)}${e.brand ? ` · ${e.brand}` : ''}`;
}
function foodValues(food) { return food.basis === 'portion' ? food.portion : food.per100 || food; }
function foodSource(food) { return food.source === 'MINE' ? food.ref : food.source; }
function foodMeta(food) {
  if (food.basis === 'portion') return 'Saved meal · per portion';
  if (foodSource(food) === 'BLS') return '';
  return [food.brand, food.quantity].filter(Boolean).join(' · ') || (foodSource(food) === 'OFF' ? 'Packaged product' : 'Your product');
}
function listRow(name, meta, right = '', extra = '') {
  return `<div class="list-item-body"><div class="list-item-name">${escapeHtml(name || 'Unnamed product')}</div><div class="list-item-meta"><span class="truncate">${escapeHtml(meta)}</span>${extra}</div></div>${right ? `<span class="entry-value">${right}</span>` : ''}`;
}
function entryList(rows) {
  const ul = document.createElement('ul'); ul.className = 'list'; const hero = trackedNutrients(settings)[0];
  for (const e of rows) {
    const li = document.createElement('li'); li.className = 'list-item';
    li.innerHTML = listRow(e.name, entryMeta(e), `${fmt(hero.key, e.values[hero.key])}${e.values[hero.key] == null ? '' : ` ${hero.unit}`}`);
    if (!pastDay || pastEditing) {
      li.tabIndex = 0; li.setAttribute('role', 'button'); li.onclick = () => openEdit(e);
      li.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEdit(e); } };
    } else li.classList.add('read-only');
    ul.append(li);
  }
  return ul;
}
function renderDay() {
  const tracked = trackedNutrients(settings), totals = dayTotals(entries), hero = tracked[0];
  $('summary').innerHTML = `<div class="summary-hero">${nutrientSummary(hero, totals[hero.key], true)}</div>${progressBar(hero, totals[hero.key])}${tracked.length > 1 ? `<div class="summary-columns" style="grid-template-columns:repeat(${tracked.length - 1},minmax(0,1fr))">${tracked.slice(1).map(n => `<div>${nutrientSummary(n, totals[n.key])}${progressBar(n, totals[n.key])}</div>`).join('')}</div>` : ''}`;
  // Every goal on the card met → the whole card turns green.
  const goals = tracked.map(n => statusFor(n, totals[n.key])).filter(Boolean);
  $('summary').classList.toggle('all-hit', goals.length > 0 && goals.every(p => p.hit));
  $('summary').hidden = false; $('entries').hidden = false; $('entries').replaceChildren();
  if (!entries.length) $('entries').innerHTML = '<p class="empty-state">Nothing logged yet.</p>';
  else if (settings.meals) for (const group of groupByMeal(entries)) {
    const t = dayTotals(group.entries)[hero.key], label = document.createElement('p'); label.className = 'section-label has-readout';
    label.innerHTML = `<span>${group.label}</span><span class="scrub-readout">${t.missing && t.missing === t.count ? '—' : `${t.missing ? '≥ ' : ''}${fmt(hero.key, t.value)} ${hero.unit}`}</span>`;
    $('entries').append(label, entryList(group.entries));
  } else $('entries').append(entryList(entries));
  $('summary').querySelectorAll('[data-info]').forEach(b => b.onclick = () => {
    const n = NUTRIENTS.find(n => n.key === b.dataset.info), t = totals[n.key];
    showInfo(n.label, `${t.missing} of ${day === localDay() ? "today's" : "this day's"} ${t.count} entries have no ${n.key === 'kcal' ? 'calorie' : n.label.toLowerCase()} value on record, so the real total is at least this.`);
  });
}
function showInfo(title, text, action = null) {
  infoFocus = document.activeElement; $('info-title').textContent = title; $('info-text').textContent = text; $('info-text').hidden = !text;
  $('info-action').hidden = !action; if (action) { $('info-action').textContent = action.label; $('info-action').onclick = () => { closeInfo(); action.run(); }; }
  $('info-modal').hidden = false; (action ? $('info-action') : $('close-info')).focus();
}
function closeInfo() { $('info-modal').hidden = true; infoFocus?.focus(); }

// BLS loads once in the background; the search view reflects loading/failure.
function loadBls() {
  blsError = false;
  blsPromise = fetch('./bls-foods.json').then(r => { if (!r.ok) throw new Error('Unavailable'); return r.json(); }).then(json => { bls = prepareBls(json); }).catch(() => { blsError = true; }).finally(() => { if (view === 'add' && !step && tab === 'search') search(searchQuery); });
  return blsPromise;
}

const scanner = createScanner({
  container: $('camera-container'),
  onCode: code => { if (view === 'add' && !step && tab === 'scan') { scanner.pause(); lookup(code); } },
  onError: error => { cameraMessage = error?.message || "Couldn't start the camera. Check camera access and try again."; renderCameraStatus(); },
});
function renderCameraStatus() {
  if (view === 'add' && !step && tab === 'scan') status('camera-status', cameraMessage, cameraMessage.includes('Starting') ? 'info' : 'error', cameraMessage && !cameraMessage.includes('Starting') ? () => warmCamera(true) : null);
  else status('camera-status');
}
const scanVisible = () => view === 'add' && !step && tab === 'scan' && !scanCode && !document.hidden;
async function warmCamera(force = false) {
  if (!scanVisible()) return;
  if (force) parkCamera();
  if (cameraPending) return cameraPending;
  const run = ++cameraRun;
  cameraMessage = 'Starting camera…'; renderCameraStatus();
  cameraPending = (async () => {
    try { await scanner.start(); if (run === cameraRun) cameraMessage = ''; }
    catch (error) { if (run === cameraRun) cameraMessage = error?.message || "Couldn't start the camera. Check camera access and try again."; }
    finally {
      if (run === cameraRun) { cameraPending = null; syncCamera(); renderCameraStatus(); }
    }
  })();
  return cameraPending;
}
function syncCamera() {
  const active = scanVisible();
  $('camera-container').classList.toggle('parked', !active); $('camera-container').setAttribute('aria-hidden', String(!active));
  if (active) { if (scanner.running) scanner.resume(); }
  else parkCamera();
}
function parkCamera() {
  ++cameraRun; cameraPending = null;
  scanner.stop();
  $('camera-container').classList.add('parked'); $('camera-container').setAttribute('aria-hidden', 'true');
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !writeBlocked && (view === 'day' || observedToday !== localDay())) loadDay();
  if (document.hidden) parkCamera();
  else if (scanVisible()) { syncCamera(); warmCamera(); }
});
window.addEventListener('pagehide', parkCamera);
window.addEventListener('pageshow', event => {
  if (event.persisted && scanVisible()) { syncCamera(); warmCamera(); }
});

function sheetHeader(title, back = false) {
  $('sheet-header').innerHTML = `<button type="button" id="sheet-back" class="icon-link" aria-label="${back ? 'Back' : 'Close'}">${back ? BACK_ICON : '×'}</button><h1>${escapeHtml(title)}</h1><span class="icon-link header-blank" aria-hidden="true"></span>`;
  $('sheet-back').onclick = back ? goBack : closeAdd; $('add-tabs').hidden = !!step;
  document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); b.tabIndex = b.dataset.tab === tab ? 0 : -1; });
}
function openAdd() {
  if (!explicitDay) day = localDay();
  addToday = !explicitDay && day === localDay();
  dayScroll = window.scrollY; editing = null; step = null; scanCode = null; selectedMeal = settings.meals ? defaultMeal() : null;
  showView('add'); renderTab(); if (tab === 'scan') warmCamera();
}
function closeAdd() {
  ++lookupVersion; ++searchVersion; clearTimeout(searchTimer); step = null; editing = null; scanCode = null; parkCamera(); showView('day'); dayAction(); status('sheet-status');
}
function goBack() {
  ++lookupVersion;
  if (step === 'save-food') { step = 'amount'; if (editing.basis === 'once') renderOnceEdit(); else renderAmount(); return; }
  if (editing) { closeAdd(); return; }
  if (step === 'own' && returnStep?.step === 'amount') { currentFood = returnStep.food; step = 'amount'; renderAmount(); return; }
  step = null; scanCode = null; renderTab(); syncCamera(); if (tab === 'scan') warmCamera();
}
function renderTab() {
  status('sheet-status'); sheetHeader('Add food'); syncCamera(); renderCameraStatus();
  if (tab === 'search') renderSearch(); else renderScan();
}
function switchTab(next) {
  if (next === tab && !step) return;
  tab = next; step = null; scanCode = null; ++lookupVersion; ++searchVersion; clearTimeout(searchTimer);
  try { localStorage.setItem('eatabase-last-add-tab', tab); } catch { toast("Couldn't remember this tab on this phone.", null, false, 'error'); }
  renderTab(); if (tab === 'scan' && !scanner.running) warmCamera();
}
function renderSearch() {
  if (!blsPromise) loadBls();
  $('bottom-actions').hidden = true;
  $('add-content').innerHTML = `${field('food-query', 'Search foods', searchQuery, { mode: 'search', placeholder: 'Food or brand' })}<button type="button" id="search-products" class="secondary">Search packaged products</button><div id="search-results"></div><button type="button" id="create-own" class="link-button">Create your own product</button>`;
  $('food-query').oninput = () => { searchQuery = $('food-query').value; $('search-products').disabled = searchQuery.trim().length < 3; search(searchQuery); };
  $('search-products').disabled = searchQuery.trim().length < 3;
  $('search-products').onclick = () => search(searchQuery, true);
  $('food-query').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (searchQuery.trim().length >= 3) search(searchQuery, true); } };
  $('create-own').onclick = () => openOwn({ name: searchQuery });
  search(searchQuery); requestAnimationFrame(() => { if (view === 'add' && !step && tab === 'search') $('food-query')?.focus(); });
}
function searchList(rows, { recent = false, pending = false, error = false } = {}) {
  if (view !== 'add' || step || tab !== 'search') return;
  searchRows = rows; const el = $('search-results');
  el.innerHTML = `${recent ? '<p class="section-label">Recent</p>' : ''}<ul class="list">${rows.map((r, i) => {
    const v = foodValues(r), kcal = v?.kcal;
    return `<li class="list-item" role="button" tabindex="0" data-result="${i}">${listRow(r.name, foodMeta(r), kcal == null ? '—' : `${fmt('kcal', kcal)} kcal`, r.check?.flag ? '<span class="badge">Check</span>' : '')}</li>`;
  }).join('')}</ul>${!rows.length && recent ? '<p class="muted">Foods you log show up here.</p>' : !rows.length && !pending && !blsError && bls ? '<p class="muted">No matching foods.</p>' : ''}${!bls && !blsError ? '<p class="muted" role="status">Loading foods…</p>' : ''}${blsError ? '<div class="status error">The food database couldn’t load. <button type="button" class="link-button" id="retry-bls">Retry</button></div>' : ''}${pending ? '<p class="muted" role="status">Searching products…</p>' : ''}${error ? '<div class="status info">Product search didn’t work — showing basic foods only. <button type="button" class="link-button" id="retry-search">Retry</button></div>' : ''}`;
  el.querySelectorAll('[data-result]').forEach(b => { const open = () => selectFood(searchRows[Number(b.dataset.result)]); b.onclick = open; b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }; });
  $('retry-search')?.addEventListener('click', () => search(searchQuery, true)); $('retry-bls')?.addEventListener('click', () => { loadBls(); search(searchQuery); });
}
function search(q, retry = false) {
  clearTimeout(searchTimer); const version = ++searchVersion; q = q.trim();
  if (!q) { searchList(remembered.slice(0, 20), { recent: true }); return; }
  const mine = searchMine(remembered, q), generic = bls ? searchBls(bls, q, 10) : [];
  const pinned = mergeResults({ mine, bls: generic.filter(r => r.strength === 'strong').slice(0, 2) });
  if (q.length < 3) { searchList(mergeResults({ mine, bls: generic, pinned })); return; }
  const display = data => searchList(mergeResults({ mine, bls: generic, off: data.ranked.slice(0, 20), brand: data.brand, pinned }));
  if (productCache.has(q) && !retry) { display(productCache.get(q)); return; }
  if (!retry) { searchList(mergeResults({ mine, bls: generic, pinned })); return; }
  searchList(pinned, { pending: true });
  const products = async () => {
    try {
      let promise = productPending.get(q);
      if (!promise) {
        promise = searchOff(q, { base: API_BASE, fetchFn: (url, options) => foodFetch(url, { ...options, signal: AbortSignal.timeout(15000) }) }).then(({ results, brand }) => ({ ranked: rerankOff(results, q, brand), brand })); productPending.set(q, promise);
        promise.finally(() => productPending.delete(q)).catch(() => {});
      }
      const data = await promise; productCache.set(q, data);
      if (version === searchVersion) display(data);
    } catch { if (version === searchVersion) searchList(mergeResults({ mine, bls: generic, pinned }), { error: true }); }
  };
  if (retry) products(); else searchTimer = setTimeout(products, 450);
}

function renderScan() {
  $('bottom-actions').hidden = true;
  $('add-content').innerHTML = '<p class="muted scan-hint">Point at a barcode</p><div id="scan-result" aria-live="polite"></div>';
}
async function lookup(code) {
  scanCode = code;
  return loadProduct({ source:'OFF', id:code, name:'Scanned product' });
}
function selectFood(food) {
  if (foodSource(food) !== 'OFF' || food.productVersion === PRODUCT_VERSION && food.per100) { openAmount(food); return; }
  return loadProduct(food);
}
async function loadProduct(preview, refresh = false) {
  const code = String(preview.sourceRef ?? preview.id), version = ++lookupVersion;
  ++searchVersion; clearTimeout(searchTimer); editing = null; currentFood = preview; step = 'details';
  sheetHeader('Product', true); syncCamera(); renderCameraStatus(); $('bottom-actions').hidden = true;
  $('add-content').innerHTML = `<h2 class="form-heading">${escapeHtml(preview.name || 'Scanned product')}</h2><p class="muted food-meta">${escapeHtml(foodMeta(preview))}</p><div id="product-loading" role="status"></div>`;
  loading('product-loading');
  const active = () => version === lookupVersion && view === 'add' && step === 'details';
  const explain = (message, { retry = false, product = preview } = {}) => {
    if (!active()) return;
    currentFood = product;
    $('add-content').innerHTML = `<h2 class="form-heading">${escapeHtml(product.name || preview.name || 'Scanned product')}</h2><p class="muted food-meta">${escapeHtml(foodMeta(product))}</p><div class="status info" role="status">${escapeHtml(message)}</div>${retry ? '<button type="button" id="retry-product">Try again</button>' : ''}<button type="button" id="product-label" class="link-button">Enter label values</button>`;
    if (retry) $('retry-product').onclick = () => loadProduct(preview, true);
    $('product-label').onclick = () => openOwn({ name:product.name === 'Scanned product' ? '' : product.name || preview.name, brand:product.brand, barcode:code, amountUnit:product.amountUnit || null });
  };
  try {
    const own = ownFoods.find(food => food.barcode === code);
    if (!active()) return;
    if (own) { openAmount({ ...own, source:'own', sourceRef:own.id }); return; }
    const savedDetail = await store.cachedProduct(code, { stale:true });
    let food = refresh ? undefined : await store.cachedProduct(code);
    if (food === undefined) {
      food = await fetchProduct(code, { base:API_BASE, fetchFn:foodFetch });
      if (food === null && savedDetail?.usable) {
        if (active()) { openAmount(savedDetail); status('sheet-status', 'This product is no longer listed. Using saved product details.'); }
        return;
      }
      if (!writeBlocked) await store.cacheProduct(code, food);
    }
    if (!active()) return;
    if (!food) { explain('This product is not available in the database. You can keep it by entering its label values.'); return; }
    if (!food.usable) { explain('The nutrition details need checking. Enter the label values to use this product.', { product:food }); return; }
    openAmount(food);
  } catch (error) {
    if (!active()) return;
    const saved = await store.cachedProduct(code, { stale:true });
    if (!active()) return;
    if (saved?.usable) { openAmount(saved); status('sheet-status', 'Using saved product details. Fresh details couldn’t load.'); return; }
    explain(error.message || 'Product details couldn’t load. Your selection is still here.', { retry:true });
  }
}
function scanAgain() { scanCode = null; ++lookupVersion; renderScan(); syncCamera(); if (!scanner.running) warmCamera(); }

function mealChips(meal) {
  if (!settings.meals) return '';
  return `<div class="meal-chips"><label>Meal</label><div class="chips" role="group" aria-label="Meal">${MEALS.map(m => `<button type="button" class="chip${m.key === meal ? ' selected' : ''}" data-meal="${m.key}" aria-pressed="${m.key === meal}">${m.key === 'snack' ? 'Snack' : m.label}</button>`).join('')}</div></div>`;
}
function wireMeals(callback) { $('add-content').querySelectorAll('[data-meal]').forEach(b => b.onclick = () => { selectedMeal = b.dataset.meal; $('add-content').querySelectorAll('[data-meal]').forEach(x => { x.classList.toggle('selected', x === b); x.setAttribute('aria-pressed', String(x === b)); }); callback?.(selectedMeal); }); }
// A saved food is entered once and reused forever, so it needs every macro.
const ALL_NUTRIENTS = NUTRIENTS.map(n => n.key);
function nutrientFields(prefix, values = {}, required = [], onlyTracked = false, more = false) {
  const tracked = new Set(['kcal', ...trackedNutrients(settings).map(n => n.key)]);
  return NUTRIENTS.map(n => `<div${onlyTracked && !tracked.has(n.key) ? ` data-extra${more ? '' : ' hidden'}` : ''}>${field(`${prefix}-${n.key}`, `${n.label} (${n.unit})${required.includes(n.key) ? ' · required' : ''}`, values[n.key] ?? '', { required: required.includes(n.key) })}${n.key === 'kcal' ? `<p class="caption" id="${prefix}-derived" hidden></p>` : ''}</div>`).join('');
}
// Quicklog popup lives in quicklog.js (shared with Home).
function openQuicklog() {
  if (!explicitDay) day = localDay();
  showQuicklog({ settings, day, today: !explicitDay && day === localDay(), onLogged: afterLog, mutate });
}
function normalizeFood(food) {
  const source = foodSource(food) || 'own', sourceRef = food.sourceRef ?? food.id;
  const last = remembered.find(r => r.source === source && String(r.sourceRef) === String(sourceRef));
  const v = foodValues(food) || {}, check = food.check || plausibility(v.kcal, v.protein, v.carbs, v.fat);
  return { ...last, ...food, source, sourceRef, name: food.name || 'Unnamed product', basis: food.basis || 'per100', check };
}
function openAmount(food) {
  ++searchVersion; clearTimeout(searchTimer); currentFood = normalizeFood(food); editing = null; step = 'amount'; selectedMeal = settings.meals ? defaultMeal() : null;
  amountState = initialAmount(currentFood); portions = currentFood.lastPortions || 1; renderAmount(); syncCamera(); window.scrollTo(0, 0);
}
function amountValuesMarkup(values) {
  return trackedNutrients(settings).map(n => `<div><div class="stat-label">${n.label}</div><span class="stat-value">${fmt(n.key, values?.[n.key])}<span class="unit">${values?.[n.key] == null ? '' : n.unit}</span></span></div>`).join('');
}
function warningMarkup(food) {
  return food.check?.flag ? `<div class="status info">These values look off: ${fmt('kcal', foodValues(food).kcal)} kcal on the label, but the macros add up to about ${fmt('kcal', food.check.expected)} kcal.</div>` : '';
}
function canonicalAmount() {
  const selected = amountOptions(currentFood).find(o => o.id === amountState.mode) || { factor:1 };
  const r = number($('amount-grams').value, { required:true, min:0.000001, max:5000 / selected.factor });
  const total = r.error ? null : Math.round(r.value * selected.factor * 10) / 10;
  return r.error || !(total > 0) || total > 5000 ? { error:`Enter an amount greater than zero and no more than 5000 ${amountUnit(currentFood)}.` } : { value:total };
}
function renderAmount() {
  status('sheet-status'); sheetHeader(editing ? 'Edit entry' : 'Amount', true); renderCameraStatus();
  const food = currentFood, portion = food.basis === 'portion', v = foodValues(food), unit = amountUnit(food);
  amountState ||= initialAmount(food, editing);
  const options = amountOptions(food), selected = options.find(o => o.id === amountState.mode) || options.at(-1);
  amountState.mode = selected.id;
  const display = amountState.total == null ? '' : Number((amountState.total / selected.factor).toFixed(6));
  const usableServing = food.servingSize?.unit === unit && food.servingSize.amount > 0 && !food.sizeConflict;
  const sizeNote = food.sizeConflict ? 'Package and serving sizes disagree. Enter the amount you ate.' : !usableServing && options.some(o => o.id === 'package') ? 'Serving size unavailable. Enter an amount or select Package.' : '';
  $('add-content').innerHTML = `<h2 class="form-heading">${escapeHtml(food.name)}</h2><p class="muted food-meta">${[foodMeta(food), foodSource(food) === 'BLS' ? food.nameDe : ''].filter(Boolean).map(escapeHtml).join('<br>')}</p>${warningMarkup(food)}${portion ? `<div class="stepper-row"><button type="button" id="portion-minus" class="stepper-btn" aria-label="Decrease by half a portion">−</button><div class="stepper-value"><span class="value" id="portion-value"></span></div><button type="button" id="portion-plus" class="stepper-btn" aria-label="Increase by half a portion">+</button></div>` : `${options.length > 1 ? `<div class="chips amount-choices" role="group" aria-label="Amount unit">${options.map(o => `<button type="button" class="chip${o.id === selected.id ? ' selected' : ''}" data-amount-mode="${o.id}" aria-pressed="${o.id === selected.id}">${o.label}</button>`).join('')}</div>` : ''}<div class="amount-field">${field('amount-grams', selected.id === 'manual' ? `Amount (${unit})` : `Number of ${selected.id === 'package' ? 'packages' : 'servings'}`, display, { required:true, unit:selected.id === 'manual' ? unit : selected.id === 'package' ? 'packages' : 'servings' })}</div><p id="amount-total" class="caption" aria-live="polite"></p>${sizeNote ? `<p class="caption">${escapeHtml(sizeNote)}</p>` : ''}`}<div id="amount-values" class="amount-values"></div>${!portion ? `<p class="caption">per 100 ${unit}: ${fmt('kcal', v.kcal)} kcal · P ${fmt('protein', v.protein)} · C ${fmt('carbs', v.carbs)} · F ${fmt('fat', v.fat)}</p>` : ''}${mealChips(selectedMeal)}${editing ? `${SAVE_AS_FOOD}<div class="form-delete"><button type="button" id="delete-entry" class="arm-confirm-btn">Delete</button></div>` : ''}`;
  bottom(editing ? 'Save' : 'Log', e => run(e.currentTarget, saveAmount));
  const update = () => {
    if (portion) {
      $('portion-value').innerHTML = `${portions}<span class="unit">portions</span>`; $('portion-minus').disabled = portions <= 0.5; $('portion-plus').disabled = portions >= 50; $('amount-values').innerHTML = amountValuesMarkup(multiplyValues(v, portions));
    } else {
      const r = canonicalAmount(); amountState.total = r.error ? null : r.value;
      $('amount-total').textContent = r.error || (selected.id === 'manual' ? '' : `${r.value} ${unit} total · 1 ${selected.id} = ${selected.factor} ${unit}`);
      $('amount-values').innerHTML = amountValuesMarkup(r.error ? {} : scaleValues(v, r.value));
      $('bottom-actions').firstElementChild.disabled = !!r.error || writeBlocked;
    }
  };
  if (portion) { $('portion-minus').onclick = () => { portions = Math.max(0.5, portions - 0.5); update(); }; $('portion-plus').onclick = () => { portions = Math.min(50, portions + 0.5); update(); }; }
  else {
    $('amount-grams').oninput = update; $('amount-grams').onfocus = e => e.target.select();
    $('add-content').querySelectorAll('[data-amount-mode]').forEach(b => b.onclick = () => { update(); amountState.mode = b.dataset.amountMode; renderAmount(); });
  }
  update(); wireMeals(); if (editing) { wireDelete(); wireSaveAsFood(); }
}
async function saveAmount() {
  const portion = currentFood.basis === 'portion';
  const r = portion ? number(String(portions), { required:true, min:0.5, max:50 }) : canonicalAmount();
  if (r.error) { status('sheet-status', r.error, 'error'); $('amount-grams')?.focus(); return; }
  const amount = portion ? { portions:r.value } : amountUnit(currentFood) === 'ml' ? { millilitres:r.value } : { grams:r.value };
  if (editing) {
    await mutate(() => store.updateEntry(editing.id, { ...withAmount(editing, amount), meal:settings.meals ? selectedMeal : editing.meal })); closeAdd(); await loadDay(); toast('Saved');
  } else { if (addToday) day = localDay(); const row = await mutate(() => store.addEntry(makeEntry(currentFood, { ...amount, meal:settings.meals ? selectedMeal : null, day }))); await afterLog(row); }
}
async function afterLog(row) {
  closeAdd(); await loadDay();
  const undo = async () => { await mutate(() => store.deleteEntry(row.id)); await loadDay(); };
  if (pastDay) { toast(`Logged to ${titleForDay(row.day)}`, undo); return; }
  if (row.day === localDay()) { toast('Logged', undo); return; }
  // Logged onto another day than today: say so, and offer to put it on today instead.
  toast(`Logged to ${titleForDay(row.day).replace(/^Yesterday$/, 'yesterday')}`, undo, false, 'info', {
    label: 'Move to today',
    run: async () => { await mutate(() => store.updateEntry(row.id, { day: localDay() })); day = localDay(); await loadDay(); toast('Moved to today'); },
  });
}
function openOwn({ name = '', brand = '', barcode = '', amountUnit:unit = 'g' } = {}) {
  ++searchVersion; clearTimeout(searchTimer); returnStep = { step, food: currentFood }; step = 'own'; scanner.pause(); syncCamera(); sheetHeader('Your product', true); renderCameraStatus(); status('sheet-status');
  $('add-content').innerHTML = `${field('own-name', 'Name · required', name, { mode: 'text', required: true , maxlength: 120})}${field('own-brand', 'Brand (optional)', brand || '', { mode: 'text' , maxlength: 80})}${field('own-barcode', 'Barcode (optional)', barcode, { mode: 'numeric' , maxlength: 14})}<label>Nutrition on the label</label><div class="chips amount-choices" role="group" aria-label="Nutrition basis"><button type="button" class="chip${unit === 'g' ? ' selected' : ''}" data-own-unit="g" aria-pressed="${unit === 'g'}">Per 100 g</button><button type="button" class="chip${unit === 'ml' ? ' selected' : ''}" data-own-unit="ml" aria-pressed="${unit === 'ml'}">Per 100 ml</button></div>${field('own-serving', `Serving size (${unit || 'g'}) · optional`, '', {unit:unit || 'g'})}${nutrientFields('own', {}, ALL_NUTRIENTS)}<div id="own-check" class="status info" role="status" hidden></div>`;
  $('add-content').querySelectorAll('[data-own-unit]').forEach(b => b.onclick = () => { unit = b.dataset.ownUnit; $('add-content').querySelector('label[for="own-serving"]').textContent = `Serving size (${unit}) · optional`; $('own-serving').parentElement.querySelector('.unit').textContent = unit; $('add-content').querySelectorAll('[data-own-unit]').forEach(x => { x.classList.toggle('selected', x === b); x.setAttribute('aria-pressed', String(x === b)); }); status('sheet-status'); });
  const update = () => { const r = readNutrients('own', { per100: true, showErrors: false }), v = r.values, check = plausibility(v.kcal, v.protein, v.carbs, v.fat); status('own-check', r.valid && check.flag ? `These values look off: ${fmt('kcal', v.kcal)} kcal on the label, but the macros add up to about ${check.expected} kcal.` : ''); };
  $('add-content').querySelectorAll('input').forEach(x => x.addEventListener('input', update));
  bottom('Save', e => run(e.currentTarget, async () => {
    if (!unit) { status('sheet-status', 'Choose whether the label is per 100 g or per 100 ml.'); return; }
    const name = $('own-name').value.trim(), barcode = $('own-barcode').value.trim(), r = readNutrients('own', { required: ALL_NUTRIENTS, per100: true });
    fieldError('own-name', !name ? 'Enter the product name.' : name.length > 120 ? 'Use no more than 120 characters.' : '');
    const brand = $('own-brand').value.trim(); fieldError('own-brand', brand.length > 80 ? 'Use no more than 80 characters.' : ''); const barcodeValid = !barcode || /^\d{8,14}$/.test(barcode); fieldError('own-barcode', barcodeValid ? '' : 'Use 8–14 digits for the barcode.');
    const serving = readNumber('own-serving', {min:0.1,max:5000});
    if (!name || name.length > 120 || brand.length > 80 || !barcodeValid || !r.valid || serving.error) { $('add-content').querySelector('[aria-invalid="true"]')?.focus(); return; }
    const food = await mutate(() => store.addFood({ name, brand: brand || null, barcode: barcode || null, basis: 'per100', amountUnit:unit, servingSize:serving.value == null ? null : {amount:serving.value,unit}, per100: r.values }));
    ownFoods = await store.listFoods(); remembered = rememberedFoods(await store.recentEntries(), ownFoods); toast('Product saved'); openAmount({ ...food, source: 'own', sourceRef: food.id });
  })); window.scrollTo(0, 0);
}
function openEdit(entry) {
  if (pastDay && !pastEditing) return;
  dayScroll = window.scrollY; amountState = initialAmount(entry, entry); editing = entry; currentFood = normalizeFood(entry); step = 'amount'; selectedMeal = entry.meal; portions = entry.portions || 1; showView('add'); syncCamera();
  if (entry.basis === 'once') renderOnceEdit(); else renderAmount();
}
function renderOnceEdit() {
  sheetHeader('Edit entry', true); renderCameraStatus(); status('sheet-status');
  $('add-content').innerHTML = `${field('edit-name', 'Name (optional)', editing.name, { mode: 'text', placeholder: 'Quicklog' })}${nutrientFields('edit', editing.values)}${mealChips(selectedMeal)}${SAVE_AS_FOOD}<div class="form-delete"><button type="button" id="delete-entry" class="arm-confirm-btn">Delete</button></div>`;
  wireMeals(); wireDelete(); wireSaveAsFood(); bottom('Save', e => run(e.currentTarget, async () => {
    const r = readNutrients('edit'), q = r.valid ? quickValues(r.values) : null;
    if (!r.valid) return; if (q?.values.kcal > valueMax.kcal) { fieldError('edit-kcal', `Enter calories or macros totaling no more than ${valueMax.kcal} kcal.`); return; } if (!q) { fieldError('edit-kcal', 'Enter at least one nutrient value.'); return; }
    await mutate(() => store.updateEntry(editing.id, { name: $('edit-name').value.trim() || 'Quicklog', values: q.values, meal: settings.meals ? selectedMeal : editing.meal })); closeAdd(); await loadDay(); toast('Saved');
  }));
}
// Any logged entry can become one of your foods: exactly what was eaten, as one portion
// (a product at 150 g saves as "that, 150 g"). Saved foods need every macro, so only
// the ones the entry doesn't know are asked for.
const SAVE_AS_FOOD = '<button type="button" id="save-as-food" class="link-button">Save to your foods</button>';
function wireSaveAsFood() { $('save-as-food').onclick = renderSaveAsFood; }
function defaultFoodName(entry) {
  const name = entry.basis === 'once' && entry.name === 'Quicklog' ? '' : entry.name || '';
  const amount = entry.basis === 'per100' ? ` ${fmt('grams', entryAmount(entry))} ${amountUnit(entry)}` : entry.basis === 'portion' && entry.portions !== 1 ? ` ×${entry.portions}` : '';
  return name ? (name + amount).slice(0, 120) : '';
}
function renderSaveAsFood() {
  step = 'save-food'; sheetHeader('Save to your foods', true); status('sheet-status');
  const v = editing.values || {}, missing = ALL_NUTRIENTS.filter(k => v[k] == null);
  const known = NUTRIENTS.filter(n => v[n.key] != null);
  $('add-content').innerHTML = `${field('food-name', 'Name · required', defaultFoodName(editing), { mode: 'text', required: true, maxlength: 120, placeholder: 'e.g. Evening bowl' })}${known.length ? `<div class="amount-values">${known.map(n => `<div><div class="stat-label">${n.label}</div><span class="stat-value">${fmt(n.key, v[n.key])}<span class="unit">${n.unit}</span></span></div>`).join('')}</div>` : ''}${missing.length ? `<p class="caption">Your foods need every macro. Add the ones this entry doesn’t have.</p>${NUTRIENTS.filter(n => missing.includes(n.key)).map(n => field(`food-${n.key}`, `${n.label} (${n.unit}) · required`, '', { required: true })).join('')}` : ''}<p class="caption">Saved as one portion.</p>`;
  bottom('Save', e => run(e.currentTarget, async () => {
    const name = $('food-name').value.trim();
    fieldError('food-name', !name ? 'Enter a name.' : name.length > 120 ? 'Use no more than 120 characters.' : '');
    const r = readNutrients('food', { required: missing });
    if (!name || name.length > 120 || !r.valid) { $('add-content').querySelector('[aria-invalid="true"]')?.focus(); return; }
    const portion = Object.fromEntries(ALL_NUTRIENTS.map(k => [k, v[k] ?? r.values[k]]));
    await mutate(() => store.addFood({ name, basis: 'portion', portion }));
    ownFoods = await store.listFoods(); remembered = rememberedFoods(await store.recentEntries(), ownFoods);
    closeAdd(); toast('Saved to your foods');
  }));
  window.scrollTo(0, 0);
}
function wireDelete() { arm($('delete-entry'), async () => { const row = await mutate(() => store.deleteEntry(editing.id)); closeAdd(); await loadDay(); toast('Deleted', async () => { await mutate(() => store.addEntry(row)); await loadDay(); }); }); }

$('day-title').onclick = () => {
  if (pastDay || !isLateNight()) return;
  if (day !== localDay()) { explicitDay = false; day = localDay(); loadDay(); return; }   // yesterday → straight back to today
  showInfo('It’s late', '', { label: 'Go to yesterday', run: () => { explicitDay = true; day = shiftDay(localDay(), -1); loadDay(); } });
};
$('add-food').onclick = () => openAdd(); $('quick-log').onclick = () => openQuicklog();

document.querySelectorAll('[data-tab]').forEach(b => {
  b.onclick = () => switchTab(b.dataset.tab);
  b.onkeydown = e => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); const tabs = ['search', 'scan'], i = tabs.indexOf(tab); switchTab(tabs[(i + 1) % 2]); document.querySelector(`[data-tab="${tab}"]`).focus(); };
});
$('close-info').onclick = closeInfo; $('info-modal').onclick = e => { if (e.target === $('info-modal')) closeInfo(); };
document.addEventListener('keydown', e => {
  if (!$('info-modal').hidden) {
    if (e.key === 'Escape') closeInfo();
    if (e.key === 'Tab') { e.preventDefault(); ($('info-action').hidden || document.activeElement === $('info-action') ? $('close-info') : $('info-action')).focus(); }
  } else if (e.key === 'Escape' && $('quicklog-modal') && !$('quicklog-modal').hidden) { /* quicklog.js closes it */ }
  else if (e.key === 'Escape' && view === 'add') closeAdd();
});
// Home's "Add food" lands here with #add: open the add sheet straight away.
loadDay().then(() => { if (location.hash === '#add') { history.replaceState(null, '', location.pathname + location.search); if (settings && !pastDay) openAdd(); } });

setActionRunner(run);
$('day-back').innerHTML = BACK_ICON;
$('day-back').href = pastDay ? './history.html' : './home.html';
$('day-back').setAttribute('aria-label', pastDay ? 'Back to history' : 'Back to home');
