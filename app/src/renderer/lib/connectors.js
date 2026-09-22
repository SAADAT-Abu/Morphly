/**
 * Connectors: lines and arrows that can be glued to other elements and drawn
 * straight, curved, or with right-angle elbows.
 *
 * Everything about how a connector looks is worked out here, once, and both
 * the canvas and the SVG export draw from the result. That is what keeps the
 * two identical: there is no second interpretation of a curve or an elbow.
 *
 * The model, on a "line" or "arrow" element:
 *
 *   x, y, points  where the ends are, relative to x/y, as for any line. For a
 *                 glued end these are kept up to date (relayoutConnectors), so
 *                 bounds, snapping and older code keep working unchanged, and a
 *                 connector whose target is deleted stays where it last was.
 *   start, end    { elementId, anchor } for a glued end, or null
 *   route         "straight" (default) | "curved" | "elbow"
 *   bend          curved only: { along, offset }, the point the curve passes
 *                 through, as a fraction along the line from start to end and
 *                 a sideways distance from it, so the curve keeps its shape
 *                 when the ends move
 *   elbowRatio    elbow only: where the middle leg sits between the ends (0..1)
 *   startHead,    how each end looks: "none" | "triangle" | "open" | "square" |
 *   endHead       "circle" | "bar" (older arrows stored `heads` instead)
 *   dash          "solid" | "dashed" | "dotted"
 *
 * Glue points follow BioRender: the middle of each side and the corners of the
 * element's box, with circles and triangles using points on their own outline.
 */

import { pointsBounds } from "./geometry";

export const isConnector = (el) => el?.type === "line" || el?.type === "arrow";

/** Element types a connector end can be glued to. */
const GLUE_TYPES = new Set(["rect", "ellipse", "triangle", "image", "table", "asset", "plot"]);

export const canGlueTo = (el) =>
  Boolean(el) && GLUE_TYPES.has(el.type) && el.width > 0 && el.height > 0;

// ---------------------------------------------------------------------------
// Glue points
// ---------------------------------------------------------------------------

/** Glue point positions in the element's own coordinates. */
function anchorLayout(el) {
  const w = el.width;
  const h = el.height;
  if (el.type === "ellipse") {
    // Diagonal points on the ellipse itself; a box corner would float in air.
    const dx = (w / 2) * Math.SQRT1_2;
    const dy = (h / 2) * Math.SQRT1_2;
    return {
      top: [w / 2, 0],
      "top-right": [w / 2 + dx, h / 2 - dy],
      right: [w, h / 2],
      "bottom-right": [w / 2 + dx, h / 2 + dy],
      bottom: [w / 2, h],
      "bottom-left": [w / 2 - dx, h / 2 + dy],
      left: [0, h / 2],
      "top-left": [w / 2 - dx, h / 2 - dy],
    };
  }
  if (el.type === "triangle") {
    return {
      top: [w / 2, 0],
      right: [w * 0.75, h / 2],
      "bottom-right": [w, h],
      bottom: [w / 2, h],
      "bottom-left": [0, h],
      left: [w * 0.25, h / 2],
    };
  }
  return {
    top: [w / 2, 0],
    "top-right": [w, 0],
    right: [w, h / 2],
    "bottom-right": [w, h],
    bottom: [w / 2, h],
    "bottom-left": [0, h],
    left: [0, h / 2],
    "top-left": [0, 0],
  };
}

/** Which way a line leaves each side. Corners have no preference. */
const SIDE_DIRECTION = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

/** Elements rotate about their top-left corner, as Konva groups do. */
function rotation(el) {
  const r = ((el.rotation ?? 0) * Math.PI) / 180;
  return { cos: Math.cos(r), sin: Math.sin(r) };
}

function describeAnchor(el, anchor, [lx, ly]) {
  const { cos, sin } = rotation(el);
  const side = SIDE_DIRECTION[anchor];
  return {
    anchor,
    x: el.x + lx * cos - ly * sin,
    y: el.y + lx * sin + ly * cos,
    direction: side ? { x: side[0] * cos - side[1] * sin, y: side[0] * sin + side[1] * cos } : null,
  };
}

