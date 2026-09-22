/**
 * What to make of a table, a results list or a set of lists.
 *
 * The three shapes added for bioinformatics all have the same awkwardness:
 * one table can be drawn several ways, and which column means what depends on
 * the drawing. A volcano needs a fold change and a p value; a ROC curve needs
 * a score and a class; a Bland-Altman needs two ways of measuring one thing.
 * Asking for all of that up front would make the dialog a form, so instead
 * the columns are guessed from their names and every guess can be overruled
 * in the properties panel.
 *
 * Everything returned here is what both the drawing and the panel read, so
 * the numbers written beside a figure are the numbers drawn in it.
 */

import { adjustBenjaminiHochberg, adjustBonferroni, formatStat, formatP } from "./stats";
import { parseNumber, rowCount } from "./datasets";
import {
  tableMatrix,
  numericColumns,
  zScoreRows,
  pca,
  correlationMatrix,
  clusterRows,
  rocCurve,
  classLabels,
  blandAltman,
} from "./matrix";
import { readSets, vennRegions, upsetIntersections, overlapTest } from "./sets";

// ---------------------------------------------------------------------------
// Guessing what the columns are
// ---------------------------------------------------------------------------

const PATTERNS = {
  p: /\b(p|pval|pvalue|p[-_. ]?value|padj|p[-_. ]?adj|fdr|q[-_. ]?value|qval)\b|^p$|pvalue|padj|fdr/i,
  adjusted: /padj|p[-_. ]?adj|fdr|q[-_. ]?val/i,
  effect: /log2|log ?fc|fold|lfc|estimate|effect|coef|difference|beta|hazard|odds|ratio/i,
  se: /^se$|std[.\s_-]?err|standard error|lfcse|stderr/i,
  low: /low|lower|ci[._ ]?l|2\.5|min/i,
  high: /high|upper|ci[._ ]?h|97\.5|max/i,
  mean: /mean|basemean|average|abundance|expression|intensity|counts/i,
};

const nameOf = (dataset, col) => String(dataset?.columns[col]?.name ?? "");

const findColumn = (dataset, columns, pattern) => columns.find((c) => pattern.test(nameOf(dataset, c))) ?? null;

/**
 * Columns that hold words rather than numbers, past the first: the class of a
 * ROC curve, or the group that colours a PCA.
 */
export function wordColumns(dataset) {
  const numeric = new Set(numericColumns(dataset));
  const out = [];
  for (let c = 1; c < (dataset?.columns.length ?? 0); c += 1) {
    if (!numeric.has(c) && dataset.columns[c].values.some((v) => String(v).trim() !== "")) out.push(c);
  }
  return out;
}

/**
 * A first reading of what each column is for, by its name. Every one of these
 * is only a suggestion: the panel shows what was chosen and lets it be
 * changed, because a column called "estimate" is not always the estimate.
 */
export function guessColumns(dataset) {
  const numeric = numericColumns(dataset);
  const p = findColumn(dataset, numeric, PATTERNS.p);
  const effect = findColumn(dataset, numeric, PATTERNS.effect) ?? numeric.find((c) => c !== p) ?? null;
  const mean = findColumn(dataset, numeric, PATTERNS.mean);
  return {
    numeric,
    words: wordColumns(dataset),
    p,
    effect,
    mean: mean === effect ? null : mean,
    se: findColumn(dataset, numeric, PATTERNS.se),
    low: findColumn(dataset, numeric, PATTERNS.low),
    high: findColumn(dataset, numeric, PATTERNS.high),
    adjusted: p != null && PATTERNS.adjusted.test(nameOf(dataset, p)),
  };
}

const column = (dataset, col) => (dataset.columns[col]?.values ?? []).map(parseNumber);
const labels = (dataset) =>
  Array.from({ length: rowCount(dataset) }, (_, r) => String(dataset.columns[0]?.values[r] ?? "").trim() || `Row ${r + 1}`);

// ---------------------------------------------------------------------------
// Results: volcano, MA and forest
// ---------------------------------------------------------------------------

export const RESULT_ADJUSTMENTS = [
  ["bh", "Benjamini-Hochberg (FDR)"],
  ["bonferroni", "Bonferroni"],
  ["none", "None"],
];

