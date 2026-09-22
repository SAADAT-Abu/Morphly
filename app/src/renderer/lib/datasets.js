/**
 * Datasets: the numbers behind a graph.
 *
 * A dataset is stored in the figure file, next to the pages, so a graph can be
 * redrawn from its data on any machine and several graphs can share one set of
 * numbers. It is a list of named columns, in one of two shapes (the first two
 * of Prism's table types):
 *
 *   groups   each column is a group: control, treated, and so on
 *   grouped  two ways of grouping at once: the first column names the row's
 *            group (genotype, say) and every other column is a condition
 *            (vehicle, drug), so each row is one replicate of one group
 *   xy       the first column is X, every other column is a Y series
 *
 * Values are kept as the text that was typed or imported, so a half-typed
 * number or an empty cell survives an edit, and are read as numbers only when
 * a graph or a test needs them. A decimal comma is accepted, since figures made
 * in Spain, Germany or France often arrive that way.
 *
 * Every change to a dataset is a small operation object handed to
 * applyDatasetOp, whether it comes from the drawer under the canvas or from the
 * data window. One vocabulary for both means the two cannot disagree.
 */

import Papa from "papaparse";

export const DATASET_KINDS = {
  groups: { label: "Groups", first: "Group" },
  grouped: { label: "Groups by condition", first: "Condition" },
  contingency: { label: "Counts in categories", first: "Category" },
  xy: { label: "X and Y", first: "X" },
};

/** Datasets whose first column names things rather than measuring them. */
export const hasLabelColumn = (dataset) => dataset?.kind === "grouped" || dataset?.kind === "contingency";

