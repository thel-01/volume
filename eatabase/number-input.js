// Shared behavior snapshot from Volume.
// ---------------------------------------------------------------------------
// Strict parsing for typed numbers: set forms (log.html, history.html) and
// weigh-ins (weight.html, dashboard.html).
// parseInt/parseFloat read a numeric prefix and drop the rest, so "80kg"
// became 80 and "5,5" became 5 — saved without a word. These accept the whole
// input or nothing: anything else comes back NaN, which every caller already
// treats as "not a number" and shows its own error for.
// ---------------------------------------------------------------------------

// Stay inside the database's column limits (sets.reps / duration_seconds are
// integer, sets.weight is numeric(6,2)) so an absurd value gets the page's own
// message instead of a raw database error.
const MAX_COUNT = 100000;
const MAX_KG = 9999.99;

/** Whole number of reps or seconds, e.g. "8". Signs, decimals or letters → NaN. */
export function parseCount(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return NaN;
  const n = Number(s);
  return n <= MAX_COUNT ? n : NaN;
}

/** A kg amount, decimal point or comma, e.g. "80.5" / "80,5". Anything else → NaN. */
export function parseKg(raw) {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
  const n = Number(s);
  return n <= MAX_KG ? n : NaN;
}
