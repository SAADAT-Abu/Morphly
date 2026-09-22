/**
 * Fitting a curve to points, and saying how sure we are of it.
 *
 * Dose response is the reason this exists: a figure that shows an IC50 has to
 * show how well that IC50 is pinned down, which means standard errors and a
 * confidence band, not just a line through the dots.
 *
 * The fit is Levenberg-Marquardt, written out here rather than taken from a
 * library, because what we need most is the covariance of the parameters at
 * the end, and the libraries hand back only the parameters. From the
 * covariance come the standard errors, the confidence intervals, and the band
 * drawn around the curve.
 *
 * Checked against R's nls(); see curveFit.test.js.
 */

import tquantile from "@stdlib/stats-base-dists-t-quantile";
import fcdf from "@stdlib/stats-base-dists-f-cdf";

/** Solve a small symmetric system by Gaussian elimination with pivoting. */
function solve(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-300) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row, i) => row[n] / a[i][i]);
}

/** Invert a small symmetric matrix, for the covariance of the parameters. */
function invert(matrix) {
  const n = matrix.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const unit = new Array(n).fill(0);
    unit[i] = 1;
    const column = solve(matrix, unit);
    if (!column) return null;
    out.push(column);
  }
  // Columns come out as rows of `out`; transpose back.
  return out[0].map((_, i) => out.map((row) => row[i]));
}

/** The gradient of `f` at `x` with respect to each parameter, numerically. */
function gradient(model, x, parameters) {
  return parameters.map((value, i) => {
    const step = Math.max(1e-7, Math.abs(value) * 1e-6);
    const up = [...parameters];
    const down = [...parameters];
    up[i] = value + step;
    down[i] = value - step;
    return (model(x, up) - model(x, down)) / (2 * step);
  });
}

/**
 * Fit `model(x, parameters)` to the points by least squares.
 *
 * Returns the parameters, their standard errors and 95% confidence intervals,
 * the residual sum of squares, R squared, and a `predict` function that also
 * gives the standard error of the curve at any x, which is what the
 * confidence band is drawn from.
 */
export function fitCurve({ x, y, model, start, maxSteps = 200, tolerance = 1e-10 }) {
  const n = x.length;
  const p = start.length;
  if (n <= p) return { error: `A fit with ${p} parameters needs more than ${p} points.` };

  const residualsAt = (parameters) => x.map((xi, i) => y[i] - model(xi, parameters));
  const sumSquares = (residuals) => residuals.reduce((sum, r) => sum + r * r, 0);

  let parameters = [...start];
  let residuals = residualsAt(parameters);
  let rss = sumSquares(residuals);
  if (!Number.isFinite(rss)) return { error: "The starting values do not give a curve." };
  let lambda = 1e-3;

  for (let step = 0; step < maxSteps; step += 1) {
    const jacobian = x.map((xi) => gradient(model, xi, parameters));
    // Normal equations: (JtJ + lambda diag(JtJ)) delta = Jt r
    const jtj = Array.from({ length: p }, (_, a) =>
      Array.from({ length: p }, (_, b) => jacobian.reduce((sum, row) => sum + row[a] * row[b], 0))
    );
    const jtr = Array.from({ length: p }, (_, a) => jacobian.reduce((sum, row, i) => sum + row[a] * residuals[i], 0));

    let improved = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const damped = jtj.map((row, i) => row.map((value, j) => (i === j ? value * (1 + lambda) + 1e-12 : value)));
      const delta = solve(damped, jtr);
      if (!delta) break;
      const candidate = parameters.map((value, i) => value + delta[i]);
      const candidateResiduals = residualsAt(candidate);
      const candidateRss = sumSquares(candidateResiduals);
      if (Number.isFinite(candidateRss) && candidateRss < rss) {
        const gain = rss - candidateRss;
        parameters = candidate;
        residuals = candidateResiduals;
        rss = candidateRss;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (gain < tolerance * (rss + tolerance)) step = maxSteps;
        break;
      }
      lambda *= 10;
    }
    if (!improved && lambda > 1e10) break;
  }

  const df = n - p;
  const mse = rss / df;
  const jacobian = x.map((xi) => gradient(model, xi, parameters));
  const jtj = Array.from({ length: p }, (_, a) =>
    Array.from({ length: p }, (_, b) => jacobian.reduce((sum, row) => sum + row[a] * row[b], 0))
  );
  const inverse = invert(jtj);
  const covariance = inverse ? inverse.map((row) => row.map((value) => value * mse)) : null;
  const errors = covariance ? covariance.map((row, i) => Math.sqrt(Math.max(0, row[i]))) : parameters.map(() => NaN);
  const tCritical = df > 0 ? tquantile(0.975, df) : NaN;

  const mean = y.reduce((sum, v) => sum + v, 0) / n;
  const totalSquares = y.reduce((sum, v) => sum + (v - mean) ** 2, 0);

  return {
    parameters,
    errors,
    intervals: parameters.map((value, i) => [value - tCritical * errors[i], value + tCritical * errors[i]]),
    rss,
    df,
    mse,
    r2: totalSquares > 0 ? 1 - rss / totalSquares : NaN,
    n,
    covariance,
    /** The curve at `xi`, with the standard error of the curve there. */
    predict: (xi) => {
      const value = model(xi, parameters);
      if (!covariance) return { value, se: NaN };
      const g = gradient(model, xi, parameters);
      let variance = 0;
      for (let a = 0; a < p; a += 1) for (let b = 0; b < p; b += 1) variance += g[a] * covariance[a][b] * g[b];
      return { value, se: Math.sqrt(Math.max(0, variance)) };
    },
    tCritical,
  };
}

