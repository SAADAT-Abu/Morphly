/**
 * Statistics for graphs.
 *
 * The test statistics are computed here, from their textbook formulas, and
 * every p-value comes from a distribution function in stdlib (the t, F,
 * normal, chi-square and studentized range distributions, and exact rank
 * distributions counted here), which
 * match R to the last digit. Each test mirrors R's default behaviour so that a
 * result from Morphly can be reproduced in R, and stats.test.js checks each
 * one against numbers computed by R itself:
 *
 *   Unpaired t test          t.test(x, y, var.equal = TRUE)
 *   Welch's t test           t.test(x, y)
 *   Paired t test            t.test(x, y, paired = TRUE)
 *   Mann-Whitney test        wilcox.test(x, y)  (R 4.6: exact below 50, ties too)
 *   Wilcoxon signed rank     wilcox.test(x, y, paired = TRUE)  (the same)
 *   One-way ANOVA + Tukey    aov() and TukeyHSD()
 *   Welch's ANOVA            oneway.test(var.equal = FALSE)
 *   Games-Howell             rstatix::games_howell_test()
 *   Kruskal-Wallis + Dunn    kruskal.test() and rstatix::dunn_test(p.adjust.method = "holm")
 *   Two-way ANOVA            aov(value ~ a * b) and car::Anova(type = "II")
 *   Dunnett's test           scipy.stats.dunnett()
 *   Repeated measures ANOVA  aov(value ~ group + Error(subject / group))
 *   Friedman                 friedman.test()
 *   Shapiro-Wilk             shapiro.test()  (Royston's algorithm, as R)
 *   Brown-Forsythe           car::leveneTest()  (centred on the median)
 *   Pearson, Spearman        cor.test(); Spearman's p from the t approximation
 *   Linear regression        lm(y ~ x)
 *
 * Nothing here touches the DOM, so it all runs under the unit tests.
 */

import tcdf from "@stdlib/stats-base-dists-t-cdf";
import tquantile from "@stdlib/stats-base-dists-t-quantile";
import fcdf from "@stdlib/stats-base-dists-f-cdf";
import pnormBase from "@stdlib/stats-base-dists-normal-cdf";
import qnormBase from "@stdlib/stats-base-dists-normal-quantile";
import chisqcdf from "@stdlib/stats-base-dists-chisquare-cdf";
import ptukeyBase from "@stdlib/stats-base-dists-studentized-range-cdf";
import { fitRss, ones, factorColumns, interactionColumns } from "./linearModel";

const pnorm = (x) => pnormBase(x, 0, 1);
const qnorm = (p) => qnormBase(p, 0, 1);
/** Two-sided p for a t statistic. */
export const tTwoSided = (t, df) => 2 * tcdf(-Math.abs(t), df);
/** Upper tail of the studentized range, the p of a Tukey-type comparison. */
export const ptukeyUpper = (q, k, df) => Math.min(1, Math.max(0, 1 - ptukeyBase(q, k, df)));
const fUpper = (f, d1, d2) => Math.max(0, 1 - fcdf(f, d1, d2));
const chisqUpper = (x, df) => Math.max(0, 1 - chisqcdf(x, df));

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs) => sum(xs) / xs.length;

/** Sample variance, n - 1 in the denominator. */
export function variance(xs) {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) * (x - m))) / (n - 1);
}

/** Quantile by R's default method (type 7). */
export function quantile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Ranks from 1, ties sharing their average rank, as R's rank(). */
export function rank(xs) {
  const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}

/** Sizes of the groups of tied values, for tie corrections. */
function tieSizes(xs) {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.values()].filter((t) => t > 1);
}