let counter = 0;
export const nextDatasetId = () => `ds_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/** A number from a cell, or NaN. "1,5" and " 2.25 " both read. */
export function parseNumber(text) {
  if (typeof text === "number") return text;
  let s = String(text ?? "").trim();
  if (s === "") return NaN;
  // A single comma between digits with no point is a decimal comma.
  if (/^[-+]?\d*,\d+(e[-+]?\d+)?$/i.test(s)) s = s.replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  return Number(s);
}

export const isNumeric = (text) => Number.isFinite(parseNumber(text));

/** How many rows the table has: the longest column. */
export const rowCount = (dataset) =>
  dataset.columns.reduce((max, c) => Math.max(max, c.values.length), 0);

/** The numbers in one column, empty and unreadable cells left out. */
export const columnNumbers = (dataset, col) =>
  (dataset.columns[col]?.values ?? []).map(parseNumber).filter(Number.isFinite);

/**
 * Rows in which every one of `cols` holds a number, as arrays of numbers. For
 * paired tests and for X and Y, where values belong together by row.
 */
export function completeRows(dataset, cols) {
  const rows = [];
  for (let r = 0; r < rowCount(dataset); r += 1) {
    const row = cols.map((c) => parseNumber(dataset.columns[c]?.values[r]));
    if (row.every(Number.isFinite)) rows.push(row);
  }
  return rows;
}

/** A new dataset. Columns are padded to the same length. */
export function createDataset({ name = "Data", kind = "groups", columns = [], id = nextDatasetId() } = {}) {
  const length = Math.max(0, ...columns.map((c) => c.values?.length ?? 0));
  return {
    id,
    name,
    kind: DATASET_KINDS[kind] ? kind : "groups",
    columns: columns.map((c) => ({
      name: String(c.name ?? ""),
      values: [...(c.values ?? []).map((v) => String(v ?? "")), ...Array(length - (c.values?.length ?? 0)).fill("")],
    })),
  };
}

/** A blank table to type into. */
export function blankDataset(kind = "groups", { columns = kind === "xy" ? 2 : 3, rows = 6 } = {}) {
  const names =
    kind === "xy"
      ? ["X", ...Array.from({ length: columns - 1 }, (_, i) => `Y${i + 1}`)]
      : kind === "grouped"
      ? ["Group", ...Array.from({ length: columns - 1 }, (_, i) => `Condition ${i + 1}`)]
      : kind === "contingency"
      ? ["Group", ...Array.from({ length: columns - 1 }, (_, i) => `Category ${i + 1}`)]
      : Array.from({ length: columns }, (_, i) => `Group ${i + 1}`);
  return createDataset({
    name: "Data",
    kind,
    columns: names.map((name) => ({ name, values: Array(rows).fill("") })),
  });
}

/** Sample data, so the graph dialog can be tried without any numbers at hand. */
export function sampleDataset(kind = "groups") {
  if (kind === "grouped") {
    return createDataset({
      name: "IL-6 by genotype (sample)",
      kind: "grouped",
      columns: [
        { name: "Genotype", values: ["Wild type", "Wild type", "Wild type", "Wild type", "Knockout", "Knockout", "Knockout", "Knockout"] },
        { name: "Vehicle", values: ["11.4", "12.1", "10.8", "11.9", "12.0", "11.2", "12.6", "11.5"] },
        { name: "LPS", values: ["48.2", "52.7", "45.9", "50.3", "24.1", "27.8", "22.6", "25.9"] },
      ],
    });
  }
  if (kind === "contingency") {
    return createDataset({
      name: "Response by treatment (sample)",
      kind: "contingency",
      columns: [
        { name: "Treatment", values: ["Drug", "Placebo"] },
        { name: "Responded", values: ["9", "2"] },
        { name: "Did not respond", values: ["3", "10"] },
      ],
    });
  }
  if (kind === "xy") {
    return createDataset({
      name: "Growth curve (sample)",
      kind: "xy",
      columns: [
        { name: "Time (h)", values: ["0", "4", "8", "12", "16", "20", "24"] },
        { name: "Wild type", values: ["0.05", "0.09", "0.21", "0.44", "0.71", "0.86", "0.91"] },
        { name: "Mutant", values: ["0.05", "0.07", "0.12", "0.22", "0.37", "0.52", "0.61"] },
      ],
    });
  }
  return createDataset({
    name: "Cell viability (sample)",
    kind: "groups",
    columns: [
      { name: "Control", values: ["98", "101", "95", "103", "99", "97"] },
      { name: "Vehicle", values: ["97", "100", "94", "102", "96", "99"] },
      { name: "Drug A", values: ["84", "78", "90", "81", "88", "83"] },
      { name: "Drug B", values: ["64", "58", "69", "61", "55", "66"] },
    ],
  });
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

const padTo = (values, length) =>
  values.length >= length ? values : [...values, ...Array(length - values.length).fill("")];

/** Column names nobody has used yet: "Group 4", then "Group 5". */
function freshColumnName(dataset) {
  const stem =
    dataset.kind === "xy"
      ? "Y"
      : dataset.kind === "grouped"
      ? "Condition "
      : dataset.kind === "contingency"
      ? "Category "
      : "Group ";
  const taken = new Set(dataset.columns.map((c) => c.name));
  for (let i = dataset.columns.length; ; i += 1) {
    const name = `${stem}${i}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Apply one edit and return the new dataset; the old one is left untouched.
 * An operation that does not apply returns the dataset as it was.
 *
 *   { op: "setCell", col, row, value }
 *   { op: "pasteBlock", col, row, cells }   cells: rows of text, grows the table
 *   { op: "renameColumn", col, name }
 *   { op: "addColumn", name? }
 *   { op: "removeColumn", col }             never the last column
 *   { op: "addRows", count }
 *   { op: "removeRow", row }
 *   { op: "rename", name }
 *   { op: "setKind", kind }
 */
