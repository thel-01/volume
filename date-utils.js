// ---------------------------------------------------------------------------
// Shared date-label helpers used by any page listing dated entries
// (weight.html, history.html, dashboard.html).
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

/** Midnight local on the Monday of the week containing `date`. */
export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
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
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfEntryDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfToday - startOfEntryDay) / DAY_MS);

  if (dayDiff <= 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff <= 6) return d.toLocaleDateString('en-US', { weekday: 'long' });
  if (dayDiff <= 13) return `Last ${d.toLocaleDateString('en-US', { weekday: 'long' })}`;

  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}
