import { describe, it, expect } from "vitest";
import { pointsBounds, elementBox, visualBox, unionBox, aspectLocked, selectionKeepsRatio } from "./geometry";

describe("visualBox", () => {
  it("is the element's own box when it is upright", () => {
    expect(visualBox({ x: 10, y: 20, width: 30, height: 40 })).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("follows a line's points to either side of its origin", () => {
    expect(visualBox({ x: 100, y: 100, points: [0, 0, -40, 30] })).toEqual({ x: 60, y: 100, width: 40, height: 30 });
  });

  it("covers a turned element, which rotates about its top-left corner", () => {
    const box = visualBox({ x: 100, y: 100, width: 200, height: 100, rotation: 90 });
    expect(box.x).toBeCloseTo(0, 6);
    expect(box.y).toBeCloseTo(100, 6);
    expect(box.width).toBeCloseTo(100, 6);
    expect(box.height).toBeCloseTo(200, 6);
  });

  it("asks for a height the model does not store, as for text", () => {
    expect(visualBox({ x: 0, y: 0, width: 300 }, () => 48).height).toBe(48);
    expect(visualBox({ x: 0, y: 0, width: 300 }).height).toBe(0);
  });
});

describe("unionBox", () => {
  it("surrounds every box", () => {
    expect(unionBox([{ x: 0, y: 10, width: 5, height: 5 }, { x: 20, y: 0, width: 10, height: 40 }])).toEqual({ x: 0, y: 0, width: 30, height: 40 });
  });

  it("is null for nothing", () => {
    expect(unionBox([])).toBeNull();
  });
});


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

describe("locking the proportions", () => {
  it("starts locked for the things that should not be squashed", () => {
    expect(aspectLocked({ type: "image" })).toBe(true);
    expect(aspectLocked({ type: "asset" })).toBe(true);
  });

  it("starts free for the things that are meant to be shaped", () => {
    expect(aspectLocked({ type: "rect" })).toBe(false);
    expect(aspectLocked({ type: "plot" })).toBe(false);
    expect(aspectLocked({ type: "table" })).toBe(false);
  });

  it("lets either default be overruled, and remembers false as a choice", () => {
    expect(aspectLocked({ type: "image", lockAspect: false })).toBe(false);
    expect(aspectLocked({ type: "rect", lockAspect: true })).toBe(true);
  });

  it("keeps the ratio of a selection only when every part of it is locked", () => {
    expect(selectionKeepsRatio([{ type: "image" }, { type: "asset" }])).toBe(true);
    // A mixed selection resizes freely: there is no one answer, and freeing it
    // is the choice that can be taken back.
    expect(selectionKeepsRatio([{ type: "image" }, { type: "rect" }])).toBe(false);
    expect(selectionKeepsRatio([])).toBe(false);
  });
});
