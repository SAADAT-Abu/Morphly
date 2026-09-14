import { describe, it, expect } from "vitest";
import { alignMoves, distributeMoves, applyMoves, movableUnits } from "./align";

const canvas = { width: 1000, height: 800 };
const rect = (id, x, y, width = 100, height = 50, over = {}) => ({ id, type: "rect", x, y, width, height, visible: true, ...over });
const after = (elements, moves) => Object.fromEntries(applyMoves(elements, moves).map((el) => [el.id, el]));

describe("alignMoves", () => {
  it("centres a single object on the page, whatever the reference", () => {
    const els = [rect("a", 10, 10)];
    for (const relativeTo of ["page", "selection", "first", "biggest"]) {
      expect(after(els, alignMoves(els, ["a"], "hcenter", { relativeTo, canvas })).a.x).toBe(450);
    }
  });

  it("lines a selection up with its own left edge", () => {
    const els = [rect("a", 100, 0), rect("b", 40, 100), rect("c", 300, 200)];
    const moved = after(els, alignMoves(els, ["a", "b", "c"], "left", { relativeTo: "selection", canvas }));
    expect([moved.a.x, moved.b.x, moved.c.x]).toEqual([40, 40, 40]);
  });

  it("aligns several objects to the page centre", () => {
    const els = [rect("a", 0, 0, 100), rect("b", 700, 300, 200)];
    const moved = after(els, alignMoves(els, ["a", "b"], "hcenter", { relativeTo: "page", canvas }));
    expect([moved.a.x, moved.b.x]).toEqual([450, 400]);
  });

  it("keeps the first selected object still and aligns the others to it", () => {
    const els = [rect("a", 0, 0), rect("b", 500, 500)];
    const moves = alignMoves(els, ["b", "a"], "top", { relativeTo: "first", canvas });
    expect(moves.b).toBeUndefined();
    expect(after(els, moves).a.y).toBe(500);
  });

  it("keeps the biggest object still", () => {
    const els = [rect("small", 0, 0, 10, 10), rect("big", 300, 300, 400, 400)];
    const moved = after(els, alignMoves(els, ["small", "big"], "right", { relativeTo: "biggest", canvas }));
    expect(moved.big.x).toBe(300);
    expect(moved.small.x).toBe(690);
  });

  it("centres each object in the panel it sits in", () => {
    const els = [
      rect("p1", 0, 0, 500, 800, { panel: true }),
      rect("p2", 500, 0, 500, 800, { panel: true }),
      rect("a", 20, 20, 100, 50),
      rect("b", 900, 20, 60, 50),
    ];
    const moved = after(els, alignMoves(els, ["a", "b"], "hcenter", { relativeTo: "panel", canvas }));
    expect(moved.a.x).toBe(200);
    expect(moved.b.x).toBe(720);
  });

  it("moves a group as one piece", () => {
    const els = [rect("a", 0, 0, 100, 50, { groupId: "g" }), rect("b", 200, 100, 100, 50, { groupId: "g" })];
    const moved = after(els, alignMoves(els, ["a", "b"], "left", { relativeTo: "page", canvas }));
    // The group was already at the left edge as a whole, so neither moves.
    expect([moved.a.x, moved.b.x]).toEqual([0, 200]);
    const centred = after(els, alignMoves(els, ["a", "b"], "hcenter", { relativeTo: "page", canvas }));
    expect(centred.b.x - centred.a.x).toBe(200);
  });

  it("leaves locked objects and glued lines alone", () => {
    const els = [
      rect("a", 0, 0),
      rect("locked", 10, 300, 100, 50, { locked: true }),
      { id: "line", type: "line", x: 5, y: 5, points: [0, 0, 50, 0], end: { elementId: "a", anchor: "left" } },
    ];
    const moves = alignMoves(els, ["a", "locked", "line"], "right", { relativeTo: "page", canvas });
    expect(Object.keys(moves)).toEqual(["a"]);
  });

  it("uses the box a rotated object really covers", () => {
    const els = [rect("r", 500, 100, 200, 100, { rotation: 90 })]; // covers x 400..500
    expect(after(els, alignMoves(els, ["r"], "left", { relativeTo: "page", canvas })).r.x).toBe(100);
  });
});

describe("distributeMoves", () => {
  it("evens out the gaps, keeping the outer objects still", () => {
    const els = [rect("a", 0, 0, 100), rect("b", 150, 0, 50), rect("c", 600, 0, 100)];
    const moved = after(els, distributeMoves(els, ["c", "a", "b"], "h-gaps", { relativeTo: "selection", canvas }));
    // 700 wide in total, 250 of objects: two gaps of 225.
    expect([moved.a.x, moved.b.x, moved.c.x]).toEqual([0, 325, 600]);
  });

  it("spreads centres evenly", () => {
    const els = [rect("a", 0, 0, 0, 20), rect("b", 0, 30, 0, 100), rect("c", 0, 500, 0, 20)];
    const moved = after(els, distributeMoves(els, ["a", "b", "c"], "v-centres", { relativeTo: "selection", canvas }));
    const centre = (el) => el.y + el.height / 2;
    expect(centre(moved.b) - centre(moved.a)).toBeCloseTo(centre(moved.c) - centre(moved.b), 6);
  });

  it("spreads across the whole page from edge to edge", () => {
    const els = [rect("a", 300, 0, 100), rect("b", 500, 0, 100)];
    const moved = after(els, distributeMoves(els, ["a", "b"], "h-gaps", { relativeTo: "page", canvas }));
    expect([moved.a.x, moved.b.x]).toEqual([0, 900]);
  });

  it("needs three objects to distribute between themselves", () => {
    const els = [rect("a", 0, 0), rect("b", 500, 0)];
    expect(distributeMoves(els, ["a", "b"], "h-gaps", { relativeTo: "selection", canvas })).toEqual({});
  });
});

describe("movableUnits", () => {
  it("keeps selection order, with a group counted once", () => {
    const els = [rect("a", 0, 0, 10, 10, { groupId: "g" }), rect("b", 0, 0), rect("c", 0, 0, 10, 10, { groupId: "g" })];
    const units = movableUnits(els, ["b", "a", "c"]);
    expect(units.map((u) => u.members.map((m) => m.id))).toEqual([["b"], ["a", "c"]]);
  });
});

describe("applyMoves", () => {
  it("returns the same array when nothing moves", () => {
    const els = [rect("a", 0, 0)];
    expect(applyMoves(els, {})).toBe(els);
  });
});
