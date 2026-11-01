// ---------------------------------------------------------------------------
// Odometer: a number whose digits roll like an odometer instead of swapping.
//
// Built for rapid tapping (the weight quicklog stepper). The value is whole
// tenths of a unit (80.4 -> 804) and every decimal place is its own wheel: a
// tall strip of digits that slides up or down. Wheel k holds floor(N / 10^k),
// so it moves exactly when that place's digit changes — one tap moves only the
// wheels that really change, an unchanged wheel is never touched, and nothing
// is ever rebuilt or reset to the final value while you keep tapping. A wheel
// that is mid-roll just retargets from wherever it is on screen (CSS
// transitions interrupt in place), so fast taps chase smoothly and the number
// always settles on exactly the right digit.
//
// Timing and easing live in styles.css (.odo .col); this file only decides
// where each strip should be.
// ---------------------------------------------------------------------------

const ROWS = 40;          // four copies of 0-9 per wheel
const MID = 20;           // a wheel starts mid-strip and is re-centred before it can run off an end
const SETTLE_MS = 320 + 150;   // roll duration (styles.css) plus margin: after this a wheel must be exactly on its digit

const instances = new Set();

/** Row height in px, robust to a hidden element (where getComputedStyle may hand back a unitless line-height). */
function rowHeightOf(el) {
  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize) || 16;
  const lh = cs.lineHeight;
  if (lh === 'normal') return fs * 1.2;
  if (lh.endsWith('px')) return parseFloat(lh);
  const n = parseFloat(lh);
  return (n < 10 ? n * fs : n) || fs * 1.2;
}

/** Whole tenths of a unit, from a number that already carries one decimal. */
export function tenths(value) {
  return Math.round(Number(value.toFixed(1)) * 10);
}

class Odometer {
  constructor(el, suffixHTML) {
    this.el = el;
    this.suffix = suffixHTML;
    this.built = false;
    this.pending = false;   // mid-roll: leave it alone until its settle check
    this.N = null;
    instances.add(this);
  }

  build() {
    this.h = rowHeightOf(this.el);
    const rows = Array.from({ length: ROWS }, (_, r) => `<i>${r % 10}</i>`).join('');
    const wheel = (k) => `<span class="wheel" data-k="${k}"><span class="col">${rows}</span></span>`;
    // The real number is plain text for screen readers; the wheels are decoration.
    this.el.innerHTML = `<span class="odo-sr"></span><span class="odo" aria-hidden="true" style="--h:${this.h}px">${wheel(3)}${wheel(2)}${wheel(1)}<span class="dot">.</span>${wheel(0)}</span>${this.suffix}`;
    this.sr = this.el.querySelector('.odo-sr');
    this.wheels = [0, 1, 2, 3].map((k) => {
      const wrap = this.el.querySelector(`.wheel[data-k="${k}"]`);
      return { k, wrap, col: wrap.firstElementChild, p: 0, idx: MID, shown: true };
    });
    this.built = true;
  }

  // Tens and hundreds only exist once the number is big enough (9.5 shows "9.5", never "009.5").
  static visible(k, N) { return k < 2 || N >= Math.pow(10, k); }

  // A position is a percentage of the strip's own height (idx / ROWS), never idx * a measured pixel height, so a
  // fractional or rounded row height on a phone can't accumulate into a visible offset.
  place(w, idx, animate) {
    if (!animate) w.col.style.transition = 'none';
    w.col.style.transform = `translateY(${(-idx * 100 / ROWS).toFixed(4)}%)`;
    if (!animate) { void w.col.offsetWidth; w.col.style.transition = ''; }
  }

  // Once a wheel should be at rest: re-measure the row height (it may have been measured while the popup was hidden or
  // before a font arrived) and make sure every wheel really is exactly on its digit; fix whatever isn't.
  reseat() {
    this.pending = false;
    if (!this.built || this.el.getClientRects().length === 0) return;
    const h = rowHeightOf(this.el);
    if (h && Math.abs(h - this.h) > 0.1) { const N = this.N; this.built = false; this.set(N, { jump: true }); return; }
    for (const w of this.wheels) {
      const rowH = w.col.offsetHeight / ROWS;
      if (!rowH) continue;
      const y = new DOMMatrix(getComputedStyle(w.col).transform).m42;
      if (Math.abs(y + w.idx * rowH) > 0.5) this.place(w, w.idx, false);
    }
  }

