import { describe, it, expect } from "vitest";
import {
  replicateMeans,
  groupedFactors,
  parseNumber,
  createDataset,
  blankDataset,
  sampleDataset,
  applyDatasetOp,
  rowCount,
  columnNumbers,
  completeRows,
  parseTable,
  datasetFromRows,
  describeColumns,
} from "./datasets";

describe("parseNumber", () => {
  it("reads points, decimal commas, signs and exponents", () => {
    expect(parseNumber("2.25")).toBe(2.25);
    expect(parseNumber(" 1,5 ")).toBe(1.5);
    expect(parseNumber("-3e2")).toBe(-300);
    expect(parseNumber(".5")).toBe(0.5);
  });

  it("refuses what is not a number", () => {
    for (const bad of ["", "  ", "abc", "1,000,000", "12a", "1.2.3", null]) {
      expect(Number.isNaN(parseNumber(bad))).toBe(true);
    }
  });
});

describe("datasets", () => {
  it("pads columns to the same length", () => {
    const ds = createDataset({ columns: [{ name: "A", values: ["1", "2", "3"] }, { name: "B", values: ["4"] }] });
    expect(ds.columns[1].values).toEqual(["4", "", ""]);
    expect(rowCount(ds)).toBe(3);
  });

  it("reads a column's numbers, skipping blanks and text", () => {
    const ds = createDataset({ columns: [{ name: "A", values: ["1", "", "x", "2,5"] }] });
    expect(columnNumbers(ds, 0)).toEqual([1, 2.5]);
  });

  it("keeps only complete rows for paired data", () => {
    const ds = createDataset({
      columns: [
        { name: "A", values: ["1", "2", "3"] },
        { name: "B", values: ["4", "", "6"] },
      ],
    });
    expect(completeRows(ds, [0, 1])).toEqual([
      [1, 4],
      [3, 6],
    ]);
  });

  it("offers blank tables and sample data of both shapes", () => {
    expect(blankDataset("groups").columns.map((c) => c.name)).toEqual(["Group 1", "Group 2", "Group 3"]);
    expect(blankDataset("xy").columns[0].name).toBe("X");
    expect(sampleDataset("groups").columns).toHaveLength(4);
    expect(sampleDataset("xy").kind).toBe("xy");
  });
});

describe("applyDatasetOp", () => {
  const base = () => createDataset({ columns: [{ name: "A", values: ["1", "2"] }, { name: "B", values: ["3", "4"] }] });

  it("sets a cell, growing the table when typing below it", () => {
    const ds = base();
    const next = applyDatasetOp(ds, { op: "setCell", col: 1, row: 3, value: "9" });
    expect(next.columns[1].values).toEqual(["3", "4", "", "9"]);
    expect(next.columns[0].values).toEqual(["1", "2", "", ""]);
    expect(ds.columns[1].values).toEqual(["3", "4"]); // untouched
  });

  it("pastes a block, adding columns and rows as needed", () => {
    const next = applyDatasetOp(base(), {
      op: "pasteBlock",
      col: 1,
      row: 1,
      cells: [
        ["5", "6"],
        ["7", "8"],
      ],
    });
    expect(next.columns).toHaveLength(3);
    expect(next.columns[1].values).toEqual(["3", "5", "7"]);
    expect(next.columns[2].values).toEqual(["", "6", "8"]);
  });

  it("adds, renames and removes columns, but never the last one", () => {
    let ds = applyDatasetOp(base(), { op: "addColumn" });
    expect(ds.columns[2].name).toBe("Group 2");
    ds = applyDatasetOp(ds, { op: "renameColumn", col: 2, name: "Drug" });
    expect(ds.columns[2].name).toBe("Drug");
    ds = applyDatasetOp(ds, { op: "removeColumn", col: 0 });
    ds = applyDatasetOp(ds, { op: "removeColumn", col: 0 });
    const last = applyDatasetOp(ds, { op: "removeColumn", col: 0 });
    expect(last.columns).toHaveLength(1);
  });

  it("adds and removes rows", () => {
    let ds = applyDatasetOp(base(), { op: "addRows", count: 2 });
    expect(rowCount(ds)).toBe(4);
    ds = applyDatasetOp(ds, { op: "removeRow", row: 0 });
    expect(ds.columns[0].values).toEqual(["2", "", ""]);
  });

  it("ignores operations that do not apply", () => {
    const ds = base();
    expect(applyDatasetOp(ds, { op: "setCell", col: 5, row: 0, value: "1" })).toBe(ds);
    expect(applyDatasetOp(ds, { op: "nonsense" })).toBe(ds);
    expect(applyDatasetOp(ds, { op: "setKind", kind: "pie" })).toBe(ds);
  });
});

