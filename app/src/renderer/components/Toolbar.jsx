import React from "react";
import { useStore } from "../store";
import iconUrl from "../assets/icon.png";

/**
 * Tool icons are inline SVG on a shared 24x24 grid rather than Unicode glyphs.
 * Glyphs like the box, circle and triangle characters carry different advance
 * widths and sit on different baselines in every font, so they cannot be made
 * to line up inside equally sized buttons; drawn paths can.
 */
const ICON = {
  select: <path d="M6 3l12 9-5.2.9L15 18.4l-2.3 1-2.2-4.6L6.8 18z" />,
  rect: <rect x="3.5" y="6.5" width="17" height="11" rx="1.5" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  triangle: <path d="M12 4.5 20.5 19h-17z" />,
  line: <path d="M4.5 19.5 19.5 4.5" />,
  arrow: <path d="M4.5 19.5 19 5m0 0h-6.2M19 5v6.2" />,
  text: <path d="M5 5.5h14M12 5.5v13M8.8 18.5h6.4" />,
};

const TOOLS = [
  ["select", "Select (V)"],
  ["rect", "Rectangle (R)"],
  ["ellipse", "Ellipse (O)"],
  ["triangle", "Triangle"],
  ["line", "Line (L)"],
  ["arrow", "Arrow (A)"],
  ["text", "Text (T)"],
];

function ToolIcon({ name }) {
  // `select` is a filled cursor; the rest read better as outlines.
  const filled = name === "select" || name === "triangle";
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON[name]}
    </svg>
  );
}

export default function Toolbar({ onNew, onOpen, onSave, onExport, onFitToScreen, onHelp }) {
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
        <img className="logo" src={iconUrl} alt="" width="20" height="20" /> Morphly
      </div>

      <div className="group">
        <button className="ghost" onClick={onNew} title="New figure (Ctrl+N)">New</button>
        <button className="ghost" onClick={onOpen} title="Open (Ctrl+O)">Open</button>
        <button className="ghost" onClick={() => onSave(false)} title="Save (Ctrl+S)">Save</button>
        <button className="ghost" onClick={() => onSave(true)}>Save as…</button>
      </div>

      <div className="divider" />

      <div className="group tools">
        {TOOLS.map(([tool, label]) => (
          <button
            key={tool}
            className={`tool${activeTool === tool ? " active" : ""}`}
            title={label}
            aria-label={label}
            aria-pressed={activeTool === tool}
            onClick={() => setTool(tool)}
          >
            <ToolIcon name={tool} />
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

      <button className="ghost help-btn" onClick={onHelp} title="Help (F1)">?</button>
      <button className="primary" onClick={onExport}>Export…</button>
    </div>
  );
}
