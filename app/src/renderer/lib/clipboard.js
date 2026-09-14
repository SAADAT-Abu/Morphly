/**
 * Copy, paste and stacking order for a selection.
 *
 * Copied elements are deep copies, so editing the original afterwards never
 * changes what is on the clipboard. Pasting gives every element a new id, and
 * keeps what belonged together together: a copied group pastes as a new group,
 * and a line glued to a shape that was copied with it is glued to the pasted
 * shape. A line glued to something left behind lets go and keeps its place.
 */

import { isConnector, remapGlue } from "./connectors";
import { visualBox, unionBox } from "./geometry";

/** Deep copies of the selected elements, in stacking order. */
export function copyElements(elements, selectedIds) {
  const chosen = new Set(selectedIds);
  return elements.filter((el) => chosen.has(el.id)).map((el) => structuredClone(el));
}

/**
 * Fresh elements from a clipboard, moved by (dx, dy).
 * `newId()` and `newGroupId()` supply ids, so the store stays their only source.
 */
export function pasteElements(copied, { newId, newGroupId, dx = 0, dy = 0 }) {
  const ids = new Map();
  const groups = new Map();
  const fresh = copied.map((el) => {
    const id = newId();
    ids.set(el.id, id);
    let groupId = null;
    if (el.groupId) {
      if (!groups.has(el.groupId)) groups.set(el.groupId, newGroupId());
      groupId = groups.get(el.groupId);
    }
    return { ...structuredClone(el), id, groupId, x: el.x + dx, y: el.y + dy };
  });
  return fresh.map((el) => (isConnector(el) ? remapGlue(el, ids) : el));
}

/** The shift that centres copied elements on a point, for "Paste here". */
export function offsetToCentre(copied, point, measure) {
  const box = unionBox(copied.map((el) => visualBox(el, measure)));
  if (!box) return { dx: 0, dy: 0 };
  return { dx: point.x - (box.x + box.width / 2), dy: point.y - (box.y + box.height / 2) };
}

/**
 * Change the stacking order of a selection, keeping the selected elements in
 * their order relative to each other.
 *
 *   front     above everything
 *   forward   one step up, past the next unselected element
 *   backward  one step down
 *   back      below everything
 *
 * Returns the same array when nothing would change.
 */
export function reorderSelection(elements, selectedIds, direction) {
  const chosen = new Set(selectedIds);
  const picked = (el) => chosen.has(el.id);
  if (!elements.some(picked)) return elements;

  let next;
  if (direction === "front") {
    next = [...elements.filter((el) => !picked(el)), ...elements.filter(picked)];
  } else if (direction === "back") {
    next = [...elements.filter(picked), ...elements.filter((el) => !picked(el))];
  } else {
    next = elements.slice();
    const swap = (i, j) => ([next[i], next[j]] = [next[j], next[i]]);
    if (direction === "forward") {
      // From the top down, so a block of selected elements moves as one.
      for (let i = next.length - 2; i >= 0; i -= 1) if (picked(next[i]) && !picked(next[i + 1])) swap(i, i + 1);
    } else if (direction === "backward") {
      for (let i = 1; i < next.length; i += 1) if (picked(next[i]) && !picked(next[i - 1])) swap(i, i - 1);
    }
  }
  return next.every((el, i) => el === elements[i]) ? elements : next;
}
