import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";
import { sampleDataset } from "./lib/datasets";
import { migrate, serialise } from "./lib/document";

const state = () => useStore.getState();
const graphs = () => state().elements.filter((el) => el.type === "plot");

describe("graphs in the store", () => {
  beforeEach(() => {
    state().newDocument();
  });

  it("inserts a graph with its dataset, selected, sized for the page", () => {
    const ds = sampleDataset("groups");
    const id = state().addGraph({ dataset: ds, kind: "dots" });
    const el = graphs()[0];
    expect(el.id).toBe(id);
    expect(el.datasetId).toBe(ds.id);
    expect(el.plot.kind).toBe("dots");
    expect(el.plot.fontSize).toBe(Math.round(Math.min(state().canvas.width, state().canvas.height) * 0.02));
    expect(state().datasets).toEqual([ds]);
    expect(state().selectedIds).toEqual([id]);
    expect(state().dataView).toMatchObject({ datasetId: ds.id, open: true });
  });

  it("fills a box when given one, such as a panel", () => {
    state().addGraph({ dataset: sampleDataset(), box: { x: 10, y: 20, width: 300, height: 200 } });
    expect(graphs()[0]).toMatchObject({ x: 10, y: 20, width: 300, height: 200 });
  });

  it("undoes the insertion, dataset and all, in one step", () => {
    state().addGraph({ dataset: sampleDataset() });
    state().undo();
    expect(graphs()).toHaveLength(0);
    expect(state().datasets).toHaveLength(0);
  });

  it("makes a typed word one undo step", () => {
    const ds = sampleDataset();
    state().addGraph({ dataset: ds });
    const before = state().past.length;
    state().editDataset(ds.id, { op: "setCell", col: 0, row: 0, value: "1" });
    state().editDataset(ds.id, { op: "setCell", col: 0, row: 0, value: "12" }, { commit: false });
    state().editDataset(ds.id, { op: "setCell", col: 0, row: 0, value: "120" }, { commit: false });
    expect(state().past.length).toBe(before + 1);
    expect(state().datasets[0].columns[0].values[0]).toBe("120");
    state().undo();
    expect(state().datasets[0].columns[0].values[0]).toBe("98");
  });

  it("changes a graph's settings", () => {
    const id = state().addGraph({ dataset: sampleDataset() });
    state().updatePlot(id, { error: "sem", yTitle: "Viability (%)" });
    expect(graphs()[0].plot).toMatchObject({ error: "sem", yTitle: "Viability (%)", kind: "bar" });
  });

  it("brings the data along when a graph is pasted into a new figure", () => {
    const ds = sampleDataset();
    state().addGraph({ dataset: ds });
    state().copySelected();
    state().newDocument();
    expect(state().datasets).toHaveLength(0);
    state().pasteClipboard();
    expect(state().datasets.map((d) => d.id)).toEqual([ds.id]);
    // Pasting again in the same figure does not add a second copy.
    state().pasteClipboard();
    expect(state().datasets).toHaveLength(1);
    expect(graphs()).toHaveLength(2);
  });

  it("deletes a dataset and closes the drawer on it", () => {
    const ds = sampleDataset();
    state().addGraph({ dataset: ds });
    state().deleteDataset(ds.id);
    expect(state().datasets).toHaveLength(0);
    expect(state().dataView.open).toBe(false);
  });

  it("saves and reopens datasets, dropping anything malformed", () => {
    const ds = sampleDataset();
    state().addGraph({ dataset: ds });
    const saved = JSON.parse(
      JSON.stringify(serialise({ pages: state().allPages(), activePageId: state().activePageId, datasets: state().datasets }))
    );
    saved.datasets.push({ id: 5, columns: "no" }, null);
    state().newDocument();
    state().loadDocument(migrate(saved));
    expect(state().datasets).toEqual([ds]);
    expect(graphs()[0].datasetId).toBe(ds.id);
  });
});