/** Every glue point of an element, in canvas coordinates. */
export function anchorPoints(el) {
  if (!canGlueTo(el)) return [];
  return Object.entries(anchorLayout(el)).map(([anchor, spot]) => describeAnchor(el, anchor, spot));
}

/** One named glue point, or null if the element has no such point. */
export function anchorPoint(el, anchor) {
  if (!canGlueTo(el)) return null;
  const spot = anchorLayout(el)[anchor];
  return spot ? describeAnchor(el, anchor, spot) : null;
}

/** The closest glue point within `radius` of a point, or null. */
export function nearestAnchor(elements, point, radius, { exclude = [] } = {}) {
  let best = null;
  for (const el of elements) {
    if (el.visible === false || exclude.includes(el.id)) continue;
    for (const a of anchorPoints(el)) {
      const distance = Math.hypot(a.x - point.x, a.y - point.y);
      if (distance <= radius && (!best || distance < best.distance)) {
        best = { elementId: el.id, anchor: a.anchor, x: a.x, y: a.y, distance };
      }
    }
  }
  return best;
}

/** The topmost glueable element under a point (with a margin around it), so
 *  its glue points can be shown while an end is dragged near it. */
export function glueTargetAt(elements, point, margin = 0, { exclude = [] } = {}) {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const el = elements[i];
    if (el.visible === false || exclude.includes(el.id) || !canGlueTo(el)) continue;
    const { cos, sin } = rotation(el);
    const dx = point.x - el.x;
    const dy = point.y - el.y;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    if (lx >= -margin && ly >= -margin && lx <= el.width + margin && ly <= el.height + margin) return el;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Arrow heads are three stroke widths long and wide, as they always were. */
export const headSize = (c) => (c.strokeWidth ?? 2) * 3;

/** The styles an end of a line can have. "bar" is the flat end used for inhibition. */
export const HEAD_STYLES = ["none", "triangle", "open", "square", "circle", "bar"];
export const DASH_STYLES = ["solid", "dashed", "dotted"];

/**
 * How each end of a line looks. Lines drawn before end styles existed stored
 * `heads` ("none" | "end" | "both") on arrows, which means triangles.
 */
export function lineEnds(c) {
  if (c.startHead !== undefined || c.endHead !== undefined) {
    const valid = (v) => (HEAD_STYLES.includes(v) ? v : "none");
    return { start: valid(c.startHead), end: valid(c.endHead) };
  }
  if (c.type !== "arrow") return { start: "none", end: "none" };
  const heads = c.heads ?? "end";
  return { start: heads === "both" ? "triangle" : "none", end: heads === "none" ? "none" : "triangle" };
}

/** A dash pattern in stroke lengths, scaled to the line's width, or null for a
 *  solid line. Dots are dashes of no length, drawn round by the line caps. */
export function dashPattern(c) {
  const w = Math.max(0.5, c.strokeWidth ?? 2);
  if (c.dash === "dashed") return [w * 4, w * 3];
  if (c.dash === "dotted") return [0, w * 2.5];
  return null;
}

/** How far the line stops short of its tip, so a thick stroke never shows
 *  through or past the end drawn there. */
function shaftInset(style, c) {
  if (style === "triangle") return headSize(c);
  if (style === "open") return (c.strokeWidth ?? 2) / 2;
  return 0;
}

/**
 * The shape drawn at one end: tip at (x, y), the line arriving along `angle`.
 *   { kind: "polygon", points }   filled
 *   { kind: "polyline", points }  stroked like the line
 *   { kind: "circle", cx, cy, r } filled
 * Points are flat [x1, y1, x2, y2, ...]. Returns null for no end.
 */
export function headShape(style, x, y, angle, size) {
  switch (style) {
    case "triangle":
      return { kind: "polygon", points: headPolygon(x, y, angle, size) };
    case "open": {
      const [tx, ty, ax, ay, bx, by] = headPolygon(x, y, angle, size);
      return { kind: "polyline", points: [ax, ay, tx, ty, bx, by] };
    }
    case "square": {
      const h = size * 0.45;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const corner = (u, v) => [x + u * cos - v * sin, y + u * sin + v * cos];
      return { kind: "polygon", points: [...corner(-h, -h), ...corner(h, -h), ...corner(h, h), ...corner(-h, h)] };
    }
    case "circle":
      return { kind: "circle", cx: x, cy: y, r: size * 0.45 };
    case "bar": {
      const offX = Math.sin(angle) * (size / 2);
      const offY = Math.cos(angle) * (size / 2);
      return { kind: "polyline", points: [x - offX, y + offY, x + offX, y - offY] };
    }
    default:
      return null;
  }
}

/** Triangle for one head: tip at (x, y), pointing along `angle`. Returned as
 *  flat [x1, y1, x2, y2, x3, y3], the form Konva lines take. */
export function headPolygon(x, y, angle, size) {
  const baseX = x - Math.cos(angle) * size;
  const baseY = y - Math.sin(angle) * size;
  const offX = Math.sin(angle) * (size / 2);
  const offY = Math.cos(angle) * (size / 2);
  return [x, y, baseX - offX, baseY + offY, baseX + offX, baseY - offY];
}

/** Where the middle of a curve goes, and the control point that puts it there. */
function curveThrough(S, E, bend) {
  const dx = E.x - S.x;
  const dy = E.y - S.y;
  const length = Math.hypot(dx, dy);
  const nx = length ? -dy / length : 0;
  const ny = length ? dx / length : 1;
  const along = bend?.along ?? 0.5;
  const offset = bend?.offset ?? 0;
  const through = { x: S.x + dx * along + nx * offset, y: S.y + dy * along + ny * offset };
  // A quadratic curve is halfway along at t = 0.5, where it sits at
  // (S + 2C + E) / 4; solving for C puts that point exactly under the handle.
  const control = { x: 2 * through.x - (S.x + E.x) / 2, y: 2 * through.y - (S.y + E.y) / 2 };
  return { through, control };
}

/** The bend that makes a curve pass through `point`; the inverse of the above. */
export function bendThrough(S, E, point) {
  const dx = E.x - S.x;
  const dy = E.y - S.y;
  const length = Math.hypot(dx, dy);
  if (!length) return { along: 0.5, offset: 0 };
  const px = point.x - S.x;
  const py = point.y - S.y;
  return {
    along: (px * dx + py * dy) / (length * length),
    offset: (dx * py - dy * px) / length,
  };
}

/** How far an elbow runs straight out of a glued side before it turns. */
export const ELBOW_STUB = 16;

function axisOf(direction) {
  if (!direction) return null;
  if (Math.abs(direction.x) > Math.abs(direction.y) + 1e-6) return "h";
  if (Math.abs(direction.y) > Math.abs(direction.x) + 1e-6) return "v";
  return null;
}

function stub(point, direction, axis) {
  return axis === "h"
    ? { x: point.x + Math.sign(direction.x) * ELBOW_STUB, y: point.y }
    : { x: point.x, y: point.y + Math.sign(direction.y) * ELBOW_STUB };
}

/** Drop repeated points, and middle points on a straight run. */
function simplify(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const cross = (last.x - a.x) * (p.y - last.y) - (last.y - a.y) * (p.x - last.x);
      const dot = (last.x - a.x) * (p.x - last.x) + (last.y - a.y) * (p.y - last.y);
      if (Math.abs(cross) < 1e-6 && dot > 0) out.pop();
    }
    out.push(p);
  }
  return out;
}

