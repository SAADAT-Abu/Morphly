import { describe, it, expect } from "vitest";
import {
  anchorPoints,
  anchorPoint,
  nearestAnchor,
  glueTargetAt,
  connectorGeometry,
  bendThrough,
  elbowRoute,
  elbowRatioAt,
  relayoutConnectors,
  unglueExcept,
  remapGlue,
  ELBOW_STUB,
} from "./connectors";

const rect = (over = {}) => ({ id: "r", type: "rect", x: 100, y: 100, width: 200, height: 100, rotation: 0, visible: true, ...over });
const arrow = (over = {}) => ({
  id: "a",
  type: "arrow",
  x: 0,
  y: 0,
  points: [0, 0, 100, 0],
  strokeWidth: 4,
  heads: "end",
  start: null,
  end: null,
  ...over,
});
const close = (a, b) => expect(a).toBeCloseTo(b, 6);
const byId = (...els) => {
  const map = new Map(els.map((e) => [e.id, e]));
  return (id) => map.get(id);
};

describe("glue points", () => {
  it("puts eight points on a box: side middles and corners", () => {
    const points = Object.fromEntries(anchorPoints(rect()).map((a) => [a.anchor, [a.x, a.y]]));
    expect(points).toEqual({
      top: [200, 100],
      "top-right": [300, 100],
      right: [300, 150],
      "bottom-right": [300, 200],
      bottom: [200, 200],
      "bottom-left": [100, 200],
      left: [100, 150],
      "top-left": [100, 100],
    });
  });

  it("gives sides an outward direction and corners none", () => {
    expect(anchorPoint(rect(), "right").direction).toEqual({ x: 1, y: 0 });
    expect(anchorPoint(rect(), "top-left").direction).toBeNull();
  });

  it("turns with a rotated element, about its top-left corner", () => {
    // The right middle sits at (200, 50) in the box; a quarter turn about the
    // corner at (100, 100) carries it to (100 - 50, 100 + 200).
    const a = anchorPoint(rect({ rotation: 90 }), "right");
    close(a.x, 50);
    close(a.y, 300);
    close(a.direction.x, 0);
    close(a.direction.y, 1);
  });

  it("sits the diagonal points of an ellipse on its outline", () => {
    const e = rect({ type: "ellipse" });
    for (const a of anchorPoints(e)) {
      const u = (a.x - 200) / 100;
      const v = (a.y - 150) / 50;
      close(u * u + v * v, 1);
    }
  });

  it("uses a triangle's own corners and sides", () => {
    const t = rect({ type: "triangle" });
    expect(anchorPoint(t, "top")).toMatchObject({ x: 200, y: 100 });
    expect(anchorPoint(t, "left")).toMatchObject({ x: 150, y: 150 });
    expect(anchorPoint(t, "top-left")).toBeNull();
  });

  it("offers nothing on lines, text or empty boxes", () => {
    expect(anchorPoints(arrow())).toEqual([]);
    expect(anchorPoints({ type: "text", x: 0, y: 0, width: 100 })).toEqual([]);
    expect(anchorPoints(rect({ width: 0 }))).toEqual([]);
  });
});

describe("finding a glue point", () => {
  const els = [rect(), rect({ id: "r2", x: 400 }), arrow()];

  it("picks the nearest point within reach", () => {
    expect(nearestAnchor(els, { x: 305, y: 148 }, 10)).toMatchObject({ elementId: "r", anchor: "right", x: 300, y: 150 });
  });

  it("finds nothing out of reach, hidden or excluded", () => {
    expect(nearestAnchor(els, { x: 320, y: 150 }, 10)).toBeNull();
    expect(nearestAnchor(els, { x: 305, y: 148 }, 10, { exclude: ["r"] })).toBeNull();
    expect(nearestAnchor([rect({ visible: false })], { x: 300, y: 150 }, 10)).toBeNull();
  });

  it("finds the topmost element under the pointer, with a margin", () => {
    const stack = [rect(), rect({ id: "top", x: 150 })];
    expect(glueTargetAt(stack, { x: 200, y: 150 }).id).toBe("top");
    expect(glueTargetAt(stack, { x: 120, y: 150 }).id).toBe("r");
    expect(glueTargetAt(stack, { x: 90, y: 150 })).toBeNull();
    expect(glueTargetAt(stack, { x: 90, y: 150 }, 12).id).toBe("r");
  });
});

