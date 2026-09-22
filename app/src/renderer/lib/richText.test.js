import { describe, it, expect } from "vitest";
import {
  plainText,
  runsOf,
  mergeRuns,
  applyMarks,
  marksIn,
  layoutRichText,
  hasFormatting,
  sizeOf,
  riseOf,
  SMALL,
} from "./richText";

/** A measurer with no window: every character is half the font size wide. */
const measure = (text, size) => text.length * size * 0.5;
const layout = (runs, over = {}) =>
  layoutRichText({ runs, width: 100, fontSize: 10, lineHeight: 1.2, measure, ...over });
const texts = (result) => result.lines.map((l) => l.pieces.map((p) => p.text).join(""));

describe("runs and plain text", () => {
  it("falls back to one plain run, and prefers the plain text if they disagree", () => {
    expect(runsOf({ text: "Hello" })).toEqual([{ text: "Hello" }]);
    expect(runsOf({ text: "" })).toEqual([]);
    expect(runsOf({ text: "Hi", runs: [{ text: "Hi", bold: true }] })).toEqual([{ text: "Hi", bold: true }]);
    // Runs that no longer match the text are ignored rather than trusted.
    expect(runsOf({ text: "Hello", runs: [{ text: "Stale" }] })).toEqual([{ text: "Hello" }]);
  });

  it("joins neighbours with the same marks and drops empty runs", () => {
    expect(mergeRuns([{ text: "a" }, { text: "" }, { text: "b" }])).toEqual([{ text: "ab" }]);
    expect(mergeRuns([{ text: "a", bold: true }, { text: "b", bold: true }, { text: "c" }])).toEqual([
      { bold: true, text: "ab" },
      { text: "c" },
    ]);
  });

  it("knows when one style would do", () => {
    expect(hasFormatting([{ text: "plain" }])).toBe(false);
    expect(hasFormatting([{ text: "a", italic: true }])).toBe(true);
    expect(hasFormatting([{ text: "a" }, { text: "b", bold: true }])).toBe(true);
  });
});

describe("applyMarks", () => {
  const runs = [{ text: "Hello world" }];

  it("marks a stretch of characters", () => {
    expect(applyMarks(runs, 6, 11, { bold: true })).toEqual([
      { text: "Hello " },
      { text: "world", bold: true },
    ]);
  });

  it("removes a mark again, and joins what is left", () => {
    const bold = applyMarks(runs, 0, 5, { bold: true });
    expect(applyMarks(bold, 0, 5, { bold: false })).toEqual([{ text: "Hello world" }]);
  });

  it("treats superscript and subscript as one mark", () => {
    const sup = applyMarks([{ text: "CO2" }], 2, 3, { baseline: "super" });
    expect(applyMarks(sup, 2, 3, { baseline: "sub" })).toEqual([
      { text: "CO" },
      { text: "2", baseline: "sub" },
    ]);
  });

  it("keeps marks that are already there, and adds colour", () => {
    const italic = applyMarks(runs, 0, 5, { italic: true });
    expect(applyMarks(italic, 0, 11, { color: "#d1495b" })).toEqual([
      { italic: true, color: "#d1495b", text: "Hello" },
      { color: "#d1495b", text: " world" },
    ]);
  });

  it("does nothing without a selection, and clamps out-of-range offsets", () => {
    expect(applyMarks(runs, 4, 4, { bold: true })).toEqual(runs);
    expect(applyMarks(runs, -5, 99, { bold: true })).toEqual([{ text: "Hello world", bold: true }]);
  });
});

describe("marksIn", () => {
  const runs = [
    { text: "Hello ", bold: true },
    { text: "world" },
  ];

  it("reports true, false and mixed", () => {
    expect(marksIn(runs, 0, 5).bold).toBe(true);
    expect(marksIn(runs, 6, 11).bold).toBe(false);
    expect(marksIn(runs, 0, 11).bold).toBe("mixed");
  });

  it("reports the character before the caret when nothing is selected", () => {
    expect(marksIn(runs, 3, 3).bold).toBe(true);
    expect(marksIn(runs, 8, 8).bold).toBe(false);
    expect(marksIn(runs, 0, 0).bold).toBe(false);
  });
});

