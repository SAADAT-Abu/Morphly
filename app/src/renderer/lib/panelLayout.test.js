import { describe, it, expect } from "vitest";
import {
  gridCells,
  PANEL_PRESETS,
  presetCells,
  layoutPanels,
  panelLetter,
  readingOrder,
  reletterPanels,
} from "./panelLayout";

const area = { x: 50, y: 40, width: 1000, height: 700, gap: 20 };

describe("layoutPanels", () => {
  it("fills the area exactly with equal gaps between panels", () => {
    const boxes = layoutPanels({ rows: 2, cols: 3 }, area);
    expect(boxes).toHaveLength(6);
    expect(boxes[0]).toMatchObject({ x: 50, y: 40 });
    const last = boxes[5];
    expect(last.x + last.width).toBe(1050);
    expect(last.y + last.height).toBe(740);
    // Horizontal gaps in the first row, and the vertical gap between rows.
    expect(boxes[1].x - (boxes[0].x + boxes[0].width)).toBe(20);
    expect(boxes[2].x - (boxes[1].x + boxes[1].width)).toBe(20);
    expect(boxes[3].y - (boxes[0].y + boxes[0].height)).toBe(20);
  });

  it("stretches a spanning panel across the gap it covers", () => {
    const wideTop = PANEL_PRESETS.find((p) => p.id === "wide-top");
    const [top, left, right] = layoutPanels({ ...wideTop, cells: presetCells(wideTop) }, area);
    expect(top.x).toBe(left.x);
    expect(top.x + top.width).toBe(right.x + right.width);
  });

  it("stretches a tall panel down the rows it covers", () => {
    const tall = PANEL_PRESETS.find((p) => p.id === "tall-left");
    const [big, upper, lower] = layoutPanels({ ...tall, cells: presetCells(tall) }, area);
    expect(big.y).toBe(upper.y);
    expect(big.y + big.height).toBe(lower.y + lower.height);
  });

  it("keeps a single panel as the whole area", () => {
    expect(layoutPanels({ rows: 1, cols: 1 }, area)).toEqual([{ x: 50, y: 40, width: 1000, height: 700 }]);
  });

  it("uses whole units, so panel edges stay crisp", () => {
    for (const box of layoutPanels({ rows: 3, cols: 3 }, { width: 1001, height: 1001, gap: 7 })) {
      for (const v of Object.values(box)) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("every preset puts each grid cell in exactly one panel", () => {
    for (const preset of PANEL_PRESETS) {
      const covered = new Map();
      for (const cell of presetCells(preset)) {
        for (let r = cell.row; r < cell.row + (cell.rowSpan ?? 1); r += 1) {
          for (let c = cell.col; c < cell.col + (cell.colSpan ?? 1); c += 1) {
            const key = `${r},${c}`;
            covered.set(key, (covered.get(key) ?? 0) + 1);
          }
        }
      }
      expect(covered.size, preset.id).toBe(preset.rows * preset.cols);
      expect([...covered.values()].every((n) => n === 1), preset.id).toBe(true);
    }
  });

  it("lists grid cells row by row", () => {
    expect(gridCells(2, 2)).toEqual([{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }]);
  });
});

describe("panelLetter", () => {
  it("counts A to Z, then AA", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map((i) => panelLetter(i))).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
  });

  it("writes lower case or nothing on request", () => {
    expect(panelLetter(2, "lower")).toBe("c");
    expect(panelLetter(2, "none")).toBe("");
  });
});

describe("readingOrder", () => {
  it("reads row by row, left to right, forgiving small misalignment", () => {
    const boxes = [
      { x: 520, y: 4, width: 400, height: 300 }, // B, a few units lower than A
      { x: 0, y: 330, width: 400, height: 300 }, // C
      { x: 0, y: 0, width: 400, height: 300 }, // A
      { x: 520, y: 326, width: 400, height: 300 }, // D, slightly above C
    ];
    expect(readingOrder(boxes)).toEqual([2, 0, 1, 3]);
  });

  it("puts a tall panel first when it starts the top row", () => {
    const boxes = [
      { x: 520, y: 0, width: 400, height: 300 },
      { x: 0, y: 0, width: 400, height: 640 },
      { x: 520, y: 340, width: 400, height: 300 },
    ];
    expect(readingOrder(boxes)).toEqual([1, 0, 2]);
  });
});

describe("reletterPanels", () => {
  const panel = (id, x, y, over = {}) => ({ id, type: "rect", panel: true, x, y, width: 100, height: 100, ...over });

  it("letters panels in reading order", () => {
    const next = reletterPanels([panel("p1", 200, 0), panel("p2", 0, 0), panel("p3", 0, 200)]);
    expect(next.map((p) => p.panelLabel)).toEqual(["B", "A", "C"]);
  });

  it("returns the same array when every letter is right", () => {
    const els = reletterPanels([panel("p1", 0, 0), panel("p2", 200, 0)]);
    expect(reletterPanels(els)).toBe(els);
  });

  it("closes the gap when a panel is deleted or moved", () => {
    const els = reletterPanels([panel("a", 0, 0), panel("b", 200, 0), panel("c", 400, 0)]);
    expect(reletterPanels(els.filter((p) => p.id !== "b")).map((p) => p.panelLabel)).toEqual(["A", "B"]);
    const moved = els.map((p) => (p.id === "a" ? { ...p, x: 600 } : p));
    expect(reletterPanels(moved).map((p) => [p.id, p.panelLabel])).toEqual([["a", "C"], ["b", "A"], ["c", "B"]]);
  });

  it("leaves pages without panels alone, and ignores ordinary rectangles", () => {
    const plain = [{ id: "r", type: "rect", x: 0, y: 0, width: 5, height: 5 }];
    expect(reletterPanels(plain)).toBe(plain);
    const mixed = reletterPanels([plain[0], panel("p", 50, 50)]);
    expect(mixed[0]).toBe(plain[0]);
    expect(mixed[1].panelLabel).toBe("A");
  });

  it("names panels after their letters, unless renamed by hand", () => {
    const next = reletterPanels([panel("a", 0, 0, { name: "Panel" }), panel("b", 200, 0, { name: "Western blot" })]);
    expect(next.map((p) => p.name)).toEqual(["Panel A", "Western blot"]);
    const swapped = reletterPanels(next.map((p) => (p.id === "a" ? { ...p, x: 400 } : p)));
    expect(swapped.map((p) => p.name)).toEqual(["Panel B", "Western blot"]);
  });

  it("uses each panel's letter style", () => {
    const next = reletterPanels([panel("a", 0, 0, { panelLetterStyle: "lower" }), panel("b", 200, 0, { panelLetterStyle: "lower" })]);
    expect(next.map((p) => p.panelLabel)).toEqual(["a", "b"]);
  });
});
