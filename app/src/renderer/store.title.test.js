import { describe, it, expect, beforeEach } from "vitest";
import { useStore, titleFromPath } from "./store";

const state = () => useStore.getState();

describe("figure titles", () => {
  beforeEach(() => {
    state().newDocument();
  });

  it("starts untitled and unchanged", () => {
    expect(state()).toMatchObject({ title: "Untitled figure", projectPath: null, dirty: false });
  });

  it("counts renaming an unsaved figure as a change, so autosave picks it up", () => {
    state().setTitle("  Figure 3  ");
    expect(state()).toMatchObject({ title: "Figure 3", dirty: true });
  });

  it("ignores renaming to the same or an empty name", () => {
    state().setTitle("Untitled figure");
    expect(state().dirty).toBe(false);
    state().setTitle("   ");
    expect(state().dirty).toBe(false);
  });

  it("takes its title from the file once saved or opened", () => {
    state().markSaved("/home/me/Pictures/Morphly/T cells.morphly");
    expect(state()).toMatchObject({ title: "T cells", dirty: false });

    state().loadDocument({ pages: [{ id: "p", name: "Figure 1", canvas: {}, elements: [] }] }, "C:\\Figures\\Spleen.morphly");
    expect(state().title).toBe("Spleen");
  });

  it("follows a renamed file without claiming unsaved work is saved", () => {
    state().addShape("rect");
    state().setProjectPath("/tmp/Renamed.morphly");
    expect(state()).toMatchObject({ title: "Renamed", dirty: true });
  });

  it("reads titles from paths on any system", () => {
    expect(titleFromPath("/a/b/Figure 1.morphly")).toBe("Figure 1");
    expect(titleFromPath("D:\\x\\y.MORPHLY")).toBe("y");
    expect(titleFromPath(null)).toBe("Untitled figure");
  });
});
