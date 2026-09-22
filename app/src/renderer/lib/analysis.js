/**
 * Statistics for one graph: which tests fit the data, which one to suggest and
 * why, the result, and the pairwise comparisons drawn as brackets.
 *
 * The analysis is worked out afresh from the data every time rather than
 * stored, so a graph and its statistics can never disagree. What the figure
 * file keeps is only the choice that was made (which test, paired or not,
 * which brackets to show), so the result can be recomputed, and checked, on
 * any machine.
 */

import { columnNumbers, completeRows, groupedFactors } from "./datasets";
import {
  describe,
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
  shapiroWilk,
  brownForsythe,
  pearson,
  spearman,
  linearRegression,
  stars,
  formatP,
  formatStat,
  adjustHolm,
  adjustBonferroni,
  twoWayAnova,
  dunnettTest,
  mean,
  variance,
} from "./stats";
import { ptukeyUpper, tTwoSided } from "./stats";

/** Every test Morphly offers for groups, and what it needs. */
export const TESTS = {
  student: { label: "Unpaired t test", phrase: "an unpaired t test", groups: 2, paired: false },
  welch: { label: "Welch's t test", phrase: "Welch's t test", groups: 2, paired: false },
  mannwhitney: { label: "Mann-Whitney test", phrase: "the Mann-Whitney test", groups: 2, paired: false },
  pairedt: { label: "Paired t test", phrase: "a paired t test", groups: 2, paired: true },
  wilcoxon: { label: "Wilcoxon signed rank test", phrase: "the Wilcoxon signed rank test", groups: 2, paired: true },
  anova: {
    label: "One-way ANOVA",
    phrase: "one-way ANOVA",
    posthoc: "Tukey's multiple comparisons test",
    groups: 3,
    paired: false,
  },
  welchanova: { label: "Welch's ANOVA", phrase: "Welch's ANOVA", posthoc: "the Games-Howell test", groups: 3, paired: false },
  kruskal: {
    label: "Kruskal-Wallis test",
    phrase: "the Kruskal-Wallis test",
    posthoc: "Dunn's test with Holm's correction",
    groups: 3,
    paired: false,
  },
  rmanova: {
    label: "Repeated measures ANOVA",
    phrase: "repeated measures ANOVA",
    posthoc: "paired t tests with Holm's correction",
    groups: 3,
    paired: true,
  },
  friedman: {
    label: "Friedman test",
    phrase: "the Friedman test",
    posthoc: "Wilcoxon signed rank tests with Holm's correction",
    groups: 3,
    paired: true,
  },
};

/** Tests that suit this many groups, paired or not, in the order offered. */
export function availableTests(groupCount, paired) {
  const need = groupCount >= 3 ? 3 : 2;
  return Object.entries(TESTS)
    .filter(([, t]) => t.groups === need && t.paired === Boolean(paired))
    .map(([id, t]) => ({ id, label: t.label }));
}

/** The columns a groups graph draws: those holding at least one number. */
export const plottedGroups = (dataset) =>
  dataset.columns.map((_, i) => i).filter((i) => columnNumbers(dataset, i).length > 0);

const pairKey = (i, j) => `${i}-${j}`;

/**
 * Suggest a test the way a careful analyst would decide, and say why:
 * normality by Shapiro-Wilk in every group (or in the differences, for two
 * paired groups), equal spread by Brown-Forsythe. Groups too small to check
 * are assumed normal, and the reason says so.
 */
