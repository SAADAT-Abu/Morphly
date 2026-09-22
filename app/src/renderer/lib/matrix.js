/**
 * Tables of numbers: matrices, and the things worth doing to them.
 *
 * Morphly's other data shapes each answer one question (are these groups
 * different? does y follow x?). A table answers many: the same gene by sample
 * matrix is a heatmap, a PCA and a correlation matrix, and two of its columns
 * are a volcano, a ROC curve or a Bland-Altman plot. So this file holds the
 * mathematics and leaves the choosing to the graph.
 *
 * Nothing here is approximate for convenience: the eigenvectors come from a
 * Jacobi rotation run to convergence, the AUC is the exact rank statistic with
 * ties counted as halves, and the interval around it is DeLong's. Checked
 * against R (prcomp, cor, hclust, pROC); see matrix.test.js.
 */

import normalcdf from "@stdlib/stats-base-dists-normal-cdf";
import tquantile from "@stdlib/stats-base-dists-t-quantile";
import { parseNumber, rowCount } from "./datasets";
import { mean, pearson, spearman } from "./stats";

const normalUpper = (z) => 1 - normalcdf(z, 0, 1);

// ---------------------------------------------------------------------------
// Reading a table
// ---------------------------------------------------------------------------

/**
 * The columns of a table that hold numbers, by index. The first column names
 * the rows, so it is never one of them.
 */
export function numericColumns(dataset) {
  const out = [];
  for (let c = 1; c < (dataset?.columns.length ?? 0); c += 1) {
    const values = dataset.columns[c].values.filter((v) => String(v).trim() !== "");
    const numbers = values.filter((v) => Number.isFinite(parseNumber(v))).length;
    if (values.length > 0 && numbers >= values.length / 2) out.push(c);
  }
  return out;
}

/**
 * A table as a matrix: the chosen columns, and only the rows where every one
 * of them holds a number. Rows keep the name in the first column, or a number
 * if that cell is blank, so nothing is ever drawn nameless.
 */
export function tableMatrix(dataset, { columns = numericColumns(dataset) } = {}) {
  const colNames = columns.map((c, i) => dataset.columns[c]?.name || `Column ${i + 1}`);
  const rowNames = [];
  const rows = [];
  for (let r = 0; r < rowCount(dataset); r += 1) {
    const values = columns.map((c) => parseNumber(dataset.columns[c]?.values[r]));
    if (!values.every(Number.isFinite)) continue;
    rowNames.push(String(dataset.columns[0]?.values[r] ?? "").trim() || `Row ${rows.length + 1}`);
    rows.push(values);
  }
  return {
    rowNames,
    colNames,
    columns,
    rows,
    /** The same numbers the other way round: one array per column. */
    cols: colNames.map((_, c) => rows.map((row) => row[c])),
  };
}

/** One column of a table as numbers, keeping blanks out, row by row. */
export const columnValues = (dataset, col) =>
  (dataset.columns[col]?.values ?? []).map(parseNumber);

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
};

/**
 * Centre and, if asked, scale each column to a standard deviation of one.
 * A column that never changes is left centred at zero rather than divided by
 * nothing.
 */
export function standardise(rows, { scale = true } = {}) {
  if (!rows.length) return { rows: [], centres: [], scales: [] };
  const p = rows[0].length;
  const centres = [];
  const scales = [];
  for (let c = 0; c < p; c += 1) {
    const column = rows.map((row) => row[c]);
    centres.push(mean(column));
    const s = scale ? sd(column) : 1;
    scales.push(s > 0 ? s : 1);
  }
  return {
    rows: rows.map((row) => row.map((v, c) => (v - centres[c]) / scales[c])),
    centres,
    scales,
  };
}

/**
 * Z scores across each row, which is how a heatmap of expression is nearly
 * always drawn: every gene is shown as how far each sample is from that gene's
 * own mean, so a quiet gene and a loud one can share a colour scale.
 */
export function zScoreRows(rows) {
  return rows.map((row) => {
    const m = mean(row);
    const s = sd(row);
    return row.map((v) => (s > 0 ? (v - m) / s : 0));
  });
}

// ---------------------------------------------------------------------------
// Eigenvectors, and principal components
// ---------------------------------------------------------------------------

