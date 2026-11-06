import { mountCountOdometer } from './count-odometer.js';

const cards = new WeakMap(), numbers = new WeakMap();

function setNumber(el, text, jump) {
  let state = numbers.get(el);
  if (state?.text === text) return;
  const match = /^(≥ )?((?:\d{1,3}(?:,\d{3})+|\d+))$/.exec(text);
  const value = match ? Number(match[2].replaceAll(',', '')) : NaN;
  if (!Number.isSafeInteger(value)) {
    state?.meter?.destroy();
    el.textContent = text;
    numbers.set(el, { text });
    return;
  }
  if (!state?.meter) {
    el.innerHTML = '<span class="number-prefix"></span><span class="number-count"></span>';
    state = { meter: mountCountOdometer(el.lastElementChild) };
    numbers.set(el, state);
    jump = true;
  }
  el.firstElementChild.textContent = match[1] || '';
  state.meter.set(value, { jump });
  state.text = text;
}

// Patch the summary in place. In particular, number wheels and bar fills never
// leave the document during a refresh, so CSS can retarget an unfinished roll.
function patch(el, next, jump) {
  if (el.nodeType === Node.TEXT_NODE) {
    if (el.data !== next.data) el.data = next.data;
    return;
  }
  for (const attr of [...el.attributes]) if (!next.hasAttribute(attr.name)) el.removeAttribute(attr.name);
  for (const attr of next.attributes) if (el.getAttribute(attr.name) !== attr.value) el.setAttribute(attr.name, attr.value);
  if (el.classList.contains('number')) { setNumber(el, next.textContent, jump); return; }
  const children = [...next.childNodes];
  children.forEach((child, i) => {
    const old = el.childNodes[i];
    if (!old || old.nodeType !== child.nodeType || old.nodeName !== child.nodeName) {
      const copy = child.cloneNode(true);
      if (old) old.replaceWith(copy); else el.append(copy);
      copy.querySelectorAll?.('.number').forEach(number => setNumber(number, number.textContent, true));
    } else patch(old, child, jump);
  });
  while (el.childNodes.length > children.length) el.lastChild.remove();
}

/** Existing markup owns wording/formatting; this layer only adds motion. */
export function updateSummary(card, markup, { key, animate = false, allHit = false, tintAllHit = true }) {
  let state = cards.get(card);
  const fresh = !state || state.key !== key;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const moving = animate && !fresh && !reduced;
  const oldHits = [...card.querySelectorAll('.stat-value')].map(el => el.classList.contains('is-hit'));
  const wasAllHit = state?.allHit ?? card.classList.contains('all-hit');
  state?.effects.forEach(effect => effect.cancel());
  const effects = [];
  // Transitions must be off before anything is patched, or bars that update first would snap mid-patch.
  card.classList.toggle('summary-jump', !moving);
  if (fresh) {
    card.querySelectorAll('.number').forEach(el => numbers.get(el)?.meter?.destroy());
    card.innerHTML = markup;
    card.querySelectorAll('.number').forEach(el => setNumber(el, el.textContent, true));
  } else {
    const next = card.cloneNode(false); next.innerHTML = markup;
    // Root attributes belong to the screen, not to its summary contents.
    for (let i = 0; i < next.childNodes.length; i++) patch(card.childNodes[i], next.childNodes[i], !moving);
  }
  card.classList.toggle('all-hit', tintAllHit && allHit);
  if (moving) {
    card.querySelectorAll('.stat-value').forEach((el, i) => {
      if (!oldHits[i] && el.classList.contains('is-hit')) {
        const bar = i === 0 ? card.querySelector(':scope > .progress-track') : card.querySelectorAll('.summary-columns > div')[i - 1]?.querySelector('.progress-track');
        if (bar) effects.push(bar.querySelector('.progress-fill').animate([{ filter: 'brightness(2)' }, { filter: 'brightness(1)' }], 650));
        effects.push(el.animate([{ color: 'var(--ok)' }, { color: 'var(--ok)' }], 650));
      }
    });
    if (!wasAllHit && allHit) effects.push(card.animate([{ boxShadow: 'inset 0 0 30px var(--ok)' }, { boxShadow: 'none' }], 900));
  }
  // Flush jump styles before a later log enables transitions again.
  if (!moving) void card.offsetWidth;
  cards.set(card, { key, effects, allHit });
}