/**
 * Right-angle route between two points.
 *
 * A glued end leaves its side straight on for a short stub. The ends then join
 * with one bend when they leave on different axes (an L), or two when they
 * share one (a Z), in which case `ratio` places the middle leg and a handle is
 * offered to drag it.
 */
export function elbowRoute(S, E, startDirection, endDirection, ratio = 0.5) {
  const startAxis = axisOf(startDirection);
  const endAxis = axisOf(endDirection);
  const dominant = Math.abs(E.x - S.x) >= Math.abs(E.y - S.y) ? "h" : "v";
  const first = startAxis ?? endAxis ?? dominant;
  const last = endAxis ?? first;

  const A = startAxis ? stub(S, startDirection, startAxis) : S;
  const B = endAxis ? stub(E, endDirection, endAxis) : E;

  let middle;
  let handle = null;
  if (first === "h" && last === "h") {
    const x = A.x + (B.x - A.x) * ratio;
    middle = [{ x, y: A.y }, { x, y: B.y }];
    handle = { x, y: (A.y + B.y) / 2, axis: "x" };
  } else if (first === "v" && last === "v") {
    const y = A.y + (B.y - A.y) * ratio;
    middle = [{ x: A.x, y }, { x: B.x, y }];
    handle = { x: (A.x + B.x) / 2, y, axis: "y" };
  } else if (first === "h") {
    middle = [{ x: B.x, y: A.y }];
  } else {
    middle = [{ x: A.x, y: B.y }];
  }
  return { vertices: simplify([S, A, ...middle, B, E]), handle, A, B };
}

