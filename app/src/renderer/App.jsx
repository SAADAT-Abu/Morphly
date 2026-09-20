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
import PanelLayoutDialog from "./components/PanelLayoutDialog";
import ArtStore from "./components/ArtStore";
import GraphDialog from "./components/GraphDialog";
import DataDrawer, { datasetColours } from "./components/DataDrawer";
import DataPanel from "./components/DataPanel";
import { useStore } from "./store";
import { cellBox, isHeaderCell } from "./lib/tableLayout";
import { migrate, serialise, DocumentError } from "./lib/document";
import { watchForRecovery } from "./lib/recovery";
import { isPanel } from "./lib/panelLayout";
import { movableUnits, ALIGN_REFERENCES } from "./lib/align";

/** React's StrictMode runs effects twice in development; the recovery offer
 *  must only ever appear once per launch. */
let recoveryOffered = false;

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
  const [panelDialogOpen, setPanelDialogOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [graphDialogOpen, setGraphDialogOpen] = useState(false);
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
  const addPanelLayout = useStore((s) => s.addPanelLayout);
  const addTable = useStore((s) => s.addTable);
  const addGraph = useStore((s) => s.addGraph);
  const datasets = useStore((s) => s.datasets);
  const selectedIds = useStore((s) => s.selectedIds);
  const sidebarTab = useStore((s) => s.sidebarTab);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const dataPopped = useStore((s) => s.dataView.popped);
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

  // -- graphs ------------------------------------------------------------------

  /** The one selected panel, if a single panel is selected: a new graph can fill it. */
  const selectedPanel =
    selectedIds.length === 1 ? elements.find((el) => el.id === selectedIds[0] && isPanel(el)) ?? null : null;

  /** The area of a panel a graph fills: inside its edges, below its letter. */
  const panelBox = (panel) => {
    const letter = panel.panelLetterSize ?? 32;
    const pad = Math.round(Math.min(panel.width, panel.height) * 0.03);
    const top = Math.round(letter * 1.3);
    return {
      x: panel.x + pad,
      y: panel.y + top,
      width: Math.max(40, panel.width - 2 * pad),
      height: Math.max(40, panel.height - top - pad),
    };
  };

  const handleInsertGraph = useCallback(
    ({ dataset, datasetId, kind, place }) => {
      const box = place === "panel" && selectedPanel ? panelBox(selectedPanel) : null;
      addGraph({ dataset, datasetId, kind, box });
      setGraphDialogOpen(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addGraph, selectedPanel]
  );

  /** "Graph" in the Data tab: another graph of numbers already in the figure. */
  const graphFromDataset = useCallback(
    (datasetId) => {
      const ds = store.getState().datasets.find((d) => d.id === datasetId);
      if (!ds) return;
      addGraph({ datasetId, kind: ds.kind === "xy" ? "scatter" : "bar", box: selectedPanel ? panelBox(selectedPanel) : null });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, addGraph, selectedPanel]
  );

  /**
   * The data on show follows the selected graph, so what is typed in the
   * drawer (or in the data window) always belongs to the graph in front of
   * you. It never opens the drawer by itself: only what is already open
   * changes.
   */
  useEffect(() => {
    const s = store.getState();
    if (!s.dataView.open && !s.dataView.popped) return;
    if (selectedIds.length !== 1) return;
    const selected = elements.find((el) => el.id === selectedIds[0]);
    if (selected?.type === "plot" && selected.datasetId && selected.datasetId !== s.dataView.datasetId) {
      s.setDataView({ datasetId: selected.datasetId });
    }
  }, [selectedIds, elements, store]);

  /**
   * Keep the popped-out data window in step. It shows the dataset in the
   * drawer; each of its edits comes back here as an operation, is applied to
   * the store (so undo, autosave and the graph all see it), and the result
   * goes back to it, tagged with the number of the last edit applied.
   */
  useEffect(() => {
    const bridge = window.morphly.dataWindow;
    if (!bridge) return undefined;
    if (!dataPopped) {
      bridge.close();
      return undefined;
    }
    bridge.open();
    let seq = 0;
    const push = () => {
      const s = store.getState();
      const dataset = s.datasets.find((d) => d.id === s.dataView.datasetId) ?? null;
      bridge.push({ dataset, colours: dataset ? datasetColours(s.elements, dataset.id) : [], seq });
    };
    push();
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.datasets !== previous.datasets || state.dataView.datasetId !== previous.dataView.datasetId) push();
    });
    const offs = [
      bridge.onWantDataset(push),
      bridge.onOp(({ op, commit, seq: n }) => {
        seq = Math.max(seq, Number(n) || 0);
        const s = store.getState();
        if (op?.op === "__undo") s.undo();
        else if (op?.op === "__redo") s.redo();
        else if (s.dataView.datasetId) s.editDataset(s.dataView.datasetId, op, { commit: commit !== false });
        push();
      }),
      // Closed by the user: the data goes away. Put back: it returns to the drawer.
      bridge.onClosed(() => store.getState().setDataView({ popped: false, open: false })),
      bridge.onDocked(() => store.getState().setDataView({ popped: false, open: true })),
    ];
    return () => {
      unsubscribe();
      offs.forEach((off) => off());
    };
  }, [dataPopped, store]);

  // -- figure name, default folder and autosave -----------------------------

  const [fileSettings, setFileSettings] = useState({ autosave: true, saveFolder: null });
  useEffect(() => {
    window.morphly.fileSettings().then((res) => {
      if (res.ok) setFileSettings(res);
    });
  }, []);

  /** Renaming a saved figure renames its file; an unsaved one just changes name. */
  const handleRename = useCallback(
    async (title) => {
      const s = store.getState();
      if (!s.projectPath) {
        s.setTitle(title);
        return;
      }
      const res = await window.morphly.renameProject({ filePath: s.projectPath, title });
      if (res.ok) store.getState().setProjectPath(res.filePath);
      else flash(`Could not rename: ${res.error}`);
    },
    [store, flash]
  );

  /**
   * Autosave. A moment after the figure changes (and never more than ten
   * seconds behind while work carries on), it is written to its file, or
   * created in the default folder under its title. Edits made while a save is
   * under way are saved next time rather than lost or marked saved by mistake.
   */
  useEffect(() => {
    if (!fileSettings.autosave) return undefined;
    const QUIET_MS = 2000;
    const MAX_WAIT_MS = 10000;
    let timer = null;
    let firstPending = 0;
    let saving = false;
    let again = false;
    let lastError = null;

    const schedule = () => {
      const now = Date.now();
      if (!firstPending) firstPending = now;
      window.clearTimeout(timer);
      timer = window.setTimeout(run, Math.max(0, Math.min(QUIET_MS, MAX_WAIT_MS - (now - firstPending))));
    };

    const run = async () => {
      timer = null;
      const s = store.getState();
      if (!s.dirty) {
        firstPending = 0;
        return;
      }
      if (saving) {
        again = true;
        return;
      }
      saving = true;
      firstPending = 0;
      const taken = { elements: s.elements, canvas: s.canvas, pages: s.pages, activePageId: s.activePageId, datasets: s.datasets, title: s.title };
      const doc = serialise({ pages: s.allPages(), activePageId: s.activePageId, datasets: s.datasets });
      const res = await window.morphly.autosaveProject({
        json: JSON.stringify(doc, null, 2),
        filePath: s.projectPath,
        title: s.title,
      });
      saving = false;

      const now = store.getState();
      if (res.ok) {
        lastError = null;
        const unchanged = Object.keys(taken).every((key) => now[key] === taken[key]);
        if (unchanged) now.markSaved(res.filePath);
        else {
          now.setProjectPath(res.filePath);
          schedule();
        }
      } else if (res.error !== lastError) {
        lastError = res.error;
        flash(`Autosave failed: ${res.error}`);
      }
      if (again) {
        again = false;
        schedule();
      }
    };

    if (store.getState().dirty) schedule();
    const unsubscribe = store.subscribe((state, previous) => {
      if (!state.dirty) return;
      const changed =
        !previous.dirty ||
        state.elements !== previous.elements ||
        state.canvas !== previous.canvas ||
        state.pages !== previous.pages ||
        state.activePageId !== previous.activePageId ||
        state.datasets !== previous.datasets ||
        state.title !== previous.title;
      if (changed) schedule();
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [fileSettings.autosave, store, flash]);

  const handleChooseSaveFolder = useCallback(async () => {
    const res = await window.morphly.chooseSaveFolder();
    if (res.canceled) return;
    if (!res.ok) {
      flash(`Could not change the folder: ${res.error}`);
      return;
    }
    setFileSettings((current) => ({ ...current, saveFolder: res.saveFolder }));
    flash(`New figures and exports will be saved in ${res.saveFolder}`);
  }, [flash]);

  const handleSetAutosave = useCallback(
    async (enabled) => {
      const res = await window.morphly.setAutosave(enabled);
      if (res.ok) {
        setFileSettings((current) => ({ ...current, autosave: res.autosave }));
        flash(res.autosave ? "Autosave is on" : "Autosave is off: save with Ctrl+S");
      }
    },
    [flash]
  );

  // -- clipboard ------------------------------------------------------------

  /**
   * The clipboard is Morphly's own, so copied elements keep everything they
   * are (groups, glue, recolouring), and it survives switching pages. A token
   * is also put on the system clipboard: if something else has been copied
   * since, in any program, the token is gone and that newer thing is pasted
   * instead when Morphly can use it (a picture, or SVG markup).
   */
  const clipboardToken = useRef(null);

  const handleCopy = useCallback(
    (cut) => {
      const s = store.getState();
      if (s.selectedIds.length === 0) return;
      if (cut) s.cutSelected();
      else s.copySelected();
      const token = `morphly-clipboard:${Date.now().toString(36)}`;
      clipboardToken.current = token;
      window.morphly.writeClipboardText(token);
    },
    [store]
  );

  const handlePaste = useCallback(
    async ({ inPlace = false, at = null } = {}) => {
      const s = store.getState();
      let system = { text: "", image: null };
      try {
        const res = await window.morphly.readClipboard();
        if (res.ok) system = res;
      } catch {
        /* an unreadable system clipboard just means Morphly's own is used */
      }

      if (system.text !== clipboardToken.current || !s.clipboard?.length) {
        if (system.image) {
          await addImageFromDataUrl(system.image, "Pasted image", at);
          return;
        }
        const text = (system.text ?? "").trim();
        if (/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[\s\S]*?>\s*)?<svg\b/i.test(text)) {
          const res = await window.morphly.prepareSvg(text);
          if (res.ok) placeSvgArtwork(res, "Pasted SVG", at);
          else flash(`Could not paste the SVG: ${res.error}`);
          return;
        }
      }
      if (s.clipboard?.length) s.pasteClipboard({ inPlace, at });
    },
    [store, addImageFromDataUrl, placeSvgArtwork, flash]
  );

  // -- right-click menu -----------------------------------------------------

  /** Where the last right-click landed, for "Paste here". */
  const contextPointRef = useRef(null);

  const handleCanvasContextMenu = useCallback(
    (at, onObject) => {
      contextPointRef.current = at;
      const s = store.getState();
      const selected = s.elements.filter((el) => s.selectedIds.includes(el.id));
      const separator = { type: "separator" };

      if (s.partEdit) {
        const el = selected[0];
        const keys = s.partEdit.selected;
        const edits = el?.partEdits ?? {};
        window.morphly.showContextMenu([
          { label: "Hide", accelerator: "Delete", action: "parts:hide", enabled: keys.length > 0 },
          { label: "Show", action: "parts:show", enabled: keys.some((k) => edits[k]?.hidden) },
          { label: "Reset", action: "parts:reset", enabled: keys.some((k) => edits[k]) },
          { label: "Reset all parts", action: "parts:resetAll", enabled: Object.keys(edits).length > 0 },
          separator,
          { label: "Open group", action: "parts:open", enabled: keys.length === 1 },
          { label: "Up one level", action: "parts:up" },
          { label: "Done editing parts", action: "parts:done" },
        ]);
        return;
      }

      if (!onObject || selected.length === 0) {
        window.morphly.showContextMenu([
          { label: "Paste here", accelerator: "CmdOrCtrl+V", action: "pasteHere" },
          { label: "Paste in place", accelerator: "CmdOrCtrl+Shift+V", action: "pasteInPlace" },
          { label: "Select all", accelerator: "CmdOrCtrl+A", action: "selectAll" },
          separator,
          { label: "Show grid", checked: s.grid.visible, action: "toggleGrid" },
          { label: "Snap to guides", checked: s.snapping, action: "toggleSnapping" },
          { label: "Fit to screen", accelerator: "CmdOrCtrl+0", action: "fit" },
        ]);
        return;
      }

      const units = movableUnits(s.elements, s.selectedIds).length;
      const spread = units >= (s.alignTo === "page" || s.alignTo === "panel" ? 2 : 3);
      const reference = ALIGN_REFERENCES.find(([value]) => value === s.alignTo)?.[1] ?? "Selection";
      const allLocked = selected.every((el) => el.locked);

      window.morphly.showContextMenu([
        { label: "Cut", accelerator: "CmdOrCtrl+X", action: "cut" },
        { label: "Copy", accelerator: "CmdOrCtrl+C", action: "copy" },
        { label: "Paste", accelerator: "CmdOrCtrl+V", action: "paste" },
        { label: "Paste in place", accelerator: "CmdOrCtrl+Shift+V", action: "pasteInPlace" },
        { label: "Duplicate", accelerator: "CmdOrCtrl+D", action: "duplicate" },
        { label: "Delete", accelerator: "Delete", action: "delete" },
        separator,
        {
          label: "Edit parts",
          action: "parts:edit",
          enabled: selected.length === 1 && selected[0].type === "asset" && !selected[0].locked,
        },
        separator,
        { label: "Group", accelerator: "CmdOrCtrl+G", action: "group", enabled: selected.length >= 2 },
        { label: "Ungroup", accelerator: "CmdOrCtrl+Shift+G", action: "ungroup", enabled: selected.some((el) => el.groupId) },
        separator,
        {
          label: `Align to ${reference.toLowerCase()}`,
          submenu: [
            { label: "Align left", action: "align:left", enabled: units > 0 },
            { label: "Centre horizontally", action: "align:hcenter", enabled: units > 0 },
            { label: "Align right", action: "align:right", enabled: units > 0 },
            separator,
            { label: "Align top", action: "align:top", enabled: units > 0 },
            { label: "Centre vertically", action: "align:vcenter", enabled: units > 0 },
            { label: "Align bottom", action: "align:bottom", enabled: units > 0 },
            separator,
            { label: "Distribute horizontally", action: "distribute:h-gaps", enabled: spread },
            { label: "Distribute vertically", action: "distribute:v-gaps", enabled: spread },
          ],
        },
        {
          label: "Order",
          submenu: [
            { label: "Bring to front", accelerator: "CmdOrCtrl+Shift+]", action: "order:front" },
            { label: "Bring forward", accelerator: "CmdOrCtrl+]", action: "order:forward" },
            { label: "Send backward", accelerator: "CmdOrCtrl+[", action: "order:backward" },
            { label: "Send to back", accelerator: "CmdOrCtrl+Shift+[", action: "order:back" },
          ],
        },
        separator,
        allLocked ? { label: "Unlock", action: "unlock" } : { label: "Lock", action: "lock" },
      ]);
    },
    [store]
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
      // Always written at the current format version; lib/document.js is the
      // one place that knows what that is.
      const doc = serialise({ pages: state.allPages(), activePageId: state.activePageId, datasets: state.datasets });
      const res = await window.morphly.saveProject(
        JSON.stringify(doc, null, 2),
        saveAs ? null : state.projectPath,
        state.title
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

      // Editing parts of an illustration: keys act on the parts, and commands
      // for whole elements wait until editing is done.
      if (s.partEdit) {
        const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (e.key === "Escape") {
          e.preventDefault();
          s.partEditBack();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          s.hideSelectedParts();
        } else if (arrows[e.key]) {
          e.preventDefault();
          const step = e.shiftKey ? 20 : 2;
          s.nudgeParts(arrows[e.key][0] * step, arrows[e.key][1] * step);
        } else if (mod && e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.shiftKey ? s.redo() : s.undo();
        } else if (mod && e.key.toLowerCase() === "y") {
          e.preventDefault();
          s.redo();
        } else if (mod && e.key.toLowerCase() === "s") {
          e.preventDefault();
          handleSave(e.shiftKey);
        }
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
      } else if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) {
        // With nothing selected, leave the keys alone.
        if (s.selectedIds.length === 0) return;
        e.preventDefault();
        handleCopy(e.key.toLowerCase() === "x");
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        handlePaste({ inPlace: e.shiftKey });
      } else if (mod && (e.code === "BracketRight" || e.code === "BracketLeft")) {
        // By key position, so Shift (which turns ] into } on many layouts) still works.
        e.preventDefault();
        const up = e.code === "BracketRight";
        s.reorderSelected(e.shiftKey ? (up ? "front" : "back") : up ? "forward" : "backward");
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
        if (e.key.toLowerCase() === "a") {
          // A draws an arrow: the line tool with a head, remembered for next time.
          s.setLineStyle({ startHead: "none", endHead: "triangle" }, []);
          s.setTool("line");
          return;
        }
        const map = { v: "select", r: "rect", o: "ellipse", l: "line", t: "text" };
        const tool = map[e.key.toLowerCase()];
        if (tool) s.setTool(tool);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, handleSave, handleOpen, handleNew, fitToScreen, handleCopy, handlePaste]);

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
        case "insertGraph": return setGraphDialogOpen(true);
        case "insertPanels": return setPanelDialogOpen(true);
        case "toggleSnapping": return s.toggleSnapping();
        case "align:left": case "align:hcenter": case "align:right":
        case "align:top": case "align:vcenter": case "align:bottom":
          return s.alignSelected(action.slice("align:".length));
        case "distribute:h-gaps": case "distribute:v-gaps":
          return s.distributeSelected(action.slice("distribute:".length));
        case "insertImage": return handleInsertImage();
        case "toggleGrid": return s.toggleGrid();
        case "undo": return s.undo();
        case "redo": return s.redo();
        case "copy": return handleCopy(false);
        case "cut": return handleCopy(true);
        case "paste": return handlePaste();
        case "pasteInPlace": return handlePaste({ inPlace: true });
        case "pasteHere": return handlePaste({ at: contextPointRef.current });
        case "order:front": case "order:forward": case "order:backward": case "order:back":
          return s.reorderSelected(action.slice("order:".length));
        case "chooseSaveFolder": return handleChooseSaveFolder();
        case "autosave:true": return handleSetAutosave(true);
        case "autosave:false": return handleSetAutosave(false);
        case "parts:edit": return s.enterPartEdit(s.selectedIds[0]);
        case "parts:hide": return s.hideSelectedParts();
        case "parts:show": return s.partEdit && s.updateParts(s.partEdit.selected, { hidden: false });
        case "parts:reset": return s.partEdit && s.resetParts(s.partEdit.selected);
        case "parts:resetAll": return s.resetParts(null);
        case "parts:open": return s.partEdit && s.openPartGroup(s.partEdit.selected[0]);
        case "parts:up": return s.partEditUp();
        case "parts:done": return s.exitPartEdit();
        case "lock": return s.setSelectedLocked(true);
        case "unlock": return s.setSelectedLocked(false);
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
  }, [store, handleNew, handleOpen, handleSave, fitToScreen, addLibrary, handleInsertImage, runUpdateCheck, handleCopy, handlePaste, handleChooseSaveFolder, handleSetAutosave]);


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

  // The canvas is captured as it looks for PNG export, so part editing (with
  // its tints and outlines) ends before the export dialog opens.
  useEffect(() => {
    if (exportOpen) store.getState().exitPartEdit();
  }, [exportOpen, store]);

  // Crash recovery. While there are unsaved changes a spare copy is kept in
  // Morphly's data folder (never in the user's file); lib/recovery.js decides
  // when. A copy still there at launch means Morphly stopped without closing.
  useEffect(() => watchForRecovery(store, window.morphly), [store]);

  useEffect(() => {
    if (recoveryOffered) return;
    recoveryOffered = true;
    (async () => {
      const res = await window.morphly.checkRecovery();
      if (!res.ok || !res.found) return;
      try {
        loadDocument(migrate(res.snapshot.document), res.snapshot.projectPath ?? null);
        if (!res.snapshot.projectPath && res.snapshot.title) store.setState({ title: res.snapshot.title });
        // The restored work is in no file yet, so it is unsaved: the close
        // prompt protects it and copies carry on as before.
        store.setState({ dirty: true });
        flash("Restored your figure. Save it to keep it.");
      } catch (err) {
        // The copy stays where it is, so nothing is lost by a failed restore.
        flash(`Could not restore your figure: ${err.message}`);
      }
    })();
  }, [store, loadDocument, flash]);

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
        onInsertPanels={() => setPanelDialogOpen(true)}
        onRename={handleRename}
        autosave={fileSettings.autosave}
        onInsertImage={handleInsertImage}
        onInsertGraph={() => setGraphDialogOpen(true)}
      />

      <div className="workspace">
        <div className="sidebar">
          <div className="sidebar-tabs" role="tablist" aria-label="Sidebar">
            <button
              role="tab"
              aria-selected={sidebarTab === "illustrations"}
              className={sidebarTab === "illustrations" ? "active" : undefined}
              onClick={() => setSidebarTab("illustrations")}
            >
              Illustrations
            </button>
            <button
              role="tab"
              aria-selected={sidebarTab === "data"}
              className={sidebarTab === "data" ? "active" : undefined}
              onClick={() => setSidebarTab("data")}
            >
              Data{datasets.length ? ` (${datasets.length})` : ""}
            </button>
          </div>
          {/* The library stays mounted while hidden, so its search and scroll survive a tab switch. */}
          <div className="sidebar-pane" hidden={sidebarTab !== "illustrations"}>
            <AssetLibrary
              onPlaceAsset={(asset, variant) => placeAsset(asset, variant)}
              onOpenStore={() => setStoreOpen(true)}
              onNotice={flash}
            />
          </div>
          {sidebarTab === "data" && (
            <div className="sidebar-pane">
              <DataPanel onGraph={graphFromDataset} flash={flash} />
            </div>
          )}
        </div>

        <div className="canvas-column">
          <PageTabs />

          <div className="canvas-wrap" ref={canvasWrapRef}>
          <CanvasStage
            stageRef={stageRef}
            onRequestTextEdit={(id, cell = null) => setEditing({ id, cell })}
            onExternalDrop={handleExternalDrop}
            onDropFiles={handleDropFiles}
            onContextMenu={handleCanvasContextMenu}
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
          <DataDrawer />
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

      {panelDialogOpen && (
        <PanelLayoutDialog
          canvas={canvas}
          hasPanels={elements.some(isPanel)}
          onClose={() => setPanelDialogOpen(false)}
          onInsert={(options) => {
            addPanelLayout(options);
            setPanelDialogOpen(false);
          }}
        />
      )}
      {graphDialogOpen && (
        <GraphDialog
          datasets={datasets}
          panelLabel={selectedPanel ? selectedPanel.panelLabel || "" : null}
          onClose={() => setGraphDialogOpen(false)}
          onInsert={handleInsertGraph}
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