/** Mean, spread and quartiles of one column of numbers. */
export function describe(values) {
  const xs = values.filter(Number.isFinite);
  const n = xs.length;
  if (n === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = mean(xs);
  const sd = n > 1 ? Math.sqrt(variance(xs)) : 0;
  const sem = n > 1 ? sd / Math.sqrt(n) : 0;
  const ci = n > 1 ? tquantile(0.975, n - 1) * sem : 0;
  return {
    n,
    mean: m,
    sd,
    sem,
    ci,
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    min: sorted[0],
    max: sorted[n - 1],
  };
}

/** Holm's step-down adjustment, as R's p.adjust(method = "holm"). */
export function adjustHolm(ps) {
  const m = ps.length;
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(m);
  let running = 0;
  order.forEach(([p, i], rankIndex) => {
    running = Math.max(running, Math.min(1, (m - rankIndex) * p));
    out[i] = running;
  });
  return out;
}

export const adjustBonferroni = (ps) => ps.map((p) => Math.min(1, p * ps.length));

// ---------------------------------------------------------------------------
// Two groups
// ---------------------------------------------------------------------------

/** Unpaired t test; Welch's version unless `equalVariance`. */
export function tTest(x, y, { equalVariance = false } = {}) {
  const n1 = x.length;
  const n2 = y.length;
  const v1 = variance(x);
  const v2 = variance(y);
  const diff = mean(x) - mean(y);
  let se;
  let df;
  if (equalVariance) {
    df = n1 + n2 - 2;
    const pooled = ((n1 - 1) * v1 + (n2 - 1) * v2) / df;
    se = Math.sqrt(pooled * (1 / n1 + 1 / n2));
  } else {
    const a = v1 / n1;
    const b = v2 / n2;
    se = Math.sqrt(a + b);
    df = (a + b) ** 2 / (a ** 2 / (n1 - 1) + b ** 2 / (n2 - 1));
  }
  const t = diff / se;
  return { t, df, p: tTwoSided(t, df), diff };
}

/** Paired t test on matched pairs. */
export function pairedTTest(x, y) {
  const d = x.map((v, i) => v - y[i]);
  const n = d.length;
  const se = Math.sqrt(variance(d) / n);
  const t = mean(d) / se;
  return { t, df: n - 1, p: tTwoSided(t, n - 1), diff: mean(d) };
}

/**
 * Exact distribution of a rank sum, by counting.
 *
 * Ranks are doubled so that tied (half) ranks become whole numbers, then
 * `counts[s]` is how many ways a sum of 2s can be reached: over subsets of
 * exactly `size` ranks (the rank sum test), or over any subset (the signed rank
 * test, where each rank is independently positive or negative). This is R
 * 4.6's exact conditional distribution, which also holds with ties; without
 * ties it is the classic Wilcoxon distribution.
 */
function rankSumCounts(ranks, size = null) {
  const doubled = ranks.map((r) => Math.round(r * 2));
  const total = doubled.reduce((a, b) => a + b, 0);
  if (size === null) {
    let counts = new Float64Array(total + 1);
    counts[0] = 1;
    let reach = 0;
    for (const d of doubled) {
      for (let s = reach; s >= 0; s -= 1) if (counts[s]) counts[s + d] += counts[s];
      reach += d;
    }
    return counts;
  }
  // ways[k][s]: subsets of k of the ranks seen so far with doubled sum s.
  const ways = Array.from({ length: size + 1 }, () => new Float64Array(total + 1));
  ways[0][0] = 1;
  let reach = 0;
  doubled.forEach((d, idx) => {
    for (let k = Math.min(size, idx + 1); k >= 1; k -= 1) {
      const from = ways[k - 1];
      const to = ways[k];
      for (let s = reach; s >= 0; s -= 1) if (from[s]) to[s + d] += from[s];
    }
    reach += d;
  });
  return ways[size];
}

/** P(sum <= q) and P(sum >= q) from counts over doubled sums. */
function tails(counts, q) {
  const q2 = Math.round(q * 2);
  let below = 0;
  let above = 0;
  let all = 0;
  for (let s = 0; s < counts.length; s += 1) {
    const c = counts[s];
    if (!c) continue;
    all += c;
    if (s <= q2) below += c;
    if (s >= q2) above += c;
  }
  return { lower: below / all, upper: above / all };
}

/** Two-sided p from a normal approximation with a continuity correction. */
function normalTwoSided(z) {
  return Math.min(1, 2 * Math.min(pnorm(z), 1 - pnorm(z)));
}

/**
 * Mann-Whitney (Wilcoxon rank sum) test, as R 4.6's wilcox.test(x, y): exact
 * below 50 values per group, ties included; otherwise the normal
 * approximation with continuity and tie corrections.
 */
export function mannWhitney(x, y) {
  const n1 = x.length;
  const n2 = y.length;
  const r = rank([...x, ...y]);
  const offset = (n1 * (n1 + 1)) / 2;
  const W = sum(r.slice(0, n1)) - offset;
  const exact = n1 < 50 && n2 < 50;
  let p;
  if (exact) {
    const { lower, upper } = tails(rankSumCounts(r, n1), W + offset);
    p = Math.min(1, 2 * lower, 2 * upper);
  } else {
    const N = n1 + n2;
    const ties = tieSizes([...x, ...y]);
    const z = W - (n1 * n2) / 2;
    const sigma = Math.sqrt(((n1 * n2) / 12) * (N + 1 - sum(ties.map((t) => t ** 3 - t)) / (N * (N - 1))));
    p = normalTwoSided((z - Math.sign(z) * 0.5) / sigma);
  }
  return { W, p, exact };
}

/**
 * Wilcoxon signed rank test on matched pairs, as R 4.6's
 * wilcox.test(paired = TRUE): exact below 50 pairs, where zero differences
 * keep their place in the ranking and ties are allowed; otherwise the normal
 * approximation, with zero differences dropped.
 */
export function wilcoxonSignedRank(x, y) {
  const d = x.map((v, i) => v - y[i]);
  const n = d.length;
  if (n === 0) return { V: 0, p: 1, exact: false };
  if (n < 50) {
    const r = rank(d.map(Math.abs));
    const V = sum(r.filter((_, i) => d[i] > 0));
    const z = r.filter((_, i) => d[i] !== 0);
    if (z.length === 0) return { V, p: 1, exact: true };
    const { lower, upper } = tails(rankSumCounts(z), V);
    const middle = sum(z) / 2;
    return { V, p: Math.min(1, 2 * (V > middle ? upper : lower)), exact: true };
  }
  const nz = d.filter((v) => v !== 0);
  const m = nz.length;
  const r = rank(nz.map(Math.abs));
  const V = sum(r.filter((_, i) => nz[i] > 0));
  const ties = tieSizes(nz.map(Math.abs));
  const zStat = V - (m * (m + 1)) / 4;
  const sigma = Math.sqrt((m * (m + 1) * (2 * m + 1)) / 24 - sum(ties.map((t) => t ** 3 - t)) / 48);
  return { V, p: normalTwoSided((zStat - Math.sign(zStat) * 0.5) / sigma), exact: false };
}

// ---------------------------------------------------------------------------
// Several groups
// ---------------------------------------------------------------------------

const pairsOf = (k) => {
  const out = [];
  for (let i = 0; i < k; i += 1) for (let j = i + 1; j < k; j += 1) out.push([i, j]);
  return out;
};

/** One-way ANOVA. */
export function oneWayAnova(groups) {
  const k = groups.length;
  const all = groups.flat();
  const N = all.length;
  const grand = mean(all);
  const ssb = sum(groups.map((g) => g.length * (mean(g) - grand) ** 2));
  const ssw = sum(groups.map((g) => sum(g.map((x) => (x - mean(g)) ** 2))));
  const df1 = k - 1;
  const df2 = N - k;
  const F = ssb / df1 / (ssw / df2);
  return { F, df1, df2, p: fUpper(F, df1, df2), mse: ssw / df2, etaSquared: ssb / (ssb + ssw) };
}

/** Tukey's honestly significant difference, every pair, as R's TukeyHSD(). */
export function tukeyHsd(groups, anova = oneWayAnova(groups)) {
  const k = groups.length;
  return pairsOf(k).map(([i, j]) => {
    const diff = mean(groups[j]) - mean(groups[i]);
    const se = Math.sqrt((anova.mse / 2) * (1 / groups[i].length + 1 / groups[j].length));
    return { i, j, diff, p: ptukeyUpper(Math.abs(diff) / se, k, anova.df2) };
  });
}

/** Welch's one-way ANOVA, which does not assume equal variances. */
export function welchAnova(groups) {
  const k = groups.length;
  const w = groups.map((g) => g.length / variance(g));
  const W = sum(w);
  const mw = sum(groups.map((g, i) => w[i] * mean(g))) / W;
  const tmp = sum(groups.map((g, i) => (1 - w[i] / W) ** 2 / (g.length - 1))) / (k * k - 1);
  const F = sum(groups.map((g, i) => w[i] * (mean(g) - mw) ** 2)) / ((k - 1) * (1 + 2 * (k - 2) * tmp));
  const df1 = k - 1;
  const df2 = 1 / (3 * tmp);
  return { F, df1, df2, p: fUpper(F, df1, df2) };
}

/** Games-Howell comparisons, the follow-up to Welch's ANOVA. */
export function gamesHowell(groups) {
  const k = groups.length;
  return pairsOf(k).map(([i, j]) => {
    const a = variance(groups[i]) / groups[i].length;
    const b = variance(groups[j]) / groups[j].length;
    const diff = mean(groups[j]) - mean(groups[i]);
    const df = (a + b) ** 2 / (a ** 2 / (groups[i].length - 1) + b ** 2 / (groups[j].length - 1));
    const q = Math.abs(diff) / Math.sqrt((a + b) / 2);
    return { i, j, diff, p: ptukeyUpper(q, k, df) };
  });
}

/** Kruskal-Wallis rank sum test, with the tie correction. */
export function kruskalWallis(groups) {
  const all = groups.flat();
  const N = all.length;
  const r = rank(all);
  let at = 0;
  let h = 0;
  for (const g of groups) {
    const rs = sum(r.slice(at, at + g.length));
    h += (rs * rs) / g.length;
    at += g.length;
  }
  h = (12 / (N * (N + 1))) * h - 3 * (N + 1);
  const ties = tieSizes(all);
  h /= 1 - sum(ties.map((t) => t ** 3 - t)) / (N ** 3 - N);
  const df = groups.length - 1;
  return { H: h, df, p: chisqUpper(h, df) };
}

/** Dunn's test after Kruskal-Wallis, Holm-adjusted, as rstatix::dunn_test(). */
export function dunnTest(groups) {
  const all = groups.flat();
  const N = all.length;
  const r = rank(all);
  const meanRanks = [];
  let at = 0;
  for (const g of groups) {
    meanRanks.push(mean(r.slice(at, at + g.length)));
    at += g.length;
  }
  const ties = tieSizes(all);
  const base = (N * (N + 1)) / 12 - sum(ties.map((t) => t ** 3 - t)) / (12 * (N - 1));
  const raw = pairsOf(groups.length).map(([i, j]) => {
    const z = (meanRanks[j] - meanRanks[i]) / Math.sqrt(base * (1 / groups[i].length + 1 / groups[j].length));
    return { i, j, z, p: 2 * (1 - pnorm(Math.abs(z))) };
  });
  const adjusted = adjustHolm(raw.map((c) => c.p));
  return raw.map((c, idx) => ({ ...c, pUnadjusted: c.p, p: adjusted[idx] }));
}

/**
 * One-way repeated measures ANOVA, sphericity assumed. `rows` are subjects,
 * each with one value per condition.
 */
export function repeatedMeasuresAnova(rows) {
  const n = rows.length;
  const k = rows[0].length;
  const all = rows.flat();
  const grand = mean(all);
  const colMeans = Array.from({ length: k }, (_, j) => mean(rows.map((r) => r[j])));
  const rowMeans = rows.map(mean);
  const ssTotal = sum(all.map((x) => (x - grand) ** 2));
  const ssCond = n * sum(colMeans.map((m) => (m - grand) ** 2));
  const ssSubj = k * sum(rowMeans.map((m) => (m - grand) ** 2));
  const ssErr = ssTotal - ssCond - ssSubj;
  const df1 = k - 1;
  const df2 = (n - 1) * (k - 1);
  const F = ssCond / df1 / (ssErr / df2);
  return { F, df1, df2, p: fUpper(F, df1, df2) };
}

/** Friedman rank sum test, as R's friedman.test(). */
export function friedman(rows) {
  const n = rows.length;
  const k = rows[0].length;
  const ranked = rows.map(rank);
  const colSums = Array.from({ length: k }, (_, j) => sum(ranked.map((r) => r[j])));
  const tieTerm = sum(rows.map((r) => sum(tieSizes(r).map((t) => t ** 3 - t))));
  const stat =
    (12 * sum(colSums.map((s) => (s - (n * (k + 1)) / 2) ** 2))) /
    (n * k * (k + 1) - tieTerm / (k - 1));
  const df = k - 1;
  return { chi2: stat, df, p: chisqUpper(stat, df) };
}

/** Every pair compared with a two-group test, then Holm-adjusted. */
function pairwiseHolm(k, compare) {
  const raw = pairsOf(k).map(([i, j]) => ({ i, j, p: compare(i, j) }));
  const adjusted = adjustHolm(raw.map((c) => c.p));
  return raw.map((c, idx) => ({ ...c, pUnadjusted: c.p, p: adjusted[idx] }));
}

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------

/** poly() from R's swilk.c: cc[0] + cc[1] x + ... evaluated Horner style. */
function swPoly(cc, nord, x) {
  let ret = cc[0];
  if (nord > 1) {
    let p = x * cc[nord - 1];
    for (let j = nord - 2; j > 0; j -= 1) p = (p + cc[j]) * x;
    ret += p;
  }
  return ret;
}

/**
 * Shapiro-Wilk normality test, Royston's algorithm AS R94 as in R's
 * shapiro.test(). Needs 3 to 5000 values that are not all equal.
 */
export function shapiroWilk(values) {
  const x = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = x.length;
  if (n < 3 || n > 5000) return null;
  const range = x[n - 1] - x[0];
  if (range < 1e-10) return null;

  const nn2 = Math.floor(n / 2);
  const a = new Array(nn2 + 1); // 1-based, as in the C original
  const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
  const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
  if (n === 3) {
    a[1] = Math.SQRT1_2;
  } else {
    const an25 = n + 0.25;
    let summ2 = 0;
    for (let i = 1; i <= nn2; i += 1) {
      a[i] = qnorm((i - 0.375) / an25);
      summ2 += a[i] * a[i];
    }
    summ2 *= 2;
    const ssumm2 = Math.sqrt(summ2);
    const rsn = 1 / Math.sqrt(n);
    const a1 = swPoly(c1, 6, rsn) - a[1] / ssumm2;
    let i1;
    let fac;
    if (n > 5) {
      i1 = 3;
      const a2 = -a[2] / ssumm2 + swPoly(c2, 6, rsn);
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1] - 2 * a[2] * a[2]) / (1 - 2 * a1 * a1 - 2 * a2 * a2));
      a[2] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1]) / (1 - 2 * a1 * a1));
    }
    a[1] = a1;
    for (let i = i1; i <= nn2; i += 1) a[i] = -a[i] / fac;
  }

  const m = mean(x);
  const ss = sum(x.map((v) => (v - m) ** 2));
  let b = 0;
  for (let i = 1; i <= nn2; i += 1) b += a[i] * (x[n - i] - x[i - 1]);
  const w = Math.min(1, (b * b) / ss);

  if (n === 3) {
    const p = Math.max(0, 1.90985931710274 * (Math.asin(Math.sqrt(w)) - 1.0471975511966));
    return { W: w, p: Math.min(1, p) };
  }
  let y = Math.log(1 - w);
  const xx = Math.log(n);
  let mu;
  let sigma;
  if (n <= 11) {
    const gamma = swPoly([-2.273, 0.459], 2, n);
    if (y >= gamma) return { W: w, p: 1e-99 };
    y = -Math.log(gamma - y);
    mu = swPoly([0.544, -0.39978, 0.025054, -6.714e-4], 4, n);
    sigma = Math.exp(swPoly([1.3822, -0.77857, 0.062767, -0.0020322], 4, n));
  } else {
    mu = swPoly([-1.5861, -0.31082, -0.083751, 0.0038915], 4, xx);
    sigma = Math.exp(swPoly([-0.4803, -0.082676, 0.0030302], 3, xx));
  }
  return { W: w, p: 1 - pnorm((y - mu) / sigma) };
}

