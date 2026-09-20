import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";
import { marksIn, plainText, runsOf, withBase, baseMarks } from "./lib/richText";

const state = () => useStore.getState();
const elementOf = (id) => state().elements.find((el) => el.id === id);
const runsFor = (id) => {
  const el = elementOf(id);
  return withBase(runsOf(el), baseMarks(el.fontStyle));
};
const marksFor = (id) => {
  const runs = runsFor(id);
  return marksIn(runs, 0, plainText(runs).length);
};

describe("text marks on whole elements", () => {
  beforeEach(() => state().newDocument());

  it("turns each mark on and off", () => {
    const id = state().addText(null, "Hello world");
    for (const mark of ["bold", "italic", "underline", "strike"]) {
      state().toggleTextStyle(mark);
      expect(marksFor(id)[mark]).toBe(true);
      state().toggleTextStyle(mark);
      expect(marksFor(id)[mark]).toBe(false);
    }
  });

  it("swaps superscript for subscript, and off again", () => {
    const id = state().addText(null, "CO2");
    state().toggleTextStyle("super");
    expect(marksFor(id).baseline).toBe("super");
    state().toggleTextStyle("sub");
    expect(marksFor(id).baseline).toBe("sub");
    state().toggleTextStyle("sub");
    expect(marksFor(id).baseline).toBe(false);
  });

  it("keeps plain text free of runs, so old figures stay as they were", () => {
    const id = state().addText(null, "Plain");
    expect(elementOf(id).runs).toBeUndefined();
    state().toggleTextStyle("bold");
    expect(elementOf(id).runs).toEqual([{ bold: true, text: "Plain" }]);
    state().toggleTextStyle("bold");
    expect(elementOf(id).runs).toBeUndefined();
    expect(elementOf(id).text).toBe("Plain");
  });

  it("folds an old element-wide style into the runs once, and only once", () => {
    const id = state().addText(null, "Gene");
    state().updateElement(id, { fontStyle: "italic bold" });
    state().applyTextMarks(id, { bold: false }, { start: 0, end: 4 });
    expect(elementOf(id).fontStyle).toBe("normal");
    expect(elementOf(id).runs).toEqual([{ italic: true, text: "Gene" }]);
  });

  it("marks part of the text, leaving the rest alone", () => {
    const id = state().addText(null, "CO2 uptake");
    state().applyTextMarks(id, { baseline: "sub" }, { start: 2, end: 3 });
    expect(elementOf(id).runs).toEqual([
      { text: "CO" },
      { baseline: "sub", text: "2" },
      { text: " uptake" },
    ]);
    expect(elementOf(id).text).toBe("CO2 uptake");
    expect(marksFor(id).baseline).toBe("mixed");
  });

  it("colours a word", () => {
    const id = state().addText(null, "Red word");
    state().applyTextMarks(id, { color: "#d1495b" }, { start: 0, end: 3 });
    expect(elementOf(id).runs[0]).toEqual({ color: "#d1495b", text: "Red" });
  });

  it("can be undone", () => {
    const id = state().addText(null, "Hello");
    state().toggleTextStyle("bold");
    state().undo();
    expect(elementOf(id).runs).toBeUndefined();
  });

  it("makes a mixed selection agree, following the first", () => {
    const a = state().addText(null, "one");
    const b = state().addText(null, "two");
    state().applyTextMarks(b, { bold: true });
    state().setSelection([a, b]);
    state().toggleTextStyle("bold");
    expect([marksFor(a).bold, marksFor(b).bold]).toEqual([true, true]);
  });

  it("works on one element by id, for text being edited in place", () => {
    const a = state().addText(null, "one");
    const b = state().addText(null, "two");
    state().setSelection([]);
    state().toggleTextStyle("italic", a);
    expect([marksFor(a).italic, marksFor(b).italic]).toEqual([true, false]);
  });

  it("leaves shapes, locked text and empty selections alone", () => {
    const shape = state().addShape("rect");
    state().setSelection([shape]);
    state().toggleTextStyle("bold");
    expect(elementOf(shape).runs).toBeUndefined();

    const id = state().addText(null, "Locked");
    state().updateElement(id, { locked: true });
    state().setSelection([id]);
    state().toggleTextStyle("bold");
    expect(elementOf(id).runs).toBeUndefined();
  });

  it("stores a caption's formatting separately from a text element's", () => {
    const shape = state().addShape("rect");
    state().updateElement(shape, { label: "Nucleus" });
    state().applyTextMarks(shape, { italic: true }, { start: 0, end: 7, field: "label" });
    expect(elementOf(shape).labelRuns).toEqual([{ italic: true, text: "Nucleus" }]);
    expect(elementOf(shape).runs).toBeUndefined();
  });

  it("writes text and runs together as the editor types", () => {
    const id = state().addText(null, "old");
    state().setRichText(id, { text: "new", runs: [{ text: "ne" }, { text: "w", bold: true }] });
    expect(elementOf(id).text).toBe("new");
    expect(elementOf(id).runs).toHaveLength(2);
    // A word typed after that is one undo step, not one per letter.
    const past = state().past.length;
    state().setRichText(id, { text: "news", runs: [{ text: "news" }] }, { commit: false });
    expect(state().past.length).toBe(past);
    expect(elementOf(id).runs).toBeUndefined();
  });
});
