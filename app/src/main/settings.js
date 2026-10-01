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
  /** Ask Zenodo, at most once a day, whether a newer release exists. This is
   *  the only network request Morphly ever makes; everything else is local. */
  checkForUpdates: true,
  lastUpdateCheck: 0,
  /** Where figures are autosaved and where save and export dialogs open.
   *  Null means the default below, so it follows the user's own Pictures
   *  folder wherever their system keeps it. */
  saveFolder: null,
  /** Save figures automatically as they change. */
  autosave: true,
  /** Pane sizes in pixels. Every boundary in the workspace can be dragged
   *  (renderer lib/panes.js), and where they were left is where they open. */
  sidebarWidth: 280,
  railWidth: 300,
  layersHeight: 240,
  dataHeight: 270,
};

/** Pictures/Morphly: ~/Pictures/Morphly on Linux and macOS, Pictures\Morphly on Windows. */
function defaultSaveFolder() {
  return path.join(app.getPath("pictures"), "Morphly");
}

/** The folder figures go to, from settings. */
const saveFolderFrom = (settings) => settings.saveFolder || defaultSaveFolder();

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

/**
 * Id for a library that lives inside the app, keyed by folder name rather than
 * by path.
 *
 * An AppImage mounts itself at a fresh /tmp/.mount_MorphlyXXXXXX on every
 * launch, so the absolute path of a bundled library is different each run and
 * meaningless once the app exits.
 */
function bundledKey(name) {
  return crypto.createHash("sha1").update(`bundled:${name}`).digest("hex").slice(0, 8);
}

/** An entry for a folder this build carries, recorded by name. */
const bundledEntry = (dir) => ({
  key: bundledKey(path.basename(dir)),
  dir,
  bundled: path.basename(dir),
});

/**
 * Turn what settings.json holds into folders to mount now.
 *
 * Bundled libraries are stored as a name (`bundled: "bioart_library"`) and
 * resolved against this launch's folders, because the path they had last time
 * may no longer exist. That is not hypothetical: 0.5.x wrote the absolute path,
 * and on an AppImage the first settings write of the first run (the update check
 * persisting `lastUpdateCheck`) froze a /tmp mount point into the file. The
 * folder is gone by the second launch, and because the list was no longer empty
 * the first-run mount did not repeat, so BioArt disappeared for good.
 *
 * So an entry whose folder has gone missing, and whose name matches a library
 * this build carries, is re-pointed at the copy inside the app. A folder the
 * user chose themselves is left exactly as it is, missing or not, since a
 * removable drive that is not plugged in should not be quietly rewritten.
 */
function resolveLibraries(stored, bundledDirs, exists = (p) => fsSync.existsSync(p)) {
  const byName = new Map(bundledDirs.map((dir) => [path.basename(dir), dir]));
  const out = [];

  for (const entry of stored ?? []) {
    if (!entry) continue;

    if (entry.bundled) {
      // Dropped rather than kept if this build does not carry it, so the app
      // does not report an error about a folder the user never chose.
      const dir = byName.get(entry.bundled);
      if (dir) out.push({ ...entry, ...bundledEntry(dir) });
      continue;
    }

    if (!entry.dir) continue;
    const name = path.basename(entry.dir);
    if (byName.has(name) && !exists(path.join(entry.dir, "manifest.json"))) {
      out.push({ ...entry, ...bundledEntry(byName.get(name)) });
      continue;
    }
    out.push({ ...entry, key: entry.key ?? libraryKey(entry.dir) });
  }

  // Re-pointing two entries at one folder would mount it twice.
  const seen = new Set();
  return out.filter((l) => {
    const resolved = path.resolve(l.dir);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

async function readSettings() {
  let raw = {};
  try {
    raw = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
  } catch {
    // No settings file yet, or an unreadable one: fall through on defaults so
    // a first run still picks up the libraries the build ships with.
    raw = {};
  }

  const settings = { ...DEFAULTS, ...raw };

  // First run: mount whatever the build ships with, so the app is usable
  // immediately rather than opening on an empty sidebar and a folder picker.
  if (!raw.librariesInitialised && settings.libraries.length === 0) {
    settings.libraries = bundledLibraryDirs().map(bundledEntry);
  }

  // Migrate the single-folder format used by v0.1.
  if (raw.libraryDir && settings.libraries.length === 0) {
    settings.libraries = [{ key: libraryKey(raw.libraryDir), dir: raw.libraryDir }];
  }
  // Resolve bundled names to this launch's folders, repair a path left behind
  // by an AppImage mount, and backfill keys for any hand-edited entries.
  settings.libraries = resolveLibraries(settings.libraries, bundledLibraryDirs());

  return settings;
}

async function writeSettings(patch) {
  const next = { ...(await readSettings()), ...patch };
  delete next.libraryDir; // superseded by `libraries`
  // A bundled library is stored by name only. Writing its current path would
  // put an AppImage's mount point back in the file, which is the whole fault
  // this is here to prevent.
  next.libraries = (next.libraries ?? []).map((l) =>
    l.bundled ? { key: l.key, bundled: l.bundled, ...(l.packId ? { packId: l.packId } : {}) } : l
  );
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

/** Resolve a library key back to its folder. */
async function libraryDirFor(key) {
  const { libraries } = await readSettings();
  return libraries.find((l) => l.key === key)?.dir ?? null;
}

module.exports = { readSettings, writeSettings, settingsPath, libraryKey, bundledKey, bundledEntry,
  resolveLibraries, libraryDirFor, defaultSaveFolder, saveFolderFrom, bundledLibraryDirs };