/**
 * The models Morphly fits, with sensible starting values worked out from the
 * points themselves, so nobody has to guess them.
 *
 * Every model names its parameters in the order the fit returns them.
 */
export const MODELS = {
  "4pl": {
    label: "Dose response (four parameters)",
    parameters: ["Bottom", "Top", "IC50", "Hill slope"],
    /** Bottom + (Top - Bottom) / (1 + (IC50 / x) ^ hill), the form used with a dose on a log axis. */
    fn: (x, [bottom, top, ic50, hill]) => bottom + (top - bottom) / (1 + (Math.max(ic50, 1e-12) / Math.max(x, 1e-12)) ** hill),
    start: (x, y) => {
      const low = Math.min(...y);
      const high = Math.max(...y);
      const middle = (low + high) / 2;
      // The dose nearest the half way point is the first guess at the IC50.
      let guess = x[0];
      let best = Infinity;
      x.forEach((xi, i) => {
        const distance = Math.abs(y[i] - middle);
        if (distance < best) {
          best = distance;
          guess = xi;
        }
      });
      const rising = y[y.length - 1] >= y[0];
      return [low, high, Math.max(guess, 1e-9), rising ? 1 : -1];
    },
    /** What the middle parameter is called once fitted. */
    key: "IC50",
  },
  "exp-decay": {
    label: "Exponential decay",
    parameters: ["Y0", "Plateau", "Rate"],
    fn: (x, [y0, plateau, rate]) => plateau + (y0 - plateau) * Math.exp(-rate * x),
    start: (x, y) => {
      const span = Math.max(...x) - Math.min(...x) || 1;
      return [y[0], y[y.length - 1], 1 / span];
    },
    key: "Half life",
    derived: ([, , rate]) => ({ "Half life": Math.log(2) / rate }),
  },
  association: {
    label: "One-phase association",
    parameters: ["Y0", "Plateau", "Rate"],
    fn: (x, [y0, plateau, rate]) => y0 + (plateau - y0) * (1 - Math.exp(-rate * x)),
    start: (x, y) => {
      const span = Math.max(...x) - Math.min(...x) || 1;
      return [y[0], Math.max(...y), 1 / span];
    },
    key: "Half time",
    derived: ([, , rate]) => ({ "Half time": Math.log(2) / rate }),
  },
  "michaelis-menten": {
    label: "Michaelis-Menten",
    parameters: ["Vmax", "Km"],
    fn: (x, [vmax, km]) => (vmax * x) / (km + x),
    start: (x, y) => [Math.max(...y) * 1.1, Math.max(1e-9, (Math.max(...x) + Math.min(...x)) / 4)],
  },
};

/** Fit one of the named models, choosing its starting values. */
export function fitModel(name, x, y) {
  const model = MODELS[name];
  if (!model) return { error: `Unknown model: ${name}` };
  const points = x.map((xi, i) => [xi, y[i]]).filter(([xi, yi]) => Number.isFinite(xi) && Number.isFinite(yi));
  if (points.length < model.parameters.length + 1) {
    return { error: `${model.label} needs at least ${model.parameters.length + 1} points.` };
  }
  const xs = points.map(([xi]) => xi);
  const ys = points.map(([, yi]) => yi);
  const fit = fitCurve({ x: xs, y: ys, model: model.fn, start: model.start(xs, ys) });
  if (fit.error) return fit;
  return { ...fit, model: name, label: model.label, names: model.parameters, derived: model.derived?.(fit.parameters) ?? {} };
}

/**
 * Compare two fits of the same points by the extra sum of squares F test: is
 * the richer model worth its extra parameters? This is how Prism asks whether
 * two curves share an IC50.
 */
export function compareFits(simpler, richer) {
  const dfDifference = simpler.df - richer.df;
  if (dfDifference <= 0 || richer.df <= 0) return null;
  const F = ((simpler.rss - richer.rss) / dfDifference) / (richer.rss / richer.df);
  return { F, df1: dfDifference, df2: richer.df, p: Math.max(0, 1 - fcdf(F, dfDifference, richer.df)) };
}
