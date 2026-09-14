/**
 * Panel layouts: the grid of lettered panels (A, B, C...) most journal figures
 * are built on.
 *
 * A panel is an ordinary rectangle marked `panel: true`, so it can be moved,
 * resized, recoloured, glued to and deleted like any other. What makes it a
 * panel is its letter, and letters are never typed by hand: they are assigned
 * in reading order (left to right, top to bottom) every time the panels
 * change. Delete panel B, or drag it below C, and the letters follow, which is
 * exactly the chore that goes wrong at revision time.
 *
 * On a panel element:
 *
 *   panel              true
 *   panelLabel         the letter, kept up to date by reletterPanels
 *   panelLetterStyle   "upper" (A, B) | "lower" (a, b) | "none"
 *   panelLetterSize    font size
 *   panelLetterColor   colour
 */

/** Cells of a plain grid, one per row and column. */
export function gridCells(rows, cols) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) cells.push({ row, col });
  }
  return cells;
}

/** Common figure shapes. Spanning panels hold the main result or a schematic. */
export const PANEL_PRESETS = [
  { id: "1x2", name: "Two across", rows: 1, cols: 2 },
  { id: "2x1", name: "Two stacked", rows: 2, cols: 1 },
  { id: "2x2", name: "Two by two", rows: 2, cols: 2 },
  { id: "1x3", name: "Three across", rows: 1, cols: 3 },
  { id: "2x3", name: "Two rows of three", rows: 2, cols: 3 },
  { id: "3x2", name: "Three rows of two", rows: 3, cols: 2 },
  {
    id: "wide-top",
    name: "Wide top, two below",
    rows: 2,
    cols: 2,
    cells: [{ row: 0, col: 0, colSpan: 2 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
  },
  {
    id: "wide-bottom",
    name: "Two above, wide bottom",
    rows: 2,
    cols: 2,
    cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0, colSpan: 2 }],
  },
  {
    id: "tall-left",
    name: "Tall left, two right",
    rows: 2,
    cols: 2,
    cells: [{ row: 0, col: 0, rowSpan: 2 }, { row: 0, col: 1 }, { row: 1, col: 1 }],
  },
  {
    id: "wide-top-3",
    name: "Wide top, three below",
    rows: 2,
    cols: 3,
    cells: [{ row: 0, col: 0, colSpan: 3 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }],
  },
];

export const presetCells = (preset) => preset.cells ?? gridCells(preset.rows, preset.cols);

/**
 * Boxes for a layout inside an area.
 *
 * Every gap between neighbouring panels is exactly `gap`, and the outer edges
 * of the panels meet the edges of the area, so spacing is consistent however
 * the cells span. Sizes are rounded to whole units with the remainder given to
 * the last column and row, so edges stay crisp and still meet exactly.
 */
export function layoutPanels({ rows, cols, cells }, { x = 0, y = 0, width, height, gap = 0 }) {
  const edges = (start, total, count) => {
    const size = (total - gap * (count - 1)) / count;
    const starts = [];
    const ends = [];
    for (let i = 0; i < count; i += 1) {
      starts.push(Math.round(start + i * (size + gap)));
      ends.push(i === count - 1 ? start + total : Math.round(start + i * (size + gap) + size));
    }
    return { starts, ends };
  };
  const across = edges(x, width, cols);
  const down = edges(y, height, rows);

  return (cells ?? gridCells(rows, cols)).map((cell) => {
    const lastCol = Math.min(cols, cell.col + (cell.colSpan ?? 1)) - 1;
    const lastRow = Math.min(rows, cell.row + (cell.rowSpan ?? 1)) - 1;
    const left = across.starts[cell.col];
    const top = down.starts[cell.row];
    return {
      x: left,
      y: top,
      width: across.ends[lastCol] - left,
      height: down.ends[lastRow] - top,
    };
  });
}

/** A, B, ..., Z, AA, AB, ... (or lower case); "" for no letters. */
export function panelLetter(index, style = "upper") {
  if (style === "none") return "";
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return style === "lower" ? letters.toLowerCase() : letters;
}

/**
 * Order boxes the way a reader scans a figure: row by row, left to right.
 *
 * Panels dragged by hand are rarely aligned to the pixel, so a box joins the
 * current row when its top is within half the row's shortest height of the
 * row's first box. Returns indices into `boxes`.
 */
export function readingOrder(boxes) {
  const byTop = boxes.map((box, index) => ({ box, index })).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const rows = [];
  for (const item of byTop) {
    const row = rows[rows.length - 1];
    if (row && item.box.y < row.top + row.shortest / 2) {
      row.items.push(item);
      row.shortest = Math.min(row.shortest, item.box.height);
    } else {
      rows.push({ top: item.box.y, shortest: item.box.height, items: [item] });
    }
  }
  return rows.flatMap((row) => row.items.sort((a, b) => a.box.x - b.box.x).map((item) => item.index));
}

export const isPanel = (el) => el?.type === "rect" && el.panel === true;

/**
 * Give every panel on the page its letter, in reading order.
 *
 * Runs after every change. Returns the very same array when every letter is
 * already right, so it causes no further updates.
 */
export function relettersFor(elements) {
  const panels = elements.filter(isPanel);
  const order = readingOrder(panels);
  const letters = new Map();
  order.forEach((panelIndex, position) => {
    const panel = panels[panelIndex];
    letters.set(panel.id, panelLetter(position, panel.panelLetterStyle ?? "upper"));
  });
  return letters;
}

/** A name Morphly gave the panel, as opposed to one the user typed. */
const AUTOMATIC_NAME = /^Panel(?: [A-Za-z]+)?$/;

export function reletterPanels(elements) {
  if (!elements.some(isPanel)) return elements;
  const letters = relettersFor(elements);
  let changed = false;
  const next = elements.map((el) => {
    if (!isPanel(el)) return el;
    const panelLabel = letters.get(el.id);
    // The Layers panel shows "Panel B" for panel B, unless the user renamed it.
    const name = AUTOMATIC_NAME.test(el.name ?? "") ? (panelLabel ? `Panel ${panelLabel}` : "Panel") : el.name;
    if (el.panelLabel === panelLabel && el.name === name) return el;
    changed = true;
    return { ...el, panelLabel, name };
  });
  return changed ? next : elements;
}
