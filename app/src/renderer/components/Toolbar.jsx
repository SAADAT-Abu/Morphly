import React from "react";
import { useStore } from "../store";
import iconUrl from "../assets/icon.png";
import { ALIGN_REFERENCES, movableUnits } from "../lib/align";
import { connectorGeometry, isConnector } from "../lib/connectors";

/**
 * The toolbar, in two rows.
 *
 *   top      the document: file actions, undo and redo, its name, help, export
 *   tools    working on the figure, left to right in the order a figure is
 *            usually made: draw, insert, edit, arrange; then viewing options
 *            at the far end
 *
 * Icons are inline SVG on a shared 24x24 grid rather than Unicode glyphs.
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
  table: (
    <>
      <path d="M3.5 5.5h17v4h-17z" fill="currentColor" />
      <path d="M3.5 5.5h17v13h-17zM3.5 9.5h17M3.5 14h17M10 9.5v9M16 9.5v9" />
    </>
  ),
  image: <path d="M3.5 5.5h17v13h-17zM3.5 15l4.5-4.5 4 4 3-2.5 5.5 4.5M15.5 9.5h.01" />,
  panels: <path d="M3.5 4.5h7.5v7h-7.5zM13 4.5h7.5v7H13zM3.5 13.5h17v6h-17z" />,
  grid: <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />,
  // A droplet, not a page: a page outline reads as the image button.
  canvas: <path d="M12 3.4c3.6 4.1 5.6 6.6 5.6 9.1a5.6 5.6 0 1 1-11.2 0c0-2.5 2-5 5.6-9.1z" />,
  snap: <path d="M6 4.5v7a6 6 0 0 0 12 0v-7h-3.5v7a2.5 2.5 0 0 1-5 0v-7zM6 8.5h3.5M14.5 8.5H18" />,

  undo: <path d="M8.5 5.5 4 10l4.5 4.5M4.5 10h10a5 5 0 0 1 0 10h-3" />,
  redo: <path d="M15.5 5.5 20 10l-4.5 4.5M19.5 10h-10a5 5 0 0 0 0 10h3" />,
  duplicate: <path d="M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4" />,
  delete: <path d="M4.5 6.5h15M9.5 6.5v-2h5v2M6.5 6.5l1 13h9l1-13M10.5 10v6M13.5 10v6" />,
  group: (
    <>
      <path d="M3.5 3.5h17v17h-17z" strokeDasharray="2.5 2.5" />
      <path d="M7 7h5.5v5.5H7zM11.5 11.5H17V17h-5.5z" />
    </>
  ),
  ungroup: <path d="M3.5 3.5h7.5V11H3.5zM13 13h7.5v7.5H13z" />,

  "align-left": <path d="M4 3.5v17M7 6.5h11v4H7zM7 13.5h6.5v4H7z" />,
  "align-hcenter": <path d="M12 3.5v17M5.5 6.5h13v4h-13zM8.5 13.5h7v4h-7z" />,
  "align-right": <path d="M20 3.5v17M6 6.5h11v4H6zM10.5 13.5H17v4h-6.5z" />,
  "align-top": <path d="M3.5 4h17M6.5 7h4v11h-4zM13.5 7h4v6.5h-4z" />,
  "align-vcenter": <path d="M3.5 12h17M6.5 5.5h4v13h-4zM13.5 8.5h4v7h-4z" />,
  "align-bottom": <path d="M3.5 20h17M6.5 6h4v11h-4zM13.5 10.5h4V17h-4z" />,
  "distribute-h-gaps": <path d="M3.5 4v16M20.5 4v16M7.5 7.5h3v9h-3zM13.5 5.5h3v13h-3z" />,
  "distribute-h-centres": <path d="M4 8h3v8H4zM10.5 6h3v12h-3zM17 9h3v6h-3zM5.5 3.5v2M12 3v2M18.5 3.5v2" />,
  "distribute-v-gaps": <path d="M4 3.5h16M4 20.5h16M7.5 7.5h9v3h-9zM5.5 13.5h13v3h-13z" />,
  "distribute-v-centres": <path d="M8 4h8v3H8zM6 10.5h12v3H6zM9 17h6v3H9zM3.5 5.5h2M3 12h2M3.5 18.5h2" />,

  "zoom-out": <path d="M6 12h12" />,
  "zoom-in": <path d="M12 6v12M6 12h12" />,
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
};

const TOOLS = [
  ["select", "Select (V)"],
  ["rect", "Rectangle (R)"],
  ["ellipse", "Ellipse (O)"],
  ["triangle", "Triangle"],
];

/** End combinations offered for the line tool. */
const LINE_PRESETS = [
  ["Line", { startHead: "none", endHead: "none" }],
  ["Arrow", { startHead: "none", endHead: "triangle" }],
  ["Double arrow", { startHead: "triangle", endHead: "triangle" }],
  ["Open arrow", { startHead: "none", endHead: "open" }],
  ["Double open arrow", { startHead: "open", endHead: "open" }],
  ["Inhibition", { startHead: "none", endHead: "bar" }],
  ["Square end", { startHead: "none", endHead: "square" }],
  ["Dot end", { startHead: "none", endHead: "circle" }],
  ["Dots at both ends", { startHead: "circle", endHead: "circle" }],
];

