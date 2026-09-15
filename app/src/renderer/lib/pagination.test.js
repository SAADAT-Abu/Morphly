import { describe, it, expect } from "vitest";
import { PAGE_SIZE, pageCount, clampPage, pageRange } from "./pagination";

describe("pageCount", () => {
  it("rounds up to whole pages", () => {
    expect(pageCount(2531)).toBe(29);
    expect(pageCount(90)).toBe(1);
    expect(pageCount(91)).toBe(2);
  });

  it("gives an empty list one page", () => {
    expect(pageCount(0)).toBe(1);
  });
});

describe("clampPage", () => {
  it("keeps a page inside the range", () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(-4, 10)).toBe(1);
    expect(clampPage(11, 10)).toBe(10);
    expect(clampPage(7, 10)).toBe(7);
  });

  it("reads typed text and drops fractions", () => {
    expect(clampPage("3", 10)).toBe(3);
    expect(clampPage(" 4 ", 10)).toBe(4);
    expect(clampPage("2.9", 10)).toBe(2);
  });

  it("falls back to the first page for input that is not a number", () => {
    expect(clampPage("abc", 10)).toBe(1);
    expect(clampPage(undefined, 10)).toBe(1);
  });
});

describe("pageRange", () => {
  it("slices the first, a middle and the last page", () => {
    expect(pageRange(1, 2531)).toEqual({ page: 1, count: 29, start: 0, end: 90 });
    expect(pageRange(2, 2531)).toEqual({ page: 2, count: 29, start: 90, end: 180 });
    expect(pageRange(29, 2531)).toEqual({ page: 29, count: 29, start: 2520, end: 2531 });
  });

  it("shows the last page when the list shrinks under the current page", () => {
    // Page 20 of a full library, then a search leaves 100 matches.
    expect(pageRange(20, 100)).toEqual({ page: 2, count: 2, start: PAGE_SIZE, end: 100 });
  });

  it("handles an empty search", () => {
    expect(pageRange(5, 0)).toEqual({ page: 1, count: 1, start: 0, end: 0 });
  });
});