function suggest(groups, paired) {
  const k = groups.length;
  const reasons = [];
  let normal = true;
  let checkable = true;

  const samples = paired && k === 2 ? [groups[0].map((v, r) => v - groups[1][r])] : groups;
  const normality = samples.map((g) => (g.length >= 3 ? shapiroWilk(g) : null));
  if (normality.some((r) => r === null)) checkable = false;
  const ps = normality.filter(Boolean).map((r) => r.p);
  if (ps.some((p) => p <= 0.05)) normal = false;

  const where = paired && k === 2 ? "the differences" : k === 2 ? "both groups" : "every group";
  if (!normal) {
    reasons.push(`values in at least one group do not look normally distributed (Shapiro-Wilk p = ${formatP(Math.min(...ps))})`);
  } else if (checkable) {
    reasons.push(`values look normally distributed in ${where} (Shapiro-Wilk p above 0.05)`);
  } else {
    reasons.push("some groups are too small to check normality, so it is assumed");
  }

  let equalSpread = true;
  if (!paired && normal) {
    const bf = groups.every((g) => g.length >= 2) ? brownForsythe(groups) : null;
    if (bf && Number.isFinite(bf.p)) {
      equalSpread = bf.p > 0.05;
      reasons.push(
        equalSpread
          ? `spreads are similar (Brown-Forsythe p = ${formatP(bf.p)})`
          : `spreads differ (Brown-Forsythe p = ${formatP(bf.p)})`
      );
    }
  }

  let test;
  if (k === 2) {
    if (paired) test = normal ? "pairedt" : "wilcoxon";
    else test = !normal ? "mannwhitney" : equalSpread ? "student" : "welch";
  } else if (paired) {
    test = normal ? "rmanova" : "friedman";
  } else {
    test = !normal ? "kruskal" : equalSpread ? "anova" : "welchanova";
  }
  const head = paired ? `${k} matched groups` : `${k} groups`;
  const reason = `${head}; ${reasons.join(", and ")}.`;
  return { test, reason: reason.charAt(0).toUpperCase() + reason.slice(1) };
}

const fmtDf = (df) => (Number.isInteger(df) ? String(df) : df.toFixed(1));
const pPhrase = (p) => (p < 0.0001 ? "p < 0.0001" : `p = ${formatP(p)}`);

/**
 * Run the statistics for a groups dataset.
 *
 *   test     a key of TESTS, or "auto" for the suggested one
 *   paired   rows are matched (the same subject measured in every column)
 *
 * Returns { groups, suggestion, test, label, posthoc, summary, comparisons,
 * warnings } or { error } when the data cannot support a test yet.
 * `comparisons` use dataset column indexes, so they line up with the graph.
 */
export function analyseGroups(dataset, { test = "auto", paired = false } = {}) {
  let cols = plottedGroups(dataset);
  if (cols.length < 2) return { error: "Add a second group to compare." };

  let groups;
  const warnings = [];
  if (paired) {
    const rows = completeRows(dataset, cols);
    const dropped = Math.max(...cols.map((c) => columnNumbers(dataset, c).length)) - rows.length;
    if (dropped > 0) warnings.push(`${dropped} ${dropped === 1 ? "row is" : "rows are"} left out because a value is missing.`);
    if (rows.length < 2) return { error: "Paired tests need at least 2 complete rows." };
    groups = cols.map((_, j) => rows.map((r) => r[j]));
  } else {
    // A column with a single value can be drawn but cannot be tested, so it is
    // left out of the statistics rather than stopping them.
    const tooSmall = cols.filter((c) => columnNumbers(dataset, c).length < 2);
    if (tooSmall.length) {
      const names = tooSmall.map((c) => dataset.columns[c].name || `Group ${c + 1}`);
      warnings.push(
        `${names.join(", ")} ${names.length === 1 ? "has" : "have"} fewer than 2 values, so ${
          names.length === 1 ? "it is" : "they are"
        } left out of the test.`
      );
      cols = cols.filter((c) => !tooSmall.includes(c));
      if (cols.length < 2) return { error: "At least two groups need 2 or more values each." };
    }
    groups = cols.map((c) => columnNumbers(dataset, c));
  }
  if (groups.some((g) => Math.max(...g) === Math.min(...g)) && !paired) {
    warnings.push("A group has no spread (all its values are equal), so some tests cannot be run.");
  }

  const k = cols.length;
  const suggestion = suggest(groups, paired);
  const options = availableTests(k, paired).map((t) => t.id);
  const chosen = test !== "auto" && options.includes(test) ? test : suggestion.test;
  const info = TESTS[chosen];

  let summary;
  let pairs; // [{ i, j, p }] with i, j indexes into `groups`
  if (k === 2) {
    const [x, y] = groups;
    let res;
    if (chosen === "student" || chosen === "welch") {
      res = tTest(x, y, { equalVariance: chosen === "student" });
      summary = `t(${fmtDf(res.df)}) = ${formatStat(Math.abs(res.t))}, ${pPhrase(res.p)}`;
    } else if (chosen === "pairedt") {
      res = pairedTTest(x, y);
      summary = `t(${res.df}) = ${formatStat(Math.abs(res.t))}, ${pPhrase(res.p)}`;
    } else if (chosen === "mannwhitney") {
      res = mannWhitney(x, y);
      summary = `U = ${formatStat(Math.min(res.W, x.length * y.length - res.W))}, ${pPhrase(res.p)}${res.exact ? " (exact)" : ""}`;
    } else {
      res = wilcoxonSignedRank(x, y);
      summary = `V = ${formatStat(res.V)}, ${pPhrase(res.p)}${res.exact ? " (exact)" : ""}`;
    }
    pairs = [{ i: 0, j: 1, p: res.p }];
  } else if (chosen === "anova") {
    const res = oneWayAnova(groups);
    summary = `F(${res.df1}, ${res.df2}) = ${formatStat(res.F)}, ${pPhrase(res.p)}, η² = ${res.etaSquared.toFixed(2)}`;
    pairs = tukeyHsd(groups, res);
  } else if (chosen === "welchanova") {
    const res = welchAnova(groups);
    summary = `F(${res.df1}, ${fmtDf(res.df2)}) = ${formatStat(res.F)}, ${pPhrase(res.p)}`;
    pairs = gamesHowell(groups);
  } else if (chosen === "kruskal") {
    const res = kruskalWallis(groups);
    summary = `H(${res.df}) = ${formatStat(res.H)}, ${pPhrase(res.p)}`;
    pairs = dunnTest(groups);
  } else if (chosen === "rmanova") {
    const rows = groups[0].map((_, r) => groups.map((g) => g[r]));
    const res = repeatedMeasuresAnova(rows);
    summary = `F(${res.df1}, ${res.df2}) = ${formatStat(res.F)}, ${pPhrase(res.p)}`;
    pairs = holmPairs(groups, (a, b) => pairedTTest(a, b).p);
  } else {
    const rows = groups[0].map((_, r) => groups.map((g) => g[r]));
    const res = friedman(rows);
    summary = `χ²(${res.df}) = ${formatStat(res.chi2)}, ${pPhrase(res.p)}`;
    pairs = holmPairs(groups, (a, b) => wilcoxonSignedRank(a, b).p);
  }

  const names = dataset.columns.map((c) => c.name);
  const comparisons = pairs.map(({ i, j, p }) => ({
    i: cols[i],
    j: cols[j],
    key: pairKey(cols[i], cols[j]),
    label: `${names[cols[i]] || `Group ${cols[i] + 1}`} vs ${names[cols[j]] || `Group ${cols[j] + 1}`}`,
    p,
    pText: formatP(p),
    stars: stars(p),
  }));

  const ns = groups.map((g) => g.length);
  return {
    groups: cols,
    n: ns,
    paired: Boolean(paired),
    suggestion,
    test: chosen,
    label: info.label,
    posthoc: k > 2 ? info.posthoc : null,
    summary,
    comparisons,
    warnings,
  };
}