/** Brown-Forsythe test for equal spread: ANOVA on distances from each median. */
export function brownForsythe(groups) {
  const deviations = groups.map((g) => {
    const med = quantile([...g].sort((a, b) => a - b), 0.5);
    return g.map((x) => Math.abs(x - med));
  });
  const { F, df1, df2, p } = oneWayAnova(deviations);
  return { F, df1, df2, p };
}

// ---------------------------------------------------------------------------
// X and Y
// ---------------------------------------------------------------------------

export function pearson(x, y) {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const r = sxy / Math.sqrt(sxx * syy);
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return { r, df: n - 2, p: n > 2 ? tTwoSided(t, n - 2) : NaN };
}

/** Spearman's rank correlation, p from the t approximation (as SciPy). */
export function spearman(x, y) {
  const { r, df, p } = pearson(rank(x), rank(y));
  return { rho: r, df, p };
}

/** Straight line by least squares, as R's lm(y ~ x). */
export function linearRegression(x, y) {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residuals = x.map((xi, i) => y[i] - (intercept + slope * xi));
  const sse = sum(residuals.map((r) => r * r));
  const sst = sum(y.map((v) => (v - my) ** 2));
  const df = n - 2;
  const seSlope = Math.sqrt(sse / df / sxx);
  const t = slope / seSlope;
  return { slope, intercept, r2: 1 - sse / sst, seSlope, df, p: tTwoSided(t, df) };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** GraphPad's star scheme. */
export function stars(p) {
  if (!(p < 0.05)) return "ns";
  if (p < 0.0001) return "****";
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  return "*";
}

/** "< 0.0001", "0.0123", "0.48": exact to four places near the thresholds. */
export function formatP(p) {
  if (!Number.isFinite(p)) return "n/a";
  if (p < 0.0001) return "< 0.0001";
  if (p < 0.1) return p.toFixed(4);
  return p.toFixed(2);
}

/** A number for a results line: three significant figures, no exponent. */
export function formatStat(x) {
  if (!Number.isFinite(x)) return "n/a";
  const abs = Math.abs(x);
  if (abs >= 100) return x.toFixed(1);
  if (abs >= 1) return x.toPrecision(3);
  return x.toFixed(3);
}


// ---------------------------------------------------------------------------
// Two factors at once
// ---------------------------------------------------------------------------

/**
 * Two-way ANOVA, with the interaction.
 *
 * `design` is { rows, cols, valuesAt(row, col) }: the levels of each factor
 * and the numbers in each cell. Sums of squares are type II (each factor
 * allowing for the other, and the interaction allowing for both), which is
 * what car::Anova(type = "II") reports and, unlike the sequential kind, does
 * not depend on which factor is named first. With the same number of values
 * in every cell the two agree, and both match R's aov().
 */
export function twoWayAnova(design) {
  const y = [];
  const rowCodes = [];
  const colCodes = [];
  for (const row of design.rows) {
    for (const col of design.cols) {
      for (const value of design.valuesAt(row, col)) {
        y.push(value);
        rowCodes.push(row);
        colCodes.push(col);
      }
    }
  }
  const n = y.length;
  if (n === 0 || design.rows.length < 2 || design.cols.length < 2) return null;

  const A = factorColumns(rowCodes, design.rows);
  const B = factorColumns(colCodes, design.cols);
  const AB = interactionColumns(A, B);
  const base = [ones(n)];
  const rss = (...sets) => fitRss([...base, ...sets.flat()], y);

  // Type II: each main effect is judged against a model holding the other
  // one (and no interaction), and the interaction against both main effects.
  const full = rss(A, B, AB);
  const mains = rss(A, B);
  const onlyRows = rss(A);
  const onlyCols = rss(B);
  const dfResidual = n - full.rank;
  if (dfResidual <= 0) return null;
  const msResidual = full.rss / dfResidual;

  const term = (reduced, richer) => {
    const df = richer.rank - reduced.rank;
    if (df <= 0 || msResidual <= 0) return { ss: 0, df: 0, F: NaN, p: NaN };
    const ss = reduced.rss - richer.rss;
    const F = ss / df / msResidual;
    return { ss, df, F, p: fUpper(F, df, dfResidual) };
  };

  const rowsTerm = term(onlyCols, mains);
  const colsTerm = term(onlyRows, mains);
  const interaction = term(mains, full);

  const counts = design.rows.flatMap((row) => design.cols.map((col) => design.valuesAt(row, col).length));
  return {
    rows: rowsTerm,
    cols: colsTerm,
    interaction,
    residual: { ss: full.rss, df: dfResidual, ms: msResidual },
    n,
    balanced: counts.every((c) => c === counts[0]),
    empty: counts.filter((c) => c === 0).length,
  };
}

/**
 * Dunnett's test: every group against one control, allowing for the fact that
 * all the comparisons share that control.
 *
 * The p-value is the probability that the largest of k correlated t statistics
 * exceeds the one observed. With equal group sizes those statistics all
 * correlate at one half, which makes the probability a double integral, done
 * here by Gauss-Legendre quadrature over the control's own deviation and over
 * the pooled spread. Matches scipy.stats.dunnett.
 */
export function dunnettTest(groups, controlIndex = 0) {
  if (groups.length < 2) return [];
  const anova = oneWayAnova(groups);
  const mse = anova.mse;
  const df = anova.df2;
  const nControl = groups[controlIndex].length;
  // Each comparison's t statistic is a standard normal shifted by the
  // control's own deviation: a_i says how strongly it is shifted, b_i how wide
  // its window is. They are what ties the comparisons together.
  const shape = groups
    .map((g, j) => ({ j, a: Math.sqrt(g.length / nControl), b: Math.sqrt(1 + g.length / nControl) }))
    .filter((s) => s.j !== controlIndex);

  return shape.map(({ j }) => {
    const diff = mean(groups[j]) - mean(groups[controlIndex]);
    const t = diff / Math.sqrt(mse * (1 / groups[j].length + 1 / nControl));
    return { i: controlIndex, j, diff, t, p: dunnettP(Math.abs(t), shape, df) };
  });
}

/** Nodes and weights for Gauss-Legendre quadrature on [-1, 1]. */
function legendre(nodes) {
  const x = [];
  const w = [];
  for (let i = 1; i <= nodes; i += 1) {
    // Newton's method from the usual starting guess.
    let guess = Math.cos((Math.PI * (i - 0.25)) / (nodes + 0.5));
    for (let step = 0; step < 100; step += 1) {
      let p0 = 1;
      let p1 = 0;
      for (let j = 0; j < nodes; j += 1) {
        const p2 = p1;
        p1 = p0;
        p0 = ((2 * j + 1) * guess * p1 - j * p2) / (j + 1);
      }
      const derivative = (nodes * (guess * p0 - p1)) / (guess * guess - 1);
      const next = guess - p0 / derivative;
      if (Math.abs(next - guess) < 1e-14) {
        guess = next;
        break;
      }
      guess = next;
    }
    let p0 = 1;
    let p1 = 0;
    for (let j = 0; j < nodes; j += 1) {
      const p2 = p1;
      p1 = p0;
      p0 = ((2 * j + 1) * guess * p1 - j * p2) / (j + 1);
    }
    const derivative = (nodes * (guess * p0 - p1)) / (guess * guess - 1);
    x.push(guess);
    w.push(2 / ((1 - guess * guess) * derivative * derivative));
  }
  return { x, w };
}

const GL = legendre(60);

/**
 * Integrate f over [a, b] by Gauss-Legendre, in panels. One panel is not
 * enough over a wide range: a Dunnett p-value of a few parts in a million
 * comes out half as large again.
 */
function integrate(f, a, b, panels = 12) {
  const step = (b - a) / panels;
  let total = 0;
  for (let panel = 0; panel < panels; panel += 1) {
    const from = a + panel * step;
    const half = step / 2;
    const mid = from + half;
    let sum = 0;
    for (let i = 0; i < GL.x.length; i += 1) sum += GL.w[i] * f(mid + half * GL.x[i]);
    total += sum * half;
  }
  return total;
}

const normalPdf = (z) => Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);

