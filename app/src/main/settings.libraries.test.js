import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// settings.js destructures `app` from electron at load time, which is harmless
// outside Electron; only the pure resolver is exercised here.
const { resolveLibraries, bundledKey } = require("./settings.js");

// An AppImage mounts itself somewhere new on every launch.
const MOUNT_A = "/tmp/.mount_MorphlyAAAAAA/resources/libraries/bioart_library";
const MOUNT_B = "/tmp/.mount_MorphlyBBBBBB/resources/libraries/bioart_library";
const nothingExists = () => false;
const everythingExists = () => true;

describe("resolveLibraries", () => {
  it("resolves a bundled name to wherever the app is mounted now", () => {
    const resolved = resolveLibraries([{ key: "old", bundled: "bioart_library" }], [MOUNT_B], nothingExists);
    expect(resolved).toEqual([{ key: bundledKey("bioart_library"), dir: MOUNT_B, bundled: "bioart_library" }]);
  });

  it("gives a bundled library the same key whatever the mount point", () => {
    const first = resolveLibraries([{ bundled: "bioart_library" }], [MOUNT_A], nothingExists);
    const second = resolveLibraries([{ bundled: "bioart_library" }], [MOUNT_B], nothingExists);
    expect(first[0].key).toBe(second[0].key);
    expect(first[0].dir).not.toBe(second[0].dir);
  });

  it("repairs a path left behind by a previous AppImage mount", () => {
    // What 0.5.1 wrote on its first run. The folder is gone, but the library is
    // inside the app, so it is re-pointed rather than reported as an error.
    const resolved = resolveLibraries([{ key: "3dab4567", dir: MOUNT_A }], [MOUNT_B], nothingExists);
    expect(resolved).toEqual([{ key: bundledKey("bioart_library"), dir: MOUNT_B, bundled: "bioart_library" }]);
  });

  it("leaves a folder the user chose alone, even when it is missing", () => {
    // An unplugged drive must not be silently rewritten to something else.
    const chosen = [{ key: "abc12345", dir: "/media/usb/my_library" }];
    expect(resolveLibraries(chosen, [MOUNT_B], nothingExists)).toEqual(chosen);
  });

  it("keeps a bundled folder that is present, without rewriting it", () => {
    // Running from source: the repo copy is both bundled and really there.
    const repo = "/home/me/Morphly/bioart_library";
    const resolved = resolveLibraries([{ key: "x", dir: repo }], [repo], everythingExists);
    expect(resolved).toEqual([{ key: "x", dir: repo }]);
  });

  it("drops a bundled name this build no longer carries", () => {
    expect(resolveLibraries([{ bundled: "bioicons_library" }], [MOUNT_B], nothingExists)).toEqual([]);
  });

  it("does not mount one folder twice", () => {
    const resolved = resolveLibraries(
      [{ bundled: "bioart_library" }, { key: "stale", dir: MOUNT_A }],
      [MOUNT_B],
      nothingExists
    );
    expect(resolved).toHaveLength(1);
  });

  it("keeps an installed pack as it is and backfills a missing key", () => {
    const pack = { dir: "/home/me/.local/share/Morphly/art-packs/bioicons", packId: "bioicons" };
    const [resolved] = resolveLibraries([pack], [MOUNT_B], everythingExists);
    expect(resolved.packId).toBe("bioicons");
    expect(resolved.key).toMatch(/^[0-9a-f]{8}$/);
  });

  it("ignores empty and malformed entries", () => {
    expect(resolveLibraries([null, undefined, {}, { key: "k" }], [MOUNT_B], nothingExists)).toEqual([]);
    expect(resolveLibraries(undefined, [MOUNT_B], nothingExists)).toEqual([]);
  });
});