function holmPairs(groups, pOf) {
  const raw = [];
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) raw.push({ i, j, p: pOf(groups[i], groups[j]) });
  }
  const adjusted = adjustHolm(raw.map((r) => r.p));
  return raw.map((r, idx) => ({ ...r, p: adjusted[idx] }));
}

/**
 * The comparisons to draw as brackets. Significant ones show unless switched
 * off; others show only when switched on. `overrides` maps "i-j" to a choice.
 */
export function bracketsToDraw(analysis, overrides = {}) {
  if (!analysis?.comparisons) return [];
  return analysis.comparisons.filter((c) => overrides[c.key] ?? c.p < 0.05);
}

/** Correlation and a fitted line for each Y series of an X and Y dataset. */
export function analyseXY(dataset) {
  const series = [];
  for (let c = 1; c < dataset.columns.length; c += 1) {
    const rows = completeRows(dataset, [0, c]);
    const name = dataset.columns[c].name || `Y${c}`;
    if (rows.length < 3) {
      series.push({ col: c, name, n: rows.length, error: "Needs at least 3 points." });
      continue;
    }
    const x = rows.map((r) => r[0]);
    const y = rows.map((r) => r[1]);
    const constantX = Math.max(...x) === Math.min(...x);
    const constantY = Math.max(...y) === Math.min(...y);
    if (constantX || constantY) {
      series.push({ col: c, name, n: rows.length, error: "All X or all Y values are equal." });
      continue;
    }
    series.push({
      col: c,
      name,
      n: rows.length,
      regression: linearRegression(x, y),
      pearson: pearson(x, y),
      spearman: spearman(x, y),
    });
  }
  return { series };
}

const ERROR_WORDS = { sd: "SD", sem: "SEM", ci: "95% confidence interval" };

