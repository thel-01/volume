// ---------------------------------------------------------------------------
// Shared date-label helpers used by any page listing dated entries
// (weight.html, history.html, dashboard.html).
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

/** Midnight local on the Monday of the week containing `date`. */
export function mondayOf(date) {
  const day = date.getDay(); // 0 = Sunday
  // Built from y/m/d in one go so a skipped midnight (some zones switch
  // clocks at 00:00) lands on the same instant for every date in that week.
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + (day === 0 ? -6 : 1 - day));
}

/**
 * `date` moved by whole calendar weeks (negative goes back), keeping the same
 * local clock time. Never add 7 x 24h in milliseconds instead: across a
 * daylight-saving change that lands an hour off, and a "Monday midnight"
 * stops matching the keys mondayOf() produces.
 */
export function addWeeks(date, weeks) {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

/**
 * Calendar days between `iso` and now — local midnight to local midnight,
 * never a raw 24h division. A session logged yesterday at 11pm is only ~10
 * hours before 9am today, but it's still yesterday: dividing elapsed
 * milliseconds by 86400000 would floor that to 0 and call it "today".
 */
export function daysAgo(iso) {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((startOfToday - startOfThatDay) / DAY_MS);
}

/**
 * "Today", "Yesterday", a bare weekday for the rest of this past week,
 * "Last {weekday}" for the week before that, then a plain date beyond —
 * the same escalation phones use for message timestamps, so it needs no
 * explaining. Day boundaries only — no time-of-day component, since callers
 * that have a clock time (or lack one) append that themselves.
 */
export function relativeDayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const dayDiff = daysAgo(iso);

  if (dayDiff <= 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff <= 6) return d.toLocaleDateString('en-US', { weekday: 'long' });
  if (dayDiff <= 13) return `Last ${d.toLocaleDateString('en-US', { weekday: 'long' })}`;

  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Compare calendar dates, allowing today's date-only reading before noon. */
export function isFutureLocalDate(dateStr) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return dateStr > today;
}
