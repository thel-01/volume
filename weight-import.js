// ---------------------------------------------------------------------------
// Bulk bodyweight import — parsing, detection, and overlap classification.
//
// DOM-free and Supabase-free on purpose, same reasoning as weight-utils.js:
// pure functions of plain text and plain rows, so this can be checked with
// a Node script and imported straight into weight.html with no surprises
// between what was tested and what ships.
//
// This is the logic validated over many rounds in the "Weight Import
// Workshop" Claude Artifact before being carried over here — every edge
// case below (the future-date/noon-fallback interaction, the asymmetric
// within-batch overlap bug, the time-agreement duplicate downgrade) was a
// real bug found and fixed during that workshop, not a hypothetical.
//
// kg only, everywhere — no unit conversion, nothing to guess.
// ---------------------------------------------------------------------------

import { dayKey } from './weight-utils.js';

// ===========================================================================
// Delimiter / decimal-separator detection
// ===========================================================================

/** Tab wins outright (pasted-spreadsheet signal, no ambiguity); else
 *  semicolon (comma-decimal signal); else comma. */
export function detectDelimiter(rawText) {
  const firstLine = rawText.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  if (firstLine.includes('\t')) return '\t';
  if (firstLine.includes(';')) return ';';
  return ',';
}

/** Semicolon implies comma-decimal locale; comma implies dot-decimal
 *  (matches the app's own CSV export exactly). Tab has no structural
 *  ambiguity either way, so it's sniffed per-cell instead (null here). */
export function decimalSeparatorForDelimiter(delimiter) {
  if (delimiter === ';') return ',';
  if (delimiter === ',') return '.';
  return null;
}

export function splitLine(line, delimiter) {
  return line.split(delimiter).map((c) => c.trim());
}

export function sniffDecimalSeparator(raw) {
  const cleaned = String(raw || '').replace(/\s*(kg|kgs)\s*$/i, '');
  return (cleaned.includes(',') && !cleaned.includes('.')) ? ',' : '.';
}

export function parseWeightCell(raw, decimalSeparator) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim().replace(/\s*(kg|kgs)\s*$/i, '');
  const ds = decimalSeparator ?? sniffDecimalSeparator(s);
  if (ds === ',') s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ===========================================================================
// Cell parsing
// ===========================================================================

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/; // real HH:MM, not just digit-shaped

export function parseDateCell(raw) {
  if (!raw) return null;
  const m = ISO_DATE_RE.exec(raw.trim());
  if (!m) return null;
  const mm = Number(m[2]), dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return raw.trim();
}

export function parseTimeCell(raw) {
  if (raw === undefined || raw === null || raw.trim() === '') return { timeStr: null, timeKnown: false };
  if (!TIME_RE.test(raw.trim())) return { error: true };
  return { timeStr: raw.trim(), timeKnown: true };
}

/** Local date/time strings -> a UTC instant. Identical to weight.html's own
 *  toInstant() — duplicated, not imported, since weight.html is a page, not
 *  a module; both are this one-liner and nothing more. */
