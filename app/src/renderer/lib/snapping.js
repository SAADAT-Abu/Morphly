/**
 * Smart guides: the dotted lines that appear, and the pull that snaps a moving
 * object onto them, as in PowerPoint and Inkscape.
 *
 * A moving box can latch onto:
 *
 *   - the edges and centre lines of the page
 *   - the edges and centre lines of every other object
 *   - the edges and centre lines of the panel it sits in, which are favoured,
 *     because inside a panel layout that panel is the frame being composed
 *   - equal spacing: the same gap on both sides of it, or the same gap as
 *     neighbouring objects already have between them
 *
 * Candidates are weighted. A favoured line wins over an ordinary one that is
 * only slightly closer, and reaches a little further, which is what "favour"
 * feels like under the mouse. The result says how far to move, which guides
 * to draw (as segments spanning the objects involved, not endless lines) and
 * which equal gaps to mark.
 */

import { unionBox } from "./geometry";

/** Weights: lower wins. Distance is multiplied by the weight when choosing. */
const WEIGHT = {
  panelCentre: 0.35,
  panelEdge: 0.6,
  spacing: 0.9,
  ordinary: 1,
};

/** A favoured line pulls from a little further away than an ordinary one. */
const reach = (weight) => 1 / Math.sqrt(weight);

const AXES = {
  x: { pos: "x", size: "width", cross: "y", crossSize: "height" },
  y: { pos: "y", size: "height", cross: "x", crossSize: "width" },
};

/** The smallest panel box containing a point, or null. */
export function panelAt(panelBoxes, point) {
  let best = null;
  for (const box of panelBoxes) {
    const inside =
      point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
    if (inside && (!best || box.width * box.height < best.width * best.height)) best = box;
  }
  return best;
}

/**
 * Everything a moving box could latch onto.
 *
 *   others       boxes of the objects that are not moving
 *   panels       boxes of the panels that are not moving
 *   canvas       { width, height }
 *   focus        the moving box, to find the panel it sits in
 */
export function snapContext({ others = [], panels = [], canvas, focus = null }) {
  const lines = { x: [], y: [] };
  const add = (axis, at, from, to, weight) => lines[axis].push({ at, from, to, weight });

  // Page
  for (const at of [0, canvas.width / 2, canvas.width]) add("x", at, 0, canvas.height, WEIGHT.ordinary);
  for (const at of [0, canvas.height / 2, canvas.height]) add("y", at, 0, canvas.width, WEIGHT.ordinary);

  // Other objects, panels included
  for (const b of others) {
    for (const at of [b.x, b.x + b.width / 2, b.x + b.width]) add("x", at, b.y, b.y + b.height, WEIGHT.ordinary);
    for (const at of [b.y, b.y + b.height / 2, b.y + b.height]) add("y", at, b.x, b.x + b.width, WEIGHT.ordinary);
  }

  // The panel the moving box sits in, favoured
  const home = focus ? panelAt(panels, { x: focus.x + focus.width / 2, y: focus.y + focus.height / 2 }) : null;
  if (home) {
    const { x, y, width: w, height: h } = home;
    add("x", x + w / 2, y, y + h, WEIGHT.panelCentre);
    add("y", y + h / 2, x, x + w, WEIGHT.panelCentre);
    for (const at of [x, x + w]) add("x", at, y, y + h, WEIGHT.panelEdge);
    for (const at of [y, y + h]) add("y", at, x, x + w, WEIGHT.panelEdge);
  }

  return { lines, others, panel: home };
}

/** Best alignment line for the three edges (start, centre, end) of a box on one axis. */
function bestLine(box, axis, lines, threshold) {
  const { pos, size } = AXES[axis];
  const edges = [box[pos], box[pos] + box[size] / 2, box[pos] + box[size]];
  let best = null;
  for (const value of edges) {
    for (const line of lines) {
      const dist = Math.abs(value - line.at);
      if (dist >= threshold * reach(line.weight)) continue;
      const score = dist * line.weight;
      if (!best || score < best.score) best = { score, shift: line.at - value };
    }
  }
  return best;
}

/** Objects beside the box on one axis: overlapping it across, sorted along. */
function row(box, axis, others) {
  const { pos, size, cross, crossSize } = AXES[axis];
  const overlaps = (b) => b[cross] < box[cross] + box[crossSize] && b[cross] + b[crossSize] > box[cross];
  return others.filter(overlaps).sort((a, b) => a[pos] - b[pos]);
}

/**
 * Best equal-spacing position on one axis:
 *   - centred in the space between the nearest neighbours on each side
 *   - the same gap from a neighbour as that neighbour has from the next one
 * Returns the shift and the pairs of boxes whose gaps become equal.
 */
