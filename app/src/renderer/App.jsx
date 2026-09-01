import React, { useCallback, useEffect, useRef, useState } from "react";

import Toolbar from "./components/Toolbar";
import AssetLibrary from "./components/AssetLibrary";
import CanvasStage from "./components/CanvasStage";
import Inspector from "./components/Inspector";
import LayersPanel from "./components/LayersPanel";
import ExportDialog from "./components/ExportDialog";
import HelpDialog from "./components/HelpDialog";
import WelcomeDialog from "./components/WelcomeDialog";
import TableDialog from "./components/TableDialog";
import { useStore } from "./store";
import { cellBox, isHeaderCell } from "./lib/tableLayout";

export default function App() {
  const stageRef = useRef(null);
  const canvasWrapRef = useRef(null);

  const [exportOpen, setExportOpen] = useState(false);
  /** { id, cell } while a text element, shape caption or table cell is being
   *  edited inline; `cell` is { row, col } for tables and null otherwise. */
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  /** null when closed, otherwise the tab to open Help on. */
  const [helpTab, setHelpTab] = useState(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);

  const store = useStore;
  const elements = useStore((s) => s.elements);
  const canvas = useStore((s) => s.canvas);
  const zoom = useStore((s) => s.zoom);
  const stagePos = useStore((s) => s.stagePos);
  const library = useStore((s) => s.library);

  const addAsset = useStore((s) => s.addAsset);
  const addImage = useStore((s) => s.addImage);
  const addTable = useStore((s) => s.addTable);
  const setZoom = useStore((s) => s.setZoom);
  const setStagePos = useStore((s) => s.setStagePos);
  const loadDocument = useStore((s) => s.loadDocument);
  const addLibrary = useStore((s) => s.addLibrary);
  const newDocument = useStore((s) => s.newDocument);
  const markSaved = useStore((s) => s.markSaved);

  const flash = useCallback((text) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  // Welcome screen on first launch, until the user opts out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.morphly.getSettings();
        if (!cancelled && res.ok && res.settings.showWelcome !== false) setWelcomeOpen(true);
      } catch {
        /* if settings can't be read, just don't show it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -- placing assets -------------------------------------------------------

  /** Fetch the SVG source, then hand it to the store. The source is needed
   *  (not just a URL) because recolouring rewrites the markup. */
  const placeAsset = useCallback(
    async (asset, variant, at) => {
      const res = await window.morphly.getSvg(asset.source, variant.svgPath);
      if (!res.ok) {
        flash(`Could not load asset: ${res.error}`);
        return;
      }
      addAsset({ asset, variant, svgSource: res.svg, at });
    },
    [addAsset, flash]
  );

  const handleExternalDrop = useCallback(
    (at, payload) => {
      if (!library) return;
      const asset = library.assets.find((a) => a.id === payload.assetId);
      if (!asset) return;
      const variant =
        asset.variants.find((v) => v.groupId === payload.groupId) ?? asset.variants[0];
      // Centre the asset on the cursor rather than starting its top-left there.
      placeAsset(asset, variant, at);
    },
    [library, placeAsset]
  );

  // -- inserting images -----------------------------------------------------

  /**
   * Read an image file into the document.
   *
   * The file is stored as a data URL rather than a path, so a saved figure
   * still renders after the original plot has been moved or renamed. Large
   * images make for large .morphly files, which is the right trade for a
   * figure that has to survive a submission cycle.
   */
  const addImageFromDataUrl = useCallback(
    (src, name, at) =>
      new Promise((resolve) => {
        // Pixel dimensions are read here rather than in the main process: the
        // renderer already has an image decoder, and the element needs the
        // natural size to work out a sensible starting scale.
        const probe = new window.Image();
        probe.onload = () => {
          addImage({
            src,
            naturalWidth: probe.naturalWidth || probe.width,
            naturalHeight: probe.naturalHeight || probe.height,
            name,
            at,
          });
          resolve();
        };
        probe.onerror = () => {
          flash(`${name} is not an image Morphly can read`);
          resolve();
        };
        probe.src = src;
      }),
    [addImage, flash]
  );

  const placeImageFile = useCallback(
    (file, at) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onerror = () => {
          flash(`Could not read ${file.name}`);
          resolve();
        };
        reader.onload = () =>
          addImageFromDataUrl(String(reader.result), file.name, at).then(resolve);
        reader.readAsDataURL(file);
      }),
    [addImageFromDataUrl, flash]
  );

  /** Files dragged onto the canvas from a file manager. */
  const handleDropFiles = useCallback(
    async (at, files) => {
      // Several files dropped at once are offset slightly so they do not land
      // exactly on top of each other.
      for (const [i, file] of files.entries()) {
        await placeImageFile(file, { x: at.x + i * 24, y: at.y + i * 24 });
      }
    },
    [placeImageFile]
  );

  /** Insert > Image, via the main process file picker. */
  const handleInsertImage = useCallback(async () => {
    const res = await window.morphly.importImage();
    if (res.canceled) return;
    if (!res.ok) {
      flash(`Could not import image: ${res.error}`);
      return;
    }
    for (const image of res.images) {
      await addImageFromDataUrl(image.dataUrl, image.name, null);
    }
  }, [addImageFromDataUrl, flash]);

  // -- fit to screen --------------------------------------------------------

  const fitToScreen = useCallback(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const { width, height } = wrap.getBoundingClientRect();
    const padding = 60;
    const scale = Math.min(
      (width - padding) / canvas.width,
      (height - padding) / canvas.height
    );
    const next = Math.min(4, Math.max(0.05, scale));
    setZoom(next);
    setStagePos({
      x: (width - canvas.width * next) / 2,
      y: (height - canvas.height * next) / 2,
    });
  }, [canvas.width, canvas.height, setZoom, setStagePos]);

  // Fit once on first paint and whenever the page size changes.
  useEffect(() => {
    const id = window.setTimeout(fitToScreen, 60);
    return () => window.clearTimeout(id);
  }, [canvas.width, canvas.height, fitToScreen]);

  // -- project file handling ------------------------------------------------

  const handleSave = useCallback(
    async (saveAs) => {
      const state = store.getState();
      const doc = {
        format: "morphly-figure",
        version: 1,
        canvas: state.canvas,
        elements: state.elements,
      };
      const res = await window.morphly.saveProject(
        JSON.stringify(doc, null, 2),
        saveAs ? null : state.projectPath
      );
      if (res.ok) {
        markSaved(res.filePath);
        flash(`Saved ${res.filePath.split(/[/\\]/).pop()}`);
      } else if (!res.canceled) {
        flash(`Save failed: ${res.error}`);
      }
    },
    [store, markSaved, flash]
  );

  const handleOpen = useCallback(async () => {
    const res = await window.morphly.openProject();
    if (res.canceled) return;
    if (!res.ok) {
      flash(`Open failed: ${res.error}`);
      return;
    }
    try {
      const doc = JSON.parse(res.json);
      loadDocument(doc, res.filePath);
      flash(`Opened ${res.filePath.split(/[/\\]/).pop()}`);
    } catch (err) {
      flash(`That file is not a Morphly figure (${err.message})`);
    }
  }, [loadDocument, flash]);

  const handleNew = useCallback(() => {
    if (store.getState().dirty && !window.confirm("Discard unsaved changes?")) return;
    newDocument();
  }, [store, newDocument]);

  // -- keyboard shortcuts ---------------------------------------------------

  useEffect(() => {
    const isTyping = (t) =>
      t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

    const onKeyDown = (e) => {
      const s = store.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (isTyping(e.target)) {
        if (e.key === "Escape") e.target.blur();
        return;
      }

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave(e.shiftKey);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpen();
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNew();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        s.duplicateSelected();
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        e.shiftKey ? s.ungroupSelected() : s.groupSelected();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        s.selectAll();
      } else if (mod && e.key === "0") {
        e.preventDefault();
        fitToScreen();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        s.deleteSelected();
      } else if (mod && e.key === "'") {
        e.preventDefault();
        s.toggleGrid();
      } else if (e.key === "F1") {
        e.preventDefault();
        setHelpTab("start");
      } else if (e.key === "Escape") {
        s.clearSelection();
        s.setTool("select");
      } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        if (s.selectedIds.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 20 : 2;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        s.nudgeSelected(dx, dy);
      } else if (!mod) {
        // Single-key tool switches, as in most editors.
        const map = { v: "select", r: "rect", o: "ellipse", l: "line", a: "arrow", t: "text" };
        const tool = map[e.key.toLowerCase()];
        if (tool) s.setTool(tool);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, handleSave, handleOpen, handleNew, fitToScreen]);

  // Menu items are dispatched here rather than acting in the main process, so
  // each command has exactly one implementation shared with its shortcut.
  useEffect(() => {
    const unsubscribe = window.morphly.onMenuAction((action) => {
      const s = store.getState();
      switch (action) {
        case "new": return handleNew();
        case "open": return handleOpen();
        case "save": return handleSave(false);
        case "saveAs": return handleSave(true);
        case "export": return setExportOpen(true);
        case "addLibrary": return addLibrary();
        case "insertTable": return setTableDialogOpen(true);
        case "insertImage": return handleInsertImage();
        case "toggleGrid": return s.toggleGrid();
        case "undo": return s.undo();
        case "redo": return s.redo();
        case "duplicate": return s.duplicateSelected();
        case "delete": return s.deleteSelected();
        case "selectAll": return s.selectAll();
        case "group": return s.groupSelected();
        case "ungroup": return s.ungroupSelected();
        case "zoomIn": return s.setZoom(s.zoom * 1.2);
        case "zoomOut": return s.setZoom(s.zoom / 1.2);
        case "fit": return fitToScreen();
        case "welcome": return setWelcomeOpen(true);
        case "help": return setHelpTab("start");
        case "help:licensing": return setHelpTab("licensing");
        case "help:shortcuts": return setHelpTab("shortcuts");
        case "help:about": return setHelpTab("about");
        default: return undefined;
      }
    });
    return unsubscribe;
  }, [store, handleNew, handleOpen, handleSave, fitToScreen, addLibrary, handleInsertImage]);

  // Warn before closing with unsaved work.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (store.getState().dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [store]);

  const editingElement = editing ? elements.find((el) => el.id === editing.id) ?? null : null;

  return (
    <div className="app">
      <Toolbar
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
        onExport={() => setExportOpen(true)}
        onFitToScreen={fitToScreen}
        onHelp={() => setHelpTab("start")}
        onInsertTable={() => setTableDialogOpen(true)}
        onInsertImage={handleInsertImage}
      />

      <div className="workspace">
        <AssetLibrary onPlaceAsset={(asset, variant) => placeAsset(asset, variant)} />

        <div className="canvas-wrap" ref={canvasWrapRef}>
          <CanvasStage
            stageRef={stageRef}
            onRequestTextEdit={(id, cell = null) => setEditing({ id, cell })}
            onExternalDrop={handleExternalDrop}
            onDropFiles={handleDropFiles}
          />

          {editingElement && (
            <TextEditorOverlay
              element={editingElement}
              cell={editing.cell}
              zoom={zoom}
              stagePos={stagePos}
              onClose={() => setEditing(null)}
            />
          )}
        </div>

        <div className="right-rail">
          <Inspector />
          <LayersPanel />
        </div>
      </div>

      {tableDialogOpen && (
        <TableDialog
          onClose={() => setTableDialogOpen(false)}
          onInsert={(options) => {
            addTable(options);
            setTableDialogOpen(false);
          }}
        />
      )}

      {exportOpen && <ExportDialog stageRef={stageRef} onClose={() => setExportOpen(false)} />}

      {helpTab && <HelpDialog initialTab={helpTab} onClose={() => setHelpTab(null)} />}

      {welcomeOpen && (
        <WelcomeDialog
          onClose={() => setWelcomeOpen(false)}
          onOpenHelp={() => {
            setWelcomeOpen(false);
            setHelpTab("licensing");
          }}
          onAddLibrary={async () => {
            const res = await addLibrary();
            if (res.ok) setWelcomeOpen(false);
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/**
 * Inline editing for text elements, shape captions and table cells.
 *
 * A textarea is overlaid on the canvas at the target's on-screen position and
 * scaled to match the zoom, so what you type looks like what you get. The three
 * cases differ only in which box they occupy and which field they write back
 * to, so they share one component rather than three near-identical ones.
 */
function TextEditorOverlay({ element, cell, zoom, stagePos, onClose }) {
  const updateElement = useStore((s) => s.updateElement);
  const setTableCell = useStore((s) => s.setTableCell);

  const isCell = element.type === "table" && cell;
  const isLabel = !isCell && element.type !== "text";
  const field = isLabel ? "label" : "text";

  const box = isCell ? cellBox(element, cell.row, cell.col) : null;
  const initial = isCell ? element.cells[cell.row]?.[cell.col] ?? "" : element[field] ?? "";

  const ref = useRef(null);
  const [value, setValue] = useState(initial);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commitText = () => {
    if (value !== initial) {
      if (isCell) setTableCell(element.id, cell.row, cell.col, value);
      else updateElement(element.id, { [field]: value });
    }
    onClose();
  };

  const fontSize =
    (isCell ? element.fontSize : isLabel ? element.labelSize ?? 16 : element.fontSize) * zoom;

  const isHeader = isCell && isHeaderCell(element, cell.row, cell.col);
  const pad = (element.padding ?? 6) * zoom;

  // The editor paints the cell's own colours over the cell, rather than a
  // neutral white box: a header cell has white text, which would be invisible
  // on a pale editor background.
  const cellFill = isCell ? (isHeader ? element.headerFill : element.fill) : null;
  // A textarea cannot centre its text vertically, so the first line is pushed
  // down to where Konva draws it.
  const cellPadTop = isCell
    ? Math.max(0, (box.height * zoom - element.fontSize * 1.2 * zoom) / 2)
    : 0;

  const style = isCell
    ? {
        left: stagePos.x + (element.x + box.x) * zoom + pad,
        top: stagePos.y + (element.y + box.y) * zoom,
        width: Math.max(10, box.width * zoom - pad * 2),
        height: box.height * zoom,
        paddingTop: cellPadTop,
        background: cellFill,
        fontSize,
        fontFamily: element.fontFamily,
        fontWeight: isHeader ? 700 : 400,
        lineHeight: 1.2,
        textAlign: element.align ?? "left",
        color: isHeader ? element.headerTextColor : element.textColor,
      }
    : {
        left: stagePos.x + element.x * zoom,
        top: stagePos.y + element.y * zoom,
        width: element.width * zoom,
        height: isLabel ? element.height * zoom : undefined,
        fontSize,
        fontFamily: isLabel ? element.labelFont ?? "Helvetica" : element.fontFamily,
        lineHeight: isLabel ? 1.2 : element.lineHeight ?? 1.25,
        textAlign: isLabel ? "center" : element.align,
        color: isLabel ? element.labelColor ?? "#ffffff" : element.fill,
      };

  return (
    <textarea
      ref={ref}
      className={`text-overlay${isLabel ? " label-overlay" : ""}${isCell ? " cell-overlay" : ""}`}
      value={value}
      placeholder={isLabel ? "Label" : ""}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commitText}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        // Enter commits a cell (a table cell is one line in practice); text
        // elements and captions keep Enter for a new line and commit on
        // Ctrl+Enter instead.
        if (e.key === "Enter" && (isCell || e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          commitText();
        }
        e.stopPropagation();
      }}
      style={style}
    />
  );
}