function toInstant(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`);
}

/**
 * Is dateStr (YYYY-MM-DD) later than today, in the browser's own local
 * timezone? Deliberately a pure calendar-date string comparison, not an
 * instant comparison against Date.now() — a blank-time row falls back to
 * noon for measuredAt below, and comparing THAT instant to "now" wrongly
 * rejected a same-day blank-time reading as "future" whenever the import
 * ran before local noon. The reason text says "that date is in the
 * future" — the date is genuinely all this should ever check.
 */
export function isFutureLocalDate(dateStr) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return dateStr > todayStr;
}

// One consistent precision everywhere — matches the manual single-entry
// form's own 1-decimal rounding instead of the column's full 2-decimal
// capacity, so there's one rule to know, not two. A whole-number reading
// still always displays with the decimal ("80.0"), never bare "80".
export function toKg(value) {
  return Math.round(value * 10) / 10;
}

export function looksLikeHeader(cells, weightColIndex, decimalSeparator) {
  return parseWeightCell(cells[weightColIndex], decimalSeparator) === null;
}

// ===========================================================================
// Row parsing
// ===========================================================================

export const REASON_LABEL = {
  'bad-columns': 'columns',
  'bad-date': 'bad date',
  'bad-time': 'bad time',
  'bad-weight': 'no weight',
  'out-of-range': 'out of range',
  'invalid-date': 'invalid',
  'future-date': 'future date',
  'impossible-swing': 'impossible swing',
};

export function parseRow(cells, opts) {
  const { decimalSeparator, dateCol, timeCol, weightCol } = opts;
  if (cells.length < 2) return { ok: false, reasonCode: 'bad-columns', reason: 'This row has the wrong number of columns.' };

  const dateStr = parseDateCell(cells[dateCol]);
  if (!dateStr) return { ok: false, reasonCode: 'bad-date', reason: `Couldn't read a date from "${cells[dateCol] ?? ''}". Dates need to be YYYY-MM-DD.` };

  let timeStr = null, timeKnown = false;
  if (timeCol != null) {
    const t = parseTimeCell(cells[timeCol]);
    if (t.error) return { ok: false, reasonCode: 'bad-time', reason: `Couldn't read a time from "${cells[timeCol]}". Times need to be 24-hour HH:MM, or left blank.` };
    timeStr = t.timeStr; timeKnown = t.timeKnown;
  }

  const rawWeight = cells[weightCol];
  const num = parseWeightCell(rawWeight, decimalSeparator);
  if (num === null) return { ok: false, reasonCode: 'bad-weight', reason: `Couldn't read a weight from "${rawWeight ?? ''}".` };

  const weightKg = toKg(num);
  if (!(weightKg > 20 && weightKg < 500)) return { ok: false, reasonCode: 'out-of-range', reason: `${weightKg} kg is outside a believable bodyweight range (20–500 kg).` };

  if (isFutureLocalDate(dateStr)) return { ok: false, reasonCode: 'future-date', reason: 'That date is in the future.' };
  const measuredAt = toInstant(dateStr, timeStr || '12:00');
  if (isNaN(measuredAt.getTime())) return { ok: false, reasonCode: 'invalid-date', reason: 'That date and time together aren’t valid.' };

  return { ok: true, weightKg, dateStr, timeStr, timeKnown, measuredAt };
}

export function parseImportText(rawText) {
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], delimiter: ',', decimalSeparator: '.', hadHeader: false };

  const delimiter = detectDelimiter(rawText);
  const decimalSeparator = decimalSeparatorForDelimiter(delimiter);
  const firstCells = splitLine(lines[0], delimiter);
  const colCount = firstCells.length;
  const dateCol = 0, timeCol = colCount >= 3 ? 1 : null, weightCol = colCount >= 3 ? 2 : 1;

  const isHeader = looksLikeHeader(firstCells, weightCol, decimalSeparator);
  const dataLines = isHeader ? lines.slice(1) : lines;

  const rows = dataLines.map((line) => {
    const cells = splitLine(line, delimiter);
    const parsed = parseRow(cells, { decimalSeparator, dateCol, timeCol, weightCol });
    return { raw: line, ...parsed };
  });

  return { rows, delimiter, decimalSeparator, hadHeader: isHeader };
}

// If most rows come back "wrong number of columns," that's not a pile of
// individually malformed lines — it means delimiter/column detection
// guessed wrong for the WHOLE file (or the file just isn't in the expected
// shape at all). Showing that as dozens of identical per-row badges would
// be the wrong experience; catch it once, up front, instead.
const BAD_COLUMNS_FILE_LEVEL_FRACTION = 0.5;
export function looksLikeWrongFileShape(rows) {
  if (rows.length === 0) return false;
  const badColumns = rows.filter((r) => !r.ok && r.reasonCode === 'bad-columns').length;
  return badColumns / rows.length > BAD_COLUMNS_FILE_LEVEL_FRACTION;
}

// ===========================================================================
// Overlap classification
// ===========================================================================

