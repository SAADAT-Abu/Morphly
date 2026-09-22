import { describe, it, expect } from "vitest";
import { PANES, defaultSizes, clampPane, sizesFromSettings, settingFor } from "./panes";
import { sizeFromPointer } from "../components/Splitter";

describe("pane sizes", () => {
  it("starts at the sizes Morphly has always used", () => {
    expect(defaultSizes()).toEqual({ sidebar: 280, rail: 300, layers: 240, data: 270 });
  });

  it("never lets a pane vanish or squeeze out its neighbour", () => {
    // 1400 wide: the sidebar may grow to 1400 - 420.
    expect(clampPane("sidebar", 50, 1400)).toBe(PANES.sidebar.min);
    expect(clampPane("sidebar", 5000, 1400)).toBe(980);
    // In a narrow window the smallest size wins over leaving room behind.
    expect(clampPane("sidebar", 300, 500)).toBe(PANES.sidebar.min);
    expect(clampPane("layers", 10_000, 900)).toBe(740);
  });

  it("reads remembered sizes, ignoring nonsense", () => {
    expect(sizesFromSettings({ sidebarWidth: 340, railWidth: "wide", layersHeight: 12 })).toEqual({
      ...defaultSizes(),
      sidebar: 340,
    });
    expect(sizesFromSettings()).toEqual(defaultSizes());
    expect(settingFor("data", 300)).toEqual({ dataHeight: 300 });
  });
});

describe("dragging a splitter", () => {
  const bounds = { horizontal: false, top: 100, bottom: 900, left: 0, right: 1400, available: 1400 };

  it("sizes a pane on the left from the left edge", () => {
    expect(sizeFromPointer({ name: "sidebar", edge: "start", point: 320, bounds })).toBe(320);
  });

  it("sizes a pane on the right from the right edge", () => {
    expect(sizeFromPointer({ name: "rail", edge: "end", point: 1100, bounds })).toBe(300);
  });

  it("sizes a pane at the bottom from the bottom edge", () => {
    const tall = { ...bounds, horizontal: true, available: 800 };
    expect(sizeFromPointer({ name: "data", edge: "end", point: 600, bounds: tall })).toBe(300);
  });

  it("holds to the limits while dragging past them", () => {
    expect(sizeFromPointer({ name: "sidebar", edge: "start", point: 20, bounds })).toBe(PANES.sidebar.min);
    expect(sizeFromPointer({ name: "rail", edge: "end", point: 5, bounds })).toBe(980);
  });
});
