import { describe as group, it, expect } from "vitest";
import {
  describe,
  rank,
  quantile,
  adjustHolm,
  adjustBonferroni,
  tTest,
  pairedTTest,
  mannWhitney,
  wilcoxonSignedRank,
  oneWayAnova,
  tukeyHsd,
  welchAnova,
  gamesHowell,
  kruskalWallis,
  dunnTest,
  repeatedMeasuresAnova,
  friedman,
  twoWayAnova,
  dunnettTest,
  bandwidthNrd0,
  kernelDensity,
  histogramBins,
  shapiroWilk,
  brownForsythe,
  pearson,
  spearman,
  linearRegression,
  stars,
  formatP,
} from "./stats";

/**
 * Every expected value below was computed by R 4.6 (and SciPy for Spearman), so
 * these tests check Morphly against the reference implementations reviewers
 * trust, not against itself. The R script is short enough to rerun by hand:
 * each block names the call that produced its numbers.
 */

/** Equal to a relative tolerance, which suits p-values spanning many decades. */
const close = (actual, expected, rel = 1e-6) => {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * rel + 1e-15);
};

const A = [98, 101, 95, 103, 99, 97];
const B = [97, 100, 94, 102, 96, 99];
const C = [84, 78, 90, 81, 88, 83];
const D = [64, 58, 69, 61, 55, 66];

