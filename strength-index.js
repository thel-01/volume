// ---------------------------------------------------------------------------
// Strength index maths.
//
// DOM-free and Supabase-free on purpose, so it can be imported straight into a
// test file and checked with plain assertions.
//
// Everything rests on one number — an estimated 1RM — which is what lets a set
// with more reps be compared against a set with more weight. Without it, a
// block spent holding 60kg and grinding 12/8/6 up to 12/12/12 looks like no
// progress at all, because the weight on the bar never moved.
// ---------------------------------------------------------------------------

// Above roughly 15 reps an estimated 1RM stops meaning anything: the formula
// keeps climbing but top-end strength does not. Clamping (rather than dropping
// the set) means a long set can still win on weight, never on reps alone.
export const REP_CLAMP = 15;

/**
 * Epley's formula. Chosen over Brzycki (w * 36/(37-r)), which inflates badly
 * past ~12 reps and divides by zero at 37. Epley rises steadily with both
 * weight and reps at every rep count, which is what a trend needs.
 */
export function epley(weight, reps) {
  const w = Number(weight);
  const r = Math.min(Number(reps), REP_CLAMP);
  if (!isFinite(w) || !isFinite(r) || w <= 0 || r <= 0) return null;
  if (r === 1) return w; // the plain formula would say 1.033 * w here
  return w * (1 + r / 30);
}

/**
 * Reps actually earned toward a comparison — a 'failure' tag means the last
 * rep attempted wasn't completed, so it can't count the same as a clean rep:
 * "13 reps, failure" is really "12 clean reps, then a failed attempt at a
 * 13th," not evidence of 13 clean reps. Every site that ranks or compares
 * sets by reps (the estimated-1RM input here, dashboard.html's PR ranking,
 * log.html's session-to-beat, exercise-trend.html's per-session best) should
 * run reps through this first rather than reading `set.reps` directly.
 *
 * 'hard' and 'easy' are NOT discounted here — they stay quality signals used
 * only to break a tie between two sets that already score identically, same
 * as before. Only 'failure' changes what a set is worth, because only
 * 'failure' means a rep was actually not completed.
 */
export function effectiveReps(reps, tag) {
  const r = Number(reps);
  if (!isFinite(r)) return r;
  return tag === 'failure' ? r - 1 : r;
}

/**
 * Zero assistance on a legacy 'assisted' exercise isn't an assisted set at
 * all — it's a plain bodyweight rep that happens to live on an exercise
 * still locked to the old type. Treated identically to a 'bodyweight' type's
 * zero-delta set everywhere: display, scoring, the index.
 */
export function isBodyweightEquivalent(set, type) {
  return type === 'bodyweight' || (type === 'assisted' && Number(set.weight || 0) === 0);
}

/**
 * The load a set was actually performed against.
 *
 * For 'bodyweight' (and a zero-assistance 'assisted' set, see
 * isBodyweightEquivalent), that's a snapshot of bodyweight at log time plus
 * a signed delta (assistance subtracts, added weight adds) — one continuous
 * number that lets the exact same 1RM ranking used for barbell work follow
 * a single exercise all the way from heavily assisted through unassisted
 * bodyweight to weighted. Every other type just passes its stored weight
 * through unchanged. A non-zero 'assisted' set is deliberately NOT given an
 * inversion here — it stays excluded, exactly as before.
 */
export function effectiveLoad(set, type) {
  if (!isBodyweightEquivalent(set, type)) return set.weight;
  if (set.bodyweight_kg === null || set.bodyweight_kg === undefined) return null;
  const delta = set.weight_direction === 'assist' ? -Number(set.weight || 0) : Number(set.weight || 0);
  return Number(set.bodyweight_kg) + delta;
}

/** Only weight × reps sets carry a load/rep pair, so only they can be scored. */
export function isScorable(set, type) {
  if (type !== 'weight_reps' && !isBodyweightEquivalent(set, type)) return false;
  const load = effectiveLoad(set, type);
  if (load === null || set.reps === null) return false;
  // A load at or below zero (e.g. heavily assisted) scores as a divide-by-
  // zero or a meaningless negative 1RM, same reasoning as a 0kg barbell set.
  return load > 0 && Number(set.reps) > 0;
}

function geometricMean(values) {
  if (values.length === 0) return null;
  // Averaged in log space: with dozens of values a plain product would drift
  // on floating point long before it overflowed.
  return Math.exp(values.reduce((acc, v) => acc + Math.log(v), 0) / values.length);
}

/**
 * Each session's *capacity curve*, per exercise.
 *
 * caps[i] is the (i+1)-th best set of the session, so caps[0] is the top set,
 * caps[1] is "what I held for two sets", caps[2] "…for three".
 *
 * This is the empirical quantile function of the session's sets, and comparing
 * matched order statistics across sessions is what makes set count tractable:
 * adding a 4th set cannot change C₁–C₃, it only creates C₄.
 *
 * Returns Map<exerciseId, [{ date, caps, best, sets }]> sorted oldest first.
 */
