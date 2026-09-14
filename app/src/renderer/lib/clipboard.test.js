import { describe, it, expect } from "vitest";
import { copyElements, pasteElements, offsetToCentre, reorderSelection } from "./clipboard";

const el = (id, over = {}) => ({ id, type: "rect", x: 10, y: 20, width: 100, height: 50, ...over });
let counter = 0;
const ids = { newId: () => `new${++counter}`, newGroupId: () => `grp${++counter}` };

describe("copyElements", () => {
  it("copies the selection in stacking order, as independent copies", () => {
    const elements = [el("a"), el("b", { cells: [["x"]] }), el("c")];
    const copied = copyElements(elements, ["c", "b"]);
    expect(copied.map((e) => e.id)).toEqual(["b", "c"]);
    elements[1].cells[0][0] = "changed";
    expect(copied[0].cells[0][0]).toBe("x");
  });
});

describe("pasteElements", () => {
  it("gives new ids and moves the copies", () => {
    const pasted = pasteElements([el("a")], { ...ids, dx: 24, dy: 24 });
    expect(pasted[0].id).not.toBe("a");
    expect(pasted[0]).toMatchObject({ x: 34, y: 44, width: 100 });
  });

  it("pastes a group as a new group", () => {
    const pasted = pasteElements([el("a", { groupId: "g1" }), el("b", { groupId: "g1" }), el("c")], ids);
    expect(pasted[0].groupId).toBe(pasted[1].groupId);
    expect(pasted[0].groupId).not.toBe("g1");
    expect(pasted[2].groupId).toBeNull();
  });

  it("keeps a line glued to a shape copied with it, and lets go of the rest", () => {
    const line = { id: "l", type: "arrow", x: 0, y: 0, points: [0, 0, 5, 5], start: { elementId: "a", anchor: "left" }, end: { elementId: "gone", anchor: "top" } };
    const pasted = pasteElements([el("a"), line], ids);
    expect(pasted[1].start).toEqual({ elementId: pasted[0].id, anchor: "left" });
    expect(pasted[1].end).toBeNull();
  });
});

describe("offsetToCentre", () => {
  it("centres the copies on a point", () => {
    expect(offsetToCentre([el("a", { x: 0, y: 0 })], { x: 500, y: 400 })).toEqual({ dx: 450, dy: 375 });
  });
});

describe("reorderSelection", () => {
  const stack = ["a", "b", "c", "d", "e"].map((id) => el(id));
  const order = (els) => els.map((e) => e.id).join("");

  it("brings a selection to the front and sends it to the back, keeping its own order", () => {
    expect(order(reorderSelection(stack, ["d", "b"], "front"))).toBe("acebd");
    expect(order(reorderSelection(stack, ["d", "b"], "back"))).toBe("bdace");
  });

  it("moves a block one step at a time", () => {
    expect(order(reorderSelection(stack, ["b", "c"], "forward"))).toBe("adbce");
    expect(order(reorderSelection(stack, ["b", "c"], "backward"))).toBe("bcade");
  });

  it("returns the same array when nothing can move", () => {
    expect(reorderSelection(stack, ["e"], "forward")).toBe(stack);
    expect(reorderSelection(stack, ["a"], "back")).toBe(stack);
    expect(reorderSelection(stack, [], "front")).toBe(stack);
  });
});
