/**
 * Align and distribute, as in Inkscape's panel of the same name.
 *
 * Everything is worked out on the boxes objects actually cover (rotation and
 * line points included), and relative to a chosen reference:
 *
 *   page        the page
 *   selection   the box around the whole selection
 *   panel       the panel each object sits in (the page if none)
 *   first       the first object selected, which stays put
 *   biggest     the largest object, which stays put
 *
 * A group moves as one piece, so aligning never scatters its members. Locked
 * objects stay where they are, and so do lines glued at an end, which follow
 * their targets anyway.
 *
 * The functions return moves, { id: { dx, dy } }, and change nothing
 * themselves; the store applies them as one undo step.
 */

import { visualBox, unionBox } from "./geometry";
import { isConnector } from "./connectors";
import { isPanel } from "./panelLayout";
import { panelAt } from "./snapping";

export const ALIGN_REFERENCES = [
  ["page", "Page"],
  ["selection", "Selection"],
  ["panel", "Panel"],
  ["first", "First selected"],
  ["biggest", "Biggest object"],
];

/** The selection as pieces that move together, in selection order. */
export function movableUnits(elements, selectedIds, measure) {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const units = [];
  const groups = new Map();
  for (const id of selectedIds) {
    const el = byId.get(id);
    if (!el || el.locked || el.visible === false) continue;
    if (isConnector(el) && (el.start || el.end)) continue;
    if (el.groupId) {
      let unit = groups.get(el.groupId);
      if (!unit) {
        unit = { members: [] };
        groups.set(el.groupId, unit);
        units.push(unit);
      }
      unit.members.push(el);
    } else {
      units.push({ members: [el] });
    }
  }
  for (const unit of units) unit.box = unionBox(unit.members.map((m) => visualBox(m, measure)));
  return units;
}

const pageBox = (canvas) => ({ x: 0, y: 0, width: canvas.width, height: canvas.height });

/** The panel around a unit, not counting panels that are themselves moving. */
function panelBoxFor(unit, elements, measure) {
  const moving = new Set(unit.members.map((m) => m.id));
  const panels = elements.filter((el) => isPanel(el) && !moving.has(el.id)).map((el) => visualBox(el, measure));
  return panelAt(panels, { x: unit.box.x + unit.box.width / 2, y: unit.box.y + unit.box.height / 2 });
}

function referenceFor(unit, units, relativeTo, { elements, canvas, measure }) {
  // Aligning one object to itself does nothing, so it goes to the page.
  const alone = units.length === 1;
  switch (relativeTo) {
    case "selection":
      return alone ? pageBox(canvas) : unionBox(units.map((u) => u.box));
    case "panel":
      return panelBoxFor(unit, elements, measure) ?? pageBox(canvas);
    case "first":
      return alone ? pageBox(canvas) : units[0].box;
    case "biggest":
      return alone
        ? pageBox(canvas)
        : units.reduce((a, b) => (b.box.width * b.box.height > a.box.width * a.box.height ? b : a)).box;
    default:
      return pageBox(canvas);
  }
}

function toMoves(units, shifts) {
  const moves = {};
  units.forEach((unit, i) => {
    const { dx = 0, dy = 0 } = shifts[i] ?? {};
    if (!dx && !dy) return;
    for (const m of unit.members) moves[m.id] = { dx, dy };
  });
  return moves;
}

/** edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" */
export function alignMoves(elements, selectedIds, edge, { relativeTo = "page", canvas, measure } = {}) {
  const units = movableUnits(elements, selectedIds, measure);
  if (units.length === 0) return {};
  const context = { elements, canvas, measure };

  const shifts = units.map((unit) => {
    const ref = referenceFor(unit, units, relativeTo, context);
    const b = unit.box;
    switch (edge) {
      case "left": return { dx: ref.x - b.x };
      case "hcenter": return { dx: ref.x + ref.width / 2 - (b.x + b.width / 2) };
      case "right": return { dx: ref.x + ref.width - (b.x + b.width) };
      case "top": return { dy: ref.y - b.y };
      case "vcenter": return { dy: ref.y + ref.height / 2 - (b.y + b.height / 2) };
      case "bottom": return { dy: ref.y + ref.height - (b.y + b.height) };
      default: return {};
    }
  });
  return toMoves(units, shifts);
}

/**
 * mode: "h-gaps" | "v-gaps" (equal space between objects)
 *       "h-centres" | "v-centres" (equal distance between centres)
 *
 * Relative to the page or a panel, objects spread from one edge of it to the
 * other. Otherwise the two outermost objects stay put and the rest spread
 * between them, which needs at least three.
 */
export function distributeMoves(elements, selectedIds, mode, { relativeTo = "selection", canvas, measure } = {}) {
  const units = movableUnits(elements, selectedIds, measure);
  const horizontal = mode.startsWith("h");
  const pos = horizontal ? "x" : "y";
  const size = horizontal ? "width" : "height";
  const delta = horizontal ? "dx" : "dy";

  let container = null;
  if (relativeTo === "page") container = pageBox(canvas);
  if (relativeTo === "panel" && units.length > 0) {
    container = panelBoxFor(units[0], elements, measure) ?? pageBox(canvas);
  }
  if (units.length < (container ? 2 : 3)) return {};

  const order = units
    .map((unit, index) => ({ unit, index }))
    .sort((a, b) => a.unit.box[pos] + a.unit.box[size] / 2 - (b.unit.box[pos] + b.unit.box[size] / 2));
  const n = order.length;
  const first = order[0].unit.box;
  const last = order[n - 1].unit.box;
  const start = container ? container[pos] : first[pos];
  const end = container ? container[pos] + container[size] : last[pos] + last[size];

  const shifts = [];
  if (mode.endsWith("gaps")) {
    const total = order.reduce((sum, o) => sum + o.unit.box[size], 0);
    const gap = (end - start - total) / (n - 1);
    let cursor = start;
    for (const { unit, index } of order) {
      shifts[index] = { [delta]: cursor - unit.box[pos] };
      cursor += unit.box[size] + gap;
    }
  } else {
    const firstCentre = start + first[size] / 2;
    const lastCentre = end - last[size] / 2;
    const step = (lastCentre - firstCentre) / (n - 1);
    order.forEach(({ unit, index }, i) => {
      shifts[index] = { [delta]: firstCentre + step * i - (unit.box[pos] + unit.box[size] / 2) };
    });
  }
  return toMoves(units, shifts);
}

/** Apply moves to elements, returning the same array if nothing moved. */
export function applyMoves(elements, moves) {
  if (Object.keys(moves).length === 0) return elements;
  return elements.map((el) => {
    const move = moves[el.id];
    return move ? { ...el, x: el.x + move.dx, y: el.y + move.dy } : el;
  });
}