/**
 * Eigenvalues and eigenvectors of a small symmetric matrix, by cyclic Jacobi
 * rotation: pick the off-diagonal entries one at a time and rotate them away,
 * over and over, until what is left off the diagonal is nothing. Slow for a
 * big matrix and exact for the sizes a figure ever shows.
 *
 * Returns eigenvalues largest first, with `vectors[k]` the k-th eigenvector.
 */
export function jacobiEigen(matrix, { sweeps = 100, tolerance = 1e-14 } = {}) {
  const n = matrix.length;
  const m = matrix.map((row) => [...row]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += m[p][q] * m[p][q];
    if (off <= tolerance) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(m[p][q]) < 1e-300) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const kp = m[k][p];
          const kq = m[k][q];
          m[k][p] = c * kp - s * kq;
          m[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < n; k += 1) {
          const pk = m[p][k];
          const qk = m[q][k];
          m[p][k] = c * pk - s * qk;
          m[q][k] = s * pk + c * qk;
        }
        for (let k = 0; k < n; k += 1) {
          const kp = v[k][p];
          const kq = v[k][q];
          v[k][p] = c * kp - s * kq;
          v[k][q] = s * kp + c * kq;
        }
      }
    }
  }

  const values = m.map((row, i) => row[i]);
  const order = values.map((_, i) => i).sort((a, b) => values[b] - values[a]);
  return {
    values: order.map((i) => values[i]),
    vectors: order.map((i) => v.map((row) => row[i])),
  };
}

/**
 * Principal components of a matrix whose rows are the points.
 *
 * `scale` divides each column by its standard deviation first, which is what
 * you want when the columns are measured in different units and what R's
 * prcomp(scale. = TRUE) does.
 *
 * The sign of a component is arbitrary (a component and its negative describe
 * the same axis), so each one is turned to make its largest loading positive.
 * Otherwise the same data would be drawn mirrored from one run to the next.
 */
export function pca(rows, { scale = true } = {}) {
  const n = rows.length;
  const p = rows[0]?.length ?? 0;
  if (n < 2 || p < 2) return { error: "A PCA needs at least two points and two columns." };

  const { rows: centred } = standardise(rows, { scale });
  const covariance = Array.from({ length: p }, (_, a) =>
    Array.from({ length: p }, (_, b) => centred.reduce((sum, row) => sum + row[a] * row[b], 0) / (n - 1))
  );
  const { values, vectors } = jacobiEigen(covariance);

  const loadings = vectors.map((vector) => {
    let biggest = 0;
    vector.forEach((value, i) => {
      if (Math.abs(value) > Math.abs(vector[biggest])) biggest = i;
    });
    return vector[biggest] < 0 ? vector.map((value) => -value) : vector;
  });

  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const components = Math.min(p, n - 1);
  return {
    sdev: values.slice(0, components).map((value) => Math.sqrt(Math.max(0, value))),
    explained: values.slice(0, components).map((value) => (total > 0 ? Math.max(0, value) / total : 0)),
    loadings: loadings.slice(0, components),
    /** scores[i][k] is point i on component k. */
    scores: centred.map((row) => loadings.slice(0, components).map((vector) => row.reduce((sum, value, j) => sum + value * vector[j], 0))),
    n,
    p,
    scaled: scale,
  };
}

// ---------------------------------------------------------------------------
// Correlation between columns
// ---------------------------------------------------------------------------

export const CORRELATION_METHODS = [
  ["pearson", "Pearson"],
  ["spearman", "Spearman"],
];

/**
 * Every column against every other: the correlation and its p value, as a
 * square matrix with the names down the side.
 *
 * The p value comes from the t statistic on n - 2 degrees of freedom, which is
 * what cor.test() reports for Pearson and, as an approximation, for Spearman.
 */
