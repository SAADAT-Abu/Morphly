import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

const state = () => useStore.getState();
const byId = (id) => state().elements.find((el) => el.id === id);

describe("copy, cut and paste in the store", () => {
  let a;
  let b;
  beforeEach(() => {
    state().newDocument();
    a = state().addShape("rect", { x: 100, y: 100 });
    b = state().addShape("ellipse", { x: 400, y: 100 });
  });

  it("pastes copies that step away from the original each time", () => {
    state().setSelection([a]);
    state().copySelected();
    const [first] = state().pasteClipboard();
    const [second] = state().pasteClipboard();
    expect(byId(first).x).toBe(byId(a).x + 24);
    expect(byId(second).x).toBe(byId(a).x + 48);
    expect(state().selectedIds).toEqual([second]);
  });

  it("pastes in place, exactly over the original", () => {
    state().setSelection([a]);
    state().copySelected();
    const [copy] = state().pasteClipboard({ inPlace: true });
    expect([byId(copy).x, byId(copy).y]).toEqual([byId(a).x, byId(a).y]);
  });

  it("pastes centred on a point", () => {
    state().setSelection([a]);
    state().copySelected();
    const [copy] = state().pasteClipboard({ at: { x: 800, y: 600 } });
    const el = byId(copy);
    expect(el.x + el.width / 2).toBeCloseTo(800, 6);
    expect(el.y + el.height / 2).toBeCloseTo(600, 6);
  });

  it("cuts as one undo step, and pastes what was cut", () => {
    state().setSelection([a, b]);
    state().cutSelected();
    expect(state().elements).toHaveLength(0);
    const pasted = state().pasteClipboard();
    expect(pasted).toHaveLength(2);
    state().undo();
    state().undo();
    expect(state().elements.map((el) => el.id)).toEqual([a, b]);
  });

  it("keeps the clipboard when switching pages", () => {
    state().setSelection([a]);
    state().copySelected();
    state().addPage();
    expect(state().elements).toHaveLength(0);
    state().pasteClipboard({ inPlace: true });
    expect(state().elements).toHaveLength(1);
  });

  it("does nothing with an empty clipboard", () => {
    state().setSelection([]);
    expect(state().copySelected()).toBe(false);
    useStore.setState({ clipboard: null });
    expect(state().pasteClipboard()).toEqual([]);
  });

  it("changes stacking order as one step, and locks and unlocks", () => {
    state().setSelection([a]);
    state().reorderSelected("front");
    expect(state().elements.at(-1).id).toBe(a);
    state().setSelectedLocked(true);
    expect(byId(a).locked).toBe(true);
    state().setSelectedLocked(false);
    expect(byId(a).locked).toBe(false);
  });
});