export function applyDatasetOp(dataset, op) {
  const rows = rowCount(dataset);
  const columns = dataset.columns;
  switch (op?.op) {
    case "setCell": {
      if (!columns[op.col] || !(op.row >= 0)) return dataset;
      const length = Math.max(rows, op.row + 1);
      return {
        ...dataset,
        columns: columns.map((c, i) => {
          const values = padTo(c.values, length);
          if (i !== op.col) return values === c.values ? c : { ...c, values };
          const next = [...values];
          next[op.row] = String(op.value ?? "");
          return { ...c, values: next };
        }),
      };
    }
    case "pasteBlock": {
      const cells = (op.cells ?? []).filter((r) => Array.isArray(r));
      if (!cells.length || !(op.col >= 0) || !(op.row >= 0)) return dataset;
      const width = Math.max(...cells.map((r) => r.length));
      let next = dataset;
      while (next.columns.length < op.col + width) next = applyDatasetOp(next, { op: "addColumn" });
      const length = Math.max(rowCount(next), op.row + cells.length);
      return {
        ...next,
        columns: next.columns.map((c, i) => {
          const values = [...padTo(c.values, length)];
          const offset = i - op.col;
          if (offset >= 0 && offset < width) {
            cells.forEach((r, k) => {
              if (offset < r.length) values[op.row + k] = String(r[offset] ?? "");
            });
          }
          return { ...c, values };
        }),
      };
    }
    case "renameColumn":
      if (!columns[op.col]) return dataset;
      return { ...dataset, columns: columns.map((c, i) => (i === op.col ? { ...c, name: String(op.name ?? "") } : c)) };
    case "addColumn":
      return {
        ...dataset,
        columns: [...columns, { name: op.name ?? freshColumnName(dataset), values: Array(rows).fill("") }],
      };
    case "removeColumn":
      if (columns.length <= 1 || !columns[op.col]) return dataset;
      return { ...dataset, columns: columns.filter((_, i) => i !== op.col) };
    case "addRows": {
      const length = rows + Math.max(1, op.count ?? 1);
      return { ...dataset, columns: columns.map((c) => ({ ...c, values: padTo(c.values, length) })) };
    }
    case "removeRow":
      if (!(op.row >= 0) || op.row >= rows) return dataset;
      return {
        ...dataset,
        columns: columns.map((c) => ({ ...c, values: padTo(c.values, rows).filter((_, r) => r !== op.row) })),
      };
    case "rename":
      // Kept exactly as typed, spaces and all, so a name can be typed a letter at a time.
      return { ...dataset, name: String(op.name ?? "") };
    case "setKind":
      return DATASET_KINDS[op.kind] ? { ...dataset, kind: op.kind } : dataset;
    default:
      return dataset;
  }
}

// ---------------------------------------------------------------------------
// Reading pasted and imported tables
// ---------------------------------------------------------------------------

/**
 * Split pasted or imported text into rows of cells, working out how it is laid
 * out rather than assuming en-US conventions:
 *
 *   delimiter  tab (anything copied from a spreadsheet), semicolon (CSV saved
 *              by Excel in much of Europe) or comma
 *   decimal    "," when numbers use a decimal comma, which only happens with a
 *              tab or semicolon delimiter
 *
 * Returns { rows, delimiter, decimal }; values are normalised to a decimal
 * point, so the rest of Morphly only ever sees one convention.
 */
export function parseTable(text) {
  const source = String(text ?? "").replace(/^﻿/, "");
  const sample = source.split(/\r?\n/).slice(0, 20).join("\n");
  const count = (ch) => (sample.match(new RegExp(ch, "g")) ?? []).length;
  const delimiter = count("\t") > 0 ? "\t" : count(";") > 0 && count(";") >= count(",") / 2 ? ";" : ",";

  const parsed = Papa.parse(source, { delimiter, skipEmptyLines: "greedy" });
  let rows = parsed.data.map((r) => r.map((cell) => String(cell ?? "").trim()));
  // Trailing empty columns (a trailing delimiter on every line) carry nothing.
  const width = Math.max(0, ...rows.map((r) => {
    let w = r.length;
    while (w > 0 && r[w - 1] === "") w -= 1;
    return w;
  }));
  rows = rows.map((r) => padTo(r.slice(0, width), width));

  const decimalComma =
    delimiter !== "," && rows.some((r) => r.some((cell) => /^[-+]?\d*,\d+(e[-+]?\d+)?$/i.test(cell)));
  if (decimalComma) {
    rows = rows.map((r) => r.map((cell) => (/^[-+]?\d*,\d+(e[-+]?\d+)?$/i.test(cell) ? cell.replace(",", ".") : cell)));
  }
  return { rows, delimiter, decimal: decimalComma ? "," : "." };
}

const DELIMITER_NAMES = { "\t": "tab", ";": "semicolon", ",": "comma" };
export const delimiterName = (d) => DELIMITER_NAMES[d] ?? "comma";

/**
 * Turn parsed rows into a dataset.
 *
 * A first row with any text that is not a number is taken as column names.
 * Two columns where one holds labels and the other numbers ("long" format, as
 * R and Python write it) are spread into one column per label.
 */