/**
 * Two-sided p for Dunnett's statistic: one minus the chance that every one of
 * the comparisons stays within `t`.
 *
 * Conditional on the control's deviation and on the pooled spread, the
 * comparisons are independent, so the chance they all stay inside is a
 * product. Averaging that over both leaves a double integral, done by
 * Gauss-Legendre quadrature.
 */
function dunnettP(t, shape, df) {
  const covered = (s) =>
    integrate(
      (u) =>
        normalPdf(u) *
        shape.reduce((product, { a, b }) => product * (pnorm(a * u + t * s * b) - pnorm(a * u - t * s * b)), 1),
      -8.5,
      8.5
    );
  if (!Number.isFinite(df) || df > 2000) return Math.max(0, Math.min(1, 1 - covered(1)));
  // The pooled spread is a chi variable on the residual degrees of freedom.
  const logDensity = (s) =>
    Math.LN2 + (df / 2) * Math.log(df / 2) - logGamma(df / 2) + (df - 1) * Math.log(s) - (df * s * s) / 2;
  const total = integrate((s) => Math.exp(logDensity(s)) * covered(s), 1e-9, 1 + 10 / Math.sqrt(df));
  return Math.max(0, Math.min(1, 1 - total));
}

/** log of the gamma function (Lanczos), for the chi density above. */
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// ---------------------------------------------------------------------------
// Shapes of a distribution: violins, histograms, density
// ---------------------------------------------------------------------------

