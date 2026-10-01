import { describe, it, expect } from "vitest";
import { flipTransform, canFlip, localBounds } from "./geometry";
import { buildSvg } from "./exporters";
import { useStore } from "../store";

/** Apply a flipTransform the way both the canvas and the exporter do. */
const map = (el, px, py) => {
  const f = flipTransform(el);
  return { x: f.x + f.scaleX * px, y: f.y + f.scaleY * py };
};

const box = (over = {}) => ({
  id: "e1", type: "rect", name: "Box", x: 100, y: 50, width: 80, height: 40,
  rotation: 0, opacity: 1, visible: true, fill: "#ddd", stroke: "#333", strokeWidth: 2,
  ...over,
});

describe("flipTransform", () => {
  it("is the identity when nothing is flipped", () => {
    expect(flipTransform(box())).toMatchObject({ scaleX: 1, scaleY: 1, x: 0, y: 0, flipped: false });
  });

  it("mirrors about the element's own centre, leaving it where it was", () => {
    const el = box({ flipX: true });
    // The two vertical edges swap, so the element covers the same ground.
    expect(map(el, 0, 0)).toEqual({ x: 80, y: 0 });
    expect(map(el, 80, 0)).toEqual({ x: 0, y: 0 });
    // The centre does not move.
    expect(map(el, 40, 20)).toEqual({ x: 40, y: 20 });
  });

  it("mirrors top to bottom independently, and both at once", () => {
    expect(map(box({ flipY: true }), 0, 0)).toEqual({ x: 0, y: 40 });
    expect(map(box({ flipX: true, flipY: true }), 0, 0)).toEqual({ x: 80, y: 40 });
  });

  it("follows a line's points rather than assuming it starts at its origin", () => {
    // Points either side of the origin: the mirror is about their own middle.
    const line = { id: "l", type: "line", x: 10, y: 10, points: [-20, 0, 60, 0], flipX: true };
    expect(localBounds(line)).toMatchObject({ x: -20, width: 80 });
    expect(map(line, -20, 0)).toEqual({ x: 60, y: 0 });
    expect(map(line, 60, 0)).toEqual({ x: -20, y: 0 });
  });

  it("comes back to where it started when flipped twice", () => {
    const once = box({ flipX: true });
    const twice = box({ flipX: false });
    expect(map(twice, 13, 7)).toEqual({ x: 13, y: 7 });
    expect(map(once, ...Object.values(map(once, 13, 7)))).toEqual({ x: 13, y: 7 });
  });
});

describe("canFlip", () => {
  it("covers artwork and shapes", () => {
    for (const type of ["asset", "image", "rect", "ellipse", "triangle", "line", "arrow", "connector"]) {
      expect(canFlip({ type })).toBe(true);
    }
  });

  it("leaves out what a mirror would make wrong rather than reversed", () => {
    for (const type of ["text", "table", "plot"]) expect(canFlip({ type })).toBe(false);
    expect(canFlip(undefined)).toBe(false);
  });
});

describe("flipSelected", () => {
  const reset = (elements, selectedIds) =>
    useStore.setState({ elements, selectedIds, past: [], future: [] });

  it("toggles the flag on each axis and is undoable", () => {
    reset([box()], ["e1"]);
    useStore.getState().flipSelected("x");
    expect(useStore.getState().elements[0].flipX).toBe(true);
    useStore.getState().flipSelected("y");
    expect(useStore.getState().elements[0]).toMatchObject({ flipX: true, flipY: true });
    useStore.getState().undo();
    expect(useStore.getState().elements[0].flipX).toBe(true);
    expect(useStore.getState().elements[0].flipY).toBeFalsy();
    useStore.getState().flipSelected("x");
    expect(useStore.getState().elements[0].flipX).toBe(false);
  });

  it("flips only what it can, and leaves the rest of a mixed selection alone", () => {
    reset(
      [box(), { id: "t1", type: "text", x: 0, y: 0, text: "Figure 1" },
       box({ id: "r2", locked: true })],
      ["e1", "t1", "r2"]
    );
    useStore.getState().flipSelected("x");
    const byId = Object.fromEntries(useStore.getState().elements.map((el) => [el.id, el]));
    expect(byId.e1.flipX).toBe(true);
    expect(byId.t1.flipX).toBeUndefined();
    expect(byId.r2.flipX).toBeUndefined(); // locked
  });

  it("does nothing, and records no undo step, when nothing can flip", () => {
    reset([{ id: "t1", type: "text", x: 0, y: 0, text: "hi" }], ["t1"]);
    useStore.getState().flipSelected("x");
    expect(useStore.getState().past).toHaveLength(0);
  });
});

describe("export", () => {
  const canvas = { width: 400, height: 300, background: "#ffffff" };

  it("writes the same mirror into the SVG, around the artwork only", () => {
    const el = box({ flipX: true, label: "Nucleus" });
    const svg = buildSvg({ elements: [el], canvas, stage: null });
    // translate then scale, matching flipTransform.
    expect(svg).toContain('transform="translate(80 0) scale(-1 1)"');
    // The caption is outside that group, so it reads normally.
    const mirror = svg.indexOf("scale(-1 1)");
    expect(svg.indexOf("Nucleus")).toBeGreaterThan(svg.indexOf("</g>", mirror));
  });

  it("adds no transform at all when nothing is flipped", () => {
    expect(buildSvg({ elements: [box()], canvas, stage: null })).not.toContain("scale(");
  });
});