describe("parseTable", () => {
  it("reads comma separated values", () => {
    const t = parseTable("Control,Drug\n1.5,2\n3,4\n");
    expect(t.delimiter).toBe(",");
    expect(t.decimal).toBe(".");
    expect(t.rows).toEqual([
      ["Control", "Drug"],
      ["1.5", "2"],
      ["3", "4"],
    ]);
  });

  it("reads European CSV: semicolons and decimal commas", () => {
    const t = parseTable("﻿Control;Drug\r\n1,5;2,25\r\n3;4\r\n");
    expect(t.delimiter).toBe(";");
    expect(t.decimal).toBe(",");
    expect(t.rows[1]).toEqual(["1.5", "2.25"]);
  });

  it("reads cells copied from a spreadsheet (tabs)", () => {
    const t = parseTable("A\tB\n1\t2\n\t3\n");
    expect(t.delimiter).toBe("\t");
    expect(t.rows[2]).toEqual(["", "3"]);
  });

  it("drops empty trailing columns", () => {
    expect(parseTable("a,b,\n1,2,\n").rows[0]).toEqual(["a", "b"]);
  });
});

describe("datasetFromRows", () => {
  it("takes a text first row as column names", () => {
    const ds = datasetFromRows([
      ["WT", "KO"],
      ["1", "2"],
    ]);
    expect(ds.columns.map((c) => c.name)).toEqual(["WT", "KO"]);
    expect(ds.columns[0].values).toEqual(["1"]);
  });

  it("names columns itself when the table has no header", () => {
    const ds = datasetFromRows([["1", "2"]], { kind: "xy" });
    expect(ds.columns.map((c) => c.name)).toEqual(["X", "Y1"]);
  });

  it("spreads long format (label, value) into one column per group", () => {
    const ds = datasetFromRows([
      ["group", "value"],
      ["ctrl", "1"],
      ["drug", "5"],
      ["ctrl", "2"],
    ]);
    expect(ds.columns.map((c) => c.name)).toEqual(["ctrl", "drug"]);
    expect(ds.columns[0].values).toEqual(["1", "2"]);
    expect(ds.columns[1].values).toEqual(["5", ""]);
  });

  it("says how each column was read", () => {
    const ds = createDataset({ columns: [{ name: "A", values: ["1", "x", ""] }] });
    expect(describeColumns(ds)).toEqual([{ name: "A", numbers: 1, other: 1 }]);
  });

  it("returns null for an empty table", () => {
    expect(datasetFromRows([["", ""]])).toBeNull();
  });
});

describe("grouped tables", () => {
  const ds = createDataset({
    kind: "grouped",
    columns: [
      { name: "Genotype", values: ["WT", "WT", "KO", "KO", "  ", "WT"] },
      { name: "Vehicle", values: ["1", "3", "5", "7", "9", "x"] },
      { name: "Drug", values: ["2", "4", "6", "8", "10", "12"] },
    ],
  });

  it("reads the two factors, in the order the groups first appear", () => {
    const f = groupedFactors(ds);
    expect(f.rowFactor).toBe("Genotype");
    expect(f.levels).toEqual(["WT", "KO"]);
    expect(f.conditions.map((c) => c.name)).toEqual(["Vehicle", "Drug"]);
    // The blank label is left out, and so is the cell that is not a number.
    expect(f.valuesAt("WT", "Vehicle")).toEqual([1, 3]);
    expect(f.valuesAt("WT", "Drug")).toEqual([2, 4, 12]);
    expect(f.valuesAt("KO", "Vehicle")).toEqual([5, 7]);
  });

  it("averages each replicate for a SuperPlot", () => {
    const means = replicateMeans(ds);
    expect(means.kind).toBe("groups");
    expect(means.columns.map((c) => c.name)).toEqual(["Vehicle", "Drug"]);
    expect(means.columns[0].values).toEqual(["2", "6"]);
    expect(means.columns[1].values).toEqual(["6", "7"]);
  });
});
