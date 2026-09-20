import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useStore } from "../store";
import { sampleDataset } from "../lib/datasets";
import GraphDialog, { initialSource } from "./GraphDialog";
import GraphPanel from "./GraphPanel";
import DataGrid from "./DataGrid";
import DataDrawer from "./DataDrawer";
import DataPanel from "./DataPanel";

/**
 * The graph interface, rendered to HTML without a window. These catch a panel
 * that throws on some data, or loses a control, before anyone opens the app;
 * how it looks and responds still wants a person's eye.
 */

const h = React.createElement;
const state = () => useStore.getState();
// Rendering without a window reads the store's starting state, so copy the
// state each test set up into it first.
const html = (el) => {
  Object.assign(useStore.getInitialState(), useStore.getState());
  return renderToStaticMarkup(el);
};

describe("graph interface", () => {
  beforeEach(() => state().newDocument());

  it("starts on data already in the figure when there is some of that shape", () => {
    const groups = [sampleDataset("groups")];
    expect(initialSource([], "groups")).toBe("sample");
    expect(initialSource(groups, "groups")).toBe("existing");
    expect(initialSource(groups, "xy")).toBe("sample");
  });

  it("opens the graph dialog on the data shape step", () => {
    const out = html(h(GraphDialog, { datasets: [], onClose() {}, onInsert() {} }));
    expect(out).toContain("What does your data look like?");
    for (const shape of ["Groups", "X and Y", "Groups by condition", "Survival"]) expect(out).toContain(shape);
    expect(out).toContain("Later");
  });

  it("shows a graph's settings and statistics in the properties panel", () => {
    const id = state().addGraph({ dataset: sampleDataset("groups") });
    const el = state().elements.find((e) => e.id === id);
    const out = html(h(GraphPanel, { element: el }));
    expect(out).toContain("Error bars");
    expect(out).toContain("One-way ANOVA");
    expect(out).toContain("Suggested");
    expect(out).toContain("F(3, 20) = 111.6");
    expect(out).toContain("Control vs Vehicle");
    expect(out).toContain("Copy methods sentence");
    expect(out).not.toMatch(/[–—]/);
  });

  it("shows fits for an X and Y graph", () => {
    const id = state().addGraph({ dataset: sampleDataset("xy"), kind: "scatter" });
    const el = state().elements.find((e) => e.id === id);
    const out = html(h(GraphPanel, { element: el }));
    expect(out).toContain("Straight-line fit");
    expect(out).toContain("Wild type");
    expect(out).toContain("R² = ");
  });

  it("offers other data when a graph's data is missing", () => {
    const id = state().addGraph({ dataset: sampleDataset("groups") });
    const el = { ...state().elements.find((e) => e.id === id), datasetId: "gone" };
    expect(html(h(GraphPanel, { element: el }))).toContain("data for this graph is missing");
  });

  it("draws the data grid with spare rows and column summaries", () => {
    const ds = sampleDataset("groups");
    const out = html(h(DataGrid, { dataset: ds, onOp() {} }));
    expect((out.match(/class="cell"/g) ?? []).length).toBe(4 * (6 + 3));
    expect(out).toContain(">Mean<");
    expect(out).toContain(">98.83<");
  });

  it("shows the drawer with its pop-out button, and the slim bar once popped out", () => {
    const ds = sampleDataset("groups");
    state().addGraph({ dataset: ds });
    let out = html(h(DataDrawer));
    expect(out).toContain('aria-label="Open the data in its own window"');
    state().setDataView({ popped: true });
    out = html(h(DataDrawer));
    expect(out).toContain("is open in its own window");
    expect(out).not.toContain("data-grid");
  });

  it("lists the figure's data in the Data tab", () => {
    state().addGraph({ dataset: sampleDataset("groups") });
    const out = html(h(DataPanel, { onGraph() {} }));
    expect(out).toContain("Cell viability (sample)");
    expect(out).toContain("Used by 1 graph");
  });
});
