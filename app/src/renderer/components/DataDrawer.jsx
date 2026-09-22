/**
 * The data drawer, under the canvas.
 *
 * It shows the numbers behind the selected graph (or the dataset chosen in the
 * Data tab) while the graph stays in view above it, so every edit is seen
 * redrawn at once. Drag the handle above it to give the table or the canvas
 * more room. It can be closed, or popped out into a window of its own (the
 * icon in its top right corner), for a long table or a second screen. While
 * the data is in its window, a slim bar here says so and brings it back.
 */

import React, { useRef } from "react";
import { useStore } from "../store";
import DataGrid from "./DataGrid";
import Splitter from "./Splitter";
import { DATASET_KINDS } from "../lib/datasets";
import { GROUP_COLOURS } from "../lib/plotRender";

/** The colours a graph of this dataset uses, for the swatches in the header. */
export function datasetColours(elements, datasetId) {
  const graph = elements.find((el) => el.type === "plot" && el.datasetId === datasetId);
  return (graph?.plot?.colors ?? []).length
    ? GROUP_COLOURS.map((c, i) => graph.plot.colors[i] || c)
    : GROUP_COLOURS;
}

const PopOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v4h-9v-9h4" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export default function DataDrawer({ height, containerRef, onResize, onDone }) {
  const dataView = useStore((s) => s.dataView);
  const dataset = useStore((s) => s.datasets.find((d) => d.id === s.dataView.datasetId) ?? null);
  const elements = useStore((s) => s.elements);
  const editDataset = useStore((s) => s.editDataset);
  const setDataView = useStore((s) => s.setDataView);
  const closeData = useStore((s) => s.closeData);
  // Renaming, like typing in a cell, is one undo step however many letters.
  const renaming = useRef(false);

  if (!dataView.open || !dataset) return null;

  if (dataView.popped) {
    return (
      <div className="data-drawer-bar">
        <span>
          <strong>{dataset.name}</strong> is open in its own window.
        </span>
        <span className="spacer" />
        <button className="ghost small" onClick={() => setDataView({ popped: false })}>
          Put it back under the canvas
        </button>
      </div>
    );
  }

  const onOp = (op, options) => editDataset(dataset.id, op, options);

  return (
    <>
      <Splitter
        name="data"
        horizontal
        containerRef={containerRef}
        size={height}
        onResize={onResize}
        onDone={onDone}
      />
      <div className="data-drawer" style={{ height }}>
      <div className="data-drawer-head">
        <input
          className="data-name"
          value={dataset.name}
          aria-label="Name of this data"
          onFocus={() => (renaming.current = false)}
          onChange={(e) => {
            onOp({ op: "rename", name: e.target.value }, { commit: !renaming.current });
            renaming.current = true;
          }}
        />
        <span className="muted">
          {DATASET_KINDS[dataset.kind].label}.{" "}
          {dataset.kind === "xy" ? "The first column is X." : "Each column is a group."} Edits redraw the graph as you type.
        </span>
        <span className="spacer" />
        <button className="ghost small" onClick={() => onOp({ op: "addRows", count: 5 })}>
          + 5 rows
        </button>
        <button className="ghost small" onClick={closeData}>
          Close
        </button>
        <button
          className="tool pop-out"
          title="Open the data in its own window"
          aria-label="Open the data in its own window"
          onClick={() => setDataView({ popped: true })}
        >
          <PopOutIcon />
        </button>
      </div>
      <DataGrid dataset={dataset} onOp={onOp} colours={datasetColours(elements, dataset.id)} />
      </div>
    </>
  );
}
