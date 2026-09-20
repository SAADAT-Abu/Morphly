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
import { isConnector, lineEnds, relayoutConnectors, remapGlue, unglueExcept } from "./lib/connectors";
import { isPanel, layoutPanels, reletterPanels } from "./lib/panelLayout";
import { alignMoves, distributeMoves, applyMoves } from "./lib/align";
import { measuredHeight } from "./lib/measure";
import { copyElements, pasteElements, offsetToCentre, reorderSelection } from "./lib/clipboard";
import { analyseSvg, topContainer, parentKey, cleanEdit, canvasDeltaToUser } from "./lib/svgParts";
import { applyDatasetOp, createDataset, DATASET_KINDS } from "./lib/datasets";
import { defaultPlot } from "./lib/plotRender";

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

/** Fields that make up a saved document -- everything else is view state.
 *  Datasets belong to the whole document rather than to a page, but they are
 *  snapshotted with the page's history, so editing numbers can be undone like
 *  any other change. */
const documentSlice = (state) => ({
  elements: state.elements,
  canvas: state.canvas,
  datasets: state.datasets,
});

/** A dataset read from a file, checked and brought into shape. Anything that
 *  is not recognisably a table is dropped rather than trusted. */
const cleanDataset = (d) =>
  d && typeof d === "object" && typeof d.id === "string" && Array.isArray(d.columns)
    ? createDataset({
        id: d.id,
        name: typeof d.name === "string" ? d.name : "Data",
        kind: DATASET_KINDS[d.kind] ? d.kind : "groups",
        columns: d.columns
          .filter((c) => c && typeof c === "object")
          .map((c) => ({ name: String(c.name ?? ""), values: Array.isArray(c.values) ? c.values.map((v) => String(v ?? "")) : [] })),
      })
    : null;

const INITIAL_PAGE = makePage("Figure 1");

/** A figure's title from its file: "Figure 1" for ".../Figure 1.morphly". */
export const titleFromPath = (filePath) =>
  String(filePath ?? "").split(/[/\\]/).pop().replace(/\.morphly$/i, "") || "Untitled figure";

