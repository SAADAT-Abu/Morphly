import React, { useCallback, useEffect, useRef, useState } from "react";

import Toolbar from "./components/Toolbar";
import AssetLibrary from "./components/AssetLibrary";
import CanvasStage from "./components/CanvasStage";
import Inspector from "./components/Inspector";
import LayersPanel from "./components/LayersPanel";
import PageTabs from "./components/PageTabs";
import ExportDialog from "./components/ExportDialog";
import HelpDialog from "./components/HelpDialog";
import WelcomeDialog from "./components/WelcomeDialog";
import TableDialog from "./components/TableDialog";
import ArtStore from "./components/ArtStore";
import { useStore } from "./store";
import { cellBox, isHeaderCell } from "./lib/tableLayout";
import { migrate, serialise, DocumentError } from "./lib/document";

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
  const [storeOpen, setStoreOpen] = useState(false);
  /** { latest, url } when Zenodo has a newer release than this build. */
  const [update, setUpdate] = useState(null);

  const store = useStore;
  const elements = useStore((s) => s.elements);
  const canvas = useStore((s) => s.canvas);
  const zoom = useStore((s) => s.zoom);
  const stagePos = useStore((s) => s.stagePos);
  const library = useStore((s) => s.library);

  const addAsset = useStore((s) => s.addAsset);
  const addImage = useStore((s) => s.addImage);
  const addSvgArtwork = useStore((s) => s.addSvgArtwork);
  const addTable = useStore((s) => s.addTable);
  const setZoom = useStore((s) => s.setZoom);
  const setStagePos = useStore((s) => s.setStagePos);
  const loadDocument = useStore((s) => s.loadDocument);
  const addLibrary = useStore((s) => s.addLibrary);
  const setLibrary = useStore((s) => s.setLibrary);
  const setLibraryError = useStore((s) => s.setLibraryError);
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

  // -- update check ---------------------------------------------------------

  /**
   * Ask whether a newer Morphly exists.
   *
   * Silent by design: offline is the normal state for this app, and a failed
   * check is not something to interrupt anyone over. Only a genuinely newer
   * version produces a banner, and only a manual check reports "up to date".
   */
  const runUpdateCheck = useCallback(
    async ({ force = false } = {}) => {
      try {
        const res = await window.morphly.checkForUpdate({ force });
        if (res.available) {
          setUpdate({ latest: res.latest, current: res.current, url: res.url });
        } else if (force) {
          if (res.ok && res.latest) flash(`Morphly ${res.current} is up to date.`);
          else if (res.skipped === "disabled") flash("Update checks are switched off.");
          else flash("Could not reach Zenodo to check for updates.");
        }
      } catch {
        /* never let a version check break the editor */
      }
    },
    [flash]
  );

  useEffect(() => {
    // A moment after launch, so it never competes with loading the library.
    const id = window.setTimeout(() => runUpdateCheck(), 4000);
    return () => window.clearTimeout(id);
  }, [runUpdateCheck]);

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

  /** Place an SVG that has been through the main process checks, and say what
   *  happened to it when that is worth knowing. */
  const placeSvgArtwork = useCallback(
    (prepared, fileName, at) => {
      addSvgArtwork({ svgSource: prepared.svg, name: fileName.replace(/\.svg$/i, ""), at });
      const count = (n) => n.toLocaleString("en-US");
      if (prepared.heavy) {
        flash(`${fileName} has ${count(prepared.drawn)} shapes, so recolouring it may be slow`);
      } else if (prepared.drawn < prepared.marks) {
        flash(`${fileName}: combined ${count(prepared.marks)} shapes into ${count(prepared.drawn)}`);
      }
    },
    [addSvgArtwork, flash]
  );

  const placeSvgFile = useCallback(
    async (file, at) => {
      if (file.size > 100 * 1024 * 1024) {
        flash(`Could not import ${file.name}: the file is larger than 100 MB`);
        return;
      }
      const res = await window.morphly.prepareSvg(await file.text());
      if (!res.ok) {
        flash(`Could not import ${file.name}: ${res.error}`);
        return;
      }
      placeSvgArtwork(res, file.name, at);
    },
    [placeSvgArtwork, flash]
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
        const spot = { x: at.x + i * 24, y: at.y + i * 24 };
        const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
        await (isSvg ? placeSvgFile(file, spot) : placeImageFile(file, spot));
      }
    },
    [placeImageFile, placeSvgFile]
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
      if (image.error) flash(`Could not import ${image.name}: ${image.error}`);
      else if (image.kind === "svg") placeSvgArtwork(image, image.name, null);
      else await addImageFromDataUrl(image.dataUrl, image.name, null);
    }
  }, [addImageFromDataUrl, placeSvgArtwork, flash]);

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
      // Always written at the current format version; lib/document.js is the
      // one place that knows what that is.
      const doc = serialise({ pages: state.allPages(), activePageId: state.activePageId });
      const res = await window.morphly.saveProject(
        JSON.stringify(doc, null, 2),
        saveAs ? null : state.projectPath
      );
      if (res.ok) {
        markSaved(res.filePath);
        flash(`Saved ${res.filePath.split(/[/\\]/).pop()}`);
        return true;
      }
      if (!res.canceled) flash(`Save failed: ${res.error}`);
      return false;
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
      // Older figures are brought up to date in memory; the file on disk is
      // only rewritten if the user saves.
      const doc = migrate(JSON.parse(res.json));
      loadDocument(doc, res.filePath);
      flash(`Opened ${res.filePath.split(/[/\\]/).pop()}`);
    } catch (err) {
      flash(
        err instanceof DocumentError
          ? err.message
          : `That file is not a Morphly figure (${err.message})`
      );
    }
  }, [loadDocument, flash]);

  const handleNew = useCallback(async () => {
    // The prompt is a main-process dialog, not window.confirm. Chromium's own
    // dialogs block the renderer until they are answered, and in this window
    // one comes up invisible: the app then looks alive but ignores every
    // click, which is indistinguishable from a hang.
    if (store.getState().dirty) {
      const res = await window.morphly.confirmDiscard();
      if (!res.discard) return;
    }
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
      } else if (mod && (e.key === "PageDown" || e.key === "PageUp")) {
        e.preventDefault();
        s.stepPage(e.key === "PageDown" ? 1 : -1);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        fitToScreen();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        s.deleteSelected();
      } else if (mod && e.key === "'") {
        e.preventDefault();
        s.toggleGrid();
      } else if (e.key === "F2") {
        e.preventDefault();
        s.requestRename();
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
        case "saveAndClose":
          // Only close once the file is actually written: a cancelled save
          // dialog should leave the window open, not lose the figure.
          return handleSave(false).then((saved) => {
            if (saved) window.morphly.closeWindow();
          });
        case "export": return setExportOpen(true);
        case "addLibrary": return addLibrary();
        case "artStore": return setStoreOpen(true);
        case "pageNew": return s.addPage();
        case "pageDuplicate": return s.duplicatePage();
        case "pageRename": return s.requestRename();
        case "checkUpdates": return runUpdateCheck({ force: true });
        case "pageNext": return s.stepPage(1);
        case "pagePrev": return s.stepPage(-1);
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
  }, [store, handleNew, handleOpen, handleSave, fitToScreen, addLibrary, handleInsertImage, runUpdateCheck]);


  // Unsaved-changes guard.
  //
  // The main process owns the prompt, because a renderer `beforeunload` cannot
  // show one in Electron: returning a value from it cancels the close outright,
  // which left the window refusing to close with no explanation. Here the
  // renderer only mirrors the dirty flag and does the saving when asked.
  useEffect(() => {
    window.morphly.setDirty(store.getState().dirty);
    return store.subscribe((state, previous) => {
      if (state.dirty !== previous.dirty) window.morphly.setDirty(state.dirty);
    });
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
        <AssetLibrary
          onPlaceAsset={(asset, variant) => placeAsset(asset, variant)}
          onOpenStore={() => setStoreOpen(true)}
          onNotice={flash}
        />

        <div className="canvas-column">
          <PageTabs />

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
        </div>

        <div className="right-rail">
          <Inspector />
          <LayersPanel />
        </div>
      </div>

      {storeOpen && (
        <ArtStore
          onClose={() => setStoreOpen(false)}
          onLibraryChange={(library) =>
            library ? setLibrary(library) : setLibraryError("no-library-configured")
          }
          flash={flash}
        />
      )}

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
      {update && (
        <div className="update-banner">
          <span>
            Morphly <strong>{update.latest}</strong> is available. You are running{" "}
            {update.current}.
          </span>
          <button className="primary small" onClick={() => window.morphly.openExternal(update.url)}>
            Open download page
          </button>
          <button className="ghost small" onClick={() => setUpdate(null)}>
            Dismiss
          </button>
        </div>
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