/**
 * The bandwidth R uses by default for density(): 0.9 times the smaller of the
 * standard deviation and the interquartile range over 1.34, times n to the
 * power of minus a fifth (bw.nrd0).
 */
export function bandwidthNrd0(values) {
  const n = values.length;
  if (n < 2) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const sd = Math.sqrt(variance(values));
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  // R's bw.nrd0 divides by 1.34, not by the 1.349 of the normal quartile.
  let spread = Math.min(sd, iqr / 1.34);
  if (!(spread > 0)) spread = sd || Math.abs(values[0]) || 1;
  return 0.9 * spread * n ** -0.2;
}

/**
 * A smooth curve through the values: a Gaussian kernel at each point,
 * averaged, as R's density(kernel = "gaussian") does. Returns `points` pairs
 * spanning the data plus three bandwidths either side, which is R's default
 * cut.
 */
export function kernelDensity(values, { bandwidth = null, points = 128, from = null, to = null } = {}) {
  const xs = values.filter(Number.isFinite);
  if (xs.length === 0) return [];
  const bw = bandwidth ?? bandwidthNrd0(xs);
  const lo = from ?? Math.min(...xs) - 3 * bw;
  const hi = to ?? Math.max(...xs) + 3 * bw;
  const step = points > 1 ? (hi - lo) / (points - 1) : 0;
  const scale = 1 / (xs.length * bw * Math.sqrt(2 * Math.PI));
  const out = [];
  for (let i = 0; i < points; i += 1) {
    const x = lo + i * step;
    let sum = 0;
    for (const value of xs) {
      const z = (x - value) / bw;
      sum += Math.exp(-0.5 * z * z);
    }
    out.push({ x, y: sum * scale });
  }
  return out;
}

