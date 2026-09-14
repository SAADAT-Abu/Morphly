import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { safeTitle, uniquePath, writeAtomic, renameFigure } = require("./figureFiles.js");

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "morphly-files-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("safeTitle", () => {
  it("keeps ordinary titles as they are", () => {
    expect(safeTitle("Figure 2: T cell activation")).toBe("Figure 2 T cell activation");
    expect(safeTitle("Células madre")).toBe("Células madre");
  });

  it("removes what file systems refuse", () => {
    expect(safeTitle('a/b\\c*d?"e<f>g|h')).toBe("a b c d e f g h");
    expect(safeTitle("  ..hidden. ")).toBe("hidden");
    expect(safeTitle("CON")).toBe("CON figure");
    expect(safeTitle("x".repeat(200))).toHaveLength(120);
  });

  it("names an empty title", () => {
    expect(safeTitle("   ")).toBe("Untitled figure");
    expect(safeTitle(null)).toBe("Untitled figure");
  });
});

describe("uniquePath", () => {
  it("uses the title, then numbers it when taken", async () => {
    expect(await uniquePath(dir, "Cells")).toBe(path.join(dir, "Cells.morphly"));
    fs.writeFileSync(path.join(dir, "Cells.morphly"), "{}");
    fs.writeFileSync(path.join(dir, "Cells 2.morphly"), "{}");
    expect(await uniquePath(dir, "Cells")).toBe(path.join(dir, "Cells 3.morphly"));
  });
});

describe("writeAtomic", () => {
  it("creates the folder and leaves no temporary file", async () => {
    const target = path.join(dir, "Pictures", "Morphly", "Cells.morphly");
    await writeAtomic(target, '{"a":1}');
    expect(fs.readFileSync(target, "utf8")).toBe('{"a":1}');
    expect(fs.readdirSync(path.dirname(target))).toEqual(["Cells.morphly"]);
  });
});

describe("renameFigure", () => {
  it("renames the file in its own folder", async () => {
    const original = path.join(dir, "Untitled figure.morphly");
    fs.writeFileSync(original, "{}");
    const renamed = await renameFigure(original, "Figure 1");
    expect(renamed).toBe(path.join(dir, "Figure 1.morphly"));
    expect(fs.existsSync(renamed)).toBe(true);
    expect(fs.existsSync(original)).toBe(false);
  });

  it("refuses to replace another figure", async () => {
    const a = path.join(dir, "A.morphly");
    fs.writeFileSync(a, "a");
    fs.writeFileSync(path.join(dir, "B.morphly"), "b");
    await expect(renameFigure(a, "B")).rejects.toThrow(/already in that folder/);
    expect(fs.readFileSync(path.join(dir, "B.morphly"), "utf8")).toBe("b");
  });

  it("accepts the same name, and a file that is not there yet", async () => {
    const a = path.join(dir, "A.morphly");
    fs.writeFileSync(a, "a");
    expect(await renameFigure(a, "A")).toBe(a);
    expect(await renameFigure(path.join(dir, "Gone.morphly"), "New")).toBe(path.join(dir, "New.morphly"));
  });
});