  /** Show N tenths. `jump` puts the digits there instantly; an element that isn't on screen always jumps. */
  set(N, { jump = false } = {}) {
    N = Math.max(0, Math.min(9999, Math.round(N)));
    if (this.el.getClientRects().length === 0) jump = true;
    if (this.built && !this.el.contains(this.wheels[0].wrap)) this.built = false;   // something replaced our wheels: start clean
    if (!this.built) {
      this.build();
      jump = true;
      this.wheels.forEach((w) => { w.p = Math.floor(N / Math.pow(10, w.k)); w.shown = !Odometer.visible(w.k, N); });
    }
    let animated = false;
    for (const w of this.wheels) {
      const pNew = Math.floor(N / Math.pow(10, w.k));
      const vis = Odometer.visible(w.k, N);
      if (vis !== w.shown) {   // a wheel appearing or disappearing is placed instantly, no roll
        w.shown = vis; w.wrap.hidden = !vis; w.idx = MID + (pNew % 10); w.p = pNew;
        this.place(w, w.idx, false);
        continue;
      }
      const delta = pNew - w.p;
      if (delta === 0) continue;   // untouched: whatever it is doing, it keeps doing
      if (jump) { w.idx = MID + (pNew % 10); w.p = pNew; this.place(w, w.idx, false); continue; }
      // Never spin more than one full turn: same final digit, same direction, bounded distance (a 5 kg jump would
      // otherwise be a 50-row spin on a 40-row strip and run off the end).
      const step = delta > 0 ? ((delta - 1) % 10) + 1 : -(((-delta - 1) % 10) + 1);
      let idx = w.idx + step;
      // Keep both where the wheel is DRAWN right now and where it is heading inside the strip. In a burst the drawn
      // position can trail the destination, so re-centre by a whole number of 20-row copies chosen against both; if
      // no shift keeps both inside (an extreme backlog), skip the roll and seat the digit exactly.
      const rowH = w.col.offsetHeight / ROWS;
      const y = new DOMMatrix(getComputedStyle(w.col).transform).m42;
      const cur = rowH ? -y / rowH : idx;
      let shift = null;
      for (const sft of [0, 20, -20, 40, -40]) {
        if (cur + sft < 0 || cur + sft > ROWS - 1 || idx + sft < 0 || idx + sft > ROWS - 1) continue;
        if (shift === null || Math.abs(idx + sft - MID) < Math.abs(idx + shift - MID)) shift = sft;
      }
      if (shift === null || idx % 10 !== pNew % 10) {   // extreme backlog or broken invariant: re-seat, never leave a blank digit
        idx = MID + (pNew % 10); w.idx = idx; w.p = pNew;
        this.place(w, idx, false);
        continue;
      }
      if (shift !== 0) {   // slide the whole strip invisibly (every copy of a digit looks the same), mid-flight
        w.col.style.transition = 'none';
        w.col.style.transform = `translateY(${y - shift * rowH}px)`;
        void w.col.offsetWidth;
        w.col.style.transition = '';
        idx += shift;
      }
      w.idx = idx; w.p = pNew;
      this.place(w, idx, true);
      animated = true;
    }
    this.N = N;
    if (animated) {   // something is rolling: leave refreshes alone until the settle check
      clearTimeout(this.vt);
      this.pending = true;
      this.vt = setTimeout(() => this.reseat(), SETTLE_MS);
    }
    this.sr.textContent = (N / 10).toFixed(1);
  }
}

/** Turn `el` into an odometer followed by `suffixHTML` (e.g. the "kg" unit). Returns it; call `.set(tenths)`. */
export function mountOdometer(el, suffixHTML = '') {
  return new Odometer(el, suffixHTML);
}

/**
 * Re-seat every odometer: after a popup opens, the tab returns from the background, the phone rotates or a font
 * arrives late, a row height may have changed or a transition been left half-done. Wheels still rolling are skipped
 * (their own settle check handles them).
 */
export function refreshOdometers() {
  instances.forEach((o) => { if (!o.pending) o.reseat(); });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshOdometers(); });
addEventListener('pageshow', refreshOdometers);
addEventListener('resize', refreshOdometers);
addEventListener('orientationchange', refreshOdometers);
document.fonts?.ready.then(refreshOdometers);