function bestSpacing(box, axis, others, threshold) {
  const { pos, size } = AXES[axis];
  const beside = row(box, axis, others);
  const middle = box[pos] + box[size] / 2;
  const end = (b) => b[pos] + b[size];
  const before = beside.filter((b) => end(b) <= middle).sort((a, b) => end(b) - end(a));
  const after = beside.filter((b) => b[pos] >= middle).sort((a, b) => a[pos] - b[pos]);
  const [left, left2] = before;
  const [right, right2] = after;

  const candidates = [];
  if (left && right) {
    const gap = (right[pos] - end(left) - box[size]) / 2;
    if (gap >= 0) candidates.push({ target: end(left) + gap, pairs: [[left, "self"], ["self", right]] });
  }
  if (left && left2) {
    const gap = left[pos] - end(left2);
    if (gap > 0) candidates.push({ target: end(left) + gap, pairs: [[left2, left], [left, "self"]] });
  }
  if (right && right2) {
    const gap = right2[pos] - end(right);
    if (gap > 0) candidates.push({ target: right[pos] - gap - box[size], pairs: [["self", right], [right, right2]] });
  }

  let best = null;
  for (const c of candidates) {
    const dist = Math.abs(c.target - box[pos]);
    if (dist >= threshold * reach(WEIGHT.spacing)) continue;
    const score = dist * WEIGHT.spacing;
    if (!best || score < best.score) best = { score, shift: c.target - box[pos], pairs: c.pairs };
  }
  return best;
}

/** Gap markers between pairs of boxes, drawn across the middle of their overlap. */
function gapMarkers(pairs, self, axis) {
  const { pos, size, cross, crossSize } = AXES[axis];
  return pairs.map(([a0, b0]) => {
    const a = a0 === "self" ? self : a0;
    const b = b0 === "self" ? self : b0;
    const top = Math.max(a[cross], b[cross]);
    const bottom = Math.min(a[cross] + a[crossSize], b[cross] + b[crossSize]);
    return { axis, from: a[pos] + a[size], to: b[pos], at: (top + bottom) / 2 };
  });
}

/** Guide segments for every line the box now touches, spanning both. */
function guidesFor(box, context, axis) {
  const { pos, size, cross, crossSize } = AXES[axis];
  const edges = [box[pos], box[pos] + box[size] / 2, box[pos] + box[size]];
  const byPosition = new Map();
  for (const line of context.lines[axis]) {
    if (!edges.some((e) => Math.abs(e - line.at) < 0.5)) continue;
    const key = Math.round(line.at * 2) / 2;
    const from = Math.min(line.from, box[cross]);
    const to = Math.max(line.to, box[cross] + box[crossSize]);
    const seen = byPosition.get(key);
    byPosition.set(key, seen ? { ...seen, from: Math.min(seen.from, from), to: Math.max(seen.to, to) } : { axis, at: line.at, from, to });
  }
  return [...byPosition.values()];
}

/**
 * Snap a moving box.
 * Returns { dx, dy, guides: [{ axis, at, from, to }], gaps: [{ axis, from, to, at }] }.
 * An "x" guide is a vertical line at x = at, running from y = from to y = to.
 */
export function snapMove(box, context, threshold) {
  const result = { dx: 0, dy: 0, guides: [], gaps: [] };
  const spacingPairs = {};

  for (const axis of ["x", "y"]) {
    const line = bestLine(box, axis, context.lines[axis], threshold);
    const spacing = bestSpacing(box, axis, context.others, threshold);
    const winner = [line, spacing].filter(Boolean).sort((a, b) => a.score - b.score)[0];
    if (!winner) continue;
    result[axis === "x" ? "dx" : "dy"] = winner.shift;
    if (winner === spacing) spacingPairs[axis] = spacing.pairs;
  }

  const moved = { ...box, x: box.x + result.dx, y: box.y + result.dy };
  for (const axis of ["x", "y"]) {
    result.guides.push(...guidesFor(moved, context, axis));
    if (spacingPairs[axis]) result.gaps.push(...gapMarkers(spacingPairs[axis], moved, axis));
  }
  return result;
}

/**
 * Snap a single point, such as a resize handle, to the guide lines.
 * Returns { x, y, guides }.
 */
export function snapPoint(point, context, threshold) {
  const at = { x: point.x, y: point.y };
  const guides = [];
  for (const axis of ["x", "y"]) {
    const cross = axis === "x" ? "y" : "x";
    let best = null;
    for (const line of context.lines[axis]) {
      const dist = Math.abs(point[axis] - line.at);
      if (dist >= threshold * reach(line.weight)) continue;
      const score = dist * line.weight;
      if (!best || score < best.score) best = { score, line };
    }
    if (best) {
      at[axis] = best.line.at;
      guides.push({
        axis,
        at: best.line.at,
        from: Math.min(best.line.from, point[cross]),
        to: Math.max(best.line.to, point[cross]),
      });
    }
  }
  return { ...at, guides };
}

/** For callers snapping a whole selection: the box around everything moving. */
export const selectionBox = unionBox;
