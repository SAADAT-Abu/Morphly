/**
 * Page arithmetic for the asset library.
 *
 * The sidebar shows a fixed number of tiles at a time, so a search with 2,531
 * matches becomes 29 pages. Everything here is plain numbers, which keeps the
 * edge cases (an empty search, a typed page past the end, "abc" typed into the
 * page box) testable without rendering anything.
 */

/** Tiles per page: 30 rows of three in the sidebar grid. */
export const PAGE_SIZE = 90;

/** How many pages `total` items fill. An empty list still has one page. */
export function pageCount(total, size = PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / size));
}

/**
 * Turn whatever was asked for into a real page number between 1 and `count`.
 * Typed input arrives as text, so anything that is not a number falls back to
 * the first page rather than breaking the grid.
 */
export function clampPage(page, count) {
  const n = Math.floor(Number(page));
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(1, n), Math.max(1, count));
}

/**
 * The slice of items one page shows: `start` is inclusive and `end` exclusive,
 * ready for `items.slice(start, end)`. The page is clamped, so a page that no
 * longer exists after the search narrows shows the last one instead.
 */
export function pageRange(page, total, size = PAGE_SIZE) {
  const count = pageCount(total, size);
  const current = clampPage(page, count);
  const start = (current - 1) * size;
  return { page: current, count, start, end: Math.min(start + size, total) };
}
