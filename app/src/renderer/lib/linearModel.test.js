import { describe, it, expect } from "vitest";
import { fitRss, ones, factorColumns, interactionColumns } from "./linearModel";

describe("least squares", () => {
  it("leaves nothing behind when the columns explain the data", () => {
    const y = [2, 4, 6, 8];
    const x = [1, 2, 3, 4];
    const { rss, rank } = fitRss([ones(4), x], y);
    expect(rss).toBeLessThan(1e-20);
    expect(rank).toBe(2);
  });

  it("measures what is left over", () => {
    // y on an intercept alone leaves the sum of squares about the mean.
    const y = [1, 2, 3, 4];
    expect(fitRss([ones(4)], y).rss).toBeCloseTo(5, 10);
  });

  it("drops a column that repeats what is already there", () => {
    const x = [1, 2, 3, 4];
    const twice = x.map((v) => v * 2);
    const { rank } = fitRss([ones(4), x, twice], [1, 3, 2, 5]);
    expect(rank).toBe(2);
  });

  it("codes a factor as one column per level after the first", () => {
    const columns = factorColumns(["a", "b", "a", "c"], ["a", "b", "c"]);
    expect(columns).toEqual([
      [0, 1, 0, 0],
      [0, 0, 0, 1],
    ]);
  });

  it("multiplies every pair for an interaction", () => {
    expect(interactionColumns([[1, 0]], [[1, 1]])).toEqual([[1, 0]]);
    expect(interactionColumns([[1, 0], [0, 1]], [[1, 1]])).toHaveLength(2);
  });
});
