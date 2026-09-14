/**
 * Crash recovery: a spare copy of the figure being edited.
 *
 * While a figure has unsaved changes the renderer sends a snapshot here every
 * so often, and it is written to Morphly's own data folder. It is never written
 * to the user's file: saving stays something only the user does, so a figure
 * on disk never changes behind their back.
 *
 * A normal close removes the copy, as do saving and starting a new figure. So
 * a copy still present at launch means Morphly stopped without closing, and
 * the user is offered their work back.
 *
 * Kept free of Electron so it can be tested on its own; main.js decides where
 * the folder is.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

/** Figures with many embedded images can be large; past this, skip the copy
 *  rather than fill the disk. */
const MAX_RECOVERY_BYTES = 512 * 1024 * 1024;

function createRecovery(dir, { maxBytes = MAX_RECOVERY_BYTES } = {}) {
  const file = path.join(dir, "recovery.json");
  const temp = `${file}.tmp`;
  let closed = false;

  // Writes and removals run one after another, so a slow older snapshot can
  // never land on top of a newer one, or reappear after a removal.
  let queue = Promise.resolve();
  const enqueue = (job) => {
    const run = queue.then(job);
    queue = run.catch(() => {});
    return run;
  };

  return {
    file,

    /** Store a snapshot (a JSON string). Resolves to { written, reason }. */
    write(json) {
      if (typeof json !== "string") return Promise.resolve({ written: false, reason: "invalid" });
      if (Buffer.byteLength(json, "utf8") > maxBytes) {
        return Promise.resolve({ written: false, reason: "too-large" });
      }
      return enqueue(async () => {
        if (closed) return { written: false, reason: "closed" };
        await fsp.mkdir(dir, { recursive: true });
        // Write beside the real file and swap it in, so a crash halfway
        // through a write leaves the previous copy intact.
        await fsp.writeFile(temp, json, "utf8");
        if (closed) {
          await fsp.rm(temp, { force: true });
          return { written: false, reason: "closed" };
        }
        await fsp.rename(temp, file);
        return { written: true };
      });
    },

    /** The snapshot left behind, or null. A damaged one is removed. */
    async read() {
      let text;
      try {
        text = await fsp.readFile(file, "utf8");
      } catch {
        return null;
      }
      try {
        const snapshot = JSON.parse(text);
        if (snapshot && typeof snapshot === "object" && snapshot.document) return snapshot;
      } catch {
        /* fall through: half a file is no use to anyone */
      }
      await fsp.rm(file, { force: true });
      return null;
    },

    clear() {
      return enqueue(() => fsp.rm(file, { force: true }));
    },

    /**
     * The window closed normally. Remove the copy straight away (the process
     * may exit before a promise would settle), refuse further writes, and
     * remove it once more after any write that was already under way.
     */
    close() {
      closed = true;
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* nothing to remove */
      }
      return enqueue(() => fsp.rm(file, { force: true }));
    },

    /** A new window opened (macOS keeps the app running without one). */
    open() {
      closed = false;
    },
  };
}

module.exports = { createRecovery, MAX_RECOVERY_BYTES };