/** The elbow ratio that puts the middle leg under a dragged handle. */
export function elbowRatioAt(route, point) {
  const { A, B, handle } = route;
  if (!handle) return 0.5;
  const span = handle.axis === "x" ? B.x - A.x : B.y - A.y;
  if (Math.abs(span) < 1e-6) return 0.5;
  const ratio = ((handle.axis === "x" ? point.x - A.x : point.y - A.y)) / span;
  return Math.min(1, Math.max(0, ratio));
}

// ---------------------------------------------------------------------------
// The whole connector
// ---------------------------------------------------------------------------

const num = (v) => String(Math.round(v * 1000) / 1000);

/** Move a point towards another by `by`, never past it. */
function pullBack(tip, from, by) {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return tip;
  const k = Math.min(by, length) / length;
  return { x: tip.x - dx * k, y: tip.y - dy * k };
}

function resolveEnd(attachment, fallback, lookup) {
  if (attachment) {
    const target = lookup(attachment.elementId);
    const a = target && anchorPoint(target, attachment.anchor);
    if (a) return { point: { x: a.x, y: a.y }, direction: a.direction };
  }
  return { point: fallback, direction: null };
}

/**
 * Everything needed to draw a connector, in its own coordinates (relative to
 * its x/y):
 *
 *   points        the ends to store, [x1, y1, ..., xn, yn]
 *   d             SVG path data for the line, stopped short of any head so a
 *                 thick stroke never shows through the tip
 *   heads         the shapes drawn at the ends (see headShape)
 *   dash          the dash pattern, or null for a solid line
 *   start, end    the ends
 *   bendHandle    curved: the point the curve passes through
 *   elbowHandle   elbow with a movable middle leg: { x, y, axis }
 *   route         the elbow route, for turning a handle drag into a ratio
 *
 * `lookup(id)` returns an element by id, so glued ends can find their target.
 */