export function sessionCapacities(sets, exercises) {
  const typeById = new Map(exercises.map((e) => [e.id, e.type]));
  const byExercise = new Map(); // exerciseId -> sessionId -> { date, scored[] }

  for (const s of sets) {
    const type = typeById.get(s.exercise_id);
    if (type === undefined) continue; // exercise soft-deleted, or not ours
    if (!isScorable(s, type)) continue;
    if (!s.sessions || s.sessions.deleted_at) continue;

    const value = epley(effectiveLoad(s, type), effectiveReps(s.reps, s.quick_tag));
    if (value === null) continue;

    if (!byExercise.has(s.exercise_id)) byExercise.set(s.exercise_id, new Map());
    const bySession = byExercise.get(s.exercise_id);
    if (!bySession.has(s.session_id)) {
      bySession.set(s.session_id, { date: s.sessions.start_time, scored: [] });
    }
    bySession.get(s.session_id).scored.push({ value, set: s });
  }

  const out = new Map();
  for (const [exerciseId, bySession] of byExercise) {
    const points = [];
    for (const { date, scored } of bySession.values()) {
      scored.sort((a, b) => b.value - a.value);
      points.push({
        date,
        caps: scored.map((x) => x.value),
        sets: scored.map((x) => x.set),
        best: scored[0].set,
      });
    }
    points.sort((a, b) => new Date(a.date) - new Date(b.date));
    out.set(exerciseId, points);
  }
  return out;
}

/**
 * How many capacity lines to draw for an exercise.
 *
 * Taken from the recent sessions rather than the whole history, so a one-off
 * long session doesn't leave a two-point stub dangling under the chart for
 * ever. Capped, because sets past the fourth are usually drop sets.
 */
export function displayDepths(points, { lookback = 5, cap = 4 } = {}) {
  if (!points || points.length === 0) return 0;
  const recent = points.slice(-lookback);
  // Keep a depth only if MORE than half your recent sessions actually reached
  // it. A median would pass a depth you hit in exactly half of them, which
  // leaves a two-point line dangling under the chart looking like a bug.
  let depth = 1;
  for (let k = 2; k <= cap; k++) {
    const present = recent.filter((p) => p.caps.length >= k).length;
    if (present * 2 <= recent.length) break;
    depth = k;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Time Product Dummy index (two-way fixed effects, in logs)
//
//     log Cₖᵗ = μ + δₜ + γₖ + ε
//
// δₜ is the session effect — the index. γₖ is the depth effect: how far your
// k-th best set typically falls below your top set, pooled across all sessions
// rather than guessed per session from three noisy points.
//
// Plain OLS, identified by fixing δ₀ = 0 and γ₁ = 0.
//
// Why this rather than chaining ratios session to session: a chained index is a
// running product, so it is path dependent, and on an unbalanced panel (which
// is what varying set counts produce) it does not return to its starting value
// when the data returns to its starting value. That is chain drift, and it was
// measured at nearly 10 index points on real data. TPD is a pure function of
// the rows, so editing an old session and refitting simply gives the right
// answer. It also needs no imputation for missing depths — the design matrix
// handles them — which is what removes every tuning constant this used to have.
// ---------------------------------------------------------------------------

/** Gauss-Jordan solve of Ax = b, also returning A⁻¹. Null if singular. */
function solveWithInverse(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
    b[i],
  ]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-11) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = col; j < M[col].length; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let j = col; j < M[r].length; j++) M[r][j] -= f * M[col][j];
    }
  }
  return { x: M.map((row) => row[2 * n]), inv: M.map((row) => row.slice(n, 2 * n)) };
}

/**
 * Fit the index for one exercise's capacity curves.
 *
 * Returns { series, gamma, sigma, n, p, df } or null when there isn't enough
 * to estimate from (a single session says nothing about change).
 *
 * `series[t].se` is the standard error of δₜ in log points. On a handful of
 * sessions it is often larger than the moves themselves, which is worth
 * knowing before reading meaning into a wobble.
 */
