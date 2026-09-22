/**
 * Just enough linear model for analysis of variance.
 *
 * A two-way ANOVA is a comparison of nested models: how much of the variation
 * is left once each factor is allowed for. Doing that with sums over cells
 * only works when every cell holds the same number of values, and lab data
 * rarely does, so the sums of squares come from least squares instead, which
 * stays correct however uneven the design.
 *
 * The residual sum of squares is all that is needed, so the columns are
 * orthogonalised (modified Gram-Schmidt) rather than solved: a column that
 * adds nothing new is dropped, which also gives the model's rank and keeps an
 * empty cell from breaking the fit.
 */

/** Dot product of two arrays. */
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

/**
 * Residual sum of squares of y on the given columns, and the rank of them.
 * `columns` is an array of equal-length arrays; the caller includes an
 * intercept column if it wants one.
 */
export function fitRss(columns, y) {
  const n = y.length;
  const basis = [];
  const scale = Math.sqrt(Math.max(1e-300, dot(y, y) / Math.max(1, n))) || 1;
  for (const column of columns) {
    const v = [...column];
    // Take out what the columns already kept can explain, twice: a second
    // pass keeps the basis orthogonal when columns are nearly parallel.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const q of basis) {
        const overlap = dot(q, v);
        for (let i = 0; i < n; i += 1) v[i] -= overlap * q[i];
      }
    }
    const norm = Math.sqrt(dot(v, v));
    // Anything this small is a copy of what is already there.
    if (norm <= 1e-9 * Math.max(1, scale) * Math.sqrt(n)) continue;
    basis.push(v.map((value) => value / norm));
  }
  let explained = 0;
  for (const q of basis) {
    const c = dot(q, y);
    explained += c * c;
  }
  return { rss: Math.max(0, dot(y, y) - explained), rank: basis.length };
}

/** An intercept column: the model's grand mean. */
export const ones = (n) => new Array(n).fill(1);

/**
 * Dummy columns for a factor, one per level after the first (treatment
 * coding). `codes` gives each observation's level.
 */
export function factorColumns(codes, levels) {
  return levels.slice(1).map((level) => codes.map((code) => (code === level ? 1 : 0)));
}

/** Every product of one column from each set: an interaction. */
export function interactionColumns(a, b) {
  const out = [];
  for (const left of a) for (const right of b) out.push(left.map((v, i) => v * right[i]));
  return out;
}