group("basics", () => {
  it("ranks ties by their average, as rank()", () => {
    expect(rank([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });

  it("uses R's default quantiles", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it("describes a column", () => {
    const d = describe(A);
    expect(d.n).toBe(6);
    close(d.mean, 98.8333333333333);
    close(d.sd, 2.85773803324704);
    close(d.sem, 2.85773803324704 / Math.sqrt(6));
    // qt(0.975, 5) * sem
    close(d.ci, 2.57058183563631 * (2.85773803324704 / Math.sqrt(6)));
    expect(describe([])).toBeNull();
  });

  it("adjusts p-values as p.adjust()", () => {
    // p.adjust(c(0.01, 0.04, 0.03, 0.2), "holm")
    const holm = adjustHolm([0.01, 0.04, 0.03, 0.2]);
    [0.04, 0.09, 0.09, 0.2].forEach((v, i) => close(holm[i], v));
    expect(adjustBonferroni([0.01, 0.3])).toEqual([0.02, 0.6]);
  });
});

group("two groups", () => {
  it("unpaired t test: t.test(A, C, var.equal = TRUE)", () => {
    const r = tTest(A, C, { equalVariance: true });
    close(r.t, 6.895289552093);
    expect(r.df).toBe(10);
    close(r.p, 4.21853482180915e-5);
  });

  it("Welch's t test: t.test(A, C)", () => {
    const r = tTest(A, C);
    close(r.df, 8.55029585798817);
    close(r.p, 9.1089086950408e-5);
  });

  it("paired t test: t.test(before, after, paired = TRUE)", () => {
    const before = [12.1, 14.3, 11.8, 15.2, 13.9, 12.7, 14.8, 13.1];
    const after = [13.4, 15.1, 12.2, 16.8, 14.1, 13.9, 15.5, 14.6];
    const r = pairedTTest(before, after);
    close(r.t, -5.28304440363827);
    close(r.p, 0.00114425689686349);
  });

  it("Mann-Whitney, exact without ties: wilcox.test(x, y)", () => {
    const r = mannWhitney([1.1, 2.3, 3.5, 4.2, 5.9], [2.8, 6.1, 7.4, 8.0, 9.3, 10.2]);
    expect(r.W).toBe(3);
    expect(r.exact).toBe(true);
    close(r.p, 0.0303030303030303);
  });

  it("Mann-Whitney with ties, exact as R 4.6", () => {
    const r = mannWhitney([1, 2, 2, 3, 4, 5], [3, 3, 4, 5, 6, 7, 7]);
    expect(r.W).toBe(7);
    expect(r.exact).toBe(true);
    close(r.p, 0.0477855477855478);
  });

  it("Mann-Whitney from 50 values uses the normal approximation", () => {
    // wilcox.test(1:50, (1:50) + 10.5): no ties, so no tie correction.
    const x = Array.from({ length: 50 }, (_, i) => i + 1);
    const r = mannWhitney(x, x.map((v) => v + 10.5));
    expect(r.exact).toBe(false);
    expect(r.W).toBe(780);
    close(r.p, 0.00120942310703335, 1e-3);
  });

  it("Wilcoxon signed rank, exact: wilcox.test(paired = TRUE)", () => {
    const before = [12.1, 14.3, 11.8, 15.2, 13.9, 12.7, 14.8, 13.1];
    const after = [13.4, 15.1, 12.2, 16.8, 14.1, 13.9, 15.5, 14.6];
    const r = wilcoxonSignedRank(before, after);
    expect(r.V).toBe(0);
    close(r.p, 0.0078125);
  });

  it("Wilcoxon signed rank with a zero difference and ties, exact as R 4.6", () => {
    const r = wilcoxonSignedRank([5, 7, 8, 6, 9, 10, 4], [5, 6, 6, 4, 8, 7, 3]);
    expect(r.V).toBe(27);
    expect(r.exact).toBe(true);
    close(r.p, 0.03125);
  });
});

group("several groups", () => {
  it("one-way ANOVA and Tukey: aov() and TukeyHSD()", () => {
    const a = oneWayAnova([A, B, C, D]);
    close(a.F, 111.569869764168);
    close(a.p, 1.17047198879936e-12, 1e-4);
    const tk = tukeyHsd([A, B, C, D], a);
    // TukeyHSD orders pairs B-A, C-A, D-A, C-B, D-B, D-C; so does Morphly.
    const expected = [9.83118525389849e-1, 1.4693322755055e-5, 4.42690328839035e-12, 3.20051495910079e-5, 6.77535805237994e-12, 4.11876572847802e-8];
    // Tukey p-values below 1e-10 come from a numerical integral; agreeing to a
    // few parts in a thousand there is more than any figure will show.
    tk.forEach((c, idx) => close(c.p, expected[idx], expected[idx] < 1e-10 ? 5e-2 : 1e-4));
  });

  const w1 = [10, 12, 11, 13, 9, 11];
  const w2 = [15, 25, 8, 30, 20, 12];
  const w3 = [20, 22, 21, 19, 23, 20];

  it("Welch's ANOVA: oneway.test(var.equal = FALSE)", () => {
    const r = welchAnova([w1, w2, w3]);
    close(r.F, 65.0798375161722);
    close(r.df2, 8.97198043804653);
    close(r.p, 4.56309820516554e-6, 1e-5);
  });

  it("Games-Howell: rstatix::games_howell_test() (printed to 3 figures)", () => {
    const gh = gamesHowell([w1, w2, w3]);
    [0.171, 9.46e-7, 0.757].forEach((v, i) => close(gh[i].p, v, 5e-3));
  });

  const g1 = [2.1, 3.4, 3.4, 5.0, 4.2];
  const g2 = [6.1, 5.5, 7.2, 6.8];
  const g3 = [3.9, 4.4, 5.0, 4.8, 5.3, 4.9];

  it("Kruskal-Wallis with ties: kruskal.test()", () => {
    const r = kruskalWallis([g1, g2, g3]);
    close(r.H, 9.94008363201912);
    expect(r.df).toBe(2);
    close(r.p, 0.00694285770607176);
  });

  it("Dunn's test, Holm: rstatix::dunn_test()", () => {
    const d = dunnTest([g1, g2, g3]);
    [0.00169558077297811, 0.19753397405680731, 0.04004705043258154].forEach((v, i) => close(d[i].pUnadjusted, v));
    [0.00508674231893433, 0.19753397405680731, 0.08009410086516308].forEach((v, i) => close(d[i].p, v));
  });

  const rows = [
    [5.1, 6.2, 7.0],
    [4.8, 5.9, 6.1],
    [6.0, 6.5, 7.9],
    [5.5, 5.4, 6.8],
    [4.9, 6.0, 6.6],
    [5.3, 6.3, 7.2],
  ];

  it("repeated measures ANOVA: aov(v ~ cond + Error(subj / cond))", () => {
    const r = repeatedMeasuresAnova(rows);
    close(r.F, 45.8424908424909);
    expect([r.df1, r.df2]).toEqual([2, 10]);
    close(r.p, 9.19847698972244e-6, 1e-5);
  });

  it("Friedman: friedman.test()", () => {
    const r = friedman(rows);
    close(r.chi2, 10.3333333333333);
    close(r.p, 0.0057035489980074);
  });
});

group("two factors at once", () => {
  const cells = {
    "WT|Veh": [11.4, 12.1, 10.8, 11.9],
    "WT|LPS": [48.2, 52.7, 45.9, 50.3],
    "KO|Veh": [12.0, 11.2, 12.6, 11.5],
    "KO|LPS": [24.1, 27.8, 22.6, 25.9],
  };
  const design = (table) => ({
    rows: ["WT", "KO"],
    cols: ["Veh", "LPS"],
    valuesAt: (row, col) => table[`${row}|${col}`] ?? [],
  });

  it("two-way ANOVA: car::Anova(lm(v ~ g * tr), type = 'II')", () => {
    const a = twoWayAnova(design(cells));
    close(a.rows.ss, 571.21);
    close(a.rows.F, 160.73444, 1e-5);
    close(a.rows.p, 2.615e-8, 1e-4);
    close(a.cols.ss, 2601);
    close(a.cols.F, 731.90292, 1e-5);
    close(a.interaction.ss, 597.8025);
    close(a.interaction.F, 168.21738, 1e-5);
    close(a.residual.ss, 42.645);
    expect([a.rows.df, a.cols.df, a.interaction.df, a.residual.df]).toEqual([1, 1, 1, 12]);
    expect(a.balanced).toBe(true);
  });

  it("stays right when the cells hold different numbers of values", () => {
    // The same data with two values dropped. Type II sums of squares do not
    // depend on which factor is named first, which is why they are used.
    const uneven = { ...cells, "WT|LPS": [48.2, 52.7], "KO|Veh": [12.0, 11.2, 12.6] };
    const a = twoWayAnova(design(uneven));
    close(a.rows.ss, 360.42857, 1e-5);
    close(a.rows.F, 118.81535, 1e-5);
    close(a.cols.ss, 1818.15048, 1e-5);
    close(a.cols.F, 599.35368, 1e-5);
    close(a.interaction.ss, 496.65333, 1e-5);
    close(a.interaction.F, 163.72187, 1e-5);
    close(a.residual.ss, 27.30167, 1e-5);
    expect(a.residual.df).toBe(9);
    expect(a.balanced).toBe(false);
  });

  it("says no when there is nothing to compare", () => {
    expect(twoWayAnova({ rows: ["a"], cols: ["x", "y"], valuesAt: () => [1, 2] })).toBeNull();
    expect(twoWayAnova({ rows: ["a", "b"], cols: ["x", "y"], valuesAt: () => [] })).toBeNull();
  });
});

group("Dunnett's test", () => {
  /**
   * Checked against a simulation of the statistic (40 million draws) rather
   * than against SciPy: scipy.stats.dunnett agrees for large p but drifts in
   * the tails, where its own documentation calls its p-values approximate.
   * Simulated, with 95% intervals:
   *   4 groups of 6, t = 0.3633   p = 0.96812
   *   4 groups of 6, t = 6.4670   p = 7.73e-06  (6.86e-06 to 8.59e-06)
   *   n = 4, 3, 5,   t = 3.9649   p = 6.079e-03 (6.045e-03 to 6.113e-03)
   *   n = 4, 3, 5,   t = 10.6203  p = 4.05e-06  (3.17e-06 to 4.93e-06)
   */
  it("compares every group with the control, allowing for the shared control", () => {
    const comparisons = dunnettTest([A, B, C, D], 0);
    expect(comparisons.map((c) => c.j)).toEqual([1, 2, 3]);
    close(comparisons[0].t, -0.3633, 1e-3);
    close(comparisons[0].p, 0.96812, 2e-4);
    close(comparisons[1].p, 7.73e-6, 0.06);
  });

  it("handles groups of different sizes", () => {
    const comparisons = dunnettTest([[5.1, 4.8, 5.5, 5.0], [6.2, 6.8, 6.1], [7.9, 8.2, 7.4, 8.8, 8.1]], 0);
    close(comparisons[0].t, 3.9649, 1e-3);
    close(comparisons[0].p, 6.079e-3, 5e-3);
    close(comparisons[1].p, 4.05e-6, 0.06);
  });

  it("can compare against any group, not just the first", () => {
    const comparisons = dunnettTest([A, B, C], 2);
    expect(comparisons.map((c) => [c.i, c.j])).toEqual([[2, 0], [2, 1]]);
  });
});

group("assumptions", () => {
  it("Shapiro-Wilk matches shapiro.test() from 3 to 30 values", () => {
    const cases = [
      [[1, 2, 4], 0.964285714285714, 0.636886845028963],
      [[2.3, 4.1, 4.4, 5.9, 9.8], 0.921788729551847, 0.541544244366439],
      [[12.1, 14.3, 11.8, 15.2, 13.9, 12.7, 14.8, 13.1], 0.949835572351036, 0.70957392882342],
      [[1, 1.2, 1.3, 1.5, 1.9, 2.4, 3.1, 4.2, 6.0, 8.5, 12.1, 17.3, 25.0, 38.2, 55.1], 0.72586571833919766, 0.00047652584796811],
      [Array.from({ length: 30 }, (_, i) => Math.sin(i + 1) * 10 + i + 1), 0.985149165389755, 0.939698868616679],
    ];
    for (const [x, W, p] of cases) {
      const r = shapiroWilk(x);
      close(r.W, W, 1e-9);
      close(r.p, p, 1e-6);
    }
  });

  it("refuses what Shapiro-Wilk cannot test", () => {
    expect(shapiroWilk([1, 2])).toBeNull();
    expect(shapiroWilk([3, 3, 3, 3])).toBeNull();
  });

  it("Brown-Forsythe: car::leveneTest(center = median)", () => {
    const r = brownForsythe([
      [10, 12, 11, 13, 9, 11],
      [15, 25, 8, 30, 20, 12],
      [20, 22, 21, 19, 23, 20],
    ]);
    close(r.F, 10.860735009671183);
    close(r.p, 0.00121278552551447);
  });
});

group("X and Y", () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8];
  const y = [2.1, 3.9, 6.2, 7.8, 9.9, 12.5, 13.8, 16.4];

  it("Pearson: cor.test()", () => {
    const r = pearson(x, y);
    close(r.r, 0.99863256849137);
    close(r.p, 6.38574025693838e-9, 1e-5);
  });

  it("linear regression: lm(y ~ x)", () => {
    const r = linearRegression(x, y);
    close(r.slope, 2.03095238095238);
    close(r.intercept, -0.0642857142857107, 1e-5);
    close(r.r2, 0.997267006851671);
    close(r.p, 6.38574025693969e-9, 1e-5);
  });

  it("Spearman: scipy.stats.spearmanr()", () => {
    const r = spearman(x, [3, 1, 4, 1.5, 5, 9, 2, 6]);
    close(r.rho, 0.523809523809524);
    close(r.p, 0.1827207505397148);
  });
});

group("reporting", () => {
  it("uses GraphPad's stars", () => {
    expect([0.2, 0.049, 0.009, 0.0009, 0.00009].map(stars)).toEqual(["ns", "*", "**", "***", "****"]);
    expect(stars(NaN)).toBe("ns");
  });

  it("formats p-values the way papers print them", () => {
    expect(formatP(0.00001)).toBe("< 0.0001");
    expect(formatP(0.0495)).toBe("0.0495");
    expect(formatP(0.48)).toBe("0.48");
  });
});

group("shapes of a distribution", () => {
  const x = [4.1, 5.3, 3.8, 6.0, 4.6, 5.9, 4.4, 7.2, 5.1, 4.9];

  it("uses R's default bandwidth: bw.nrd0()", () => {
    close(bandwidthNrd0(x), 0.550910517195, 1e-9);
  });

  it("draws the same curve as density(kernel = 'gaussian')", () => {
    const curve = kernelDensity(x, { points: 512 });
    const at = (value) => {
      // Straight line between the two nearest points, as R's approx() does.
      const after = curve.findIndex((p) => p.x >= value);
      const a = curve[after - 1];
      const b = curve[after];
      return a.y + ((value - a.x) / (b.x - a.x)) * (b.y - a.y);
    };
    // R bins the values and uses an FFT, so its curve is itself an
    // approximation; Morphly evaluates the kernel at each point. Agreement to
    // a few parts in ten thousand is the most that can be asked.
    close(at(3.5), 0.135688382017, 3e-4);
    close(at(4.5), 0.355911304365, 3e-4);
    close(at(5.5), 0.300083041514, 3e-4);
    close(at(6.5), 0.131247232881, 3e-4);
  });

  it("spans the data plus three bandwidths, as R's cut does", () => {
    const curve = kernelDensity(x, { points: 16 });
    const bw = bandwidthNrd0(x);
    close(curve[0].x, Math.min(...x) - 3 * bw, 1e-12);
    close(curve[curve.length - 1].x, Math.max(...x) + 3 * bw, 1e-12);
  });

  it("bins a histogram on round edges that hold every value", () => {
    const { breaks, counts, width } = histogramBins(x);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(x.length);
    expect(breaks[0]).toBeLessThanOrEqual(Math.min(...x));
    expect(breaks[breaks.length - 1]).toBeGreaterThan(Math.max(...x));
    expect(breaks).toHaveLength(counts.length + 1);
    // Round widths only: 1, 2, 2.5 or 5 times a power of ten.
    const magnitude = 10 ** Math.floor(Math.log10(width));
    expect([1, 2, 2.5, 5, 10]).toContain(Number((width / magnitude).toFixed(10)));
  });

  it("copes with values that are all the same, and with none at all", () => {
    expect(histogramBins([3, 3, 3]).counts).toEqual([3]);
    expect(histogramBins([]).counts).toEqual([]);
    expect(kernelDensity([])).toEqual([]);
  });
});
