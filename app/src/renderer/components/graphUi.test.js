import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useStore } from "../store";
import { sampleDataset, createDataset } from "../lib/datasets";
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
    for (const shape of [
      "Groups",
      "X and Y",
      "Groups by condition",
      "Counts in categories",
      "Survival",
      "Table of numbers",
      "Results per row",
      "Lists of names",
    ]) {
      expect(out).toContain(shape);
    }
    // Every shape is available now, so none is marked as coming later.
    expect(out).not.toContain("Later");
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

  it("names the columns of a volcano and writes what it found", () => {
    const id = state().addGraph({ dataset: sampleDataset("results"), kind: "volcano" });
    const el = state().elements.find((e) => e.id === id);
    const out = html(h(GraphPanel, { element: el }));
    // The columns were found by their names, and can be changed.
    expect(out).toContain("Effect (log2 fold change)");
    expect(out).toContain("p value");
    expect(out).toContain("Correct for multiple testing");
    expect(out).toContain("Benjamini-Hochberg (FDR)");
    expect(out).toContain("Volcano plot");
    expect(out).toContain("of 40 tested");
    expect(out).toContain("Copy methods sentence");
    expect(out).not.toMatch(/[–—]/);
  });

  it("offers the settings a heatmap needs and none it does not", () => {
    const id = state().addGraph({ dataset: sampleDataset("table"), kind: "heatmap" });
    const el = state().elements.find((e) => e.id === id);
    const out = html(h(GraphPanel, { element: el }));
    expect(out).toContain("Z score across each row");
    expect(out).toContain("Order the rows by how alike they are");
    expect(out).toContain("12 rows by 4 columns");
    // A heatmap has no Y axis to set limits on.
    expect(out).not.toContain("Y from");
    expect(out).not.toMatch(/[–—]/);
  });

  it("shows the area under a ROC curve, and which class counts as positive", () => {
    const id = state().addGraph({ dataset: sampleDataset("table"), kind: "roc" });
    const el = state().elements.find((e) => e.id === id);
    const out = html(h(GraphPanel, { element: el }));
    expect(out).toContain("True class");
    expect(out).toContain("Counts as positive");
    expect(out).toContain("Tumour");
    expect(out).toContain("AUC 0.861");
    expect(out).toContain("95% CI");
    expect(out).not.toMatch(/[–—]/);
  });

  it("asks for a background before testing an overlap", () => {
    const id = state().addGraph({ dataset: sampleDataset("sets"), kind: "venn" });
    const el = state().elements.find((e) => e.id === id);
    const out = html(h(GraphPanel, { element: el }));
    expect(out).toContain("Venn diagram");
    expect(out).toContain("3 lists");
    expect(out).toContain("Things tested in all");
    expect(out).not.toMatch(/[–—]/);
  });

  it("writes PCA axes with how much each component explains", () => {
    const id = state().addGraph({ dataset: sampleDataset("table"), kind: "pca" });
    const el = state().elements.find((e) => e.id === id);
    const out = html(h(GraphPanel, { element: el }));
    expect(out).toContain("Colour the points by");
    expect(out).toContain("Give every column the same weight");
    expect(out).toMatch(/PC1 explains \d+\.\d%/);
    expect(out).not.toMatch(/[–—]/);
  });

  it("shows fits for an X and Y graph", () => {
    const id = state().addGraph({ dataset: sampleDataset("xy"), kind: "scatter" });
    const el = state().elements.find((e) => e.id === id);
    const out = html(h(GraphPanel, { element: el }));
    expect(out).toContain("Fitted curve");
    expect(out).toContain("Straight line");
    expect(out).toContain("Wild type");
    expect(out).toContain("R² = ");
  });

  it("fits a dose response curve and writes out its IC50", () => {
    const dataset = createDataset({
      kind: "xy",
      columns: [
        { name: "Dose (uM)", values: ["0.01", "0.03", "0.1", "0.3", "1", "3", "10", "30", "100"] },
        { name: "Viability", values: ["2.1", "3.4", "8.9", "21.5", "48.7", "76.2", "91.3", "96.8", "98.4"] },
      ],
    });
    const id = state().addGraph({ dataset, kind: "scatter" });
    state().updatePlot(id, { fitModel: "4pl" });
    const el = state().elements.find((e) => e.id === id);
    const out = html(h(GraphPanel, { element: el }));
    expect(out).toContain("Show the 95% confidence band");
    expect(out).toContain("IC50 = 1.05");
    expect(out).toContain("Hill slope = 1.10");
    expect(out).toContain("Copy methods sentence");
    // The methods sentence carries the interval, not just the estimate.
    expect(out).toContain("95% CI");
    expect(out).not.toMatch(/[–—]/);
  });

  it("shows survival curves with the test that compares them", () => {
    const id = state().addGraph({ dataset: sampleDataset("survival"), kind: "survival" });
    const el = state().elements.find((e) => e.id === id);
    const out = html(h(GraphPanel, { element: el }));
    expect(out).toContain("Mark censored subjects with a tick");
    expect(out).toContain("Compare curves with");
    expect(out).toContain("Log-rank (Mantel-Cox)");
    expect(out).toContain("Gehan-Breslow-Wilcoxon");
    expect(out).toContain("Hazard ratio");
    expect(out).toContain("median");
    expect(out).not.toMatch(/[–—]/);
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
