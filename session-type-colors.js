// ---------------------------------------------------------------------------
// Persistent session-type colors — the fixed 8-slot categorical palette
// (moved here from volume.html's old SLICE_COLORS) plus the allocation rule
// that keeps a color pinned to a session_types row forever, instead of to
// its rank in whatever week happens to be on screen. DOM-free, same style
// as weight-utils.js, so both volume.html and settings.html can import it
// without duplicating the palette or the allocation logic.
// ---------------------------------------------------------------------------

// Same 8 entries as before, dataviz-skill-validated (lightness band, chroma
// floor, CVD separation, contrast — all checked against --surface, not
// eyeballed). Anything past the end shares the last color rather than
// going invisible.
export const PALETTE = [
  'var(--chart-cat-1)', 'var(--chart-cat-2)', 'var(--chart-cat-3)', 'var(--chart-cat-4)',
  'var(--chart-cat-5)', 'var(--chart-cat-6)', 'var(--chart-cat-7)', 'var(--chart-cat-8)',
];

// Reserved, fixed, NOT drawn from PALETTE — "Extra" (is_extra-flagged sets)
// and "Other" (the built-in pseudo-type, or any unrecognized category) are
// catch-alls, not real identities, so they never compete with a genuine
// session type for one of the 8 real slots. Two different values, not one
// shared one — a week that shows both an Other session and an Extra-flagged
// set needs two distinguishable legend entries.
export const OTHER_COLOR = 'var(--chart-cat-other)';
export const EXTRA_COLOR = 'var(--chart-cat-extra)';

/**
 * Bounds-safe palette lookup. A null/undefined index (shouldn't happen once
 * a row's been backfilled or freshly inserted, but a defensive fallback for
 * any gap) reads as OTHER_COLOR rather than silently defaulting to slot 0.
 */
export function colorForIndex(index) {
  if (index === null || index === undefined) return OTHER_COLOR;
  return PALETTE[Math.min(index, PALETTE.length - 1)];
}

/**
 * The smallest non-negative integer NOT present in existingIndices (the
 * "mex"). Deliberately uncapped — it keeps counting past 7 rather than
 * clamping, so every live row's color_index stays numerically distinct from
 * every other live row's even once the visible 8-slot palette is full; the
 * sharing of an actual rendered color past slot 8 happens only in
 * colorForIndex above, at render time, never in storage. Ignores null/
 * undefined entries, so a not-yet-backfilled sibling row can't jam this.
 */
export function nextColorIndex(existingIndices) {
  const used = new Set(existingIndices.filter((i) => i !== null && i !== undefined));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}
