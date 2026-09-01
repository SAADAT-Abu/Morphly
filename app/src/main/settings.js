/**
 * Persisted app settings, stored in the OS user-data directory so they survive
 * reinstalls of the project folder and are never committed to git.
 *
 * Morphly points at asset library folders rather than bundling them: the
 * combined BioArt + Bioicons libraries run to well over a gigabyte, they are
 * reproducible from the scripts in scraper/ at any time, and keeping them out
 * means the installer stays small.
 */

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const DEFAULTS = {
  /** [{ key, dir }] -- several libraries can be mounted at once. */
  libraries: [],
  recentProjects: [],
};

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

/** Stable short id for a library folder, used in morphly-asset:// URLs. */
function libraryKey(dir) {
  return crypto.createHash("sha1").update(path.resolve(dir)).digest("hex").slice(0, 8);
}

async function readSettings() {
  let raw = {};
  try {
    raw = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
  } catch {
    return { ...DEFAULTS };
  }

  const settings = { ...DEFAULTS, ...raw };

  // Migrate the single-folder format used by v0.1.
  if (raw.libraryDir && settings.libraries.length === 0) {
    settings.libraries = [{ key: libraryKey(raw.libraryDir), dir: raw.libraryDir }];
  }
  // Backfill keys for any hand-edited entries.
  settings.libraries = settings.libraries
    .filter((l) => l && l.dir)
    .map((l) => ({ ...l, key: l.key ?? libraryKey(l.dir) }));

  return settings;
}

async function writeSettings(patch) {
  const next = { ...(await readSettings()), ...patch };
  delete next.libraryDir; // superseded by `libraries`
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

/** Resolve a library key back to its folder. */
async function libraryDirFor(key) {
  const { libraries } = await readSettings();
  return libraries.find((l) => l.key === key)?.dir ?? null;
}

module.exports = { readSettings, writeSettings, settingsPath, libraryKey, libraryDirFor };