/**
 * One sentence for a methods section or figure legend, e.g. "Groups were
 * compared by one-way ANOVA followed by Tukey's multiple comparisons test
 * (Morphly 0.5.0). Bars show the mean ± SD, with n = 6 per group."
 */
export function methodsSentence(analysis, plot, { version = "" } = {}) {
  if (!analysis || analysis.error) return "";
  const k = analysis.groups.length;
  const what = k === 2 ? "The two groups were" : `The ${k} groups were`;
  const testName = TESTS[analysis.test]?.phrase ?? analysis.label;
  const posthoc = analysis.posthoc ? ` followed by ${analysis.posthoc}` : "";
  const paired = analysis.paired ? ", with each row treated as one subject" : "";
  const by = version ? ` (Morphly ${version})` : "";

  const error = ERROR_WORDS[plot?.error] ?? "SD";
  let shows;
  if (plot?.kind === "box") shows = "Boxes show the median and interquartile range, whiskers the smallest and largest values";
  else if (plot?.kind === "dots") shows = `Lines show the mean ± ${error}`;
  else shows = `Bars show the mean ± ${error}`;

  const ns = analysis.n;
  const nText =
    Math.min(...ns) === Math.max(...ns) ? `n = ${ns[0]} per group` : `n = ${Math.min(...ns)} to ${Math.max(...ns)} per group`;
  const legend = "ns, not significant; * p < 0.05; ** p < 0.01; *** p < 0.001; **** p < 0.0001.";
  return `${what} compared by ${testName}${posthoc}${paired}${by}. ${shows}, with ${nText}. ${legend}`;
}

/** Summary rows for the data grid: mean, SD and n of each column. */
export function columnSummaries(dataset) {
  return dataset.columns.map((_, i) => describe(columnNumbers(dataset, i)));
}

// ---------------------------------------------------------------------------
// Two factors: groups by condition
// ---------------------------------------------------------------------------

/** How to hold down the false positives when many pairs are compared. */
export const CORRECTIONS = [
  ["sidak", "Šídák"],
  ["tukey", "Tukey"],
  ["bonferroni", "Bonferroni"],
  ["holm", "Holm"],
  ["none", "None"],
];

/** Which pairs a grouped graph compares. */
export const COMPARISON_SETS = [
  ["conditions", "Conditions within each group"],
  ["groups", "Groups within each condition"],
  ["control", "Each condition against the first"],
];

/** Adjust a list of p-values by the chosen method. */
export function correctPValues(ps, method) {
  const m = ps.length;
  if (method === "bonferroni") return adjustBonferroni(ps);
  if (method === "holm") return adjustHolm(ps);
  // Šídák: the chance of at least one false positive among m independent tests.
  if (method === "sidak") return ps.map((p) => Math.min(1, 1 - (1 - p) ** m));
  return ps;
}

/**
 * Statistics for a groups-by-condition dataset: two-way ANOVA with the
 * interaction, and the pairwise comparisons drawn as brackets.
 *
 * Comparisons use the pooled spread from the ANOVA, as Prism does, so they
 * agree with the table above them, and they are corrected across the family
 * of comparisons actually drawn.
 */