describe("layoutRichText", () => {
  it("wraps on words and places each line's baseline", () => {
    const result = layout([{ text: "aaaa bbbb cccc dddd eeee" }]);
    // Each character is 5 wide, so 20 fit on a 100 wide line, and the space a
    // line ends on stays with it.
    expect(texts(result)).toEqual(["aaaa bbbb cccc dddd ", "eeee"]);
    expect(result.lines[0].y).toBeCloseTo(0.8 * 12, 6);
    expect(result.lines[1].y).toBeCloseTo(1.8 * 12, 6);
    expect(result.height).toBeCloseTo(24, 6);
  });

  it("always breaks on a newline", () => {
    expect(texts(layout([{ text: "one\ntwo" }]))).toEqual(["one", "two"]);
    expect(texts(layout([{ text: "a" }, { text: "\nb", bold: true }]))).toEqual(["a", "b"]);
  });

  it("carries marks through to the pieces, with smaller shifted subscripts", () => {
    const result = layout([{ text: "CO" }, { text: "2", baseline: "sub" }, { text: " uptake" }]);
    const [co, two] = result.lines[0].pieces;
    expect(co.size).toBe(10);
    expect(two.size).toBeCloseTo(10 * SMALL, 6);
    expect(two.rise).toBeGreaterThan(0);
    expect(two.run.baseline).toBe("sub");
    expect(two.x).toBeCloseTo(co.width, 6);
  });

  it("raises a superscript and keeps it above the line", () => {
    const [, sup] = layout([{ text: "10" }, { text: "-3", baseline: "super" }]).lines[0].pieces;
    expect(sup.rise).toBeLessThan(0);
    expect(sizeOf({ baseline: "super" }, 10)).toBeCloseTo(7.2, 6);
    expect(riseOf({}, 10)).toBe(0);
  });

  it("centres and right aligns, ignoring trailing spaces", () => {
    const centred = layout([{ text: "ab " }], { align: "center" });
    // "ab" is 10 wide in a 100 box, so it starts at 45 with the space ignored.
    expect(centred.lines[0].pieces[0].x).toBeCloseTo(45, 6);
    const right = layout([{ text: "ab" }], { align: "right" });
    expect(right.lines[0].pieces[0].x).toBeCloseTo(90, 6);
  });

  it("lets a single word overflow rather than hiding characters", () => {
    const result = layout([{ text: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].width).toBeGreaterThan(100);
  });

  it("measures bold text as wider when the measurer says so", () => {
    const wide = (text, size, style) => text.length * size * (style.bold ? 0.7 : 0.5);
    const runs = [{ text: "aaaa bbbb cccc" }, { text: " dddd", bold: true }];
    const asBold = layoutRichText({ runs, width: 100, fontSize: 10, lineHeight: 1.2, measure: wide });
    // 70 wide plain, then a bold word too wide to follow it: it wraps.
    expect(texts(asBold)).toEqual(["aaaa bbbb cccc ", "dddd"]);
    // The same text with one width for everything fits on a single line.
    const asPlain = layoutRichText({ runs, width: 100, fontSize: 10, lineHeight: 1.2, measure });
    expect(asPlain.lines).toHaveLength(1);
  });

  it("never breaks a word where its formatting changes", () => {
    // "10" and a superscript "-3" are one word: 5 characters at 5 wide is 25,
    // which does not fit after 80, so the whole thing moves down together.
    const result = layout([
      { text: "aaaaaaaaaaaaaaaa 10" },
      { text: "-3", baseline: "super" },
    ]);
    expect(texts(result)).toEqual(["aaaaaaaaaaaaaaaa ", "10-3"]);
    expect(result.lines[1].pieces.map((p) => p.text)).toEqual(["10", "-3"]);
  });

  it("handles empty text", () => {
    const result = layout([]);
    expect(result.lines).toHaveLength(1);
    expect(plainText([])).toBe("");
  });
});
