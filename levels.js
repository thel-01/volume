// ---------------------------------------------------------------------------
// Exercise levels — named, ordered progressions with no kg value ("Small
// box" -> "Big box", "Red band" -> "Green band"). Bodyweight-type exercises
// only: the fourth chip in the Log screen's Assist / BW / Weight / Level
// row. See exercise_levels in schema.sql for the data model, and
// variationKey() / prCandidates() in strength-index.js for how the index
// and PRs treat them.
//
// Shared here rather than copied per page (unlike describeSet, which each
// page still keeps its own copy of) because the same rules — name limit,
// error wording, where a new level goes — must match everywhere a level
// can be created or renamed: log.html, history.html, exercises.html.
// ---------------------------------------------------------------------------

import { supabase } from './supabase-client.js';

/** Mirrors the exercise_levels_name_length check in schema.sql. */
export const LEVEL_NAME_MAX = 24;

/**
 * Every level the user owns, archived ones included — an archived level
 * still has to display on the old sets that used it. Easiest first within
 * each exercise. Hand-curated, so no fetchAllRows() paging needed.
 */
export async function fetchLevels() {
  const { data, error } = await supabase
    .from('exercise_levels')
    .select('*')
    .order('position')
    .order('created_at')
    .order('id');
  const levels = data || [];
  return { levels, byId: new Map(levels.map((l) => [l.id, l])), error };
}

/** One exercise's levels, easiest first. Archived ones only if asked. */
export function levelsFor(levels, exerciseId, { includeArchived = false } = {}) {
  return levels
    .filter((l) => l.exercise_id === exerciseId && (includeArchived || !l.archived_at))
    .sort((a, b) => a.position - b.position || new Date(a.created_at) - new Date(b.created_at));
}

/** Map<levelId, position>, the shape prCandidates() wants. */
export function levelPositions(levels) {
  return new Map(levels.map((l) => [l.id, l.position]));
}

/** A level set's display name — never blank, even if the level row is missing. */
export function levelName(levelId, byId) {
  const level = byId.get(levelId);
  return level ? level.name : 'Level';
}

/** "Big box × 12" — the level takes the slot "BW" / "+10 kg" would. */
export function describeLevelSet(set, byId, repsSuffix = '') {
  const reps = set.reps !== null && set.reps !== undefined ? ` × ${set.reps}${repsSuffix}` : '';
  return levelName(set.level_id, byId) + reps;
}

/** Trimmed name, or a user-facing error for a blank / too-long one. */
export function validateLevelName(raw) {
  const name = (raw || '').trim().replace(/\s+/g, ' ');
  if (!name) return { name, error: 'Enter a name for the level.' };
  if (name.length > LEVEL_NAME_MAX) {
    return { name, error: `Keep level names to ${LEVEL_NAME_MAX} characters or fewer.` };
  }
  return { name, error: null };
}

export function describeLevelError(error, name) {
  if (error.code === '23505') return `This exercise already has a level called "${name}".`;
  if (error.message?.includes('exercise_levels_name_length')) {
    return `Keep level names to ${LEVEL_NAME_MAX} characters or fewer.`;
  }
  if (error.code === '23503') return 'That level has sets logged at it, so it can only be archived.';
  return `Could not save the level: ${error.message}`;
}

/**
 * Adds a level at the hardest end of an exercise's ladder (the usual case:
 * you just moved past your current hardest). Reordering happens in the
 * exercise editor. `existing` is every level of this exercise, archived
 * included, so a new one never reuses an archived level's position.
 */
export async function createLevel(exerciseId, rawName, existing) {
  const { name, error: invalid } = validateLevelName(rawName);
  if (invalid) return { data: null, error: invalid };
  const position = existing.reduce((max, l) => Math.max(max, l.position), -1) + 1;
  const { data, error } = await supabase
    .from('exercise_levels')
    .insert({ exercise_id: exerciseId, name, position })
    .select()
    .single();
  return error ? { data: null, error: describeLevelError(error, name) } : { data, error: null };
}
