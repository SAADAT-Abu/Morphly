import { describe, it, expect } from "vitest";
import { snapContext, snapMove, snapPoint, panelAt } from "./snapping";

const canvas = { width: 1000, height: 800 };
const box = (x, y, width, height) => ({ x, y, width, height });

describe("snapMove: alignment", () => {
  it("leaves a box alone when nothing is near", () => {
    const snap = snapMove(box(103, 207, 50, 50), snapContext({ canvas }), 6);
    expect(snap).toMatchObject({ dx: 0, dy: 0, guides: [], gaps: [] });
  });

  it("snaps a centre to the centre of the page, with a guide down the page", () => {
    const snap = snapMove(box(447, 100, 100, 50), snapContext({ canvas }), 6);
    expect(snap.dx).toBe(3);
    expect(snap.guides).toContainEqual({ axis: "x", at: 500, from: 0, to: 800 });
  });

  it("snaps an edge to another object's edge, drawing the guide across both", () => {
    const other = box(0, 0, 200, 100);
    const snap = snapMove(box(204, 300, 50, 50), snapContext({ canvas, others: [other] }), 6);
    expect(snap.dx).toBe(-4);
    expect(snap.guides).toContainEqual({ axis: "x", at: 200, from: 0, to: 350 });
  });

  it("does not snap at exactly the threshold distance", () => {
    const snap = snapMove(box(6, 300, 100, 50), snapContext({ canvas }), 6);
    expect(snap.dx).toBe(0);
  });

  it("snaps both axes independently", () => {
    const snap = snapMove(box(2, 797, 0, 0), snapContext({ canvas }), 6);
    expect(snap).toMatchObject({ dx: -2, dy: 3 });
  });

  it("marks every line the box ends up touching", () => {
    const a = box(0, 0, 100, 50); // left edge at 0 and right at 100
    const b = box(50, 400, 100, 50); // centre at 100
    const snap = snapMove(box(1, 200, 100, 50), snapContext({ canvas, others: [a, b] }), 6);
    const xs = snap.guides.filter((g) => g.axis === "x").map((g) => g.at).sort((p, q) => p - q);
    // Left edge on a's left (0), centre on b's left (50), right edge on a's right and b's centre (100).
    expect(xs).toEqual([0, 50, 100]);
  });
});

describe("snapMove: panels", () => {
  const left = box(40, 40, 440, 720); // a panel on the left half

  it("favours the centre of the panel over the page centre", () => {
    // Centred on 262, the panel centre (260) is 2 away and nothing else is near.
    const context = snapContext({ canvas, panels: [left], others: [left], focus: box(212, 300, 100, 60) });
    const snap = snapMove(box(212, 300, 100, 60), context, 6);
    expect(snap.dx).toBe(-2);
    expect(snap.guides).toContainEqual({ axis: "x", at: 260, from: 40, to: 760 });
  });

  it("prefers the panel centre even when an ordinary line is slightly closer", () => {
    const other = box(263, 0, 10, 10); // its left edge, 263, is 1 away from the box centre
    const moving = box(212, 300, 100, 60); // centre 262; panel centre 260 is 2 away
    const context = snapContext({ canvas, panels: [left], others: [left, other], focus: moving });
    expect(snapMove(moving, context, 6).dx).toBe(-2);
  });

  it("pulls from a little further away inside a panel", () => {
    const moving = box(217, 300, 100, 60); // centre 267, 7 from the panel centre
    const inPanel = snapContext({ canvas, panels: [left], focus: moving });
    expect(snapMove(moving, inPanel, 6).dx).toBe(-7);
  });

  it("ignores the panel's lines for a box outside it", () => {
    const moving = box(600, 300, 100, 60);
    const context = snapContext({ canvas, panels: [left], focus: moving });
    expect(context.panel).toBeNull();
  });

  it("finds the smallest panel under a point", () => {
    const big = box(0, 0, 1000, 800);
    const small = box(100, 100, 200, 200);
    expect(panelAt([big, small], { x: 150, y: 150 })).toBe(small);
    expect(panelAt([big, small], { x: 900, y: 700 })).toBe(big);
    expect(panelAt([small], { x: 900, y: 700 })).toBeNull();
  });
});

describe("snapMove: equal spacing", () => {
  it("centres a box between its neighbours and marks both gaps", () => {
    const a = box(100, 300, 100, 100); // ends at 200
    const b = box(500, 300, 100, 100); // starts at 500
    // 100 wide in a 300 gap: centred at x = 300. Start at 303, away from any other line.
    const snap = snapMove(box(303, 320, 100, 60), snapContext({ canvas, others: [a, b] }), 6);
    expect(snap.dx).toBe(-3);
    expect(snap.gaps).toEqual([
      { axis: "x", from: 200, to: 300, at: 350 },
      { axis: "x", from: 400, to: 500, at: 350 },
    ]);
  });

  it("repeats the gap neighbours already have", () => {
    const a = box(100, 300, 100, 100); // 100..200
    const b = box(260, 300, 100, 100); // 260..360, a gap of 60 after a
    // Placing a third to the right: 60 after b means x = 420.
    const snap = snapMove(box(424, 310, 80, 80), snapContext({ canvas, others: [a, b] }), 6);
    expect(snap.dx).toBe(-4);
    expect(snap.gaps.map((g) => g.to - g.from)).toEqual([60, 60]);
  });

  it("only counts neighbours level with the box", () => {
    const a = box(100, 0, 100, 50);
    const b = box(500, 0, 100, 50);
    const snap = snapMove(box(303, 600, 100, 60), snapContext({ canvas, others: [a, b] }), 6);
    expect(snap.gaps).toEqual([]);
  });
});

describe("snapPoint", () => {
  it("snaps a resize handle to nearby lines and reports the guide", () => {
    const other = box(300, 100, 200, 100);
    const snap = snapPoint({ x: 497, y: 452 }, snapContext({ canvas, others: [other] }), 6);
    expect(snap).toMatchObject({ x: 500, y: 452 });
    expect(snap.guides).toEqual([{ axis: "x", at: 500, from: 0, to: 800 }]);
  });
});
