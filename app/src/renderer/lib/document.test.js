import { describe, it, expect } from "vitest";
import { migrate, serialise, CURRENT_VERSION, FORMAT, DocumentError } from "./document";

const page = (over = {}) => ({
  id: "pg_1",
  name: "Figure 1",
  canvas: { width: 1200, height: 800, background: "#ffffff" },
  elements: [{ id: "el_1", type: "rect", x: 0, y: 0 }],
  ...over,
});

describe("migrate", () => {
  it("opens a version 1 figure as a one-page document", () => {
    const v1 = {
      format: FORMAT,
      version: 1,
      canvas: { width: 1200, height: 1200, background: "#fffef5" },
      elements: [{ id: "a", type: "rect" }],
    };
    const doc = migrate(v1);
    expect(doc.version).toBe(CURRENT_VERSION);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].name).toBe("Figure 1");
    expect(doc.pages[0].canvas).toEqual(v1.canvas);
    expect(doc.pages[0].elements).toEqual(v1.elements);
  });

  it("treats an unversioned file with top-level elements as version 1", () => {
    const doc = migrate({ canvas: { width: 10, height: 10 }, elements: [] });
    expect(doc.pages).toHaveLength(1);
    expect(doc.version).toBe(CURRENT_VERSION);
  });

  it("treats an unversioned file with pages as version 2", () => {
    const doc = migrate({ pages: [page()] });
    expect(doc.pages).toEqual([page()]);
  });

  it("brings version 2 up to date without changing its pages", () => {
    const v2 = { format: FORMAT, version: 2, pages: [page(), page({ id: "pg_2" })], activePageId: "pg_2" };
    const doc = migrate(v2);
    expect(doc.version).toBe(CURRENT_VERSION);
    expect(doc.pages).toEqual(v2.pages);
    expect(doc.activePageId).toBe("pg_2");
  });

  it("leaves a current figure as it is", () => {
    const current = { format: FORMAT, version: CURRENT_VERSION, pages: [page()], activePageId: "pg_1" };
    expect(migrate(current)).toEqual(current);
  });

  it("does not modify the object it is given", () => {
    const v1 = { format: FORMAT, version: 1, canvas: { width: 5, height: 5 }, elements: [] };
    const before = JSON.parse(JSON.stringify(v1));
    migrate(v1);
    expect(v1).toEqual(before);
  });

  it("refuses a figure saved by a newer Morphly", () => {
    const future = { format: FORMAT, version: CURRENT_VERSION + 1, pages: [page()] };
    expect(() => migrate(future)).toThrow(DocumentError);
    expect(() => migrate(future)).toThrow(/newer version of Morphly/);
  });

  it("refuses things that are not Morphly figures", () => {
    for (const bad of [null, undefined, "figure", 42, [], { format: "something-else", version: 2, pages: [page()] }]) {
      expect(() => migrate(bad)).toThrow(DocumentError);
    }
  });

  it("refuses a nonsense version number", () => {
    for (const version of ["2", 0, -1, 1.5]) {
      expect(() => migrate({ format: FORMAT, version, pages: [page()] })).toThrow(DocumentError);
    }
  });

  it("refuses a figure with no pages", () => {
    expect(() => migrate({ format: FORMAT, version: 2, pages: [] })).toThrow(/no pages/);
    expect(() => migrate({ format: FORMAT, version: CURRENT_VERSION })).toThrow(/no pages/);
  });
});

describe("serialise", () => {
  it("always writes the current format and version", () => {
    expect(serialise({ pages: [page()], activePageId: "pg_1" })).toEqual({
      format: FORMAT,
      version: CURRENT_VERSION,
      pages: [page()],
      activePageId: "pg_1",
      datasets: [],
    });
  });

  it("saves the datasets beside the pages", () => {
    const datasets = [{ id: "ds_1", name: "Viability", kind: "groups", columns: [{ name: "A", values: ["1"] }] }];
    const saved = serialise({ pages: [page()], activePageId: "pg_1", datasets });
    expect(saved.datasets).toBe(datasets);
    expect(migrate(JSON.parse(JSON.stringify(saved))).datasets).toEqual(datasets);
  });

  it("gives a 0.4 figure (version 3) an empty list of datasets", () => {
    const old = { format: FORMAT, version: 3, pages: [page()], activePageId: "pg_1" };
    const doc = migrate(old);
    expect(doc.version).toBe(4);
    expect(doc.datasets).toEqual([]);
  });

  it("round-trips through a save and an open", () => {
    const saved = serialise({ pages: [page(), page({ id: "pg_2", name: "Panel B" })], activePageId: "pg_2" });
    expect(migrate(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
});
