import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

const state = () => useStore.getState();
const styleOf = (id) => state().elements.find((el) => el.id === id).fontStyle;

describe("bold and italic (Ctrl+B, Ctrl+I)", () => {
  beforeEach(() => state().newDocument());

  it("turns each on and off, in the spellings the panel offers", () => {
    const id = state().addText();
    expect(styleOf(id)).toBe("normal");
    state().toggleTextStyle("bold");
    expect(styleOf(id)).toBe("bold");
    state().toggleTextStyle("italic");
    expect(styleOf(id)).toBe("italic bold");
    state().toggleTextStyle("bold");
    expect(styleOf(id)).toBe("italic");
    state().toggleTextStyle("italic");
    expect(styleOf(id)).toBe("normal");
  });

  it("can be undone", () => {
    const id = state().addText();
    state().toggleTextStyle("bold");
    state().undo();
    expect(styleOf(id)).toBe("normal");
  });

  it("makes a mixed selection agree, following the first", () => {
    const a = state().addText();
    const b = state().addText();
    state().updateElement(b, { fontStyle: "bold" });
    state().setSelection([a, b]);
    state().toggleTextStyle("bold");
    expect([styleOf(a), styleOf(b)]).toEqual(["bold", "bold"]);
  });

  it("works on one element by id, for text being edited in place", () => {
    const a = state().addText();
    const b = state().addText();
    state().setSelection([]);
    state().toggleTextStyle("italic", a);
    expect([styleOf(a), styleOf(b)]).toEqual(["italic", "normal"]);
  });

  it("leaves shapes, locked text and empty selections alone", () => {
    const shape = state().addShape("rect");
    state().setSelection([shape]);
    state().toggleTextStyle("bold");
    expect(state().elements.find((el) => el.id === shape).fontStyle).toBeUndefined();

    const id = state().addText();
    state().updateElement(id, { locked: true });
    state().setSelection([id]);
    state().toggleTextStyle("bold");
    expect(styleOf(id)).toBe("normal");
  });
});
