import { describe, it, expect } from "vitest";
import { offsets, cellBox, cellAtPoint, isHeaderCell, cellCorners } from "./tableLayout";

const table = (over = {}) => ({
  rows: 2,
  cols: 3,
  colWidths: [80, 120, 60],
  rowHeights: [40, 30],
  headerRow: true,
  headerCol: false,
  cornerRadius: 6,
  ...over,
});

describe("offsets", () => {
  it("returns running start positions", () => {
    expect(offsets([80, 120, 60])).toEqual([0, 80, 200]);
  });

  it("returns nothing for no sizes", () => {
    expect(offsets([])).toEqual([]);
  });
});

describe("cellBox", () => {
  it("places a cell using its own column width and row height", () => {
    expect(cellBox(table(), 1, 2)).toEqual({ x: 200, y: 40, width: 60, height: 30 });
  });
});

describe("cellAtPoint", () => {
  it("finds the cell under a point", () => {
    expect(cellAtPoint(table(), 85, 45)).toMatchObject({ row: 1, col: 1, x: 80, y: 40 });
  });

  it("assigns a shared border to the cell that starts there", () => {
    expect(cellAtPoint(table(), 80, 0)).toMatchObject({ row: 0, col: 1 });
    expect(cellAtPoint(table(), 79.9, 0)).toMatchObject({ row: 0, col: 0 });
  });

  it("returns null outside the table", () => {
    expect(cellAtPoint(table(), 260, 10)).toBeNull();
    expect(cellAtPoint(table(), 10, 70)).toBeNull();
    expect(cellAtPoint(table(), -1, 10)).toBeNull();
  });
});

describe("isHeaderCell", () => {
  it("marks the first row when the table has a header row", () => {
    expect(isHeaderCell(table(), 0, 2)).toBe(true);
    expect(isHeaderCell(table(), 1, 0)).toBe(false);
  });

  it("marks the first column when the table has a header column", () => {
    expect(isHeaderCell(table({ headerRow: false, headerCol: true }), 1, 0)).toBe(true);
    expect(isHeaderCell(table({ headerRow: false, headerCol: true }), 0, 1)).toBe(false);
  });
});

describe("cellCorners", () => {
  it("rounds only the four outer corners of the table", () => {
    const t = table();
    expect(cellCorners(t, 0, 0)).toEqual([6, 0, 0, 0]);
    expect(cellCorners(t, 0, 2)).toEqual([0, 6, 0, 0]);
    expect(cellCorners(t, 1, 2)).toEqual([0, 0, 6, 0]);
    expect(cellCorners(t, 1, 0)).toEqual([0, 0, 0, 6]);
    expect(cellCorners(t, 0, 1)).toEqual([0, 0, 0, 0]);
  });

  it("rounds all four corners of a one-cell table", () => {
    expect(cellCorners(table({ rows: 1, cols: 1, colWidths: [50], rowHeights: [20] }), 0, 0)).toEqual([6, 6, 6, 6]);
  });

  it("rounds nothing when the radius is zero", () => {
    expect(cellCorners(table({ cornerRadius: 0 }), 0, 0)).toEqual([0, 0, 0, 0]);
  });
});