export function datasetFromRows(rows, { kind = "groups", name = "Imported data" } = {}) {
  const clean = rows.filter((r) => r.some((c) => c !== ""));
  if (clean.length === 0) return null;
  const hasHeader = clean[0].some((c) => c !== "" && !isNumeric(c));
  const header = hasHeader ? clean[0] : null;
  const body = hasHeader ? clean.slice(1) : clean;
  const width = Math.max(...clean.map((r) => r.length));

  if (kind === "groups" && width === 2 && body.length > 0) {
    const firstIsLabels = body.every((r) => r[0] !== "" && !isNumeric(r[0]));
    const secondIsNumbers = body.every((r) => r[1] === "" || isNumeric(r[1]));
    if (firstIsLabels && secondIsNumbers) {
      const groups = new Map();
      for (const [label, value] of body) {
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(value);
      }
      return createDataset({ name, kind, columns: [...groups].map(([label, values]) => ({ name: label, values })) });
    }
  }

  const stem =
    kind === "xy"
      ? (i) => (i === 0 ? "X" : `Y${i}`)
      : kind === "grouped"
      ? (i) => (i === 0 ? "Group" : `Condition ${i}`)
      : kind === "contingency"
      ? (i) => (i === 0 ? "Group" : `Category ${i}`)
      : (i) => `Group ${i + 1}`;
  const columns = Array.from({ length: width }, (_, i) => ({
    name: header?.[i] || stem(i),
    values: body.map((r) => r[i] ?? ""),
  }));
  return createDataset({ name, kind, columns });
}

/**
 * A grouped dataset read as its two factors: the row labels in the order they
 * first appear, the condition columns, and the numbers in each cell of the
 * design. Rows whose label is blank are left out, since they belong to no
 * group.
 */
export function groupedFactors(dataset) {
  const labels = dataset.columns[0]?.values ?? [];
  const conditions = dataset.columns.slice(1).map((c, i) => ({ col: i + 1, name: c.name || `Condition ${i + 1}` }));
  const levels = [];
  for (const raw of labels) {
    const label = String(raw ?? "").trim();
    if (label !== "" && !levels.includes(label)) levels.push(label);
  }
  const cells = new Map();
  levels.forEach((level) => {
    conditions.forEach((condition) => {
      const values = [];
      labels.forEach((raw, row) => {
        if (String(raw ?? "").trim() !== level) return;
        const value = parseNumber(dataset.columns[condition.col]?.values[row]);
        if (Number.isFinite(value)) values.push(value);
      });
      cells.set(`${level}|${condition.name}`, values);
    });
  });
  return {
    rowFactor: dataset.columns[0]?.name || "Group",
    columnFactor: "Condition",
    levels,
    conditions,
    valuesAt: (level, condition) => cells.get(`${level}|${condition}`) ?? [],
  };
}

/**
 * A contingency table as rows of counts, with the row and column names.
 * Blank cells count as zero, since a category nobody fell into is a zero.
 */
export function countsTable(dataset) {
  const labels = (dataset.columns[0]?.values ?? []).map((v) => String(v ?? "").trim());
  const categories = dataset.columns.slice(1).map((c, i) => c.name || `Category ${i + 1}`);
  const rows = [];
  const rowNames = [];
  labels.forEach((label, row) => {
    if (label === "") return;
    const counts = dataset.columns.slice(1).map((column) => {
      const value = parseNumber(column.values[row]);
      return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
    });
    if (counts.some((c) => c > 0)) {
      rowNames.push(label);
      rows.push(counts);
    }
  });
  return { rows, rowNames, categories };
}

/**
 * The mean of each replicate in each condition, as a groups dataset: one
 * column per condition, one row per replicate.
 *
 * This is what a SuperPlot is really about. Cells within one dish are not
 * independent, so comparing thousands of them exaggerates how sure we are;
 * comparing the handful of replicate means does not.
 */
export function replicateMeans(dataset) {
  const { levels, conditions, valuesAt } = groupedFactors(dataset);
  return createDataset({
    name: `${dataset.name}: replicate means`,
    kind: "groups",
    columns: conditions.map((condition) => ({
      name: condition.name,
      values: levels.map((level) => {
        const values = valuesAt(level, condition.name);
        if (!values.length) return "";
        return String(values.reduce((sum, v) => sum + v, 0) / values.length);
      }),
    })),
  });
}

/**
 * What Morphly made of a table, column by column, for the "How Morphly read
 * it" panel: how many numbers each column holds and how many cells were not
 * numbers, so a column read wrongly is spotted before the graph is drawn.
 */
export function describeColumns(dataset) {
  return dataset.columns.map((c) => {
    const filled = c.values.filter((v) => String(v).trim() !== "");
    const numbers = filled.filter(isNumeric).length;
    return { name: c.name, numbers, other: filled.length - numbers };
  });
}
