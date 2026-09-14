import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

const state = () => useStore.getState();
const byId = (id) => state().elements.find((el) => el.id === id);

describe("line styles in the store", () => {
  beforeEach(() => {
    state().newDocument();
    useStore.setState({ lineStyle: { startHead: "none", endHead: "triangle", dash: "solid" } });
  });

  it("draws new lines in the remembered style", () => {
    state().setLineStyle({ startHead: "circle", endHead: "bar", dash: "dashed" }, []);
    const id = state().addShape("line");
    expect(byId(id)).toMatchObject({ type: "arrow", name: "Arrow", startHead: "circle", endHead: "bar", dash: "dashed" });
  });

  it("names a line without ends a line", () => {
    state().setLineStyle({ endHead: "none" }, []);
    expect(byId(state().addShape("line")).name).toBe("Line");
  });

  it("always gives the arrow key's line a head", () => {
    state().setLineStyle({ startHead: "none", endHead: "none" }, []);
    expect(byId(state().addShape("arrow")).endHead).toBe("triangle");
  });

  it("restyles selected lines as one undo step, and remembers the style", () => {
    const a = state().addShape("line");
    const b = state().addShape("line");
    state().setSelection([a, b]);
    state().setLineStyle({ dash: "dotted" });
    expect([byId(a).dash, byId(b).dash]).toEqual(["dotted", "dotted"]);
    expect(state().lineStyle.dash).toBe("dotted");
    state().undo();
    expect([byId(a).dash, byId(b).dash]).toEqual(["solid", "solid"]);
  });

  it("brings an older arrow up to date without changing how it looks", () => {
    useStore.setState({
      elements: [{ id: "old", type: "arrow", name: "Arrow", x: 0, y: 0, points: [0, 0, 10, 0], heads: "both", visible: true, locked: false }],
      selectedIds: ["old"],
    });
    state().setLineStyle({ dash: "dashed" });
    const old = byId("old");
    expect(old).toMatchObject({ startHead: "triangle", endHead: "triangle", dash: "dashed" });
    expect(old.heads).toBeUndefined();
  });

  it("leaves locked lines and other shapes alone", () => {
    const line = state().addShape("line");
    const box = state().addShape("rect");
    state().updateElement(line, { locked: true });
    state().setSelection([line, box]);
    state().setLineStyle({ endHead: "circle" });
    expect(byId(line).endHead).toBe("triangle");
    expect(byId(box).endHead).toBeUndefined();
  });
});
