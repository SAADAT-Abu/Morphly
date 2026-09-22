import { describe, it, expect } from "vitest";
import { BATCH_SIZE, nextLimit, visibleRange, rangeLabel } from "./libraryScroll";

/**
 * A grid laid out like the sidebar's CSS grid: three columns, rows 100 units
 * tall with an 8 unit gap, and each row as tall as its tallest tile. `tall`
 * makes chosen tiles taller than their neighbours, as a tile opened to show
 * its variants is, which pushes every later row down.
 */
function grid(count, { columns = 3, row = 100, gap = 8, tall = {} } = {}) {
  const height = (i) => tall[i] ?? row;
  const rowTops = [];
  let y = 0;
  for (let r = 0; r * columns < count; r += 1) {
    rowTops.push(y);
    let tallest = 0;
    for (let i = r * columns; i < Math.min(count, (r + 1) * columns); i += 1) tallest = Math.max(tallest, height(i));
    y += tallest + gap;
  }
  const top = (i) => rowTops[Math.floor(i / columns)];
  const bottom = (i) => top(i) + height(i);
  return { count, top, bottom };
}

const range = (g, scrollTop, viewHeight) => visibleRange(g.count, g.top, g.bottom, scrollTop, viewHeight);

describe("nextLimit", () => {
  it("adds one batch at a time and stops at the end", () => {
    expect(nextLimit(90, 2531)).toBe(180);
    expect(nextLimit(2520, 2531)).toBe(2531);
    expect(nextLimit(0, 40)).toBe(40);
    expect(BATCH_SIZE).toBe(90);
  });
});

describe("visibleRange", () => {
  it("finds the rows on screen at the top of the grid", () => {
    // 500 units of view shows rows starting at 0, 108, 216, 324 and 432.
    expect(range(grid(270), 0, 500)).toEqual({ first: 0, last: 14 });
  });

  it("includes rows only partly in view at either edge", () => {
    // View 150 to 450: row 1 (108 to 208) pokes in at the top, and row 4
    // (432 to 532) at the bottom.
    expect(range(grid(270), 150, 300)).toEqual({ first: 3, last: 14 });
  });

  it("leaves out a row that ends exactly where the view begins", () => {
    // Row 1 ends at 208, where the view starts; row 3 starts at 324, past the end.
    expect(range(grid(270), 208, 100)).toEqual({ first: 6, last: 8 });
  });

  it("catches a tall tile that sits before a shorter one in the row above", () => {
    // Tile 1 is opened to 400 tall, so row 0 is 400 tall and row 1 starts at
    // 408. At 300, tile 0 has scrolled away but tile 1 still shows.
    const g = grid(270, { tall: { 1: 400 } });
    expect(range(g, 300, 100)).toEqual({ first: 1, last: 2 });
  });

  it("stops at the last tile when the view runs past the end", () => {
    // Ten tiles: rows at 0, 108, 216 and a last row at 324 holding tile 9.
    expect(range(grid(10), 300, 1000)).toEqual({ first: 6, last: 9 });
  });

  it("finds a range deep in a large grid", () => {
    const g = grid(2531);
    const scrollTop = 60 * 108; // the top of row 60
    expect(range(g, scrollTop, 216)).toEqual({ first: 180, last: 185 });
  });

  it("returns null for an empty grid, a view with no height, or a view past the end", () => {
    expect(range(grid(0), 0, 500)).toBeNull();
    expect(range(grid(30), 0, 0)).toBeNull();
    expect(range(grid(3), 5000, 100)).toBeNull();
  });
});

describe("rangeLabel", () => {
  it("says which illustrations are on screen", () => {
    expect(rangeLabel({ first: 180, last: 224 }, 2531, false)).toBe("Showing 181 to 225 of 2,531");
  });

  it("calls a narrowed list matches", () => {
    expect(rangeLabel({ first: 0, last: 11 }, 1204, true)).toBe("Showing 1 to 12 of 1,204 matches");
    expect(rangeLabel({ first: 0, last: 0 }, 1, true)).toBe("Showing 1 to 1 of 1 match");
  });

  it("shows the count alone before the grid is measured", () => {
    expect(rangeLabel(null, 2531, false)).toBe("2,531");
    expect(rangeLabel(null, 12, true)).toBe("12 matches");
  });

  it("handles nothing to show", () => {
    expect(rangeLabel(null, 0, true)).toBe("No matches");
    expect(rangeLabel(null, 0, false)).toBe("No illustrations");
  });
});
