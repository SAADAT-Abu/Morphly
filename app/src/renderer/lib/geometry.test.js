import { describe, it, expect } from "vitest";
import { pointsBounds, elementBox, computeSnap } from "./geometry";

const canvas = { width: 1000, height: 800 };

describe("pointsBounds", () => {
  it("measures a straight segment", () => {
    expect(pointsBounds([0, 0, 100, 50])).toEqual({ width: 100, height: 50 });
  });

  it("handles negative coordinates and more than two points", () => {
    expect(pointsBounds([10, 20, -30, 60, 50, 0])).toEqual({ width: 80, height: 60 });
  });
});

describe("elementBox", () => {
  it("derives the box of a line from its points", () => {
    expect(elementBox({ x: 5, y: 6, points: [0, 0, 100, 50] })).toEqual({ x: 5, y: 6, width: 100, height: 50 });
  });

  it("uses width and height for everything else", () => {
    expect(elementBox({ x: 1, y: 2, width: 30, height: 40 })).toEqual({ x: 1, y: 2, width: 30, height: 40 });
  });

  it("treats a missing size as zero", () => {
    expect(elementBox({ x: 1, y: 2 })).toEqual({ x: 1, y: 2, width: 0, height: 0 });
  });
});

describe("computeSnap", () => {
  it("leaves an element alone when nothing is near", () => {
    const snap = computeSnap({ x: 103, y: 207, width: 50, height: 50 }, [], canvas, 6);
    expect(snap).toEqual({ x: 103, y: 207, guides: { vertical: null, horizontal: null } });
  });

  it("snaps an element's centre to the centre of the page", () => {
    const snap = computeSnap({ x: 447, y: 100, width: 100, height: 50 }, [], canvas, 6);
    expect(snap.x).toBe(450);
    expect(snap.guides.vertical).toBe(500);
  });

  it("snaps an edge to another element's edge", () => {
    const other = { x: 0, y: 0, width: 200, height: 100 };
    const snap = computeSnap({ x: 204, y: 300, width: 50, height: 50 }, [other], canvas, 6);
    expect(snap.x).toBe(200);
    expect(snap.guides.vertical).toBe(200);
  });

  it("picks the closest guide when several are in range", () => {
    const other = { x: 503, y: 0, width: 10, height: 10 };
    const snap = computeSnap({ x: 498, y: 300, width: 100, height: 50 }, [other], canvas, 6);
    expect(snap.x).toBe(500);
  });

  it("does not snap at exactly the threshold distance", () => {
    const snap = computeSnap({ x: 6, y: 300, width: 100, height: 50 }, [], canvas, 6);
    expect(snap.x).toBe(6);
    expect(snap.guides.vertical).toBeNull();
  });

  it("snaps to lines and arrows using the box of their points", () => {
    const line = { x: 300, y: 0, points: [0, 0, 100, 0] };
    const snap = computeSnap({ x: 403, y: 300, width: 10, height: 10 }, [line], canvas, 6);
    expect(snap.x).toBe(400);
  });

  it("snaps both axes independently", () => {
    const snap = computeSnap({ x: 2, y: 797, width: 0, height: 0 }, [], canvas, 6);
    expect(snap).toMatchObject({ x: 0, y: 800 });
  });
});
