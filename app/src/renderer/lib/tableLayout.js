/**
 * Table geometry, in one place.
 *
 * The canvas renderer, the inline cell editor and the SVG exporter all need to
 * agree on exactly where a cell sits. Keeping the arithmetic here means a cell
 * cannot be drawn in one position, clicked in another and exported in a third.
 *
 * Columns and rows carry their own sizes, so offsets are running sums rather
 * than a multiple of one cell size.
 */

/** Running start offsets for a list of sizes, e.g. [80,120,60] -> [0,80,200]. */
export function offsets(sizes) {
  const out = [];
  let running = 0;
  for (const size of sizes) {
    out.push(running);
    running += size;
  }
  return out;
}

/** Box of one cell, in the table's own coordinates (origin at its top-left). */
export function cellBox(element, row, col) {
  const xs = offsets(element.colWidths);
  const ys = offsets(element.rowHeights);
  return {
    x: xs[col] ?? 0,
    y: ys[row] ?? 0,
    width: element.colWidths[col] ?? 0,
    height: element.rowHeights[row] ?? 0,
  };
}

/** Which cell contains a point given in the table's own coordinates. */
export function cellAtPoint(element, localX, localY) {
  const xs = offsets(element.colWidths);
  const ys = offsets(element.rowHeights);

  let col = -1;
  for (let c = 0; c < element.cols; c += 1) {
    if (localX >= xs[c] && localX < xs[c] + element.colWidths[c]) {
      col = c;
      break;
    }
  }
  let row = -1;
  for (let r = 0; r < element.rows; r += 1) {
    if (localY >= ys[r] && localY < ys[r] + element.rowHeights[r]) {
      row = r;
      break;
    }
  }
  if (row === -1 || col === -1) return null;
  return { row, col, ...cellBox(element, row, col) };
}

/** True when this cell is styled as a header. */
export function isHeaderCell(element, row, col) {
  return Boolean((element.headerRow && row === 0) || (element.headerCol && col === 0));
}

/**
 * Corner radii for one cell's background, so a rounded table stays rounded at
 * its four corners and square everywhere else. Konva and SVG both want the
 * radii in clockwise order from the top-left.
 */
export function cellCorners(element, row, col) {
  const r = element.cornerRadius ?? 0;
  if (!r) return [0, 0, 0, 0];
  const lastRow = element.rows - 1;
  const lastCol = element.cols - 1;
  return [
    row === 0 && col === 0 ? r : 0,
    row === 0 && col === lastCol ? r : 0,
    row === lastRow && col === lastCol ? r : 0,
    row === lastRow && col === 0 ? r : 0,
  ];
}
