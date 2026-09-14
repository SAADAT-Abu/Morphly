import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

/** A box and an arrow glued to its left side, on a fresh document. */
function setup() {
  const s = useStore.getState();
  s.newDocument();
  const boxId = useStore.getState().addShape("rect", { x: 400, y: 300 });
  const arrowId = useStore.getState().addShape("arrow", { x: 100, y: 100 });
  const box = useStore.getState().elements.find((el) => el.id === boxId);
  // Glue the arrow's end to the box, as dragging its end handle does.
  useStore.getState().updateElement(arrowId, {
    points: [0, 0, box.x - 100, box.y + box.height / 2 - 100],
    end: { elementId: boxId, anchor: "left" },
  });
  return { boxId, arrowId };
}

const get = (id) => useStore.getState().elements.find((el) => el.id === id);
const endOf = (el) => ({ x: el.x + el.points.at(-2), y: el.y + el.points.at(-1) });

describe("glued connectors in the store", () => {
  let ids;
  beforeEach(() => {
    ids = setup();
  });

  it("follows its target when the target moves", () => {
    useStore.getState().updateElement(ids.boxId, { x: 700, y: 50 });
    const box = get(ids.boxId);
    expect(endOf(get(ids.arrowId))).toEqual({ x: 700, y: 50 + box.height / 2 });
  });

  it("follows a resize from the inspector too", () => {
    useStore.getState().updateElement(ids.boxId, { height: 400 });
    expect(endOf(get(ids.arrowId)).y).toBe(300 + 200);
  });

  it("moves back with one undo, in a single step", () => {
    const before = endOf(get(ids.arrowId));
    useStore.getState().updateElement(ids.boxId, { x: 900 });
    useStore.getState().undo();
    expect(endOf(get(ids.arrowId))).toEqual(before);
    expect(get(ids.boxId).x).toBe(400);
  });

  it("lets go when its target is deleted, and stays put", () => {
    const before = endOf(get(ids.arrowId));
    useStore.getState().setSelection([ids.boxId]);
    useStore.getState().deleteSelected();
    const arrow = get(ids.arrowId);
    expect(arrow.end).toBeNull();
    expect(endOf(arrow)).toEqual(before);

    // Undo brings the box back, glued as it was.
    useStore.getState().undo();
    expect(get(ids.arrowId).end).toEqual({ elementId: ids.boxId, anchor: "left" });
  });

  it("lets go of the target when the arrow alone is nudged", () => {
    useStore.getState().setSelection([ids.arrowId]);
    useStore.getState().nudgeSelected(20, 0);
    expect(get(ids.arrowId).end).toBeNull();
  });

  it("stays glued when nudged together with its target", () => {
    useStore.getState().setSelection([ids.arrowId, ids.boxId]);
    useStore.getState().nudgeSelected(20, 0);
    expect(get(ids.arrowId).end).toEqual({ elementId: ids.boxId, anchor: "left" });
    expect(endOf(get(ids.arrowId)).x).toBe(420);
  });

  it("glues a duplicated pair to each other, not to the originals", () => {
    useStore.getState().setSelection([ids.arrowId, ids.boxId]);
    useStore.getState().duplicateSelected();
    const copies = useStore.getState().selectedIds.map(get);
    const arrowCopy = copies.find((el) => el.type === "arrow");
    const boxCopy = copies.find((el) => el.type === "rect");
    expect(arrowCopy.end.elementId).toBe(boxCopy.id);
    expect(endOf(arrowCopy)).toEqual({ x: boxCopy.x, y: boxCopy.y + boxCopy.height / 2 });
  });

  it("unglues a copy made without its target, so it keeps its offset", () => {
    useStore.getState().setSelection([ids.arrowId]);
    useStore.getState().duplicateSelected();
    const copy = get(useStore.getState().selectedIds[0]);
    expect(copy.end).toBeNull();
    expect(endOf(copy).x).toBe(endOf(get(ids.arrowId)).x + 24);
  });

  it("starts a curve with a visible bend", () => {
    useStore.getState().setConnectorRoute(ids.arrowId, "curved");
    const arrow = get(ids.arrowId);
    expect(arrow.route).toBe("curved");
    expect(arrow.bend.offset).toBeGreaterThanOrEqual(24);
  });
});