export function correlationMatrix(cols, names, { method = "pearson" } = {}) {
  const k = cols.length;
  const r = Array.from({ length: k }, () => new Array(k).fill(NaN));
  const p = Array.from({ length: k }, () => new Array(k).fill(NaN));
  for (let a = 0; a < k; a += 1) {
    r[a][a] = 1;
    p[a][a] = 0;
    for (let b = a + 1; b < k; b += 1) {
      const result = method === "spearman" ? spearman(cols[a], cols[b]) : pearson(cols[a], cols[b]);
      // Spearman calls its coefficient rho; a matrix of them is still a matrix.
      const value = method === "spearman" ? result.rho : result.r;
      r[a][b] = value;
      r[b][a] = value;
      p[a][b] = result.p;
      p[b][a] = result.p;
    }
  }
  return { names, r, p, method, n: cols[0]?.length ?? 0 };
}

// ---------------------------------------------------------------------------
// Ordering rows and columns by how alike they are
// ---------------------------------------------------------------------------

const euclidean = (a, b) => Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
const correlationDistance = (a, b) => {
  const { r } = pearson(a, b);
  return Number.isFinite(r) ? 1 - r : 1;
};

/**
 * Hierarchical clustering by average linkage, returning the order the rows
 * should be drawn in and the tree that produced it.
 *
 * Average linkage is hclust(method = "average"), also called UPGMA: the
 * distance between two clusters is the mean distance between their members.
 * The order is the tree read left to right, with the tighter child first, so
 * the picture does not depend on which row happened to be typed first.
 */
export function clusterRows(rows, { metric = "euclidean" } = {}) {
  const n = rows.length;
  if (n < 2) return { order: rows.map((_, i) => i), merges: [], heights: [] };
  const distance = metric === "correlation" ? correlationDistance : euclidean;

  const clusters = rows.map((_, i) => ({ members: [i], leaves: [i], height: 0 }));
  const between = new Map();
  const key = (a, b) => `${a}|${b}`;
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) between.set(key(a, b), distance(rows[a], rows[b]));
  }

  const live = clusters.map((_, i) => i);
  const merges = [];
  const heights = [];
  const pairDistance = (a, b) => {
    let sum = 0;
    for (const i of clusters[a].members) for (const j of clusters[b].members) sum += between.get(i < j ? key(i, j) : key(j, i));
    return sum / (clusters[a].members.length * clusters[b].members.length);
  };

  while (live.length > 1) {
    let best = Infinity;
    let pick = [0, 1];
    for (let x = 0; x < live.length; x += 1) {
      for (let y = x + 1; y < live.length; y += 1) {
        const d = pairDistance(live[x], live[y]);
        if (d < best) {
          best = d;
          pick = [x, y];
        }
      }
    }
    const [x, y] = pick;
    const a = live[x];
    const b = live[y];
    // The tighter cluster goes first, so the drawn order is repeatable.
    const first = clusters[a].height <= clusters[b].height ? a : b;
    const second = first === a ? b : a;
    clusters.push({
      members: [...clusters[a].members, ...clusters[b].members],
      leaves: [...clusters[first].leaves, ...clusters[second].leaves],
      height: best,
    });
    merges.push([a, b]);
    heights.push(best);
    live.splice(y, 1);
    live.splice(x, 1);
    live.push(clusters.length - 1);
  }

  return { order: clusters[clusters.length - 1].leaves, merges, heights };
}

// ---------------------------------------------------------------------------
// ROC curves
// ---------------------------------------------------------------------------

/**
 * The ROC curve for a score against a true class, with the area under it.
 *
 * The area is the exact rank statistic (the Mann-Whitney U over the number of
 * pairs, with a tie counting a half), not the area of the drawn polygon, so it
 * is right even when many subjects share a score. The interval is DeLong's,
 * which is what pROC reports by default.
 */