describe("straight connectors", () => {
  it("stops the line at the base of the head, as the export always did", () => {
    const g = connectorGeometry(arrow());
    expect(g.d).toBe("M0 0L88 0");
    expect(g.heads).toHaveLength(1);
    expect(g.heads[0]).toEqual([100, 0, 88, 6, 88, -6]);
  });

  it("draws both heads, or none for a plain line", () => {
    expect(connectorGeometry(arrow({ heads: "both" })).d).toBe("M12 0L88 0");
    const line = connectorGeometry(arrow({ type: "line", heads: undefined }));
    expect(line.d).toBe("M0 0L100 0");
    expect(line.heads).toEqual([]);
  });

  it("follows a glued end to its target, in the connector's own coordinates", () => {
    const g = connectorGeometry(arrow({ x: 10, y: 20, end: { elementId: "r", anchor: "left" } }), byId(rect()));
    expect(g.points).toEqual([0, 0, 90, 130]);
  });

  it("keeps extra points of older lines", () => {
    const g = connectorGeometry(arrow({ type: "line", points: [0, 0, 50, 50, 100, 0] }));
    expect(g.points).toEqual([0, 0, 50, 50, 100, 0]);
    expect(g.d).toBe("M0 0L50 50L100 0");
  });
});

describe("curved connectors", () => {
  const quadratic = (S, C, E, t) => ({
    x: (1 - t) ** 2 * S.x + 2 * (1 - t) * t * C.x + t * t * E.x,
    y: (1 - t) ** 2 * S.y + 2 * (1 - t) * t * C.y + t * t * E.y,
  });

  it("passes through its handle", () => {
    const g = connectorGeometry(arrow({ type: "line", route: "curved", bend: { along: 0.5, offset: 40 } }));
    expect(g.bendHandle).toEqual({ x: 50, y: 40 });
    const [, cx, cy, ex, ey] = g.d.match(/Q([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)/).map(Number);
    const mid = quadratic({ x: 0, y: 0 }, { x: cx, y: cy }, { x: ex, y: ey }, 0.5);
    close(mid.x, 50);
    close(mid.y, 40);
  });

  it("points its head along the curve, not along the straight line", () => {
    const g = connectorGeometry(arrow({ route: "curved", bend: { along: 0.5, offset: 40 } }));
    const [tipX, tipY, b1x, b1y, b2x, b2y] = g.heads[0];
    expect([tipX, tipY]).toEqual([100, 0]);
    // Arriving from the control point (50, 80), the head's base sits below the tip.
    expect((b1y + b2y) / 2).toBeGreaterThan(0);
  });

  it("recovers the bend from a dragged handle", () => {
    const S = { x: 0, y: 0 };
    const E = { x: 100, y: 0 };
    const bend = bendThrough(S, E, { x: 30, y: -25 });
    close(bend.along, 0.3);
    close(bend.offset, -25);
    expect(bendThrough(S, S, { x: 5, y: 5 })).toEqual({ along: 0.5, offset: 0 });
  });

  it("keeps its shape when its ends move", () => {
    const moved = connectorGeometry(arrow({ type: "line", route: "curved", points: [0, 0, 0, 200], bend: { along: 0.5, offset: 40 } }));
    // Now running downwards, sideways is along x.
    expect(moved.bendHandle).toEqual({ x: -40, y: 100 });
  });
});

describe("elbow connectors", () => {
  const axisAligned = (vertices) =>
    vertices.slice(1).every((v, i) => Math.abs(v.x - vertices[i].x) < 1e-9 || Math.abs(v.y - vertices[i].y) < 1e-9);

  it("joins free ends with a Z along the longer direction", () => {
    const { vertices, handle } = elbowRoute({ x: 0, y: 0 }, { x: 200, y: 80 }, null, null);
    expect(vertices).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 200, y: 80 }]);
    expect(handle).toEqual({ x: 100, y: 40, axis: "x" });
  });

  it("leaves glued sides straight on, then turns", () => {
    // Both ends face away from each other, so each must first run outwards.
    const { vertices } = elbowRoute({ x: 0, y: 0 }, { x: 200, y: 80 }, { x: -1, y: 0 }, { x: 1, y: 0 });
    expect(vertices[1]).toEqual({ x: -ELBOW_STUB, y: 0 });
    expect(vertices.at(-2)).toEqual({ x: 200 + ELBOW_STUB, y: 80 });
    expect(axisAligned(vertices)).toBe(true);
  });

  it("folds a stub into the leg it lines up with", () => {
    const { vertices } = elbowRoute({ x: 0, y: 0 }, { x: 200, y: 80 }, { x: 1, y: 0 }, { x: -1, y: 0 });
    expect(vertices).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 200, y: 80 }]);
  });

  it("makes an L when the ends leave on different axes", () => {
    const { vertices, handle } = elbowRoute({ x: 0, y: 0 }, { x: 200, y: 80 }, { x: 1, y: 0 }, { x: 0, y: -1 });
    expect(vertices).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 80 }]);
    expect(handle).toBeNull();
  });

  it("moves its middle leg with the handle, within the ends", () => {
    const route = elbowRoute({ x: 0, y: 0 }, { x: 200, y: 80 }, null, null);
    expect(elbowRatioAt(route, { x: 50, y: 999 })).toBe(0.25);
    expect(elbowRatioAt(route, { x: 500, y: 0 })).toBe(1);
  });

  it("aims the head along the last leg", () => {
    const g = connectorGeometry(arrow({ route: "elbow", points: [0, 0, 200, 80] }));
    expect(g.d).toBe("M0 0L100 0L100 80L188 80");
    expect(g.heads[0].slice(0, 2)).toEqual([200, 80]);
  });

  it("routes a glued elbow out of the side it is glued to", () => {
    const a = arrow({ route: "elbow", points: [0, 0, 0, 0], start: { elementId: "r", anchor: "bottom" }, end: { elementId: "r2", anchor: "left" } });
    const g = connectorGeometry(a, byId(rect(), rect({ id: "r2", x: 500, y: 400 })));
    const vertices = [];
    for (const m of g.d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)) vertices.push({ x: Number(m[1]), y: Number(m[2]) });
    expect(vertices[0]).toEqual({ x: 200, y: 200 });
    expect(vertices[1].x).toBe(200); // straight down out of the bottom
    expect(axisAligned(vertices)).toBe(true);
  });
});

