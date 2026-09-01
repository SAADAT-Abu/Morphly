/**
 * Persisted app settings, stored in the OS user-data directory so they survive
 * reinstalls of the project folder and are never committed to git.
 *
 * Currently just remembers which folder the BioArt library lives in. Morphly
 * points at a scraped library folder rather than bundling ~2,000 SVGs into the
 * installer -- see CLAUDE.md, Phase 2 open questions.
 */

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

const DEFAULTS = {
  libraryDir: null,
  recentProjects: [],
};

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

async function readSettings() {
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

async function writeSettings(patch) {
  const next = { ...(await readSettings()), ...patch };
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { readSettings, writeSettings, settingsPath };
