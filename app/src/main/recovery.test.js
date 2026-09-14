import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createRecovery } = require("./recovery.js");

const snapshot = (label) =>
  JSON.stringify({ format: "morphly-recovery", savedAt: "2026-09-14T10:00:00.000Z", label, document: { pages: [] } });

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "morphly-recovery-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("crash recovery", () => {
  it("has nothing to offer on a first launch", async () => {
    expect(await createRecovery(dir).read()).toBeNull();
  });

  it("gives back what was written, in a folder it creates itself", async () => {
    const recovery = createRecovery(path.join(dir, "not-yet-there"));
    expect(await recovery.write(snapshot("a"))).toEqual({ written: true });
    expect(await recovery.read()).toMatchObject({ label: "a", document: { pages: [] } });
  });

  it("keeps the newest of several quick writes and leaves no temporary file", async () => {
    const recovery = createRecovery(dir);
    await Promise.all([recovery.write(snapshot("1")), recovery.write(snapshot("2")), recovery.write(snapshot("3"))]);
    expect((await recovery.read()).label).toBe("3");
    expect(fs.readdirSync(dir)).toEqual(["recovery.json"]);
  });

  it("removes the copy when asked, even with a write still queued", async () => {
    const recovery = createRecovery(dir);
    const pending = recovery.write(snapshot("a"));
    await recovery.clear();
    await pending;
    expect(await recovery.read()).toBeNull();
  });

  it("removes the copy on a normal close and ignores anything sent afterwards", async () => {
    const recovery = createRecovery(dir);
    await recovery.write(snapshot("a"));
    const late = recovery.write(snapshot("b"));
    recovery.close();
    expect(fs.existsSync(recovery.file)).toBe(false);
    expect(await late).toEqual({ written: false, reason: "closed" });
    expect(await recovery.write(snapshot("c"))).toEqual({ written: false, reason: "closed" });
    expect(await recovery.read()).toBeNull();
  });

  it("accepts writes again once a new window opens", async () => {
    const recovery = createRecovery(dir);
    await recovery.close();
    recovery.open();
    expect(await recovery.write(snapshot("again"))).toEqual({ written: true });
  });

  it("skips figures too large to copy", async () => {
    const recovery = createRecovery(dir, { maxBytes: 50 });
    expect(await recovery.write(snapshot("x".repeat(100)))).toEqual({ written: false, reason: "too-large" });
    expect(await recovery.read()).toBeNull();
  });

  it("refuses anything that is not text", async () => {
    expect(await createRecovery(dir).write({ document: {} })).toEqual({ written: false, reason: "invalid" });
  });

  it("throws away a damaged copy instead of offering it", async () => {
    const recovery = createRecovery(dir);
    fs.writeFileSync(recovery.file, '{"format":"morphly-recovery","docum');
    expect(await recovery.read()).toBeNull();
    expect(fs.existsSync(recovery.file)).toBe(false);

    fs.writeFileSync(recovery.file, JSON.stringify({ savedAt: "yesterday" }));
    expect(await recovery.read()).toBeNull();
  });
});