export function fitExerciseIndex(points) {
  const T = points ? points.length : 0;
  if (T < 2) return null;
  const K = Math.max(...points.map((p) => p.caps.length));

  const rows = [];
  points.forEach((p, t) => {
    p.caps.forEach((v, i) => {
      if (v > 0) rows.push({ t, k: i + 1, y: Math.log(v) });
    });
  });

  const p = 1 + (T - 1) + (K - 1); // μ, δ₁…δ_{T-1}, γ₂…γ_K
  const n = rows.length;
  if (n < p) return null;

  const design = rows.map((r) => {
    const x = new Array(p).fill(0);
    x[0] = 1;
    if (r.t > 0) x[r.t] = 1;
    if (r.k > 1) x[(T - 1) + r.k - 1] = 1;
    return x;
  });

  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      if (design[i][a] === 0) continue;
      Xty[a] += design[i][a] * rows[i].y;
      for (let b = 0; b < p; b++) XtX[a][b] += design[i][a] * design[i][b];
    }
  }

  const sol = solveWithInverse(XtX, Xty);
  if (!sol) return null;
  const beta = sol.x;

  let rss = 0;
  for (let i = 0; i < n; i++) {
    let fit = 0;
    for (let a = 0; a < p; a++) fit += design[i][a] * beta[a];
    rss += (rows[i].y - fit) ** 2;
  }
  const df = n - p;
  const sigma2 = df > 0 ? rss / df : 0;

  const series = points.map((pt, t) => {
    const delta = t === 0 ? 0 : beta[t];
    const se = t === 0 ? 0 : Math.sqrt(Math.max(0, sigma2 * sol.inv[t][t]));
    return { date: pt.date, value: 100 * Math.exp(delta), se, caps: pt.caps, best: pt.best };
  });

  const gamma = [{ depth: 1, pct: 0 }];
  for (let k = 2; k <= K; k++) {
    gamma.push({ depth: k, pct: (Math.exp(beta[(T - 1) + k - 1]) - 1) * 100 });
  }

  return { series, gamma, sigma: Math.sqrt(sigma2), n, p, df };
}

/**
 * The composite index across every movement pattern.
 *
 * Three rules do the work:
 *
 *  1. Each exercise's own trajectory comes from its TPD fit, so it is measured
 *     against its own history and never against another exercise's absolute
 *     load. Swapping Back Squat for Front Squat is therefore not a collapse.
 *
 *  2. A pattern's level is the geometric mean of the levels of the exercises
 *     logged in its MOST RECENT session — its current evidence. Averaging
 *     rather than multiplying stops five curl variations counting as five
 *     separate gains; using only the latest session stops a variation you have
 *     abandoned from diluting the one you actually train.
 *
 *  3. A new exercise joins at its pattern's current level, and a new pattern
 *     joins at the current composite. The geometric mean of a set of numbers
 *     plus their own geometric mean is unchanged, so joining is exactly
 *     neutral — starting a new movement can never drag the number down.
 *
 * Because the composite averages pattern *levels* rather than their changes, a
 * pattern you stop training keeps its old number while everything else climbs
 * past it, and drags the mean down by itself. Stalling and silence come out
 * identical, with no staleness rule anywhere.
 *
 * Returns [{ date, value }], one point per session, oldest first.
 */
export function compositeIndexSeries(sets, exercises) {
  const byExercise = sessionCapacities(sets, exercises);
  if (byExercise.size === 0) return [];

  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  // An exercise with no movement pattern counts as its own pattern — there are
  // no grounds to assume two unfiled exercises train the same thing.
  const patternKey = (exerciseId) => {
    const ex = exerciseById.get(exerciseId);
    return ex && ex.movement_pattern_id ? `p:${ex.movement_pattern_id}` : `e:${exerciseId}`;
  };

  // Only exercises with a fit contribute. One session carries no information
  // about change, so including it would just anchor a pattern in place.
  const events = [];
  for (const [exerciseId, points] of byExercise) {
    const fit = fitExerciseIndex(points);
    if (!fit) continue;
    for (const s of fit.series) {
      events.push({ exerciseId, date: s.date, relative: s.value / 100 });
    }
  }
  if (events.length === 0) return [];
  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  const patternLevel = new Map();  // patternKey -> level
  const joinLevel = new Map();     // exerciseId -> level it linked in at
  const exerciseLevel = new Map(); // exerciseId -> current level
  const series = [];

  const currentComposite = () => {
    const levels = [...patternLevel.values()];
    return levels.length === 0 ? 100 : geometricMean(levels);
  };

  let i = 0;
  while (i < events.length) {
    const date = events[i].date;
    const batch = [];
    while (i < events.length && events[i].date === date) batch.push(events[i++]);

    // Snapshot from before the batch, so several patterns starting on the same
    // day all link in at the same neutral level.
    const linkAt = currentComposite();
    const touched = new Map();

    for (const ev of batch) {
      const key = patternKey(ev.exerciseId);
      if (!patternLevel.has(key)) patternLevel.set(key, linkAt);
      if (!joinLevel.has(ev.exerciseId)) {
        // Rebased onto its pattern, so picking up a new variation neither
        // rewards nor punishes you for its unfamiliar absolute load.
        joinLevel.set(ev.exerciseId, patternLevel.get(key));
      }
      exerciseLevel.set(ev.exerciseId, joinLevel.get(ev.exerciseId) * ev.relative);

      if (!touched.has(key)) touched.set(key, []);
      touched.get(key).push(exerciseLevel.get(ev.exerciseId));
    }

    for (const [key, levels] of touched) patternLevel.set(key, geometricMean(levels));

    series.push({ date, value: currentComposite() });
  }

  return series;
}