/**
 * Bins for a histogram. The width follows the Freedman-Diaconis rule (twice
 * the interquartile range over the cube root of n), rounded to a round number
 * so the edges read well, and falls back to Sturges' count when the values are
 * too alike for that to work.
 */
export function histogramBins(values, { binWidth = null } = {}) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return { breaks: [], counts: [], width: 0 };
  const lo = xs[0];
  const hi = xs[n - 1];
  if (hi === lo) return { breaks: [lo - 0.5, lo + 0.5], counts: [n], width: 1 };

  let width = binWidth;
  if (!(width > 0)) {
    const iqr = quantile(xs, 0.75) - quantile(xs, 0.25);
    const fd = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : 0;
    const sturges = (hi - lo) / (Math.ceil(Math.log2(n)) + 1);
    const raw = fd > 0 ? fd : sturges;
    // Round to 1, 2 or 5 times a power of ten, so the edges are readable.
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const steps = [1, 2, 2.5, 5, 10];
    width = magnitude * (steps.find((s) => raw <= s * magnitude) ?? 10);
  }
  const start = Math.floor(lo / width) * width;
  const breaks = [];
  for (let edge = start; edge < hi + width; edge += width) breaks.push(Number(edge.toFixed(10)));
  if (breaks[breaks.length - 1] <= hi) breaks.push(Number((breaks[breaks.length - 1] + width).toFixed(10)));
  const counts = new Array(breaks.length - 1).fill(0);
  for (const value of xs) {
    let index = Math.floor((value - start) / width);
    if (index >= counts.length) index = counts.length - 1;
    if (index < 0) index = 0;
    counts[index] += 1;
  }
  return { breaks, counts, width };
}

// ---------------------------------------------------------------------------
// Counts in categories
// ---------------------------------------------------------------------------

const logFactorial = (n) => logGamma(n + 1);

/** Probability of one 2 by 2 table under Fisher's model. */
function hypergeometric(a, b, c, d) {
  const n = a + b + c + d;
  return Math.exp(
    logFactorial(a + b) + logFactorial(c + d) + logFactorial(a + c) + logFactorial(b + d) - logFactorial(n) -
      logFactorial(a) - logFactorial(b) - logFactorial(c) - logFactorial(d)
  );
}

/**
 * Fisher's exact test on a 2 by 2 table, two-sided as R does it: the sum of
 * the probabilities of every table no more likely than the one observed, with
 * the row and column totals held fixed.
 *
 * Returns the odds ratio as the simple cross-product, which is what most
 * people mean by it; R reports a conditional maximum likelihood estimate
 * instead, so the two can differ while the p-value agrees.
 */
/**
 * How many tables share this table's margins, which is how much work an exact
 * test would be. It grows with the counts themselves, not with the size of the
 * table, so a 2 by 2 of sequencing counts is far more work than a 2 by 2 of
 * mice.
 */
export function fisherTableCount([[a, b], [c, d]]) {
  const rowOne = a + b;
  const rowTwo = c + d;
  const colOne = a + c;
  return Math.min(colOne, rowOne) - Math.max(0, colOne - rowTwo) + 1;
}

/**
 * Past this many tables the enumeration below would stall a redraw, and every
 * redraw happens again on the next keystroke in the data table. At counts that
 * large the chi-square approximation agrees with the exact test to more
 * decimal places than anyone reports, so the caller is told to use that
 * instead of being left waiting.
 */
export const FISHER_MAX_TABLES = 500000;

export function fisherExact([[a, b], [c, d]]) {
  const rowOne = a + b;
  const rowTwo = c + d;
  const colOne = a + c;
  const n = rowOne + rowTwo;
  const tables = fisherTableCount([[a, b], [c, d]]);
  if (!(tables <= FISHER_MAX_TABLES)) {
    return {
      p: NaN,
      oddsRatio: (a * d) / (b * c),
      n,
      tables,
      error: "The counts are too large to enumerate every table; use the chi-square test.",
    };
  }
  const observed = hypergeometric(a, b, c, d);
  const lowest = Math.max(0, colOne - rowTwo);
  const highest = Math.min(colOne, rowOne);
  let p = 0;
  for (let x = lowest; x <= highest; x += 1) {
    const probability = hypergeometric(x, rowOne - x, colOne - x, rowTwo - colOne + x);
    // "No more likely than what happened", with room for rounding.
    if (probability <= observed * (1 + 1e-7)) p += probability;
  }
  const oddsRatio = (a * d) / (b * c);
  return { p: Math.min(1, p), oddsRatio, n };
}

/**
 * Chi-square test of independence on a table of counts.
 *
 * Yates' continuity correction is applied to 2 by 2 tables, as R's
 * chisq.test does unless told otherwise.
 */
export function chiSquareTest(table, { correct = true } = {}) {
  const rows = table.length;
  const cols = table[0].length;
  const rowSums = table.map((row) => row.reduce((a, b) => a + b, 0));
  const colSums = Array.from({ length: cols }, (_, j) => table.reduce((sum, row) => sum + row[j], 0));
  const n = rowSums.reduce((a, b) => a + b, 0);
  if (n === 0) return null;
  const yates = correct && rows === 2 && cols === 2;
  let stat = 0;
  let smallest = Infinity;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const expected = (rowSums[i] * colSums[j]) / n;
      smallest = Math.min(smallest, expected);
      if (expected <= 0) continue;
      let diff = Math.abs(table[i][j] - expected);
      if (yates) diff = Math.max(0, diff - 0.5);
      stat += (diff * diff) / expected;
    }
  }
  const df = (rows - 1) * (cols - 1);
  return { chi2: stat, df, p: chisqUpper(stat, df), n, smallestExpected: smallest, yates };
}

