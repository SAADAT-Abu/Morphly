/**
 * The data window: the same table as the drawer under the canvas, popped out
 * into a window of its own, for a long table or a second screen.
 *
 * This window holds no figure of its own. The editor window owns the data and
 * sends it here whenever it changes; edits made here are sent back as the same
 * operations the drawer uses (lib/datasets.js), and the editor applies them,
 * so the two can never drift apart. Undo here undoes in the editor.
 *
 * Each edit carries a number. A copy of the data sent before the editor had
 * seen the latest edit is ignored, so fast typing never flickers back to an
 * older value.
 */

import React, { useEffect, useRef, useState } from "react";
import DataGrid from "./DataGrid";
import { applyDatasetOp, DATASET_KINDS } from "../lib/datasets";

export default function DataWindow() {
  const [dataset, setDataset] = useState(null);
  const [colours, setColours] = useState([]);
  const [extended, setExtended] = useState(false);
  const sent = useRef(0);

  useEffect(() => {
    const bridge = window.morphly.dataWindow;
    const off = bridge.onDataset(({ dataset: next, colours: nextColours, seq }) => {
      if (seq < sent.current) return;
      setDataset(next);
      setColours(nextColours ?? []);
    });
    bridge.ready();
    return off;
  }, []);

  useEffect(() => {
    document.title = dataset ? `${dataset.name}: data` : "Data";
  }, [dataset]);

  const send = (op, commit = true) => {
    sent.current += 1;
    window.morphly.dataWindow.op({ op, commit, seq: sent.current });
  };

  useEffect(() => {
    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" || key === "y") {
        e.preventDefault();
        send({ op: key === "y" || e.shiftKey ? "__redo" : "__undo" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!dataset) {
    return (
      <div className="data-window empty">
        <p>No data to show. Select a graph in Morphly, or pick data in its Data tab.</p>
      </div>
    );
  }

  const onOp = (op, { commit = true } = {}) => {
    // Show the edit straight away; the editor's copy follows a moment later.
    setDataset((current) => (current ? applyDatasetOp(current, op) : current));
    send(op, commit);
  };

  return (
    <div className="data-window">
      <div className="data-drawer-head">
        <strong className="data-title">{dataset.name}</strong>
        <span className="muted">
          {DATASET_KINDS[dataset.kind].label}. Edits redraw the graph in the editor as you type.
        </span>
        <span className="spacer" />
        <button className="ghost small" onClick={() => onOp({ op: "addRows", count: 10 })}>
          + 10 rows
        </button>
        <button className="ghost small" onClick={() => setExtended((on) => !on)}>
          {extended ? "Fewer statistics" : "More statistics"}
        </button>
        <button className="ghost small" onClick={() => window.morphly.dataWindow.dock()}>
          Put back under the canvas
        </button>
      </div>
      <DataGrid dataset={dataset} onOp={onOp} colours={colours} extended={extended} />
    </div>
  );
}
