import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";
import { analyseSvg, artworkText } from "./lib/svgParts";

const DRAWING =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">' +
  "<style>.a{fill:#c5f8f6}.b{fill:#465b5a}</style>" +
  '<g id="Layer_1">' +
  '<g id="nucleus"><circle class="a" cx="50" cy="50" r="20"/><circle class="b" cx="50" cy="50" r="5"/></g>' +
  '<path class="b" d="M100 10h50v50z"/>' +
  "</g></svg>";

const state = () => useStore.getState();
const element = () => state().elements.find((el) => el.id === state().partEdit?.elementId) ?? state().elements[0];
const fills = () => {
  const a = analyseSvg(artworkText(element()));
  return a.leaves.map((i) => (a.nodes[i].hidden ? "hidden" : a.nodes[i].paint.fill));
};

describe("editing parts of an illustration", () => {
  let id;
  beforeEach(() => {
    state().newDocument();
    id = state().addSvgArtwork({ svgSource: DRAWING, name: "Cell" });
    expect(state().enterPartEdit(id)).toBe(true);
  });

  // The <style> element is the drawing's first child, so the layer group is "1".
  it("starts inside the drawing's layer group, with the element selected", () => {
    expect(state().partEdit).toEqual({ elementId: id, container: "1", selected: [] });
    expect(state().selectedIds).toEqual([id]);
  });

  it("recolours a selected part only, as one undo step", () => {
    state().setPartSelection(["1.0"]);
    state().updateParts(["1.0"], { colors: { "#465b5a": "#ff8800" } });
    expect(fills()).toEqual(["#c5f8f6", "#ff8800", "#465b5a"]);
    state().undo();
    expect(fills()).toEqual(["#c5f8f6", "#465b5a", "#465b5a"]);
    expect(state().partEdit).not.toBeNull();
  });

  it("hides and resets parts", () => {
    state().setPartSelection(["1.1"]);
    state().hideSelectedParts();
    expect(fills()[2]).toBe("hidden");
    state().resetParts(["1.1"]);
    expect(element().partEdits).toEqual({});
  });

  it("nudges parts in drawing units", () => {
    state().setPartSelection(["1.1"]);
    state().nudgeParts(5, 0);
    // The element was placed smaller than the drawing, so 5 on the page is more in drawing units.
    const { dx } = element().partEdits["1.1"];
    expect(dx).toBeCloseTo((5 * 200) / element().width, 6);
  });

  it("goes into a group and back out, then finishes", () => {
    state().openPartGroup("1.0");
    expect(state().partEdit.container).toBe("1.0");
    state().partEditBack();
    expect(state().partEdit).toMatchObject({ container: "1", selected: ["1.0"] });
    state().partEditBack();
    expect(state().partEdit.selected).toEqual([]);
    state().partEditBack();
    expect(state().partEdit).toBeNull();
  });

  it("will not open a shape as if it were a group", () => {
    state().openPartGroup("1.1");
    expect(state().partEdit.container).toBe("1");
  });

  it("finishes when the element is deselected, deleted or locked", () => {
    state().clearSelection();
    expect(state().partEdit).toBeNull();

    state().enterPartEdit(id);
    state().updateElement(id, { locked: true });
    expect(state().partEdit).toBeNull();
    expect(state().enterPartEdit(id)).toBe(false);
  });

  it("refuses anything that is not an illustration", () => {
    const box = state().addShape("rect");
    expect(state().enterPartEdit(box)).toBe(false);
  });
});
