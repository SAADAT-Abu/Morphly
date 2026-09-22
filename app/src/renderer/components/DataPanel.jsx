/**
 * The Data tab of the left sidebar: every set of numbers in this figure.
 *
 * Click one to open it in the drawer under the canvas. "Graph" draws another
 * graph of the same numbers, which then stays in step with the first. Data can
 * be imported or started empty here too, before any graph exists.
 */

import React, { useState } from "react";
import { useStore } from "../store";
import { DATASET_KINDS, blankDataset, parseTable, datasetFromRows, rowCount } from "../lib/datasets";

export default function DataPanel({ onGraph, flash }) {
  const datasets = useStore((s) => s.datasets);
  const pages = useStore((s) => s.pages);
  const activePageId = useStore((s) => s.activePageId);
  const elements = useStore((s) => s.elements);
  const dataView = useStore((s) => s.dataView);
  const openData = useStore((s) => s.openData);
  const addDataset = useStore((s) => s.addDataset);
  const deleteDataset = useStore((s) => s.deleteDataset);
  const [kind, setKind] = useState("groups");

  // Graphs on every page, the active one live.
  const graphs = pages
    .flatMap((p) => (p.id === activePageId ? elements : p.elements))
    .filter((el) => el.type === "plot");
  const usedBy = (id) => graphs.filter((g) => g.datasetId === id).length;

  const importCsv = async () => {
    const res = await window.morphly.importTable();
    if (res.canceled) return;
    if (!res.ok) {
      flash?.(`Could not import the table: ${res.error}`);
      return;
    }
    const ds = datasetFromRows(parseTable(res.text).rows, { kind, name: res.name });
    if (!ds) {
      flash?.("That file has no table in it");
      return;
    }
    openData(addDataset(ds));
  };

  const newTable = () => openData(addDataset(blankDataset(kind)));

  return (
    <div className="panel data-panel">
      <div className="panel-header">Data in this figure</div>
      <div className="data-panel-body">
        {datasets.length === 0 && (
          <p className="hint">
            No data yet. Insert a graph from the toolbar, or import a table here to graph later.
          </p>
        )}
        {datasets.map((d) => {
          const n = usedBy(d.id);
          const values = d.columns.reduce((sum, c) => sum + c.values.filter((v) => String(v).trim() !== "").length, 0);
          return (
            <div key={d.id} className={`dataset-card${dataView.datasetId === d.id && dataView.open ? " active" : ""}`}>
              <button className="dataset-open" onClick={() => openData(d.id)} title="Show these numbers under the canvas">
                <strong>{d.name || "Untitled data"}</strong>
                <span className="muted">
                  {DATASET_KINDS[d.kind].label}, {d.columns.length} {d.columns.length === 1 ? "column" : "columns"}, {values}{" "}
                  {values === 1 ? "value" : "values"}
                  {rowCount(d) ? "" : ", empty"}
                </span>
                <span className="muted">{n === 0 ? "Not in a graph yet" : n === 1 ? "Used by 1 graph" : `Used by ${n} graphs`}</span>
              </button>
              <div className="dataset-actions">
                <button className="ghost small" onClick={() => onGraph(d.id)}>
                  Graph
                </button>
                <button
                  className="ghost small"
                  disabled={n > 0}
                  title={n > 0 ? "Remove its graphs first" : "Remove this data from the figure"}
                  onClick={() => deleteDataset(d.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}

        <div className="data-panel-new">
          <label className="field">
            <span>New data is</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="groups">Groups (each column a group)</option>
              <option value="xy">X and Y (first column X)</option>
            </select>
          </label>
          <div className="control-row">
            <button className="ghost small" onClick={importCsv}>
              Import CSV…
            </button>
            <button className="ghost small" onClick={newTable}>
              New table
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