export const useStore = create((set, get) => ({
  // -- document ------------------------------------------------------------
  /** The active page's contents, live. */
  elements: [],
  canvas: { ...DEFAULT_CANVAS },
  /** Every page, including a possibly stale copy of the active one. Read them
   *  through allPages(), which refreshes the active entry first. */
  pages: [INITIAL_PAGE],
  activePageId: INITIAL_PAGE.id,
  /** The numbers behind graphs (lib/datasets.js), shared by every page. */
  datasets: [],

  // -- view state (never saved, never undone) ------------------------------
  selectedIds: [],
  zoom: 0.4,
  stagePos: { x: 0, y: 0 },
  activeTool: "select",
  /** Ends and dash for the next line drawn (lib/connectors.js). Remembers the
   *  last choice, so drawing several matching arrows does not mean setting
   *  it again each time. */
  lineStyle: { startHead: "none", endHead: "triangle", dash: "solid" },
  /** Grid overlay. A drawing aid rather than part of the figure, so it lives
   *  in view state: it is never exported, never saved and never undone. */
  grid: { visible: false, size: 50, color: "#9aa4bd", snap: false },
  /** What Align and Distribute work relative to (lib/align.js). */
  alignTo: "selection",
  /** Smart guides while moving and resizing (lib/snapping.js). */
  snapping: true,
  /** Copied elements (lib/clipboard.js). Kept across pages, never undone. */
  clipboard: null,
  /** How many times the clipboard has been pasted, so copies step away. */
  pasteCount: 0,
  /** Datasets used by copied graphs, so a graph pasted into another figure
   *  brings its numbers along. */
  clipboardDatasets: [],
  /** The data drawer under the canvas: which dataset it shows, and whether it
   *  is open, expanded, or popped out into its own window. */
  dataView: { datasetId: null, open: false, expanded: false, popped: false },
  /** Which tab the left sidebar shows: "illustrations" or "data". */
  sidebarTab: "illustrations",
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  /** Editing the parts of one illustration (lib/svgParts.js), or null:
   *  { elementId, container: part key being looked inside, selected: [part keys] } */
  partEdit: null,
  library: null,
  libraryError: null,
  /** Which colour part to highlight on canvas: { elementId, hex } or null.
   *  Purely a view concern, so it is never saved or undone. */
  highlight: null,
  projectPath: null,
  /** The figure's name, shown in the toolbar. Once saved it is the file's
   *  name, so renaming the figure renames its file. */
  title: "Untitled figure",
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
    const moving = new Set(selectedIds);
    set((s) => ({
      elements: s.elements.map((el) => {
        if (!moving.has(el.id) || el.locked) return el;
        const moved = { ...el, x: el.x + dx, y: el.y + dy };
        // A connector moved by hand lets go of anything not moving with it;
        // otherwise its glued ends would snap straight back.
        return isConnector(moved) ? unglueExcept(moved, moving) : moved;
      }),
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
      // "arrow" (the A key) always gets a head, even if the last line had none.
      const remembered = get().lineStyle;
      const style =
        type === "arrow" && remembered.startHead === "none" && remembered.endHead === "none"
          ? { ...remembered, endHead: "triangle" }
          : remembered;
      const headed = style.startHead !== "none" || style.endHead !== "none";
      element = get()._base({
        ...common,
        type: "arrow",
        name: headed ? "Arrow" : "Line",
        fill: "#1f3a63",
        strokeWidth: 4,
        // points are relative to the element's x/y origin
        points: [0, 0, size, 0],
        // See lib/connectors.js: how the line runs, and what its ends are
        // glued to.
        route: "straight",
        start: null,
        end: null,
        startHead: style.startHead,
        endHead: style.endHead,
        dash: style.dash,
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
  addAsset: ({ asset, variant, svgSource, at }) =>
    get()._placeSvg({
      svgSource,
      name: variant.caption || asset.title,
      at,
      // A library icon is one ingredient of a figure, so it arrives small.
      fraction: 0.28,
      fields: {
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
      },
    }),

  /**
   * An SVG the user imported: a plot, a diagram, their own drawing. It becomes
   * the same kind of element as a library asset, so recolouring, hiding parts
   * and vector export all work on it. It carries no citation, because Morphly
   * cannot know where it came from.
   */
  addSvgArtwork: ({ svgSource, name = "Imported SVG", at }) =>
    get()._placeSvg({ svgSource, name, at, fraction: 0.45, fields: { imported: true } }),

  /** Shared by addAsset and addSvgArtwork. `svgSource` is the untouched file
   *  text; recolouring is stored separately so the original is never lost. */
  _placeSvg: ({ svgSource, name, at, fraction, fields }) => {
    const { canvas } = get();
    const box = intrinsicSize(svgSource);
    // Scale so the artwork occupies a sensible fraction of the canvas
    // regardless of its native viewBox units.
    const target = Math.min(canvas.width, canvas.height) * fraction;
    const scale = target / Math.max(box.width, box.height);
    const width = box.width * scale;
    const height = box.height * scale;

    const element = get()._base({
      type: "asset",
      name,
      // `at` is the point to centre on (the cursor, for a drop); with no
      // point given the artwork lands in the middle of the page.
      x: (at?.x ?? canvas.width / 2) - width / 2,
      y: (at?.y ?? canvas.height / 2) - height / 2,
      width,
      height,
      svgSource,
      colorMap: {},
      hiddenColors: [],
      palette: extractPalette(svgSource),
      ...fields,
    });

    get().commit();
    set((s) => ({ elements: [...s.elements, element], selectedIds: [element.id] }));
    return element.id;
  },

  // -- graphs and their data -------------------------------------------------

  /**
   * Insert a graph. `dataset` is a new dataset to add with it; `datasetId`
   * points at one the document already has instead. With `box`, the graph
   * fills that area (a panel); otherwise it goes in the middle of the page.
   * Type and lines are sized for the page, so a graph reads the same on a
   * poster as in a single column figure.
   */
  addGraph: ({ dataset = null, datasetId = null, kind = "bar", box = null, name = "Graph" } = {}) => {
    const { canvas, datasets, elements } = get();
    const id = dataset ? dataset.id : datasetId;
    if (!id) return null;
    const fontSize = Math.max(10, Math.round(Math.min(canvas.width, canvas.height) * 0.02));
    let area = box;
    if (!area) {
      const width = Math.round(canvas.width * 0.42);
      const height = Math.round(width * 0.75);
      area = { x: canvas.width / 2 - width / 2, y: canvas.height / 2 - height / 2, width, height };
    }
    const count = elements.filter((el) => el.type === "plot").length + 1;
    const element = get()._base({
      type: "plot",
      name: `${name} ${count}`,
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      datasetId: id,
      plot: defaultPlot(kind, { fontSize }),
    });
    get().commit();
    set({
      datasets: dataset ? [...datasets, dataset] : datasets,
      elements: [...elements, element],
      selectedIds: [element.id],
      activeTool: "select",
      dataView: { ...get().dataView, datasetId: id, open: !get().dataView.popped || get().dataView.open },
      dirty: true,
    });
    return element.id;
  },

  /** Change a graph's settings (element.plot). */
  updatePlot: (id, patch, { commit = true } = {}) => {
    if (commit) get().commit();
    set((s) => ({
      elements: s.elements.map((el) => (el.id === id && el.type === "plot" ? { ...el, plot: { ...el.plot, ...patch } } : el)),
      dirty: true,
    }));
  },

  /** Add a dataset on its own, for example one imported from the Data tab. */
  addDataset: (dataset) => {
    get().commit();
    set((s) => ({ datasets: [...s.datasets, dataset], dirty: true }));
    return dataset.id;
  },

  /**
   * Edit a dataset (lib/datasets.js applyDatasetOp). Typing in a cell calls
   * this on every keystroke with commit=false after the first, so a word typed
   * is one undo step rather than one per letter.
   */
  editDataset: (id, op, { commit = true } = {}) => {
    const current = get().datasets.find((d) => d.id === id);
    if (!current) return;
    const next = applyDatasetOp(current, op);
    if (next === current) return;
    if (commit) get().commit();
    set((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? next : d)), dirty: true }));
  },

  /** Remove a dataset. Graphs still using it show that their data is missing. */
  deleteDataset: (id) => {
    if (!get().datasets.some((d) => d.id === id)) return;
    get().commit();
    set((s) => ({
      datasets: s.datasets.filter((d) => d.id !== id),
      dataView: s.dataView.datasetId === id ? { ...s.dataView, datasetId: null, open: false } : s.dataView,
      dirty: true,
    }));
  },

  /** Show a dataset in the drawer (or in its window, when popped out). */
  openData: (datasetId) =>
    set((s) => ({ dataView: { ...s.dataView, datasetId: datasetId ?? s.dataView.datasetId, open: true } })),
  closeData: () => set((s) => ({ dataView: { ...s.dataView, open: false } })),
  setDataView: (patch) => set((s) => ({ dataView: { ...s.dataView, ...patch } })),

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

  /**
   * Lay out lettered panels over the page (lib/panelLayout.js).
   *
   * Panels go underneath everything already on the page, so existing artwork
   * stays visible on top of them, and are selected so they can be nudged as a
   * set straight away. With `replace`, panels from an earlier layout are
   * removed first. The whole insertion is one undo step.
   */
  addPanelLayout: ({ rows, cols, cells, gap, margin, letterStyle = "upper", replace = true }) => {
    const { canvas, elements } = get();
    const base = Math.min(canvas.width, canvas.height);
    const boxes = layoutPanels(
      { rows, cols, cells },
      { x: margin, y: margin, width: canvas.width - 2 * margin, height: canvas.height - 2 * margin, gap }
    );
    const panels = boxes.map((box) =>
      get()._base({
        type: "rect",
        name: "Panel",
        ...box,
        // No fill, so the page colour shows through and nothing is hidden.
        fill: "",
        stroke: "#c9cfdb",
        strokeWidth: 1,
        cornerRadius: 0,
        label: "",
        labelSize: Math.round(base * 0.028),
        labelColor: "#111111",
        labelFont: "Helvetica",
        panel: true,
        panelLetterStyle: letterStyle,
        panelLetterSize: Math.max(14, Math.round(base * 0.04)),
        panelLetterColor: "#111111",
      })
    );

    get().commit();
    const kept = replace ? elements.filter((el) => !isPanel(el)) : elements;
    set({
      elements: [...panels, ...kept],
      selectedIds: panels.map((p) => p.id),
      activeTool: "select",
      dirty: true,
    });
    return panels.map((p) => p.id);
  },

  /** Letter style, size or colour, applied to every panel on the page at once,
   *  because a figure whose panels are lettered differently looks unfinished. */
  setPanelLetters: (patch) => {
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => (isPanel(el) ? { ...el, ...patch } : el)),
      dirty: true,
    }));
  },

  /**
   * Straight, curved or elbow. A line turned into a curve starts with a
   * visible bend, since a curve that looks straight reads as nothing happening.
   */
  setConnectorRoute: (id, route) => {
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => {
        if (el.id !== id) return el;
        const patch = { route };
        if (route === "curved" && !el.bend) {
          const p = el.points;
          const length = Math.hypot(p[p.length - 2] - p[0], p[p.length - 1] - p[1]);
          patch.bend = { along: 0.5, offset: Math.max(24, length * 0.25) };
        }
        return { ...el, ...patch };
      }),
      dirty: true,
    }));
  },

  /**
   * Line ends and dash: { startHead, endHead, dash }, any of them. Applied to
   * the given lines (the selected ones by default) as one undo step, and
   * remembered for the next line drawn. Pass `[]` just to remember it.
   */
  setLineStyle: (patch, ids = null) => {
    const remembered = { ...get().lineStyle, ...patch };
    const targets = new Set(ids ?? get().selectedIds);
    const affects = (el) => targets.has(el.id) && isConnector(el) && !el.locked;
    if (!get().elements.some(affects)) {
      set({ lineStyle: remembered });
      return;
    }
    get().commit();
    set((s) => ({
      lineStyle: remembered,
      elements: s.elements.map((el) => {
        if (!affects(el)) return el;
        const ends = lineEnds(el);
        const style = { startHead: ends.start, endHead: ends.end, dash: el.dash ?? "solid", ...patch };
        const { heads, ...rest } = el; // the old form, now spelled out as startHead and endHead
        const headed = style.startHead !== "none" || style.endHead !== "none";
        // Names Morphly gave follow what the line is; names the user typed stay.
        const name = /^(Line|Arrow)( copy)*$/.test(el.name ?? "")
          ? el.name.replace(/^(Line|Arrow)/, headed ? "Arrow" : "Line")
          : el.name;
        return { ...rest, type: "arrow", ...style, name };
      }),
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

  /**
   * Turn bold or italic on or off (Ctrl+B, Ctrl+I) for the text elements in
   * the selection, or for one element by id while it is being edited.
   *
   * Konva keeps one style for the whole text element, so this applies to all
   * of it rather than to a stretch of characters. Mixed selections take the
   * state of the first text element, so one press makes them agree.
   */
  toggleTextStyle: (which, id = null) => {
    const { elements, selectedIds } = get();
    const targets = elements.filter(
      (el) => el.type === "text" && !el.locked && (id ? el.id === id : selectedIds.includes(el.id))
    );
    if (targets.length === 0) return;
    const first = String(targets[0].fontStyle ?? "normal");
    const turnOn = !first.includes(which);
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => {
        if (!targets.some((t) => t.id === el.id)) return el;
        const style = String(el.fontStyle ?? "normal");
        const bold = which === "bold" ? turnOn : style.includes("bold");
        const italic = which === "italic" ? turnOn : style.includes("italic");
        // The same spellings the properties panel offers, so the two agree.
        const next = bold && italic ? "italic bold" : bold ? "bold" : italic ? "italic" : "normal";
        return { ...el, fontStyle: next };
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
    const newIds = new Map();
    const copies = elements
      .filter((el) => selectedIds.includes(el.id))
      .map((el) => {
        const id = nextId();
        newIds.set(el.id, id);
        let groupId = null;
        if (el.groupId) {
          if (!remap.has(el.groupId)) {
            remap.set(el.groupId, `g_${Date.now().toString(36)}_${(groupCounter++).toString(36)}`);
          }
          groupId = remap.get(el.groupId);
        }
        return {
          ...el,
          id,
          x: el.x + 24,
          y: el.y + 24,
          name: `${el.name} copy`,
          groupId,
        };
      })
      // A copied connector follows copies of its targets, and lets go of
      // targets that were not copied, instead of snapping back onto them.
      .map((copy) => (isConnector(copy) ? remapGlue(copy, newIds) : copy));
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

  /** Align the selection (lib/align.js), relative to the chosen reference. */
  alignSelected: (edge) => {
    const { elements, selectedIds, canvas, alignTo } = get();
    const moves = alignMoves(elements, selectedIds, edge, { relativeTo: alignTo, canvas, measure: measuredHeight });
    if (Object.keys(moves).length === 0) return;
    get().commit();
    set((st) => ({ elements: applyMoves(st.elements, moves), dirty: true }));
  },

  /** Spread the selection evenly: "h-gaps" | "v-gaps" | "h-centres" | "v-centres". */
  distributeSelected: (mode) => {
    const { elements, selectedIds, canvas, alignTo } = get();
    const moves = distributeMoves(elements, selectedIds, mode, { relativeTo: alignTo, canvas, measure: measuredHeight });
    if (Object.keys(moves).length === 0) return;
    get().commit();
    set((st) => ({ elements: applyMoves(st.elements, moves), dirty: true }));
  },

  // -- editing parts of an illustration ------------------------------------

  /** Start editing the parts of an illustration. Returns whether it could. */
  enterPartEdit: (id) => {
    const el = get().elements.find((e) => e.id === id);
    if (!el || el.type !== "asset" || el.locked) return false;
    const analysis = analyseSvg(el.svgSource);
    if (!analysis || analysis.leaves.length === 0) return false;
    set({
      partEdit: { elementId: id, container: topContainer(analysis), selected: [] },
      selectedIds: [id],
      activeTool: "select",
    });
    return true;
  },

  exitPartEdit: () => {
    if (get().partEdit) set({ partEdit: null });
  },

  setPartSelection: (selected) =>
    set((s) => (s.partEdit ? { partEdit: { ...s.partEdit, selected } } : {})),

  _partAnalysis: () => {
    const { partEdit, elements } = get();
    const el = partEdit && elements.find((e) => e.id === partEdit.elementId);
    return el ? { el, analysis: analyseSvg(el.svgSource) } : { el: null, analysis: null };
  },

  /** Look inside a group, so clicks pick the pieces within it. */
  openPartGroup: (key) => {
    const { partEdit } = get();
    const { analysis } = get()._partAnalysis();
    const node = analysis?.byKey.get(key);
    if (!partEdit || !node?.container) return;
    set({ partEdit: { ...partEdit, container: key, selected: [] } });
  },

  /** Back out of a group, selecting it, but never above where editing began. */
  partEditUp: () => {
    const { partEdit } = get();
    const { analysis } = get()._partAnalysis();
    if (!partEdit || !analysis) return false;
    const top = topContainer(analysis);
    if (partEdit.container === top || partEdit.container.length <= top.length) return false;
    set({ partEdit: { ...partEdit, container: parentKey(partEdit.container), selected: [partEdit.container] } });
    return true;
  },

  /** Esc: first clear the part selection, then go up a level, then finish. */
  partEditBack: () => {
    const { partEdit } = get();
    if (!partEdit) return;
    if (partEdit.selected.length) {
      set({ partEdit: { ...partEdit, selected: [] } });
      return;
    }
    if (!get().partEditUp()) set({ partEdit: null });
  },

  /**
   * Change some parts of the illustration being edited. `change` is a patch,
   * or a function from a part's current edit to a patch. Edits that end up
   * doing nothing are removed, so a reset part leaves no trace in the file.
   */
  updateParts: (keys, change, { commit = true } = {}) => {
    const { partEdit } = get();
    if (!partEdit || keys.length === 0) return;
    if (commit) get().commit();
    set((s) => ({
      elements: s.elements.map((el) => {
        if (el.id !== partEdit.elementId) return el;
        const partEdits = { ...(el.partEdits ?? {}) };
        for (const key of keys) {
          const current = partEdits[key] ?? {};
          const next = cleanEdit({ ...current, ...(typeof change === "function" ? change(current, key) : change) });
          if (next) partEdits[key] = next;
          else delete partEdits[key];
        }
        return { ...el, partEdits };
      }),
      dirty: true,
    }));
  },

  /** Put parts back as drawn; every part when `keys` is null. */
  resetParts: (keys = null) => {
    const { partEdit } = get();
    if (!partEdit) return;
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => {
        if (el.id !== partEdit.elementId) return el;
        if (!keys) return { ...el, partEdits: {} };
        const partEdits = { ...(el.partEdits ?? {}) };
        for (const key of keys) delete partEdits[key];
        return { ...el, partEdits };
      }),
      dirty: true,
    }));
  },

  /** Move the selected parts by a distance on the page. */
  nudgeParts: (dx, dy) => {
    const { partEdit } = get();
    const { el } = get()._partAnalysis();
    if (!el || !partEdit.selected.length) return;
    const d = canvasDeltaToUser(el, dx, dy);
    get().updateParts(partEdit.selected, (edit) => ({ dx: (edit.dx ?? 0) + d.x, dy: (edit.dy ?? 0) + d.y }));
  },

  hideSelectedParts: () => {
    const { partEdit } = get();
    if (partEdit?.selected.length) get().updateParts(partEdit.selected, { hidden: true });
  },

  // -- clipboard and order ---------------------------------------------------

  /** Copy the selection. Returns whether there was anything to copy. */
  copySelected: () => {
    const { elements, selectedIds } = get();
    if (selectedIds.length === 0) return false;
    const clipboard = copyElements(elements, selectedIds);
    const used = new Set(clipboard.filter((el) => el.type === "plot").map((el) => el.datasetId));
    set({
      clipboard,
      clipboardDatasets: get().datasets.filter((d) => used.has(d.id)),
      pasteCount: 0,
    });
    return true;
  },

  cutSelected: () => {
    if (get().copySelected()) get().deleteSelected();
  },

  /**
   * Paste the clipboard as one undo step, and select what was pasted.
   *   default    each paste steps 24 units further from the original
   *   inPlace    exactly where the originals were
   *   at         centred on a canvas point ("Paste here")
   */
  pasteClipboard: ({ inPlace = false, at = null } = {}) => {
    const { clipboard, pasteCount } = get();
    if (!clipboard?.length) return [];
    let offset = { dx: 0, dy: 0 };
    let count = pasteCount;
    if (at) {
      offset = offsetToCentre(clipboard, at, measuredHeight);
    } else if (!inPlace) {
      count += 1;
      offset = { dx: 24 * count, dy: 24 * count };
    }
    const pasted = pasteElements(clipboard, {
      newId: nextId,
      newGroupId: () => `g_${Date.now().toString(36)}_${(groupCounter++).toString(36)}`,
      ...offset,
    });
    get().commit();
    // A graph pasted into a figure that lacks its data brings the data along.
    const have = new Set(get().datasets.map((d) => d.id));
    const missing = get().clipboardDatasets.filter((d) => !have.has(d.id));
    set((s) => ({
      datasets: missing.length ? [...s.datasets, ...missing] : s.datasets,
      elements: [...s.elements, ...pasted],
      selectedIds: pasted.map((el) => el.id),
      pasteCount: count,
      activeTool: "select",
      dirty: true,
    }));
    return pasted.map((el) => el.id);
  },

  /** "front" | "forward" | "backward" | "back", for the whole selection. */
  reorderSelected: (direction) => {
    const { elements, selectedIds } = get();
    const next = reorderSelection(elements, selectedIds, direction);
    if (next === elements) return;
    get().commit();
    set({ elements: next, dirty: true });
  },

  setSelectedLocked: (locked) => {
    const { selectedIds } = get();
    if (selectedIds.length === 0) return;
    get().commit();
    set((s) => ({
      elements: s.elements.map((el) => (selectedIds.includes(el.id) ? { ...el, locked } : el)),
      dirty: true,
    }));
  },

  setAlignTo: (alignTo) => set({ alignTo }),
  toggleSnapping: () => set((st) => ({ snapping: !st.snapping })),

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
    // `doc` has already been through migrate() in lib/document.js, so it always
    // has pages, whatever version of Morphly saved it.
    const pages = doc.pages.map((p, i) => ({
      id: p.id ?? nextPageId(),
      name: p.name ?? `Figure ${i + 1}`,
      canvas: { ...DEFAULT_CANVAS, ...(p.canvas ?? {}) },
      elements: Array.isArray(p.elements) ? p.elements : [],
    }));

    const active = pages.find((p) => p.id === doc.activePageId) ?? pages[0];
    set({
      datasets: (Array.isArray(doc.datasets) ? doc.datasets : []).map(cleanDataset).filter(Boolean),
      dataView: { ...get().dataView, datasetId: null, open: false },
      pages,
      activePageId: active.id,
      elements: active.elements,
      canvas: active.canvas,
      selectedIds: [],
      highlight: null,
      past: [],
      future: [],
      projectPath,
      title: projectPath ? titleFromPath(projectPath) : "Untitled figure",
      dirty: false,
    });
  },

  newDocument: () => {
    const page = makePage("Figure 1");
    set({
      datasets: [],
      dataView: { ...get().dataView, datasetId: null, open: false },
      pages: [page],
      activePageId: page.id,
      elements: [],
      canvas: { ...DEFAULT_CANVAS },
      selectedIds: [],
      highlight: null,
      past: [],
      future: [],
      projectPath: null,
      title: "Untitled figure",
      dirty: false,
    });
  },

  markSaved: (projectPath) => set({ projectPath, title: titleFromPath(projectPath), dirty: false }),

  /** Point at a file (after a rename, or a save overtaken by new edits)
   *  without claiming everything in it is saved. */
  setProjectPath: (projectPath) => set({ projectPath, title: titleFromPath(projectPath) }),

  /**
   * Rename a figure that has no file yet. It counts as a change, so autosave
   * saves it under the new name. (A saved figure is renamed through its file.)
   */
  setTitle: (title) => {
    const next = String(title ?? "").trim() || "Untitled figure";
    if (next === get().title) return;
    set({ title: next, dirty: true });
  },

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

/**
 * Glued connector ends follow their targets, and panel letters follow the
 * panels' order on the page.
 *
 * This runs after every change rather than inside each action that can move
 * something, so nothing that moves an element (dragging, the inspector, align,
 * undo, a page switch) can forget to. It adds no undo step of its own: the
 * change that moved the target already made one, and every snapshot is taken
 * after the previous change was laid out.
 */
useStore.subscribe((state, previous) => {
  // Editing parts ends when its illustration is deselected, deleted or locked,
  // whichever way that happens (a click, undo, a page switch).
  if (state.partEdit) {
    const el = state.elements.find((e) => e.id === state.partEdit.elementId);
    if (!el || el.locked || state.selectedIds.length !== 1 || state.selectedIds[0] !== el.id) {
      useStore.setState({ partEdit: null });
      return;
    }
  }
  if (state.elements === previous.elements) return;
  const next = reletterPanels(relayoutConnectors(state.elements));
  if (next !== state.elements) useStore.setState({ elements: next });
});

export { documentSlice };