// A genuine overlap (two different real readings the same day) is
// harmless on its own — same-day readings already get averaged into one
// point before either trend method sees them (dailyValues() in
// weight-utils.js) — so it's included by default and just flagged. What's
// excluded by default is anything that looks more like a mistake than a
// real second reading: a near-duplicate (the same weigh-in re-appearing)
// or a same-day swing big enough to be more likely a data problem than a
// real fluctuation. A swing past all plausibility isn't even offered as a
// choice — it's skipped the same way an unparseable row is.
const DUPLICATE_CLOSE_KG = 0.1;
const IMPLAUSIBLE_DAY_SWING_KG = 3;   // "large-swing" — excluded by default, still your call
const IMPOSSIBLE_DAY_SWING_KG = 10;   // not a real bodyweight change — hard skip, no toggle
// Two same-day readings this close in weight still aren't the same
// reading if their clock times clearly disagree (a real morning weigh-in
// and a real evening one can land within 0.1kg of each other and still be
// two genuine readings) — some wiggle room for minor rounding between
// sources, not an exact match requirement.
const TIME_AGREEMENT_WIGGLE_MINUTES = 30;

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}
function timeStrToMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Annotates every OK row with an overlap classification (or none) against
 * both the user's already-persisted readings and sibling rows within the
 * same import batch. Never mutates importRows; returns a new array.
 */
export function annotateOverlaps(importRows, existingRows) {
  const existingByDay = new Map();
  for (const e of existingRows) {
    const k = dayKey(e.measured_at);
    if (!existingByDay.has(k)) existingByDay.set(k, []);
    existingByDay.get(k).push({
      weightKg: e.weight_kg,
      timeKnown: !!e.time_known,
      minutesOfDay: e.time_known ? minutesOfDay(new Date(e.measured_at)) : null,
    });
  }

  // Grouped by day FIRST, from every ok row in the batch, before any
  // per-row comparison happens — so a row is checked against every
  // sibling that shares its day, not just ones that happened to come
  // before it in the file. Comparing incrementally (each row only against
  // rows already seen) was the earlier bug here: of two same-day rows
  // that are actually the same conflicting pair, only the second one
  // would ever get flagged — the first would come back looking clean.
  // Wrapped (not the bare row) so existing and batch candidates share one
  // shape; __selfRow keeps the real row reachable for self-exclusion.
  const batchByDay = new Map();
  for (const row of importRows) {
    if (!row.ok) continue;
    const k = dayKey(row.measuredAt);
    if (!batchByDay.has(k)) batchByDay.set(k, []);
    batchByDay.get(k).push({
      weightKg: row.weightKg,
      timeKnown: row.timeKnown,
      minutesOfDay: row.timeKnown ? timeStrToMinutes(row.timeStr) : null,
      __selfRow: row,
    });
  }

  return importRows.map((row) => {
    if (!row.ok) return row;
    const k = dayKey(row.measuredAt);
    const candidates = [
      ...(existingByDay.get(k) || []),
      ...(batchByDay.get(k) || []).filter((c) => c.__selfRow !== row),
    ];

    if (candidates.length === 0) {
      return { ...row, overlap: null, defaultInclude: true, include: true };
    }

    const closest = candidates.reduce((a, b) =>
      Math.abs(a.weightKg - row.weightKg) <= Math.abs(b.weightKg - row.weightKg) ? a : b);
    const diff = Math.abs(closest.weightKg - row.weightKg);

    if (diff >= IMPOSSIBLE_DAY_SWING_KG) {
      return {
        ok: false,
        raw: row.raw,
        reasonCode: 'impossible-swing',
        reason: `You're entering ${row.weightKg.toFixed(1)} kg, but you already have ${closest.weightKg.toFixed(1)} kg logged that day. A same-day swing that size isn't a real bodyweight change, so this row is skipped.`,
      };
    }

    const rowMinutes = row.timeKnown ? timeStrToMinutes(row.timeStr) : null;
    const timesDisagree = row.timeKnown && closest.timeKnown
      && Math.abs(rowMinutes - closest.minutesOfDay) > TIME_AGREEMENT_WIGGLE_MINUTES;

    let kind;
    if (diff <= DUPLICATE_CLOSE_KG && !timesDisagree) {
      kind = 'duplicate';
    } else if (diff >= IMPLAUSIBLE_DAY_SWING_KG) {
      kind = 'large-swing';
    } else {
      kind = 'overlap';
    }

    // other: the actual conflicting weight, kept alongside diff so the
    // "?" explanation can show the real comparison (what you're entering
    // vs. what's already there) instead of a generic notice.
    const overlap = { kind, diff, other: closest.weightKg };
    const defaultInclude = kind === 'overlap';
    return { ...row, overlap, defaultInclude, include: defaultInclude };
  });
}