export function connectorGeometry(c, lookup = () => undefined) {
  const p = c.points;
  const storedStart = { x: p[0], y: p[1] };
  const storedEnd = { x: p[p.length - 2], y: p[p.length - 1] };
  const toLocal = (pt) => ({ x: pt.x - c.x, y: pt.y - c.y });
  const toCanvas = (pt) => ({ x: pt.x + c.x, y: pt.y + c.y });

  const s = resolveEnd(c.start, toCanvas(storedStart), lookup);
  const e = resolveEnd(c.end, toCanvas(storedEnd), lookup);
  const S = toLocal(s.point);
  const E = toLocal(e.point);
  const route = c.route ?? "straight";
  const size = headSize(c);
  const ends = lineEnds(c);

  const result = { start: S, end: E, heads: [], bendHandle: null, elbowHandle: null, route: null, dash: dashPattern(c) };
  const addHead = (style, tip, from) => {
    const shape = headShape(style, tip.x, tip.y, Math.atan2(tip.y - from.y, tip.x - from.x), size);
    if (shape) result.heads.push(shape);
  };

  if (route === "curved") {
    const { through, control } = curveThrough(S, E, c.bend);
    // The curve leaves the start heading for the control point and arrives
    // at the end from it, which is the direction each head points.
    const startFrom = Math.hypot(control.x - S.x, control.y - S.y) > 1e-6 ? control : E;
    const endFrom = Math.hypot(control.x - E.x, control.y - E.y) > 1e-6 ? control : S;
    const s2 = pullBack(S, startFrom, shaftInset(ends.start, c));
    const e2 = pullBack(E, endFrom, shaftInset(ends.end, c));
    result.d = `M${num(s2.x)} ${num(s2.y)}Q${num(control.x)} ${num(control.y)} ${num(e2.x)} ${num(e2.y)}`;
    addHead(ends.end, E, endFrom);
    addHead(ends.start, S, startFrom);
    result.points = [S.x, S.y, E.x, E.y];
    result.bendHandle = through;
    return result;
  }

  let vertices;
  if (route === "elbow") {
    const elbow = elbowRoute(S, E, s.direction, e.direction, c.elbowRatio ?? 0.5);
    vertices = elbow.vertices;
    result.elbowHandle = elbow.handle;
    result.route = elbow;
    result.points = [S.x, S.y, E.x, E.y];
  } else {
    // Straight lines from before connectors may carry extra points; keep them.
    vertices = [];
    for (let i = 0; i < p.length; i += 2) vertices.push({ x: p[i], y: p[i + 1] });
    vertices[0] = S;
    vertices[vertices.length - 1] = E;
    if (vertices.length < 2) vertices.push(E);
    result.points = vertices.flatMap((v) => [v.x, v.y]);
  }

  const n = vertices.length;
  const drawn = vertices.slice();
  drawn[n - 1] = pullBack(vertices[n - 1], vertices[n - 2], shaftInset(ends.end, c));
  addHead(ends.end, E, vertices[n - 2]);
  drawn[0] = pullBack(vertices[0], vertices[1], shaftInset(ends.start, c));
  addHead(ends.start, S, vertices[1]);
  result.d = drawn.map((v, i) => `${i === 0 ? "M" : "L"}${num(v.x)} ${num(v.y)}`).join("");
  return result;
}

// ---------------------------------------------------------------------------
// Keeping glued ends glued
// ---------------------------------------------------------------------------

/**
 * Bring every glued connector end back onto its glue point.
 *
 * Called after any change to the elements. Returns the very same array when
 * nothing needed to move, so it can run on every change without causing more.
 * An end whose target has gone is unglued and stays where it last was.
 */
export function relayoutConnectors(elements) {
  let byId = null;
  let changed = false;

  const next = elements.map((el) => {
    if (!isConnector(el) || (!el.start && !el.end)) return el;
    byId ??= new Map(elements.map((item) => [item.id, item]));

    let updated = el;
    for (const key of ["start", "end"]) {
      const glue = el[key];
      if (glue && !anchorPoint(byId.get(glue.elementId), glue.anchor)) {
        updated = { ...updated, [key]: null };
      }
    }

    const { points } = connectorGeometry(updated, (id) => byId.get(id));
    const same =
      points.length === el.points.length && points.every((v, i) => Math.abs(v - el.points[i]) < 1e-6);
    if (same && updated === el) return el;

    changed = true;
    const box = pointsBounds(points);
    return { ...updated, points, width: box.width, height: box.height };
  });

  return changed ? next : elements;
}

/** Unglue the ends of a connector that are not glued to one of `keep`. Used
 *  when a connector is moved by hand: its free ends go where it was put. */
export function unglueExcept(connector, keep) {
  const patch = {};
  for (const key of ["start", "end"]) {
    if (connector[key] && !keep.has(connector[key].elementId)) patch[key] = null;
  }
  return Object.keys(patch).length ? { ...connector, ...patch } : connector;
}

/** For a duplicated connector: follow targets that were copied with it, and
 *  unglue from the rest, so the copy does not snap back onto the original. */
export function remapGlue(connector, idMap) {
  const patch = {};
  for (const key of ["start", "end"]) {
    const glue = connector[key];
    if (glue) patch[key] = idMap.has(glue.elementId) ? { ...glue, elementId: idMap.get(glue.elementId) } : null;
  }
  return Object.keys(patch).length ? { ...connector, ...patch } : connector;
}
