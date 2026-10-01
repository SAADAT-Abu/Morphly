import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { findBundledDir, summariseManifest, describeBundled } = require("./bundledPacks.js");

let root;
let bioart;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "morphly-bundled-"));
  bioart = path.join(root, "bioart_library");
  fs.mkdirSync(bioart);
  fs.writeFileSync(
    path.join(bioart, "manifest.json"),
    JSON.stringify([
      { id: 1, title: "Cell", category: "Cells", license: "Public Domain",
        local_files: [{ group_id: "a", files: { SVG: "cells/1.svg" } },
                      { group_id: "b", files: { SVG: "cells/1b.svg" } }] },
      { id: 2, title: "Mouse", category: "Animals", license: "Public Domain",
        local_files: [{ group_id: "a", files: { SVG: "animals/2.svg" } }] },
      // A brush-type entry: Illustrator only, so nothing to show.
      { id: 3, title: "Brush", category: "Brushes", license: null, local_files: [] },
      { id: 4, title: "Borrowed", category: "Animals", license: "CC BY 4.0",
        share_alike: true, local_files: [{ group_id: "a", files: { SVG: "animals/4.svg" } }] },
    ])
  );
  // A folder that is bundled but not described, and must not become a card.
  fs.mkdirSync(path.join(root, "bioicons_library"));
  fs.writeFileSync(path.join(root, "bioicons_library", "manifest.json"), "[]");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("summariseManifest", () => {
  it("counts one illustration per entry, not per colour variant", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(bioart, "manifest.json"), "utf8"));
    const summary = summariseManifest(manifest);
    // Four entries, one of which has no SVG; the first has two variants.
    expect(summary.entries).toBe(3);
    expect(summary.categories).toEqual({ Cells: 1, Animals: 2 });
  });

  it("reads the licence the way the sidebar does", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(bioart, "manifest.json"), "utf8"));
    const summary = summariseManifest(manifest);
    // Public Domain needs no credit; the CC BY one does, and is share-alike.
    expect(summary.requiresAttribution).toBe(1);
    expect(summary.shareAlike).toBe(1);
  });
});

describe("describeBundled", () => {
  it("describes BioArt and leaves other bundled folders alone", async () => {
    const packs = await describeBundled([
      path.join(root, "bioart_library"),
      path.join(root, "bioicons_library"),
    ]);
    expect(packs).toHaveLength(1);
    expect(packs[0].id).toBe("bioart-included");
    expect(packs[0].bundled).toBe(true);
    expect(packs[0].entries).toBe(3);
    // It hides the downloadable pack of the same artwork.
    expect(packs[0].supersedes).toBe("bioart");
  });

  it("reports whether the folder is currently mounted", async () => {
    const [unmounted] = await describeBundled([bioart], [{ dir: "/somewhere/else" }]);
    expect(unmounted.installed).toBe(false);
    const [mounted] = await describeBundled([bioart], [{ dir: path.join(bioart, ".") }]);
    expect(mounted.installed).toBe(true);
  });

  it("leaves out a folder whose manifest cannot be read", async () => {
    const broken = path.join(root, "bioart_library_broken");
    fs.mkdirSync(broken, { recursive: true });
    expect(await describeBundled([broken])).toEqual([]);
    fs.writeFileSync(path.join(broken, "manifest.json"), "{ not json");
    expect(await describeBundled([broken])).toEqual([]);
  });
});

describe("findBundledDir", () => {
  it("maps a pack id back to the folder this build carries", () => {
    expect(findBundledDir([bioart], "bioart-included")).toBe(bioart);
  });

  it("refuses an id this build does not carry", () => {
    // The renderer sends the id back; a miss must not become a mounted path.
    expect(findBundledDir([bioart], "bioart")).toBeNull();
    expect(findBundledDir([bioart], "../../etc")).toBeNull();
    expect(findBundledDir([], "bioart-included")).toBeNull();
  });
});