const DASH_PRESETS = [
  ["Solid", "solid"],
  ["Dashed", "dashed"],
  ["Dotted", "dotted"],
];

/** A small drawing of a line style, made by the same geometry as the canvas. */
function LinePreview({ style, width = 48 }) {
  const height = 16;
  const geometry = connectorGeometry({
    type: "arrow",
    x: 0,
    y: 0,
    points: [4, height / 2, width - 4, height / 2],
    strokeWidth: 1.6,
    startHead: style.startHead,
    endHead: style.endHead,
    dash: style.dash,
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path
        d={geometry.d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray={geometry.dash ? geometry.dash.join(" ") : undefined}
      />
      {geometry.heads.map((head, i) =>
        head.kind === "circle" ? (
          <circle key={i} cx={head.cx} cy={head.cy} r={head.r} fill="currentColor" />
        ) : head.kind === "polyline" ? (
          <polyline key={i} points={head.points.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <polygon key={i} points={head.points.join(" ")} fill="currentColor" />
        )
      )}
    </svg>
  );
}

/**
 * Lines and arrows share one tool. The main button draws with the current
 * style; the arrow beside it lists end styles and dashes. Choosing one sets
 * the style for the next line, and restyles any lines already selected.
 */
function LineTool({ active }) {
  const lineStyle = useStore((s) => s.lineStyle);
  const setLineStyle = useStore((s) => s.setLineStyle);
  const setTool = useStore((s) => s.setTool);
  const [open, setOpen] = React.useState(false);
  const hostRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!hostRef.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = (patch) => {
    const s = useStore.getState();
    const restyling = s.elements.some((el) => s.selectedIds.includes(el.id) && isConnector(el));
    setLineStyle(patch);
    // With lines selected, the choice restyles them; otherwise it is ready to draw.
    if (!restyling) setTool("line");
    setOpen(false);
  };

  return (
    <div className="menu-host line-tool" ref={hostRef}>
      <button
        className={`tool line-tool-main${active ? " active" : ""}`}
        title="Line (L), or A for an arrow"
        aria-label="Line"
        aria-pressed={active}
        onClick={() => setTool("line")}
      >
        <LinePreview style={lineStyle} width={24} />
      </button>
      <button
        className={`tool line-tool-caret${open ? " active" : ""}`}
        title="Line ends and style"
        aria-label="Line ends and style"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="dropdown line-dropdown" role="menu">
          {LINE_PRESETS.map(([label, ends]) => {
            const current = lineStyle.startHead === ends.startHead && lineStyle.endHead === ends.endHead;
            return (
              <button key={label} role="menuitemradio" aria-checked={current} className={current ? "current" : ""} onClick={() => choose(ends)}>
                <LinePreview style={{ ...lineStyle, ...ends }} />
                {label}
              </button>
            );
          })}
          <div className="dropdown-sep" />
          {DASH_PRESETS.map(([label, dash]) => {
            const current = (lineStyle.dash ?? "solid") === dash;
            return (
              <button key={dash} role="menuitemradio" aria-checked={current} className={current ? "current" : ""} onClick={() => choose({ dash })}>
                <LinePreview style={{ startHead: "none", endHead: "none", dash }} />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ALIGN_BUTTONS = [
  ["left", "Align left edges"],
  ["hcenter", "Centre horizontally"],
  ["right", "Align right edges"],
  ["top", "Align top edges"],
  ["vcenter", "Centre vertically"],
  ["bottom", "Align bottom edges"],
];

const DISTRIBUTE_BUTTONS = [
  ["h-gaps", "Distribute horizontally: equal gaps"],
  ["h-centres", "Distribute horizontally: equal centre spacing"],
  ["v-gaps", "Distribute vertically: equal gaps"],
  ["v-centres", "Distribute vertically: equal centre spacing"],
];

function ToolIcon({ name }) {
  // `select` and the triangle read better filled; the rest as outlines.
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

/**
 * The figure's name, in the top-left corner. Click to rename; Enter keeps the
 * new name and Escape puts the old one back. Beside it, whether the figure is
 * saved, so autosave never leaves anyone wondering.
 */
function FigureTitle({ title, projectPath, dirty, autosave, onRename }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title);
  const cancelled = React.useRef(false);

  React.useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(title);
      return;
    }
    const next = draft.trim();
    if (next && next !== title) onRename(next);
    else setDraft(title);
  };

  const status = dirty
    ? autosave ? "Saving…" : "Unsaved changes"
    : projectPath ? "Saved" : "Not saved yet";

  if (editing) {
    return (
      <input
        className="figure-title-input"
        autoFocus
        value={draft}
        maxLength={120}
        aria-label="Figure name"
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <button
      className="figure-title"
      onClick={() => setEditing(true)}
      title={`${projectPath ?? "Not saved yet"}\nClick to rename`}
    >
      <span className="figure-title-text">{title}</span>
      <span className={`figure-status${dirty ? " pending" : ""}`}>{status}</span>
    </button>
  );
}

/** An icon button with its label as the tooltip and accessible name. */
function IconButton({ icon, label, active, ...props }) {
  return (
    <button
      className={`tool${active ? " active" : ""}`}
      title={label}
      aria-label={label}
      {...(active !== undefined ? { "aria-pressed": active } : {})}
      {...props}
    >
      <ToolIcon name={icon} />
    </button>
  );
}

export default function Toolbar({
  onNew,
  onOpen,
  onSave,
  onExport,
  onFitToScreen,
  onHelp,
  onInsertTable,
  onInsertPanels,
  onInsertImage,
  onRename,
  autosave,
}) {
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
  const groupSelected = useStore((s) => s.groupSelected);
  const ungroupSelected = useStore((s) => s.ungroupSelected);
  const elements = useStore((s) => s.elements);
  const grid = useStore((s) => s.grid);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const canvas = useStore((s) => s.canvas);
  const setCanvas = useStore((s) => s.setCanvas);
  const alignTo = useStore((s) => s.alignTo);
  const setAlignTo = useStore((s) => s.setAlignTo);
  const alignSelected = useStore((s) => s.alignSelected);
  const distributeSelected = useStore((s) => s.distributeSelected);
  const snapping = useStore((s) => s.snapping);
  const toggleSnapping = useStore((s) => s.toggleSnapping);

  // Ungroup is only meaningful when something in the selection is grouped.
  const hasGroup = elements.some((el) => selectedIds.includes(el.id) && el.groupId);

  // Pieces that would actually move: a group counts once, locked items not at all.
  const units = selectedIds.length ? movableUnits(elements, selectedIds).length : 0;
  // Spreading between themselves needs three; across a page or panel, two.
  const canDistribute = units >= (alignTo === "page" || alignTo === "panel" ? 2 : 3);

  const title = useStore((s) => s.title);

  return (
    <div className="toolbar-wrap">
      <div className="toolbar">
        <div className="brand">
          <img className="logo" src={iconUrl} alt="" width="20" height="20" /> Morphly
        </div>

        <FigureTitle title={title} projectPath={projectPath} dirty={dirty} autosave={autosave} onRename={onRename} />

        <div className="divider" />

        <div className="group">
          <button className="ghost" onClick={onNew} title="New figure (Ctrl+N)">New</button>
          <button className="ghost" onClick={onOpen} title="Open (Ctrl+O)">Open</button>
          <button className="ghost" onClick={() => onSave(false)} title="Save (Ctrl+S)">Save</button>
          <button className="ghost" onClick={() => onSave(true)}>Save as…</button>
        </div>

        <div className="divider" />

        <div className="group">
          <IconButton icon="undo" label="Undo (Ctrl+Z)" onClick={undo} disabled={past.length === 0} />
          <IconButton icon="redo" label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={future.length === 0} />
        </div>

        <div className="spacer" />

        <button className="ghost help-btn" onClick={onHelp} title="Help (F1)">?</button>
        <button className="primary" onClick={onExport}>Export…</button>
      </div>

      <div className="toolbar toolbar-tools">
        <div className="group tools" role="group" aria-label="Draw">
          {TOOLS.map(([tool, label]) => (
            <IconButton key={tool} icon={tool} label={label} active={activeTool === tool} onClick={() => setTool(tool)} />
          ))}
          <LineTool active={activeTool === "line" || activeTool === "arrow"} />
          <IconButton icon="text" label="Text (T)" active={activeTool === "text"} onClick={() => setTool("text")} />
        </div>

        <div className="divider" />

        <div className="group" role="group" aria-label="Insert">
          <IconButton icon="table" label="Insert a table (Ctrl+Shift+T)" onClick={onInsertTable} />
          <IconButton icon="image" label="Insert an image (Ctrl+Shift+M)" onClick={onInsertImage} />
          <IconButton icon="panels" label="Insert a panel layout (Ctrl+Shift+L)" onClick={onInsertPanels} />
        </div>

        <div className="divider" />

        <div className="group" role="group" aria-label="Edit">
          <IconButton icon="duplicate" label="Duplicate (Ctrl+D)" onClick={duplicateSelected} disabled={selectedIds.length === 0} />
          <IconButton icon="delete" label="Delete (Del)" onClick={deleteSelected} disabled={selectedIds.length === 0} />
          <IconButton icon="group" label="Group (Ctrl+G)" onClick={groupSelected} disabled={selectedIds.length < 2} />
          <IconButton icon="ungroup" label="Ungroup (Ctrl+Shift+G)" onClick={ungroupSelected} disabled={!hasGroup} />
        </div>

        <div className="divider" />

        <div className="group" role="group" aria-label="Arrange">
          <span className="group-label">Align to</span>
          <select
            className="align-to"
            value={alignTo}
            onChange={(e) => setAlignTo(e.target.value)}
            title="What aligning and distributing is relative to"
            aria-label="Align relative to"
          >
            {ALIGN_REFERENCES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {ALIGN_BUTTONS.map(([edge, label]) => (
            <IconButton key={edge} icon={`align-${edge}`} label={label} onClick={() => alignSelected(edge)} disabled={units === 0} />
          ))}
          {DISTRIBUTE_BUTTONS.map(([mode, label]) => (
            <IconButton
              key={mode}
              icon={`distribute-${mode}`}
              label={canDistribute ? label : `${label} (select ${alignTo === "page" || alignTo === "panel" ? "two" : "three"} or more)`}
              onClick={() => distributeSelected(mode)}
              disabled={!canDistribute}
            />
          ))}
        </div>

        <div className="spacer" />

        <div className="group" role="group" aria-label="View">
          <IconButton icon="snap" label="Snap to guides" active={snapping} onClick={toggleSnapping} />
          <IconButton icon="grid" label="Show grid (Ctrl+apostrophe)" active={grid.visible} onClick={toggleGrid} />

          {/* Page colour. It is here as well as in the properties panel because
              the panel only shows canvas settings when nothing is selected,
              which is exactly when you are least likely to be looking at it. */}
          <label className="canvas-color" title="Page background colour">
            <ToolIcon name="canvas" />
            <input
              type="color"
              value={canvas.background}
              onChange={(e) => setCanvas({ background: e.target.value })}
              aria-label="Page background colour"
            />
            <span className="swatch" style={{ background: canvas.background }} />
          </label>
        </div>

        <div className="divider" />

        <div className="group zoom" role="group" aria-label="Zoom">
          <IconButton icon="zoom-out" label="Zoom out" onClick={() => setZoom(zoom / 1.2)} />
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <IconButton icon="zoom-in" label="Zoom in" onClick={() => setZoom(zoom * 1.2)} />
          <IconButton icon="fit" label="Fit to screen (Ctrl+0)" onClick={onFitToScreen} />
        </div>
      </div>
    </div>
  );
}
