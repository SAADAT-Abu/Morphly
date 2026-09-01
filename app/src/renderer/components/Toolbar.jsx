import React from "react";
import { useStore } from "../store";

const TOOLS = [
  ["select", "Select", "⬉"],
  ["rect", "Rectangle", "▭"],
  ["ellipse", "Ellipse", "◯"],
  ["triangle", "Triangle", "△"],
  ["line", "Line", "╱"],
  ["arrow", "Arrow", "↗"],
  ["text", "Text", "T"],
];

export default function Toolbar({ onNew, onOpen, onSave, onExport, onFitToScreen }) {
  const activeTool = useStore((s) => s.activeTool);
  const setTool = useStore((s) => s.setTool);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const dirty = useStore((s) => s.dirty);
  const projectPath = useStore((s) => s.projectPath);
  const duplicateSelected = useStore((s) => s.duplicateSelected);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const selectedIds = useStore((s) => s.selectedIds);

  const fileName = projectPath ? projectPath.split(/[/\\]/).pop() : "Untitled figure";

  return (
    <div className="toolbar">
      <div className="brand">
        <span className="logo">◈</span> Morphly
      </div>

      <div className="group">
        <button className="ghost" onClick={onNew} title="New figure (Ctrl+N)">New</button>
        <button className="ghost" onClick={onOpen} title="Open (Ctrl+O)">Open</button>
        <button className="ghost" onClick={() => onSave(false)} title="Save (Ctrl+S)">Save</button>
        <button className="ghost" onClick={() => onSave(true)}>Save as…</button>
      </div>

      <div className="divider" />

      <div className="group tools">
        {TOOLS.map(([tool, label, icon]) => (
          <button
            key={tool}
            className={`tool${activeTool === tool ? " active" : ""}`}
            title={label}
            onClick={() => setTool(tool)}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className="divider" />

      <div className="group">
        <button className="ghost" onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)">↶</button>
        <button className="ghost" onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Shift+Z)">↷</button>
        <button className="ghost" onClick={duplicateSelected} disabled={selectedIds.length === 0} title="Duplicate (Ctrl+D)">⧉</button>
        <button className="ghost" onClick={deleteSelected} disabled={selectedIds.length === 0} title="Delete (Del)">🗑</button>
      </div>

      <div className="divider" />

      <div className="group zoom">
        <button className="ghost" onClick={() => setZoom(zoom / 1.2)} title="Zoom out">−</button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="ghost" onClick={() => setZoom(zoom * 1.2)} title="Zoom in">+</button>
        <button className="ghost" onClick={onFitToScreen} title="Fit to screen (Ctrl+0)">Fit</button>
      </div>

      <div className="spacer" />

      <div className="filename" title={projectPath ?? "Not saved yet"}>
        {fileName}
        {dirty && <span className="dot" title="Unsaved changes">•</span>}
      </div>

      <button className="primary" onClick={onExport}>Export…</button>
    </div>
  );
}