/**
 * McNemar's test on paired proportions: the same subjects judged twice, so
 * only the pairs that changed carry information.
 */
export function mcnemarTest([[, b], [c]], { correct = true } = {}) {
  const changed = b + c;
  if (changed === 0) return { chi2: 0, df: 1, p: 1, discordant: 0 };
  let diff = Math.abs(b - c);
  if (correct) diff = Math.max(0, diff - 1);
  const chi2 = (diff * diff) / changed;
  return { chi2, df: 1, p: chisqUpper(chi2, 1), discordant: changed, correct };
}

/**
 * Cochran-Armitage test for a trend in proportions across ordered groups,
 * as R's prop.trend.test. `successes` and `totals` are per group, and
 * `scores` defaults to 1, 2, 3 and so on.
 */
export function trendTest(successes, totals, scores = null) {
  const k = successes.length;
  const x = scores ?? Array.from({ length: k }, (_, i) => i + 1);
  const n = totals.reduce((a, b) => a + b, 0);
  const s = successes.reduce((a, b) => a + b, 0);
  const p = s / n;
  const weightedMean = totals.reduce((sum, t, i) => sum + t * x[i], 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < k; i += 1) {
    numerator += (successes[i] - totals[i] * p) * (x[i] - weightedMean);
    denominator += totals[i] * (x[i] - weightedMean) ** 2;
  }
  const chi2 = (numerator * numerator) / (p * (1 - p) * denominator);
  return { chi2, df: 1, p: chisqUpper(chi2, 1), n };
}

// ---------------------------------------------------------------------------
// More ways to describe, and to check
// ---------------------------------------------------------------------------

/** The geometric mean: only defined when every value is above zero. */
export function geometricMean(values) {
  const xs = values.filter((v) => Number.isFinite(v) && v > 0);
  if (xs.length !== values.length || xs.length === 0) return NaN;
  return Math.exp(xs.reduce((sum, v) => sum + Math.log(v), 0) / xs.length);
}

/** Coefficient of variation, as a percentage of the mean. */
export function coefficientOfVariation(values) {
  const m = mean(values);
  return m === 0 ? NaN : (Math.sqrt(variance(values)) / Math.abs(m)) * 100;
}

/**
 * Sample skewness (G1) and excess kurtosis (G2), the bias-corrected versions
 * used by Excel, SPSS and Prism, and by SciPy with bias = False.
 */
export function shape(values) {
  const n = values.length;
  const m = mean(values);
  if (n < 3) return { skewness: NaN, kurtosis: NaN };
  const m2 = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / n;
  const m3 = values.reduce((sum, v) => sum + (v - m) ** 3, 0) / n;
  const m4 = values.reduce((sum, v) => sum + (v - m) ** 4, 0) / n;
  const g1 = m3 / m2 ** 1.5;
  const skewness = (g1 * Math.sqrt(n * (n - 1))) / (n - 2);
  let kurtosis = NaN;
  if (n > 3) {
    const g2 = m4 / (m2 * m2) - 3;
    kurtosis = ((n - 1) * ((n + 1) * g2 + 6)) / ((n - 2) * (n - 3));
  }
  return { skewness, kurtosis };
}

/**
 * D'Agostino and Pearson's test: skewness and kurtosis together, each turned
 * into a standard normal and squared. Same as scipy.stats.normaltest, and what
 * Prism calls the D'Agostino-Pearson omnibus test. Needs at least 8 values.
 */
export function dAgostinoPearson(values) {
  const xs = values.filter(Number.isFinite);
  const n = xs.length;
  if (n < 8) return null;
  const m = mean(xs);
  const m2 = xs.reduce((sum, v) => sum + (v - m) ** 2, 0) / n;
  const m3 = xs.reduce((sum, v) => sum + (v - m) ** 3, 0) / n;
  const m4 = xs.reduce((sum, v) => sum + (v - m) ** 4, 0) / n;
  const b1 = m3 / m2 ** 1.5;
  const b2 = m4 / (m2 * m2);

  // Skewness to a standard normal (D'Agostino 1970).
  const y = b1 * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)));
  const beta2 = (3 * (n * n + 27 * n - 70) * (n + 1) * (n + 3)) / ((n - 2) * (n + 5) * (n + 7) * (n + 9));
  const w2 = -1 + Math.sqrt(2 * (beta2 - 1));
  const delta = 1 / Math.sqrt(0.5 * Math.log(w2));
  const alpha = Math.sqrt(2 / (w2 - 1));
  const zSkew = y === 0 ? 0 : delta * Math.log(y / alpha + Math.sqrt((y / alpha) ** 2 + 1));

  // Kurtosis to a standard normal (Anscombe and Glynn 1983).
  const meanB2 = (3 * (n - 1)) / (n + 1);
  const varB2 = (24 * n * (n - 2) * (n - 3)) / ((n + 1) ** 2 * (n + 3) * (n + 5));
  const x = (b2 - meanB2) / Math.sqrt(varB2);
  const sqrtBeta1 =
    ((6 * (n * n - 5 * n + 2)) / ((n + 7) * (n + 9))) * Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)));
  const a = 6 + (8 / sqrtBeta1) * (2 / sqrtBeta1 + Math.sqrt(1 + 4 / (sqrtBeta1 * sqrtBeta1)));
  const denominator = 1 + x * Math.sqrt(2 / (a - 4));
  const cube = Math.sign(denominator) * Math.cbrt((1 - 2 / a) / Math.abs(denominator));
  const zKurt = (1 - 2 / (9 * a) - cube) / Math.sqrt(2 / (9 * a));

  const k2 = zSkew * zSkew + zKurt * zKurt;
  return { k2, df: 2, p: chisqUpper(k2, 2), skewZ: zSkew, kurtosisZ: zKurt };
}

