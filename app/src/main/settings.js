/**
 * Persisted app settings, stored in the OS user-data directory so they survive
 * reinstalls of the project folder and are never committed to git.
 *
 * Morphly can read asset libraries from anywhere on disk. Packaged builds also
 * ship both libraries inside the installer, so the app works offline the moment
 * it is opened; those are mounted automatically on first run and can be removed
 * or added to like any other folder.
 */

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const crypto = require("node:crypto");

const DEFAULTS = {
  /** [{ key, dir }] -- several libraries can be mounted at once. */
  libraries: [],
  recentProjects: [],
  /** Welcome screen shows until the user opts out of it. */
  showWelcome: true,
};

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

/**
 * Library folders shipped inside the installer.
 *
 * Packaged builds carry them under `resources/libraries/`; running from source
 * there is nothing there, and the repo copies beside the app folder are used
 * instead, so development behaves the same as an install.
 */
function bundledLibraryDirs() {
  const roots = app.isPackaged
    ? [path.join(process.resourcesPath, "libraries")]
    : [path.join(__dirname, "..", "..", "..")];

  const dirs = [];
  for (const root of roots) {
    for (const name of ["bioart_library", "bioicons_library"]) {
      const dir = path.join(root, name);
      try {
        // Only offer a folder that actually holds a manifest: a half-copied or
        // missing library should not be mounted as an empty one.
        fsSync.accessSync(path.join(dir, "manifest.json"));
        dirs.push(dir);
      } catch {
        /* not shipped in this build, or not fetched yet */
      }
    }
  }
  return dirs;
}

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

  // First run: mount whatever the build ships with, so the app is usable
  // immediately rather than opening on an empty sidebar and a folder picker.
  if (!raw.librariesInitialised && settings.libraries.length === 0) {
    settings.libraries = bundledLibraryDirs().map((dir) => ({ key: libraryKey(dir), dir }));
  }

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
