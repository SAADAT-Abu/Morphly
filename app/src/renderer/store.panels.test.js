import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";
import { gridCells } from "./lib/panelLayout";

const state = () => useStore.getState();
const panels = () => state().elements.filter((el) => el.panel);
const grid = (rows, cols) => ({ rows, cols, cells: gridCells(rows, cols), gap: 20, margin: 30 });

describe("panel layouts in the store", () => {
  beforeEach(() => {
    state().newDocument();
  });

  it("lays out lettered panels inside the page margins", () => {
    state().addPanelLayout(grid(2, 2));
    const { canvas } = state();
    expect(panels().map((p) => p.panelLabel)).toEqual(["A", "B", "C", "D"]);
    expect(panels().map((p) => p.name)).toEqual(["Panel A", "Panel B", "Panel C", "Panel D"]);
    const d = panels()[3];
    expect(panels()[0]).toMatchObject({ x: 30, y: 30 });
    expect(d.x + d.width).toBe(canvas.width - 30);
    expect(d.y + d.height).toBe(canvas.height - 30);
  });

  it("puts panels underneath artwork already on the page", () => {
    const boxId = state().addShape("rect");
    state().addPanelLayout(grid(1, 2));
    const ids = state().elements.map((el) => el.id);
    expect(ids.indexOf(boxId)).toBe(ids.length - 1);
  });

  it("removes the whole layout with one undo", () => {
    state().addShape("rect");
    state().addPanelLayout(grid(2, 3));
    expect(panels()).toHaveLength(6);
    state().undo();
    expect(panels()).toHaveLength(0);
    expect(state().elements).toHaveLength(1);
  });

  it("replaces an earlier layout, or adds to it and keeps counting", () => {
    state().addPanelLayout(grid(2, 2));
    state().addPanelLayout({ ...grid(1, 2), replace: true });
    expect(panels()).toHaveLength(2);

    state().addPanelLayout({ ...grid(1, 1), replace: false, margin: 400 });
    expect(panels()).toHaveLength(3);
    expect(panels().map((p) => p.panelLabel).sort()).toEqual(["A", "B", "C"]);
  });

  it("reletters when a panel is deleted", () => {
    state().addPanelLayout(grid(1, 3));
    state().setSelection([panels()[1].id]);
    state().deleteSelected();
    expect(panels().map((p) => p.panelLabel)).toEqual(["A", "B"]);
  });

  it("changes the letters of every panel at once", () => {
    state().addPanelLayout(grid(1, 2));
    state().setPanelLetters({ panelLetterStyle: "lower", panelLetterSize: 50 });
    expect(panels().map((p) => [p.panelLabel, p.panelLetterSize])).toEqual([["a", 50], ["b", 50]]);
  });
});
