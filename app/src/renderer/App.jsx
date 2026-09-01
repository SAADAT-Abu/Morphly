import React, { useCallback, useEffect, useRef, useState } from "react";

import Toolbar from "./components/Toolbar";
import AssetLibrary from "./components/AssetLibrary";
import CanvasStage from "./components/CanvasStage";
import Inspector from "./components/Inspector";
import LayersPanel from "./components/LayersPanel";
import ExportDialog from "./components/ExportDialog";
import HelpDialog from "./components/HelpDialog";
import WelcomeDialog from "./components/WelcomeDialog";
import { useStore } from "./store";

export default function App() {
  const stageRef = useRef(null);
  const canvasWrapRef = useRef(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [toast, setToast] = useState(null);
  /** null when closed, otherwise the tab to open Help on. */
  const [helpTab, setHelpTab] = useState(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const store = useStore;
  const elements = useStore((s) => s.elements);
  const canvas = useStore((s) => s.canvas);
  const zoom = useStore((s) => s.zoom);
  const stagePos = useStore((s) => s.stagePos);
  const library = useStore((s) => s.library);

  const addAsset = useStore((s) => s.addAsset);
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
  }, [store, handleNew, handleOpen, handleSave, fitToScreen, addLibrary]);

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

  const editingElement = elements.find((el) => el.id === editingId) ?? null;

  return (
    <div className="app">
      <Toolbar
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
        onExport={() => setExportOpen(true)}
        onFitToScreen={fitToScreen}
        onHelp={() => setHelpTab("start")}
      />

      <div className="workspace">
        <AssetLibrary onPlaceAsset={(asset, variant) => placeAsset(asset, variant)} />

        <div className="canvas-wrap" ref={canvasWrapRef}>
          <CanvasStage
            stageRef={stageRef}
            onRequestTextEdit={setEditingId}
            onExternalDrop={handleExternalDrop}
          />

          {editingElement && (
            <TextEditorOverlay
              element={editingElement}
              zoom={zoom}
              stagePos={stagePos}
              onClose={() => setEditingId(null)}
            />
          )}
        </div>

        <div className="right-rail">
          <Inspector />
          <LayersPanel />
        </div>
      </div>

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
 * Inline editing for both text elements and shape captions.
 *
 * A textarea is overlaid on the canvas at the element's on-screen position and
 * scaled to match the zoom, so what you type looks like what you get. Shape
 * captions are centred inside the shape, matching how they are drawn.
 */
function TextEditorOverlay({ element, zoom, stagePos, onClose }) {
  const updateElement = useStore((s) => s.updateElement);
  const isLabel = element.type !== "text";
  const field = isLabel ? "label" : "text";

  const ref = useRef(null);
  const [value, setValue] = useState(element[field] ?? "");

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commitText = () => {
    if (value !== (element[field] ?? "")) updateElement(element.id, { [field]: value });
    onClose();
  };

  const fontSize = (isLabel ? element.labelSize ?? 16 : element.fontSize) * zoom;

  return (
    <textarea
      ref={ref}
      className={`text-overlay${isLabel ? " label-overlay" : ""}`}
      value={value}
      placeholder={isLabel ? "Label" : ""}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commitText}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitText();
        e.stopPropagation();
      }}
      style={{
        left: stagePos.x + element.x * zoom,
        top: stagePos.y + element.y * zoom,
        width: element.width * zoom,
        height: isLabel ? element.height * zoom : undefined,
        fontSize,
        fontFamily: isLabel ? element.labelFont ?? "Helvetica" : element.fontFamily,
        lineHeight: isLabel ? 1.2 : element.lineHeight ?? 1.25,
        textAlign: isLabel ? "center" : element.align,
        color: isLabel ? element.labelColor ?? "#ffffff" : element.fill,
      }}
    />
  );
}
