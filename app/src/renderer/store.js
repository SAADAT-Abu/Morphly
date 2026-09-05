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

let pageCounter = 0;
const nextPageId = () => `pg_${Date.now().toString(36)}_${(pageCounter++).toString(36)}`;

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

/**
 * A document holds several pages, one per figure, shown as tabs.
 *
 * Only the active page is live: its elements and canvas sit at the top level of
 * the store, exactly where they were before pages existed, so every action that
 * edits a figure stays unchanged. The other pages are parked in `pages` and
 * swapped in and out on a tab click. Undo history belongs to the page you are
 * on and is cleared when you switch, which keeps "undo" meaning what you just
 * did on the figure in front of you rather than something on another tab.
 */
const makePage = (name, canvas = DEFAULT_CANVAS, elements = []) => ({
  id: nextPageId(),
  name,
  canvas: { ...canvas },
  elements,
});

/** Fields that make up a saved document -- everything else is view state. */
const documentSlice = (state) => ({
  elements: state.elements,
  canvas: state.canvas,
});

const INITIAL_PAGE = makePage("Figure 1");

export const useStore = create((set, get) => ({
  // -- document ------------------------------------------------------------
  /** The active page's contents, live. */
  elements: [],
  canvas: { ...DEFAULT_CANVAS },
  /** Every page, including a possibly stale copy of the active one. Read them
   *  through allPages(), which refreshes the active entry first. */
  pages: [INITIAL_PAGE],
  activePageId: INITIAL_PAGE.id,

  // -- view state (never saved, never undone) ------------------------------
  selectedIds: [],
  zoom: 0.4,
  stagePos: { x: 0, y: 0 },
  activeTool: "select",
  /** Head style for the next arrow: "none" | "end" | "both". Remembers the
   *  last choice so drawing several matching arrows doesn't mean re-setting
   *  it every time. */
  lastArrowHeads: "end",
  /** Grid overlay. A drawing aid rather than part of the figure, so it lives
   *  in view state: it is never exported, never saved and never undone. */
  grid: { visible: false, size: 50, color: "#9aa4bd", snap: false },
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
  setGrid: (patch) => set((s) => ({ grid: { ...s.grid, ...patch } })),
  toggleGrid: () => set((s) => ({ grid: { ...s.grid, visible: !s.grid.visible } })),
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
   * A table.
   *
   * Column widths and row heights are stored per column and per row rather
   * than derived from a single cell size, so one column can be widened for
   * long labels without disturbing the rest. `width` and `height` are kept as
   * the sums of those lists, which lets tables use the same geometry, drag,
   * snapping and alignment code as every other element.
   */
  addTable: ({ rows = 3, cols = 3, headerRow = true, at } = {}) => {
    const { canvas } = get();
    const colWidth = Math.round((canvas.width * 0.55) / cols);
    const fontSize = Math.max(12, Math.round(canvas.height * 0.022));
    const rowHeight = Math.round(fontSize * 2.4);

    // Header cells are pre-filled so a new table reads as a table straight
    // away; body cells start empty.
    const cells = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) =>
        headerRow && r === 0 ? `Column ${c + 1}` : ""
      )
    );

    const width = colWidth * cols;
    const height = rowHeight * rows;

    const element = get()._base({
      type: "table",
      name: "Table",
      x: (at?.x ?? canvas.width / 2) - width / 2,
      y: (at?.y ?? canvas.height / 2) - height / 2,
      width,
      height,
      rows,
      cols,
      colWidths: Array(cols).fill(colWidth),
      rowHeights: Array(rows).fill(rowHeight),
      cells,
      headerRow,
      headerCol: false,
      headerFill: "#2f4b7c",
      headerTextColor: "#ffffff",
      fill: "#ffffff",
      stripeFill: "",
      stroke: "#8b93a7",
      strokeWidth: 1,
      cornerRadius: 6,
      showInnerLines: true,
      fontSize,
      fontFamily: "Helvetica",
      textColor: "#111111",
      align: "left",
      padding: Math.round(fontSize * 0.5),
    });

    get().commit();
    set((s) => ({ elements: [...s.elements, element], selectedIds: [element.id], activeTool: "select" }));
    return element.id;
  },

  /**
   * A bitmap image: a plot, a micrograph, a photo.
   *
   * `src` is a data URL rather than a file path, so a figure keeps working
   * when it is saved, moved to another machine, or opened after the original
   * file has been renamed. That makes .morphly files larger, which is the
   * right trade for a figure that has to survive a submission cycle.
   */
  addImage: ({ src, naturalWidth, naturalHeight, name = "Image", at }) => {
    const { canvas } = get();
    // Fit into a sensible fraction of the page without ever upscaling a small
    // plot beyond its own pixels.
    const target = Math.min(canvas.width, canvas.height) * 0.45;
    const scale = Math.min(1, target / Math.max(naturalWidth, naturalHeight));
    const width = Math.round(naturalWidth * scale);
    const height = Math.round(naturalHeight * scale);

    const element = get()._base({
      type: "image",
      name,
      x: (at?.x ?? canvas.width / 2) - width / 2,
      y: (at?.y ?? canvas.height / 2) - height / 2,
      width,
      height,
      src,
      naturalWidth,
      naturalHeight,
      cornerRadius: 0,
    });

    get().commit();
    set((s) => ({ elements: [...s.elements, element], selectedIds: [element.id] }));
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

  /** Edit one table cell. */
  setTableCell: (id, row, col, text) => {
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => {
        if (el.id !== id || el.type !== "table") return el;
        const cells = el.cells.map((r) => [...r]);
        if (!cells[row]) return el;
        cells[row][col] = text;
        return { ...el, cells };
      }),
      dirty: true,
    }));
  },

  /**
   * Add or remove a row or column.
   *
   * `where` is an index: rows and columns are inserted after it, or removed at
   * it, so the buttons in the properties panel can act on the end of the table
   * without needing a cell selection.
   */
  resizeTable: (id, what, action, where = null) => {
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => {
        if (el.id !== id || el.type !== "table") return el;
        const next = { ...el, cells: el.cells.map((r) => [...r]) };

        if (what === "row") {
          if (action === "add") {
            const at = where == null ? next.rows : where + 1;
            const height = next.rowHeights[Math.min(at, next.rows - 1)] ?? 40;
            next.cells.splice(at, 0, Array(next.cols).fill(""));
            next.rowHeights = [...next.rowHeights];
            next.rowHeights.splice(at, 0, height);
            next.rows += 1;
          } else {
            // Never delete the last row: an empty table cannot be clicked to
            // get back, so it would be a one-way trip.
            if (next.rows <= 1) return el;
            const at = where == null ? next.rows - 1 : where;
            next.cells.splice(at, 1);
            next.rowHeights = next.rowHeights.filter((_, i) => i !== at);
            next.rows -= 1;
          }
        } else {
          if (action === "add") {
            const at = where == null ? next.cols : where + 1;
            const width = next.colWidths[Math.min(at, next.cols - 1)] ?? 120;
            next.cells = next.cells.map((r) => {
              const copy = [...r];
              copy.splice(at, 0, "");
              return copy;
            });
            next.colWidths = [...next.colWidths];
            next.colWidths.splice(at, 0, width);
            next.cols += 1;
          } else {
            if (next.cols <= 1) return el;
            const at = where == null ? next.cols - 1 : where;
            next.cells = next.cells.map((r) => r.filter((_, i) => i !== at));
            next.colWidths = next.colWidths.filter((_, i) => i !== at);
            next.cols -= 1;
          }
        }

        next.width = next.colWidths.reduce((a, b) => a + b, 0);
        next.height = next.rowHeights.reduce((a, b) => a + b, 0);
        return next;
      }),
      dirty: true,
    }));
  },

  /** Set every column to the same width, or every row to the same height. */
  setTableUniform: (id, what, value) => {
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => {
        if (el.id !== id || el.type !== "table") return el;
        const next = { ...el };
        if (what === "col") next.colWidths = Array(next.cols).fill(Math.max(20, value));
        else next.rowHeights = Array(next.rows).fill(Math.max(14, value));
        next.width = next.colWidths.reduce((a, b) => a + b, 0);
        next.height = next.rowHeights.reduce((a, b) => a + b, 0);
        return next;
      }),
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

  // -- pages ---------------------------------------------------------------

  /** Fold the live elements and canvas back into the active page's entry. */
  _syncActivePage: () =>
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === s.activePageId ? { ...p, canvas: s.canvas, elements: s.elements } : p
      ),
    })),

  /** Every page with the active one up to date. Use this for saving. */
  allPages: () => {
    const { pages, activePageId, canvas, elements } = get();
    return pages.map((p) =>
      p.id === activePageId ? { ...p, canvas, elements } : p
    );
  },

  setActivePage: (id) => {
    const { activePageId, pages } = get();
    if (id === activePageId) return;
    const target = pages.find((p) => p.id === id);
    if (!target) return;

    get()._syncActivePage();
    set({
      elements: target.elements,
      canvas: { ...DEFAULT_CANVAS, ...target.canvas },
      activePageId: id,
      selectedIds: [],
      highlight: null,
      // History is per page: undoing on one figure should never reach back
      // into edits made on another.
      past: [],
      future: [],
    });
  },

  /** Add an empty page after the active one, matching its page size. */
  addPage: () => {
    get()._syncActivePage();
    const { pages, activePageId, canvas } = get();
    const page = makePage(`Figure ${pages.length + 1}`, canvas, []);
    const at = pages.findIndex((p) => p.id === activePageId) + 1;
    const next = [...pages];
    next.splice(at, 0, page);
    set({
      pages: next,
      activePageId: page.id,
      elements: [],
      canvas: { ...canvas },
      selectedIds: [],
      highlight: null,
      past: [],
      future: [],
      dirty: true,
    });
    return page.id;
  },

  /** Copy a page, contents and all, and switch to the copy. */
  duplicatePage: (id) => {
    get()._syncActivePage();
    const pages = get().allPages();
    const source = pages.find((p) => p.id === (id ?? get().activePageId));
    if (!source) return;
    // Fresh element ids, so the two pages cannot alias each other.
    const copy = {
      ...makePage(`${source.name} copy`, source.canvas, []),
      elements: source.elements.map((el) => ({ ...el, id: nextId() })),
    };
    const at = pages.findIndex((p) => p.id === source.id) + 1;
    const next = [...pages];
    next.splice(at, 0, copy);
    set({
      pages: next,
      activePageId: copy.id,
      elements: copy.elements,
      canvas: { ...copy.canvas },
      selectedIds: [],
      highlight: null,
      past: [],
      future: [],
      dirty: true,
    });
    return copy.id;
  },

  renamePage: (id, name) =>
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? { ...p, name } : p)),
      dirty: true,
    })),

  /** Remove a page. The last one is never removed: a document with no pages
   *  has nothing to click on to get back. */
  deletePage: (id) => {
    get()._syncActivePage();
    const { pages, activePageId } = get();
    if (pages.length <= 1) return;
    const index = pages.findIndex((p) => p.id === id);
    if (index === -1) return;

    const next = pages.filter((p) => p.id !== id);
    if (id !== activePageId) {
      set({ pages: next, dirty: true });
      return;
    }
    // Deleting the page you are on lands you on its neighbour.
    const target = next[Math.min(index, next.length - 1)];
    set({
      pages: next,
      activePageId: target.id,
      elements: target.elements,
      canvas: { ...DEFAULT_CANVAS, ...target.canvas },
      selectedIds: [],
      highlight: null,
      past: [],
      future: [],
      dirty: true,
    });
  },

  movePage: (id, toIndex) => {
    const pages = get().allPages();
    const from = pages.findIndex((p) => p.id === id);
    if (from === -1 || from === toIndex) return;
    const next = [...pages];
    const [moved] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, moved);
    set({ pages: next, dirty: true });
  },

  /** Set when the menu or F2 asks for a rename, cleared once the tab strip
   *  has opened its editor. Renaming lives in the tab, but it has to be
   *  reachable from outside it. */
  pendingRenamePageId: null,
  requestRename: (id) => set({ pendingRenamePageId: id ?? get().activePageId }),
  clearRenameRequest: () => set({ pendingRenamePageId: null }),

  /** Step to the next or previous tab, for Ctrl+PageDown / Ctrl+PageUp. */
  stepPage: (delta) => {
    const { pages, activePageId } = get();
    const index = pages.findIndex((p) => p.id === activePageId);
    const target = pages[(index + delta + pages.length) % pages.length];
    if (target) get().setActivePage(target.id);
  },

  // -- document load/replace ----------------------------------------------

  /**
   * Load a saved figure.
   *
   * Files written before pages existed carry a single `elements` / `canvas`
   * pair at the top level; those open as a one-page document, so older figures
   * keep working untouched.
   */
  loadDocument: (doc, projectPath = null) => {
    const pages =
      Array.isArray(doc.pages) && doc.pages.length > 0
        ? doc.pages.map((p, i) => ({
            id: p.id ?? nextPageId(),
            name: p.name ?? `Figure ${i + 1}`,
            canvas: { ...DEFAULT_CANVAS, ...(p.canvas ?? {}) },
            elements: p.elements ?? [],
          }))
        : [
            {
              ...makePage("Figure 1"),
              canvas: { ...DEFAULT_CANVAS, ...(doc.canvas ?? {}) },
              elements: doc.elements ?? [],
            },
          ];

    const active = pages.find((p) => p.id === doc.activePageId) ?? pages[0];
    set({
      pages,
      activePageId: active.id,
      elements: active.elements,
      canvas: active.canvas,
      selectedIds: [],
      highlight: null,
      past: [],
      future: [],
      projectPath,
      dirty: false,
    });
  },

  newDocument: () => {
    const page = makePage("Figure 1");
    set({
      pages: [page],
      activePageId: page.id,
      elements: [],
      canvas: { ...DEFAULT_CANVAS },
      selectedIds: [],
      highlight: null,
      past: [],
      future: [],
      projectPath: null,
      dirty: false,
    });
  },

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