export function analyseGrouped(dataset, { within = "conditions", correction = "sidak", control = 0 } = {}) {
  const factors = groupedFactors(dataset);
  const { levels, conditions } = factors;
  if (levels.length < 1 || conditions.length < 1) return { error: "Name the groups in the first column, and add a condition column." };
  const cellsOf = (level, condition) => factors.valuesAt(level, condition.name);
  const counts = levels.flatMap((l) => conditions.map((c) => cellsOf(l, c).length));
  if (counts.some((n) => n === 0)) {
    return { error: "Every group needs at least one value in every condition." };
  }

  const warnings = [];
  const anova =
    levels.length >= 2 && conditions.length >= 2
      ? twoWayAnova({
          rows: levels,
          cols: conditions.map((c) => c.name),
          valuesAt: (row, col) => factors.valuesAt(row, col),
        })
      : null;
  if (anova && !anova.balanced) {
    warnings.push("The groups hold different numbers of values, so each factor is judged allowing for the other (type II sums of squares).");
  }
  if (counts.some((n) => n < 2)) warnings.push("Some combinations hold a single value, so the spread within them is unknown.");

  // The pooled spread: from the ANOVA when there is one, otherwise from the
  // cells themselves.
  let mse = anova?.residual.ms;
  let dfResidual = anova?.residual.df;
  if (!Number.isFinite(mse)) {
    const within2 = levels.flatMap((l) => conditions.map((c) => cellsOf(l, c)));
    const ss = within2.reduce((sum, values) => sum + (values.length > 1 ? variance(values) * (values.length - 1) : 0), 0);
    dfResidual = within2.reduce((sum, values) => sum + Math.max(0, values.length - 1), 0);
    mse = dfResidual > 0 ? ss / dfResidual : NaN;
  }

  const pairs = [];
  const add = (a, b) => {
    const x = cellsOf(levels[a.row], conditions[a.col]);
    const y = cellsOf(levels[b.row], conditions[b.col]);
    if (!x.length || !y.length) return;
    const diff = mean(y) - mean(x);
    const se = Math.sqrt(mse * (1 / x.length + 1 / y.length));
    const t = diff / se;
    pairs.push({ a, b, diff, t, p: tTwoSided(t, dfResidual) });
  };

  if (within === "groups") {
    conditions.forEach((_, col) => {
      for (let i = 0; i < levels.length; i += 1) {
        for (let j = i + 1; j < levels.length; j += 1) add({ row: i, col }, { row: j, col });
      }
    });
  } else if (within === "control") {
    levels.forEach((_, row) => {
      conditions.forEach((_, col) => {
        if (col !== control) add({ row, col: control }, { row, col });
      });
    });
  } else {
    levels.forEach((_, row) => {
      for (let i = 0; i < conditions.length; i += 1) {
        for (let j = i + 1; j < conditions.length; j += 1) add({ row, col: i }, { row, col: j });
      }
    });
  }

  // Tukey works on the studentized range across the means in the family.
  let adjusted;
  if (correction === "tukey") {
    const k = within === "groups" ? levels.length : conditions.length;
    adjusted = pairs.map((pair) => ptukeyUpper(Math.abs(pair.t) * Math.SQRT2, Math.max(2, k), dfResidual));
  } else {
    adjusted = correctPValues(pairs.map((pair) => pair.p), correction);
  }

  const label = (cell) => `${levels[cell.row]} ${conditions[cell.col].name}`;
  const comparisons = pairs.map((pair, index) => ({
    ...pair,
    key: `${pair.a.row}.${pair.a.col}-${pair.b.row}.${pair.b.col}`,
    label: `${label(pair.a)} vs ${label(pair.b)}`,
    pUnadjusted: pair.p,
    p: adjusted[index],
    pText: formatP(adjusted[index]),
    stars: stars(adjusted[index]),
  }));

  const fmt = (term) => `F(${term.df}, ${anova.residual.df}) = ${formatStat(term.F)}, ${pPhrase(term.p)}`;
  const summary = anova
    ? [
        { name: factors.rowFactor || "Group", text: fmt(anova.rows) },
        { name: "Condition", text: fmt(anova.cols) },
        { name: "Interaction", text: fmt(anova.interaction) },
      ]
    : [];

  return {
    kind: "grouped",
    factors,
    levels,
    conditions,
    anova,
    label: "Two-way ANOVA",
    summary,
    correction,
    within,
    comparisons,
    n: counts,
    warnings,
  };
}

/** The methods sentence for a grouped graph. */
export function groupedMethodsSentence(analysis, plot, { version = "" } = {}) {
  if (!analysis || analysis.error) return "";
  const by = version ? ` (Morphly ${version})` : "";
  const correction = CORRECTIONS.find(([id]) => id === analysis.correction)?.[1] ?? "Šídák";
  const set =
    analysis.within === "groups"
      ? "groups were compared within each condition"
      : analysis.within === "control"
      ? "each condition was compared with the first"
      : "conditions were compared within each group";
  const error = ERROR_WORDS[plot?.error] ?? "SD";
  const shows = plot?.kind === "box" ? "Boxes show the median and interquartile range" : `Bars show the mean ± ${error}`;
  const ns = analysis.n;
  const nText =
    Math.min(...ns) === Math.max(...ns) ? `n = ${ns[0]} per group` : `n = ${Math.min(...ns)} to ${Math.max(...ns)} per group`;
  return (
    `The data were analysed by two-way ANOVA${by}, and ${set} with ${correction}'s correction for multiple comparisons. ` +
    `${shows}, with ${nText}. ns, not significant; * p < 0.05; ** p < 0.01; *** p < 0.001; **** p < 0.0001.`
  );
}