/**
 * Anderson-Darling test for normality, with the mean and spread estimated
 * from the data. The statistic matches scipy.stats.anderson; the p-value comes
 * from the usual approximation (D'Agostino and Stephens 1986), which is what
 * R's nortest::ad.test reports.
 */
export function andersonDarling(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = xs.length;
  if (n < 8) return null;
  const m = mean(xs);
  const sd = Math.sqrt(variance(xs));
  if (!(sd > 0)) return null;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const lower = pnorm((xs[i] - m) / sd);
    const upper = pnorm((xs[n - 1 - i] - m) / sd);
    sum += (2 * i + 1) * (Math.log(Math.max(lower, 1e-300)) + Math.log(Math.max(1 - upper, 1e-300)));
  }
  const a2 = -n - sum / n;
  const adjusted = a2 * (1 + 0.75 / n + 2.25 / (n * n));
  let p;
  if (adjusted < 0.2) p = 1 - Math.exp(-13.436 + 101.14 * adjusted - 223.73 * adjusted * adjusted);
  else if (adjusted < 0.34) p = 1 - Math.exp(-8.318 + 42.796 * adjusted - 59.938 * adjusted * adjusted);
  else if (adjusted < 0.6) p = Math.exp(0.9177 - 4.279 * adjusted - 1.38 * adjusted * adjusted);
  else p = Math.exp(1.2937 - 5.709 * adjusted + 0.0186 * adjusted * adjusted);
  return { a2, p: Math.max(0, Math.min(1, p)), n };
}

/**
 * Grubbs' test for one outlier: the value furthest from the mean, in units of
 * the standard deviation, against the critical value from the t distribution.
 * Two-sided, as most software reports it.
 */
export function grubbsTest(values) {
  const xs = values.filter(Number.isFinite);
  const n = xs.length;
  if (n < 3) return null;
  const m = mean(xs);
  const sd = Math.sqrt(variance(xs));
  if (!(sd > 0)) return null;
  let worst = xs[0];
  let g = 0;
  for (const value of xs) {
    const distance = Math.abs(value - m) / sd;
    if (distance > g) {
      g = distance;
      worst = value;
    }
  }
  // The critical value inverted: turn G back into a t and read its tail.
  const t2 = (g * g * (n - 2)) / ((n - 1) * (n - 1) - n * g * g);
  const t = Math.sqrt(Math.max(0, t2));
  const p = Math.min(1, n * tTwoSided(t, n - 2));
  return { G: g, value: worst, n, p };
}

// ---------------------------------------------------------------------------
// Effect sizes and more corrections
// ---------------------------------------------------------------------------

/**
 * Cohen's d and Hedges' g for two groups, with a 95% confidence interval for
 * g from its standard error. Pooled spread, as rstatix::cohens_d gives.
 */
export function effectSizeD(x, y) {
  const n1 = x.length;
  const n2 = y.length;
  const df = n1 + n2 - 2;
  const pooled = Math.sqrt((((n1 - 1) * variance(x) + (n2 - 1) * variance(y)) / df));
  const d = (mean(x) - mean(y)) / pooled;
  // Hedges' correction for small samples.
  const j = 1 - 3 / (4 * df - 1);
  const g = d * j;
  const se = Math.sqrt((n1 + n2) / (n1 * n2) + (g * g) / (2 * (n1 + n2)));
  const t = tquantile(0.975, df);
  return { d, g, se, low: g - t * se, high: g + t * se, magnitude: magnitudeOf(Math.abs(d)) };
}

const magnitudeOf = (d) => (d < 0.2 ? "negligible" : d < 0.5 ? "small" : d < 0.8 ? "medium" : "large");

/** Omega squared for a one-way ANOVA: eta squared with its bias removed. */
export function omegaSquared(anova, groups) {
  const ssb = anova.F * anova.df1 * anova.mse;
  const ssw = anova.mse * anova.df2;
  const total = ssb + ssw;
  const omega = (ssb - anova.df1 * anova.mse) / (total + anova.mse);
  return { omegaSquared: Math.max(0, omega), etaSquared: ssb / total, n: groups.flat().length };
}

/**
 * Benjamini-Hochberg: control the share of false positives among the
 * comparisons called significant, rather than the chance of any at all. The
 * same as p.adjust(method = "BH").
 */
export function adjustBenjaminiHochberg(ps) {
  const m = ps.length;
  const order = ps.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
  const out = new Array(m);
  let running = 1;
  order.forEach(([p, i], k) => {
    const rank = m - k;
    running = Math.min(running, (m / rank) * p);
    out[i] = Math.min(1, running);
  });
  return out;
}

/** Kendall's tau-b, which allows for ties, with a normal approximation for p. */
export function kendall(x, y) {
  const n = x.length;
  let concordant = 0;
  let discordant = 0;
  let tiedX = 0;
  let tiedY = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = Math.sign(x[i] - x[j]);
      const dy = Math.sign(y[i] - y[j]);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tiedX += 1;
      else if (dy === 0) tiedY += 1;
      else if (dx === dy) concordant += 1;
      else discordant += 1;
    }
  }
  const pairs = concordant + discordant;
  const tau = (concordant - discordant) / Math.sqrt((pairs + tiedX) * (pairs + tiedY));
  // The variance of the statistic under no association, ties included.
  const tie = (counts) => counts.reduce((sum, t) => sum + t * (t - 1) * (2 * t + 5), 0);
  const tiesX = tieSizes(x);
  const tiesY = tieSizes(y);
  const v0 = n * (n - 1) * (2 * n + 5);
  const v =
    (v0 - tie(tiesX) - tie(tiesY)) / 18 +
    (tiesX.reduce((s, t) => s + t * (t - 1) * (t - 2), 0) * tiesY.reduce((s, t) => s + t * (t - 1) * (t - 2), 0)) /
      (9 * n * (n - 1) * (n - 2)) +
    (tiesX.reduce((s, t) => s + t * (t - 1), 0) * tiesY.reduce((s, t) => s + t * (t - 1), 0)) / (2 * n * (n - 1));
  const z = (concordant - discordant) / Math.sqrt(v);
  return { tau, z, p: normalTwoSided(z) };
}
