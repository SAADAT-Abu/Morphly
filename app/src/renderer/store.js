/**
 * Morphly's editor state, in one Zustand store.
 *
 * Kept deliberately flat and explicit: elements are plain objects in a single
 * array, ordered back-to-front (index 0 renders first, so later items sit on
 * top). Undo/redo snapshots that array wholesale. At the scale of a scientific
 * figure -- tens of elements, not thousands -- snapshotting is far simpler to
 * reason about than a patch/diff system, and fast enough to be invisible.
 */

import { create } from "zustand";
import { extractPalette, parseViewBox } from "./lib/svgPalette";

let idCounter = 0;
const nextId = () => `el_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/** Figure presets, in pixels at 300 dpi-ish working scale. Journal single- and
 *  double-column widths are the two sizes scientific figures are actually
 *  submitted at, so they are the defaults rather than slide sizes. */
export const CANVAS_PRESETS = [
  { name: "Single column (85 mm)", width: 1004, height: 750 },
  { name: "Double column (180 mm)", width: 2126, height: 1400 },
  { name: "Slide 16:9", width: 1920, height: 1080 },
  { name: "Poster A0 (portrait)", width: 2384, height: 3370 },
  { name: "Square", width: 1200, height: 1200 },
];

const DEFAULT_CANVAS = { ...CANVAS_PRESETS[1], background: "#ffffff" };

/** Fields that make up a saved document -- everything else is view state. */
const documentSlice = (state) => ({
  elements: state.elements,
  canvas: state.canvas,
});

export const useStore = create((set, get) => ({
  // -- document ------------------------------------------------------------
  elements: [],
  canvas: { ...DEFAULT_CANVAS },

  // -- view state (never saved, never undone) ------------------------------
  selectedIds: [],
  zoom: 0.4,
  stagePos: { x: 0, y: 0 },
  activeTool: "select",
  library: null,
  libraryError: null,
  projectPath: null,
  dirty: false,

  // -- history -------------------------------------------------------------
  past: [],
  future: [],

  /**
   * Snapshot the current document before a change. Every mutating action calls
   * this first, which is the whole undo system.
   */
  commit: () => {
    const { past } = get();
    set({
      past: [...past.slice(-99), documentSlice(get())],
      future: [],
      dirty: true,
    });
  },

  undo: () => {
    const { past, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      ...previous,
      past: past.slice(0, -1),
      future: [documentSlice(get()), ...future],
      selectedIds: get().selectedIds.filter((id) =>
        previous.elements.some((el) => el.id === id)
      ),
      dirty: true,
    });
  },

  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      ...next,
      past: [...past, documentSlice(get())],
      future: future.slice(1),
      dirty: true,
    });
  },

  // -- selection -----------------------------------------------------------
  setSelection: (ids) => set({ selectedIds: ids }),
  toggleSelection: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  selectAll: () =>
    set((s) => ({ selectedIds: s.elements.filter((e) => !e.locked && e.visible).map((e) => e.id) })),
  clearSelection: () => set({ selectedIds: [] }),

  setTool: (activeTool) => set({ activeTool }),
  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.05, zoom)) }),
  setStagePos: (stagePos) => set({ stagePos }),

  // -- element creation ----------------------------------------------------

  /** Shared defaults every element carries. */
  _base(partial) {
    return {
      id: nextId(),
      name: partial.name ?? "Element",
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      ...partial,
    };
  },

  addShape: (type, at) => {
    const { canvas } = get();
    const size = Math.min(canvas.width, canvas.height) * 0.18;
    const x = at?.x ?? canvas.width / 2 - size / 2;
    const y = at?.y ?? canvas.height / 2 - size / 2;

    const common = {
      type,
      x,
      y,
      fill: "#4d7fd6",
      stroke: "#1f3a63",
      strokeWidth: 2,
    };

    let element;
    if (type === "rect") {
      element = get()._base({ ...common, name: "Rectangle", width: size, height: size * 0.7, cornerRadius: 0 });
    } else if (type === "ellipse") {
      element = get()._base({ ...common, name: "Ellipse", width: size, height: size });
    } else if (type === "triangle") {
      element = get()._base({ ...common, name: "Triangle", width: size, height: size });
    } else if (type === "line" || type === "arrow") {
      element = get()._base({
        ...common,
        name: type === "arrow" ? "Arrow" : "Line",
        fill: "#1f3a63",
        strokeWidth: 4,
        // points are relative to the element's x/y origin
        points: [0, 0, size, 0],
      });
    } else {
      return;
    }

    get().commit();
    set((s) => ({ elements: [...s.elements, element], selectedIds: [element.id], activeTool: "select" }));
    return element.id;
  },

  addText: (at, text = "Double-click to edit") => {
    const { canvas } = get();
    const element = get()._base({
      type: "text",
      name: "Text",
      text,
      x: at?.x ?? canvas.width / 2 - 200,
      y: at?.y ?? canvas.height / 2 - 30,
      width: 400,
      fontSize: Math.round(canvas.height * 0.035),
      fontFamily: "Helvetica",
      fontStyle: "normal",
      align: "left",
      fill: "#111111",
      lineHeight: 1.25,
    });
    get().commit();
    set((s) => ({ elements: [...s.elements, element], selectedIds: [element.id], activeTool: "select" }));
    return element.id;
  },

  /**
   * Place a BioArt asset. `svgSource` is the untouched file text; recolouring
   * is stored separately as `colorMap` so the original is always recoverable
   * and the user can reset any swatch.
   */
  addAsset: ({ asset, variant, svgSource, at }) => {
    const { canvas } = get();
    const box = parseViewBox(svgSource);
    // Scale so a placed asset occupies a sensible fraction of the canvas
    // regardless of its native viewBox units.
    const target = Math.min(canvas.width, canvas.height) * 0.28;
    const scale = target / Math.max(box.width, box.height);
    const width = box.width * scale;
    const height = box.height * scale;

    const element = get()._base({
      type: "asset",
      name: variant.caption || asset.title,
      // `at` is the point to centre on (the cursor, for a drop); with no
      // point given the asset lands in the middle of the page.
      x: (at?.x ?? canvas.width / 2) - width / 2,
      y: (at?.y ?? canvas.height / 2) - height / 2,
      width,
      height,
      svgSource,
      colorMap: {},
      palette: extractPalette(svgSource),
      assetId: asset.id,
      variantGroupId: variant.groupId,
      svgPath: variant.svgPath,
      source: asset.source,
      // Attribution details are copied onto the element rather than looked up
      // later, so a saved figure still knows what it owes even if the library
      // folder is unmounted or moved.
      collection: asset.collection,
      creator: asset.creator,
      citation: asset.citation,
      license: asset.license,
      licenseUrl: asset.licenseUrl,
      requiresAttribution: asset.requiresAttribution,
      shareAlike: asset.shareAlike,
      sourcePage: asset.sourcePage,
    });

    get().commit();
    set((s) => ({ elements: [...s.elements, element], selectedIds: [element.id] }));
    return element.id;
  },

  // -- element mutation ----------------------------------------------------

  /** Live drags call this with commit=false to avoid flooding the undo stack;
   *  the final drop calls it once with commit=true. */
  updateElement: (id, patch, { commit = true } = {}) => {
    if (commit) get().commit();
    set((s) => ({
      elements: s.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)),
      dirty: true,
    }));
  },

  updateSelected: (patch) => {
    const { selectedIds } = get();
    if (selectedIds.length === 0) return;
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => (selectedIds.includes(el.id) ? { ...el, ...patch } : el)),
      dirty: true,
    }));
  },

  /** Recolour one swatch of one asset element. */
  setAssetColor: (id, fromHex, toHexValue) => {
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => {
        if (el.id !== id || el.type !== "asset") return el;
        const colorMap = { ...el.colorMap };
        if (!toHexValue || toHexValue === fromHex) delete colorMap[fromHex];
        else colorMap[fromHex] = toHexValue;
        return { ...el, colorMap };
      }),
      dirty: true,
    }));
  },

  resetAssetColors: (id) => {
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => (el.id === id ? { ...el, colorMap: {} } : el)),
      dirty: true,
    }));
  },

  deleteSelected: () => {
    const { selectedIds } = get();
    if (selectedIds.length === 0) return;
    get().commit();
    set((s) => ({
      elements: s.elements.filter((el) => !selectedIds.includes(el.id) || el.locked),
      selectedIds: [],
      dirty: true,
    }));
  },

  duplicateSelected: () => {
    const { selectedIds, elements } = get();
    if (selectedIds.length === 0) return;
    get().commit();
    const copies = elements
      .filter((el) => selectedIds.includes(el.id))
      .map((el) => ({ ...el, id: nextId(), x: el.x + 24, y: el.y + 24, name: `${el.name} copy` }));
    set((s) => ({
      elements: [...s.elements, ...copies],
      selectedIds: copies.map((c) => c.id),
      dirty: true,
    }));
  },

  // -- z-order -------------------------------------------------------------

  reorder: (id, direction) => {
    const { elements } = get();
    const index = elements.findIndex((el) => el.id === id);
    if (index === -1) return;

    let target;
    if (direction === "front") target = elements.length - 1;
    else if (direction === "back") target = 0;
    else if (direction === "forward") target = Math.min(elements.length - 1, index + 1);
    else target = Math.max(0, index - 1);
    if (target === index) return;

    get().commit();
    const next = [...elements];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    set({ elements: next, dirty: true });
  },

  /** Layers panel drag-reorder. Indices are in panel order (front-to-back), so
   *  the caller converts before calling. */
  moveElementToIndex: (id, toIndex) => {
    const { elements } = get();
    const from = elements.findIndex((el) => el.id === id);
    if (from === -1 || from === toIndex) return;
    get().commit();
    const next = [...elements];
    const [moved] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, moved);
    set({ elements: next, dirty: true });
  },

  // -- alignment -----------------------------------------------------------

  /** Align selected elements. With one element selected, aligns to the canvas;
   *  with several, aligns them to each other's bounding box. */
  align: (edge) => {
    const { selectedIds, elements, canvas } = get();
    if (selectedIds.length === 0) return;
    const chosen = elements.filter((el) => selectedIds.includes(el.id) && !el.locked);
    if (chosen.length === 0) return;

    const boxOf = (el) => ({
      left: el.x,
      top: el.y,
      right: el.x + (el.width ?? 0),
      bottom: el.y + (el.height ?? 0),
    });

    let bounds;
    if (chosen.length === 1) {
      bounds = { left: 0, top: 0, right: canvas.width, bottom: canvas.height };
    } else {
      const boxes = chosen.map(boxOf);
      bounds = {
        left: Math.min(...boxes.map((b) => b.left)),
        top: Math.min(...boxes.map((b) => b.top)),
        right: Math.max(...boxes.map((b) => b.right)),
        bottom: Math.max(...boxes.map((b) => b.bottom)),
      };
    }

    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => {
        if (!selectedIds.includes(el.id) || el.locked) return el;
        const w = el.width ?? 0;
        const h = el.height ?? 0;
        switch (edge) {
          case "left": return { ...el, x: bounds.left };
          case "right": return { ...el, x: bounds.right - w };
          case "hcenter": return { ...el, x: (bounds.left + bounds.right) / 2 - w / 2 };
          case "top": return { ...el, y: bounds.top };
          case "bottom": return { ...el, y: bounds.bottom - h };
          case "vcenter": return { ...el, y: (bounds.top + bounds.bottom) / 2 - h / 2 };
          default: return el;
        }
      }),
      dirty: true,
    }));
  },

  // -- canvas --------------------------------------------------------------

  setCanvas: (patch) => {
    get().commit();
    set((s) => ({ canvas: { ...s.canvas, ...patch }, dirty: true }));
  },

  // -- library -------------------------------------------------------------

  setLibrary: (library) => set({ library, libraryError: null }),
  setLibraryError: (libraryError) => set({ libraryError, library: null }),

  // -- document load/replace ----------------------------------------------

  loadDocument: (doc, projectPath = null) =>
    set({
      elements: doc.elements ?? [],
      canvas: { ...DEFAULT_CANVAS, ...(doc.canvas ?? {}) },
      selectedIds: [],
      past: [],
      future: [],
      projectPath,
      dirty: false,
    }),

  newDocument: () =>
    set({
      elements: [],
      canvas: { ...DEFAULT_CANVAS },
      selectedIds: [],
      past: [],
      future: [],
      projectPath: null,
      dirty: false,
    }),

  markSaved: (projectPath) => set({ projectPath, dirty: false }),

  /**
   * Attribution for every distinct asset currently on the canvas.
   *
   * Returns one record per asset, de-duplicated, plus the share-alike count.
   * Share-alike is called out separately because it is an obligation on the
   * whole figure, not just a credit line -- worth surfacing before export
   * rather than discovering it at submission.
   */
  citations: () => {
    const seen = new Map();
    for (const el of get().elements) {
      if (el.type !== "asset" || !el.citation) continue;
      if (seen.has(el.assetId)) continue;
      seen.set(el.assetId, {
        citation: el.citation,
        collection: el.collection ?? "Assets",
        license: el.license ?? null,
        shareAlike: Boolean(el.shareAlike),
      });
    }
    return [...seen.values()].sort(
      (a, b) => a.collection.localeCompare(b.collection) || a.citation.localeCompare(b.citation)
    );
  },
}));

export { documentSlice };
