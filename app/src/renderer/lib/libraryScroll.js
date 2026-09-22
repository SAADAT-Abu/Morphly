/**
 * Continuous loading for the asset library, and the "where am I" counter.
 *
 * The sidebar mounts thumbnails in batches as you scroll, so a library of
 * 2,531 illustrations never loads all at once, and a counter above the grid
 * says which ones are on screen ("Showing 181 to 225 of 2,531").
 *
 * Everything here works on plain numbers, so it can be tested without a
 * window. The component passes in how to read each tile's top and bottom
 * edge; this file decides what that means.
 */

/** Thumbnails added per batch: 30 rows of three in the sidebar grid. */
export const BATCH_SIZE = 90;

/** How many tiles to have mounted after loading one more batch. */
export function nextLimit(limit, total, size = BATCH_SIZE) {
  return Math.min(total, limit + size);
}

/**
 * The tiles at least partly inside the visible band of a scrolled grid.
 *
 * `topAt(i)` and `bottomAt(i)` give tile i's edges in the grid's own
 * coordinates. Tops never decrease from one tile to the next (tiles in a row
 * share a top, and rows run downwards), which allows a binary search, so this
 * stays quick with thousands of tiles.
 *
 * Bottoms can differ within a row, for example when one tile is opened to show
 * its variants. A grid row is as tall as its tallest tile, so no tile reaches
 * past the row below it, and only the row just above the view can still poke
 * into it. That whole row is checked, not just its last tile, because a tall
 * tile may sit before a shorter one.
 *
 * Returns `{ first, last }` as zero-based, inclusive indexes, or null when no
 * tile is visible.
 */
export function visibleRange(count, topAt, bottomAt, scrollTop, viewHeight) {
  if (count <= 0 || viewHeight <= 0) return null;
  const viewBottom = scrollTop + viewHeight;

  // First tile whose top is at or below a given line.
  const firstTopAtOrBelow = (line) => {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (topAt(mid) < line) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let first = firstTopAtOrBelow(scrollTop);

  // The row starting above the view may still reach into it.
  if (first > 0) {
    const rowTop = topAt(first - 1);
    let rowStart = first - 1;
    while (rowStart > 0 && topAt(rowStart - 1) === rowTop) rowStart -= 1;
    for (let i = rowStart; i < first; i += 1) {
      if (bottomAt(i) > scrollTop) {
        first = i;
        break;
      }
    }
  }

  const last = firstTopAtOrBelow(viewBottom) - 1;
  if (first >= count || last < first) return null;
  return { first, last };
}

/**
 * The counter text. `shown` is null before the grid has been measured, in
 * which case the count alone is shown. A search or category narrows the list,
 * so the total is then called matches.
 */
export function rangeLabel(shown, total, filtered) {
  const n = (value) => value.toLocaleString("en-GB");
  const noun = filtered ? ` ${total === 1 ? "match" : "matches"}` : "";
  if (total === 0) return filtered ? "No matches" : "No illustrations";
  if (!shown) return `${n(total)}${noun}`;
  return `Showing ${n(shown.first + 1)} to ${n(shown.last + 1)} of ${n(total)}${noun}`;
}