const adjust = (ps, method) => {
  const finite = ps.map((p) => (Number.isFinite(p) ? p : 1));
  if (method === "bonferroni") return adjustBonferroni(finite);
  if (method === "none") return finite;
  return adjustBenjaminiHochberg(finite);
};

/**
 * One row per test: an effect and a p value, with everything the three result
 * plots need worked out once.
 *
 * The p value drawn is the adjusted one unless adjustment is turned off, and
 * the panel says which it is, because a volcano drawn on raw p values with a
 * line at 0.05 is the commonest overstated figure in the field.
 */
export function analyseResults(dataset, plot = {}) {
  const guess = guessColumns(dataset);
  const effectCol = plot.effectCol ?? guess.effect;
  const pCol = plot.pCol ?? guess.p;
  const meanCol = plot.meanCol ?? guess.mean;
  const kind = plot.kind ?? "volcano";
  const warnings = [];

  if (effectCol == null) return { kind: "results", error: "No column of effects to plot. Pick one in the panel." };

  const names = labels(dataset);
  const effects = column(dataset, effectCol);
  const raw = pCol == null ? [] : column(dataset, pCol);
  const method = plot.adjust ?? (guess.adjusted ? "none" : "bh");
  const adjusted = pCol == null ? [] : adjust(raw, method);
  if (guess.adjusted && (plot.adjust ?? "none") !== "none") {
    warnings.push(`${nameOf(dataset, pCol)} looks adjusted already, so adjusting it again would be too strict.`);
  }

  const fcCutoff = Number.isFinite(plot.fcCutoff) ? plot.fcCutoff : 1;
  const pCutoff = Number.isFinite(plot.pCutoff) ? plot.pCutoff : 0.05;

  const points = [];
  for (let r = 0; r < names.length; r += 1) {
    const effect = effects[r];
    if (!Number.isFinite(effect)) continue;
    const p = raw[r];
    const q = adjusted[r];
    const usable = Number.isFinite(q) ? q : NaN;
    const significant = Number.isFinite(usable) ? usable <= pCutoff && Math.abs(effect) >= fcCutoff : false;
    points.push({
      row: r,
      name: names[r],
      effect,
      p,
      adjusted: usable,
      mean: meanCol == null ? NaN : column(dataset, meanCol)[r],
      significant,
      direction: significant ? (effect > 0 ? "up" : "down") : "none",
    });
  }
  if (points.length === 0) return { kind: "results", error: "No rows with a number in the effect column." };
  if (pCol == null && kind === "volcano") warnings.push("A volcano needs a p value column. Pick one in the panel.");

  const up = points.filter((d) => d.direction === "up").length;
  const down = points.filter((d) => d.direction === "down").length;

  // Forest plots want an interval, from two columns if there are two, or from
  // a standard error if there is one.
  const lowCol = plot.lowCol ?? guess.low;
  const highCol = plot.highCol ?? guess.high;
  const seCol = plot.seCol ?? guess.se;
  let intervals = null;
  let intervalFrom = null;
  if (lowCol != null && highCol != null) {
    const low = column(dataset, lowCol);
    const high = column(dataset, highCol);
    intervals = points.map((d) => [low[d.row], high[d.row]]);
    intervalFrom = `the ${nameOf(dataset, lowCol)} and ${nameOf(dataset, highCol)} columns`;
  } else if (seCol != null) {
    const se = column(dataset, seCol);
    intervals = points.map((d) => [d.effect - 1.959963985 * se[d.row], d.effect + 1.959963985 * se[d.row]]);
    intervalFrom = `the effect plus and minus 1.96 standard errors`;
  } else if (kind === "forest") {
    warnings.push("No interval columns found, so the forest shows the effects alone.");
  }

  const label = kind === "ma" ? "MA plot" : kind === "forest" ? "Forest plot" : "Volcano plot";
  const summary =
    kind === "forest"
      ? `${points.length} ${points.length === 1 ? "row" : "rows"}`
      : `${up} up, ${down} down, of ${points.length} tested`;

  return {
    kind: "results",
    plot: kind,
    label,
    points,
    intervals,
    intervalFrom,
    counts: { up, down, tested: points.length },
    columns: { effect: effectCol, p: pCol, mean: meanCol, low: lowCol, high: highCol, se: seCol },
    names: {
      effect: nameOf(dataset, effectCol),
      p: pCol == null ? "" : nameOf(dataset, pCol),
      mean: meanCol == null ? "" : nameOf(dataset, meanCol),
    },
    adjust: pCol == null ? "none" : method,
    fcCutoff,
    pCutoff,
    summary,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Tables: heatmap, correlation, PCA, ROC, Bland-Altman
// ---------------------------------------------------------------------------

export const HEATMAP_SCALES = [
  ["row", "Z score across each row"],
  ["none", "The numbers as they are"],
];

/**
 * A table drawn one of five ways. Each branch returns only what its picture
 * needs, plus a `summary` line and the warnings worth reading.
 */
export function analyseTable(dataset, plot = {}) {
  const kind = plot.kind ?? "heatmap";
  const guess = guessColumns(dataset);
  const chosen = plot.columns?.length ? plot.columns.filter((c) => guess.numeric.includes(c)) : guess.numeric;

  if (kind === "roc") {
    const scoreCol = plot.scoreCol ?? chosen[0];
    const classCol = plot.classCol ?? guess.words[0] ?? null;
    if (scoreCol == null || classCol == null) {
      return { kind: "table", plot: kind, error: "A ROC curve needs a column of scores and a column saying which class each row is." };
    }
    const { levels, positive, flags } = classLabels(dataset.columns[classCol].values, plot.positive);
    const roc = rocCurve(column(dataset, scoreCol), flags);
    if (roc.error) return { kind: "table", plot: kind, error: roc.error, levels, positive };
    return {
      kind: "table",
      plot: kind,
      label: "ROC curve",
      roc,
      levels,
      positive,
      names: { score: nameOf(dataset, scoreCol), class: nameOf(dataset, classCol) },
      columns: { score: scoreCol, class: classCol },
      summary: `AUC ${formatStat(roc.auc)} (95% CI ${formatStat(roc.low)} to ${formatStat(roc.high)})`,
      extra: `${roc.cases} ${positive || "positive"}, ${roc.controls} other. Best cut ${formatStat(roc.best.threshold)}: sensitivity ${formatStat(roc.best.sensitivity)}, specificity ${formatStat(roc.best.specificity)}.`,
      warnings: roc.auc < 0.5 ? ["The area is below a half, so the score runs the other way. Change which class counts as positive."] : [],
    };
  }

  if (kind === "bland") {
    const a = plot.methodA ?? chosen[0];
    const b = plot.methodB ?? chosen.find((c) => c !== a);
    if (a == null || b == null) return { kind: "table", plot: kind, error: "Agreement needs two columns measuring the same thing." };
    const result = blandAltman(column(dataset, a), column(dataset, b));
    if (result.error) return { kind: "table", plot: kind, error: result.error };
    return {
      kind: "table",
      plot: kind,
      label: "Bland-Altman plot",
      agreement: result,
      names: { a: nameOf(dataset, a), b: nameOf(dataset, b) },
      columns: { a, b },
      summary: `Bias ${formatStat(result.bias)} (95% CI ${formatStat(result.biasInterval[0])} to ${formatStat(result.biasInterval[1])})`,
      extra: `Limits of agreement ${formatStat(result.lower)} to ${formatStat(result.upper)}, from ${result.n} pairs.`,
      warnings:
        result.n < 20 ? ["With fewer than 20 pairs the limits of agreement are themselves poorly pinned down."] : [],
    };
  }

  const matrix = tableMatrix(dataset, { columns: chosen });
  if (matrix.rows.length < 2 || matrix.colNames.length < 2) {
    return { kind: "table", plot: kind, error: "This graph needs at least two rows and two columns of numbers." };
  }

  if (kind === "correlation") {
    const method = plot.corrMethod ?? "pearson";
    const result = correlationMatrix(matrix.cols, matrix.colNames, { method });
    // The strongest pair, other than a column with itself, is worth saying.
    let best = { r: 0, a: 0, b: 1 };
    for (let a = 0; a < result.names.length; a += 1) {
      for (let b = a + 1; b < result.names.length; b += 1) {
        if (Math.abs(result.r[a][b]) > Math.abs(best.r)) best = { r: result.r[a][b], a, b };
      }
    }
    return {
      kind: "table",
      plot: kind,
      label: "Correlation matrix",
      correlation: result,
      matrix,
      summary: `${result.names.length} columns, ${matrix.rows.length} complete rows`,
      extra: `Strongest: ${result.names[best.a]} and ${result.names[best.b]}, ${method === "spearman" ? "rho" : "r"} = ${formatStat(best.r)}.`,
      warnings: matrix.rows.length < 5 ? ["A correlation from fewer than five rows says very little."] : [],
    };
  }

  if (kind === "pca") {
    const scale = plot.pcaScale !== false;
    const result = pca(matrix.rows, { scale });
    if (result.error) return { kind: "table", plot: kind, error: result.error };
    const groupCol = plot.groupCol ?? guess.words[0] ?? null;
    const groups =
      groupCol == null
        ? null
        : (() => {
            // The group of a row, kept in step with the rows the matrix used.
            const all = dataset.columns[groupCol].values;
            const names = [];
            const of = [];
            let seen = 0;
            for (let r = 0; r < rowCount(dataset); r += 1) {
              const values = chosen.map((c) => parseNumber(dataset.columns[c]?.values[r]));
              if (!values.every(Number.isFinite)) continue;
              const label = String(all[r] ?? "").trim() || "Ungrouped";
              if (!names.includes(label)) names.push(label);
              of[seen] = names.indexOf(label);
              seen += 1;
            }
            return { names, of, name: nameOf(dataset, groupCol) };
          })();
    const [a, b] = plot.components ?? [0, 1];
    return {
      kind: "table",
      plot: kind,
      label: "Principal components",
      pca: result,
      matrix,
      groups,
      components: [a, b],
      columns: { group: groupCol },
      summary: `PC${a + 1} explains ${(result.explained[a] * 100).toFixed(1)}%, PC${b + 1} ${(result.explained[b] * 100).toFixed(1)}%`,
      extra: `${result.n} points in ${result.p} dimensions, ${scale ? "scaled to unit variance" : "centred but not scaled"}.`,
      warnings:
        result.n <= result.p ? ["With no more points than columns, the last components are empty by construction."] : [],
    };
  }

  // Heatmap.
  const scaling = plot.scaleRows ?? "row";
  const values = scaling === "row" ? zScoreRows(matrix.rows) : matrix.rows;
  const rowOrder = plot.clusterRows === false ? values.map((_, i) => i) : clusterRows(values).order;
  const columnOrder =
    plot.clusterColumns === false || matrix.colNames.length < 2
      ? matrix.colNames.map((_, i) => i)
      : clusterRows(matrix.colNames.map((_, c) => values.map((row) => row[c]))).order;
  const flat = values.flat().filter(Number.isFinite);
  const extent = Math.max(Math.abs(Math.min(...flat)), Math.abs(Math.max(...flat)));
  return {
    kind: "table",
    plot: "heatmap",
    label: "Heatmap",
    matrix,
    values,
    rowOrder,
    columnOrder,
    scaling,
    range: scaling === "row" ? [-extent, extent] : [Math.min(...flat), Math.max(...flat)],
    summary: `${matrix.rows.length} rows by ${matrix.colNames.length} columns`,
    extra:
      scaling === "row"
        ? "Each row is shown as a z score, so rows with different overall levels can share one colour scale."
        : "The numbers are drawn as they are, so a loud row dominates the colour scale.",
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Lists of names: Venn and UpSet
// ---------------------------------------------------------------------------

export function analyseSets(dataset, plot = {}) {
  const sets = readSets(dataset).filter((s) => s.size > 0);
  const kind = plot.kind ?? "venn";
  if (sets.length < 2) return { kind: "sets", plot: kind, error: "Two lists at least, one per column." };

  const regions = vennRegions(sets);
  const warnings = [];
  if (kind === "venn" && sets.length > 3) {
    warnings.push("A Venn diagram of more than three lists cannot be drawn honestly. This one shows the first three; an UpSet plot shows them all.");
  }

  const test = sets.length === 2 ? overlapTest(sets[0], sets[1], Number(plot.background) || 0) : null;
  const upset = kind === "upset" ? upsetIntersections(sets, { mode: plot.setMode ?? "exclusive", limit: plot.setLimit ?? 20, sort: plot.setSort ?? "size" }) : null;

  const shared = regions.find((r) => r.pattern.every(Boolean))?.count ?? 0;
  return {
    kind: "sets",
    plot: kind,
    label: kind === "upset" ? "UpSet plot" : "Venn diagram",
    sets,
    regions,
    upset,
    test,
    summary: `${sets.length} lists, ${sets.reduce((sum, s) => sum + s.size, 0)} entries, ${shared} in all of them`,
    extra:
      test && !test.error
        ? `Overlap ${test.both} against ${formatStat(test.expected)} expected, ${formatStat(test.enrichment)} times as many (Fisher's exact test, ${formatP(test.p)}).`
        : sets.length === 2
        ? `Jaccard index ${formatStat(overlapTest(sets[0], sets[1], 0).jaccard)}. Type how many things were tested to ask whether the overlap is more than chance.`
        : "",
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Methods sentences
// ---------------------------------------------------------------------------

const tool = (version) => `Morphly${version ? ` ${version}` : ""}`;

export function resultsMethodsSentence(analysis, { version = "" } = {}) {
  if (!analysis || analysis.error) return "";
  const { counts, fcCutoff, pCutoff, adjust: method, plot } = analysis;
  if (plot === "forest") {
    return `Effects are shown with 95% confidence intervals${analysis.intervalFrom ? `, taken from ${analysis.intervalFrom}` : ""}. Drawn in ${tool(version)}.`;
  }
  const corrected =
    method === "bh"
      ? "p values were corrected for multiple testing by the Benjamini-Hochberg procedure"
      : method === "bonferroni"
      ? "p values were corrected for multiple testing by the Bonferroni method"
      : "p values are not corrected for multiple testing";
  return `Of ${counts.tested} tests, ${counts.up} were higher and ${counts.down} lower, taking a fold change of at least ${fcCutoff} on a log2 scale and ${method === "none" ? "p" : "an adjusted p"} of at most ${pCutoff}; ${corrected}. Drawn in ${tool(version)}.`;
}

export function tableMethodsSentence(analysis, { version = "" } = {}) {
  if (!analysis || analysis.error) return "";
  if (analysis.plot === "roc") {
    const { roc } = analysis;
    return `The area under the ROC curve was ${formatStat(roc.auc)} (95% CI ${formatStat(roc.low)} to ${formatStat(roc.high)}, DeLong), from ${roc.cases} ${analysis.positive || "positive"} and ${roc.controls} other subjects. Calculated in ${tool(version)}.`;
  }
  if (analysis.plot === "bland") {
    const a = analysis.agreement;
    return `Agreement between ${analysis.names.a} and ${analysis.names.b} was assessed as Bland and Altman describe: the mean difference was ${formatStat(a.bias)} (95% CI ${formatStat(a.biasInterval[0])} to ${formatStat(a.biasInterval[1])}) with limits of agreement from ${formatStat(a.lower)} to ${formatStat(a.upper)}, from ${a.n} pairs. Calculated in ${tool(version)}.`;
  }
  if (analysis.plot === "correlation") {
    const { correlation } = analysis;
    return `Columns were compared by ${correlation.method === "spearman" ? "Spearman's rank correlation" : "Pearson's correlation"} over ${analysis.matrix.rows.length} complete rows. Calculated in ${tool(version)}.`;
  }
  if (analysis.plot === "pca") {
    const [a, b] = analysis.components;
    const p = analysis.pca;
    return `Principal components were taken from the ${p.scaled ? "correlation" : "covariance"} matrix of ${p.n} points in ${p.p} dimensions; PC${a + 1} and PC${b + 1} account for ${((p.explained[a] + p.explained[b]) * 100).toFixed(1)}% of the variance. Calculated in ${tool(version)}.`;
  }
  return `Values are drawn as ${analysis.scaling === "row" ? "z scores across each row" : "they are"}, with rows and columns ordered by average linkage clustering on Euclidean distance. Drawn in ${tool(version)}.`;
}

export function setsMethodsSentence(analysis, { version = "" } = {}) {
  if (!analysis || analysis.error) return "";
  const names = analysis.sets.map((s) => `${s.name} (${s.size})`).join(", ");
  const test =
    analysis.test && !analysis.test.error
      ? ` The overlap of ${analysis.test.both} is ${formatStat(analysis.test.enrichment)} times what ${analysis.test.background} tested entries would give by chance (Fisher's exact test, ${formatP(analysis.test.p)}).`
      : "";
  return `Lists compared: ${names}.${test} Drawn in ${tool(version)}.`;
}