describe("relayoutConnectors", () => {
  it("returns the same array when every glued end is already in place", () => {
    const els = [rect(), arrow({ points: [0, 0, 300, 150], end: { elementId: "r", anchor: "right" } })];
    expect(relayoutConnectors(els)).toBe(els);
  });

  it("moves a glued end when its target moves", () => {
    const els = [rect({ x: 400 }), arrow({ points: [0, 0, 300, 150], end: { elementId: "r", anchor: "right" } })];
    const next = relayoutConnectors(els);
    expect(next).not.toBe(els);
    expect(next[1].points).toEqual([0, 0, 600, 150]);
    expect(next[1]).toMatchObject({ width: 600, height: 150 });
    expect(next[0]).toBe(els[0]);
  });

  it("unglues from a deleted target and stays where it was", () => {
    const els = [arrow({ points: [0, 0, 300, 150], end: { elementId: "gone", anchor: "right" } })];
    const next = relayoutConnectors(els);
    expect(next[0].end).toBeNull();
    expect(next[0].points).toEqual([0, 0, 300, 150]);
  });

  it("leaves elements without glue untouched", () => {
    const els = [rect(), arrow()];
    expect(relayoutConnectors(els)).toBe(els);
  });
});

describe("helpers for moving and copying", () => {
  const glued = arrow({ start: { elementId: "r", anchor: "left" }, end: { elementId: "r2", anchor: "top" } });

  it("unglues ends whose targets are not moving along", () => {
    expect(unglueExcept(glued, new Set(["r"]))).toMatchObject({ start: { elementId: "r" }, end: null });
    expect(unglueExcept(glued, new Set(["r", "r2"]))).toBe(glued);
  });

  it("points a copy at copied targets and unglues it from the rest", () => {
    expect(remapGlue(glued, new Map([["r", "r-copy"]]))).toMatchObject({
      start: { elementId: "r-copy", anchor: "left" },
      end: null,
    });
    expect(remapGlue(arrow(), new Map())).toEqual(arrow());
  });
});
