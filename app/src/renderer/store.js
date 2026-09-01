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
import { extractPalette, intrinsicSize } from "./lib/svgPalette";

let groupCounter = 0;

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
  /** Head style for the next arrow: "none" | "end" | "both". Remembers the
   *  last choice so drawing several matching arrows doesn't mean re-setting
   *  it every time. */
  lastArrowHeads: "end",
  library: null,
  libraryError: null,
  /** Which colour part to highlight on canvas: { elementId, hex } or null.
   *  Purely a view concern, so it is never saved or undone. */
  highlight: null,
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

  /**
   * Expand a set of ids to include every member of any group they belong to.
   * Selecting one member of a group selects the whole group, which is the
   * behaviour that makes grouping worth having.
   */
  expandToGroups: (ids) => {
    const { elements } = get();
    const groups = new Set(
      elements.filter((el) => ids.includes(el.id) && el.groupId).map((el) => el.groupId)
    );
    if (groups.size === 0) return ids;
    const expanded = new Set(ids);
    for (const el of elements) if (el.groupId && groups.has(el.groupId)) expanded.add(el.id);
    return [...expanded];
  },

  selectWithGroups: (ids) => set({ selectedIds: get().expandToGroups(ids) }),

  toggleSelection: (id) => {
    const { selectedIds, expandToGroups } = get();
    const members = expandToGroups([id]);
    const alreadyIn = members.every((m) => selectedIds.includes(m));
    set({
      selectedIds: alreadyIn
        ? selectedIds.filter((x) => !members.includes(x))
        : [...new Set([...selectedIds, ...members])],
    });
  },
  selectAll: () =>
    set((s) => ({ selectedIds: s.elements.filter((e) => !e.locked && e.visible).map((e) => e.id) })),
  clearSelection: () => set({ selectedIds: [] }),

  /** Group the current selection. Groups are flat: grouping elements that are
   *  already in other groups merges them all into one, rather than nesting,
   *  which keeps selection and z-order easy to reason about. */
  groupSelected: () => {
    const { selectedIds, elements } = get();
    if (selectedIds.length < 2) return;
    const groupId = `g_${Date.now().toString(36)}_${(groupCounter++).toString(36)}`;
    get().commit();
    set({
      elements: elements.map((el) =>
        selectedIds.includes(el.id) ? { ...el, groupId } : el
      ),
      dirty: true,
    });
  },

  ungroupSelected: () => {
    const { selectedIds, elements } = get();
    const groups = new Set(
      elements.filter((el) => selectedIds.includes(el.id) && el.groupId).map((el) => el.groupId)
    );
    if (groups.size === 0) return;
    get().commit();
    set({
      elements: elements.map((el) =>
        el.groupId && groups.has(el.groupId) ? { ...el, groupId: null } : el
      ),
      dirty: true,
    });
  },

  /** Move every selected element by the same delta, for dragging a group or a
   *  multi-selection as one piece. */
  nudgeSelected: (dx, dy, { commit = true } = {}) => {
    if (commit) get().commit();
    const { selectedIds } = get();
    set((s) => ({
      elements: s.elements.map((el) =>
        selectedIds.includes(el.id) && !el.locked
          ? { ...el, x: el.x + dx, y: el.y + dy }
          : el
      ),
      dirty: true,
    }));
  },

  setHighlight: (highlight) => set({ highlight }),

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

    // Boxes and circles in scientific figures are usually labelled, so shapes
    // carry their own centred caption rather than needing a separate text
    // element positioned on top and kept in sync by hand.
    const labelled = {
      label: "",
      labelSize: Math.round(Math.min(canvas.width, canvas.height) * 0.028),
      labelColor: "#ffffff",
      labelFont: "Helvetica",
    };

    let element;
    if (type === "rect") {
      element = get()._base({ ...common, ...labelled, name: "Rectangle", width: size, height: size * 0.7, cornerRadius: 0 });
    } else if (type === "ellipse") {
      element = get()._base({ ...common, ...labelled, name: "Ellipse", width: size, height: size });
    } else if (type === "triangle") {
      element = get()._base({ ...common, ...labelled, name: "Triangle", width: size, height: size });
    } else if (type === "line" || type === "arrow") {
      element = get()._base({
        ...common,
        name: type === "arrow" ? "Arrow" : "Line",
        fill: "#1f3a63",
        strokeWidth: 4,
        // points are relative to the element's x/y origin
        points: [0, 0, size, 0],
        ...(type === "arrow" ? { heads: get().lastArrowHeads } : {}),
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
    const box = intrinsicSize(svgSource);
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
      hiddenColors: [],
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

  /** Change an arrow's head style, and remember it for the next arrow. */
  setArrowHeads: (id, heads) => {
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => (el.id === id ? { ...el, heads } : el)),
      lastArrowHeads: heads,
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
      elements: s.elements.map((el) =>
        el.id === id ? { ...el, colorMap: {}, hiddenColors: [] } : el
      ),
      dirty: true,
    }));
  },

  /**
   * Hide or restore every shape drawn in one colour.
   *
   * This is how "delete part of a vector" works. Hidden colours are stored as
   * a list and applied as `fill: none` at draw time, so removal is reversible
   * and the original file is never altered.
   */
  toggleAssetColorHidden: (id, hex) => {
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => {
        if (el.id !== id || el.type !== "asset") return el;
        const hidden = new Set(el.hiddenColors ?? []);
        hidden.has(hex) ? hidden.delete(hex) : hidden.add(hex);
        return { ...el, hiddenColors: [...hidden] };
      }),
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
    // Duplicating a group should produce a new group, not silently add the
    // copies to the original one and not scatter them as loose elements.
    const remap = new Map();
    const copies = elements
      .filter((el) => selectedIds.includes(el.id))
      .map((el) => {
        let groupId = null;
        if (el.groupId) {
          if (!remap.has(el.groupId)) {
            remap.set(el.groupId, `g_${Date.now().toString(36)}_${(groupCounter++).toString(36)}`);
          }
          groupId = remap.get(el.groupId);
        }
        return {
          ...el,
          id: nextId(),
          x: el.x + 24,
          y: el.y + 24,
          name: `${el.name} copy`,
          groupId,
        };
      });
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

  /** Prompt for a library folder and mount it. Shared by the sidebar, the
   *  File menu and the welcome screen so there is one implementation. */
  addLibrary: async () => {
    const res = await window.morphly.addLibrary();
    if (res.ok) set({ library: res.library, libraryError: null });
    else if (!res.canceled) set({ libraryError: res.error });
    return res;
  },

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