export function rocCurve(scores, positive) {
  const points = scores
    .map((score, i) => ({ score, positive: Boolean(positive[i]) }))
    .filter((d) => Number.isFinite(d.score));
  const cases = points.filter((d) => d.positive).map((d) => d.score);
  const controls = points.filter((d) => !d.positive).map((d) => d.score);
  if (cases.length === 0 || controls.length === 0) {
    return { error: "A ROC curve needs subjects in both classes." };
  }

  // DeLong: for each case, how often it outranks a control, and the reverse.
  const psi = (a, b) => (a > b ? 1 : a === b ? 0.5 : 0);
  const v10 = cases.map((x) => mean(controls.map((y) => psi(x, y))));
  const v01 = controls.map((y) => mean(cases.map((x) => psi(x, y))));
  const auc = mean(v10);
  const varianceOf = (xs) => {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return xs.reduce((sum, v) => sum + (v - m) ** 2, 0) / (xs.length - 1);
  };
  const variance = varianceOf(v10) / cases.length + varianceOf(v01) / controls.length;
  const se = Math.sqrt(Math.max(0, variance));
  const z = se > 0 ? (auc - 0.5) / se : 0;

  // The curve itself: every distinct score is a threshold.
  const thresholds = [...new Set(points.map((d) => d.score))].sort((a, b) => b - a);
  const curve = [{ fpr: 0, tpr: 0, threshold: Infinity }];
  for (const threshold of thresholds) {
    const tp = cases.filter((s) => s >= threshold).length;
    const fp = controls.filter((s) => s >= threshold).length;
    curve.push({ fpr: fp / controls.length, tpr: tp / cases.length, threshold });
  }
  curve.push({ fpr: 1, tpr: 1, threshold: -Infinity });

  // Youden's J: the threshold where the curve stands furthest from the
  // diagonal, which is the cut people usually quote.
  let best = curve[0];
  let bestJ = -Infinity;
  for (const point of curve) {
    const j = point.tpr - point.fpr;
    if (Number.isFinite(point.threshold) && j > bestJ) {
      bestJ = j;
      best = point;
    }
  }

  return {
    curve,
    auc,
    se,
    low: Math.max(0, auc - 1.959963985 * se),
    high: Math.min(1, auc + 1.959963985 * se),
    p: se > 0 ? 2 * normalUpper(Math.abs(z)) : NaN,
    cases: cases.length,
    controls: controls.length,
    best: {
      threshold: best.threshold,
      sensitivity: best.tpr,
      specificity: 1 - best.fpr,
      youden: bestJ,
    },
  };
}

/**
 * Which cells count as the positive class. A column of 1 and 0 is the obvious
 * case; a column of words takes whichever word is named, or the one that
 * appears first if none is.
 */
export function classLabels(values, chosen = null) {
  const text = values.map((v) => String(v ?? "").trim());
  const present = [...new Set(text.filter((v) => v !== ""))];
  const positive =
    chosen && present.includes(chosen)
      ? chosen
      : present.find((v) => ["1", "yes", "true", "case", "positive", "y"].includes(v.toLowerCase())) ?? present[0] ?? "";
  return { levels: present, positive, flags: text.map((v) => v === positive) };
}

// ---------------------------------------------------------------------------
// Agreement between two measurements
// ---------------------------------------------------------------------------

/**
 * Bland and Altman's comparison of two ways of measuring the same thing: each
 * subject's mean against the difference between the methods.
 *
 * The bias is the mean difference and the limits of agreement are 1.96
 * standard deviations either side of it, the range in which 95% of differences
 * are expected to fall. Each of those three lines gets its own confidence
 * interval, because with few subjects the limits are themselves uncertain.
 */
export function blandAltman(a, b) {
  const pairs = a
    .map((value, i) => [value, b[i]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 3) return { error: "Agreement needs at least three paired measurements." };
  const points = pairs.map(([x, y]) => ({ mean: (x + y) / 2, difference: x - y }));
  const differences = points.map((d) => d.difference);
  const n = differences.length;
  const bias = mean(differences);
  const spread = sd(differences);
  const t = tquantile(0.975, n - 1);
  const biasSe = spread / Math.sqrt(n);
  // Bland and Altman's approximation for the uncertainty of a limit.
  const limitSe = spread * Math.sqrt(3 / n);
  return {
    points,
    n,
    bias,
    sd: spread,
    biasInterval: [bias - t * biasSe, bias + t * biasSe],
    lower: bias - 1.959963985 * spread,
    upper: bias + 1.959963985 * spread,
    lowerInterval: [bias - 1.959963985 * spread - t * limitSe, bias - 1.959963985 * spread + t * limitSe],
    upperInterval: [bias + 1.959963985 * spread - t * limitSe, bias + 1.959963985 * spread + t * limitSe],
    /** Is the bias itself different from zero? A paired t test in disguise. */
    biasT: biasSe > 0 ? bias / biasSe : NaN,
    df: n - 1,
  };
}
