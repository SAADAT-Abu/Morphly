/**
 * The illustration library that ships inside the installer, described in the
 * same shape as a downloadable Art Pack so the Art Store can list it.
 *
 * Morphly bundles NIH BioArt (see `extraResources` in package.json) and mounts
 * it on first launch, so the app is useful offline with nothing to download.
 * It was invisible in the Art Store, which had two awkward consequences: it
 * read as though BioArt were not included at all, and a user who removed it
 * from the sidebar had no way to put it back, because `library:remove` sets
 * `librariesInitialised` so the next launch does not silently re-mount what
 * they just removed.
 *
 * Listing it here fixes both. A bundled entry carries `bundled: true`, has no
 * download URL and no size, and installing it only mounts the folder that is
 * already inside the app.
 *
 * Counts are read from the manifest rather than written down here, so they
 * cannot drift from what the build actually carries. The licence rule matches
 * `library.js`, so the card and the sidebar badges agree.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * Keyed by folder name, because that is what the build copies in.
 *
 * Only BioArt is described. `bundledLibraryDirs()` also looks for
 * `bioicons_library`, which exists beside the repo when running from source,
 * and surfacing that would collide with the Bioicons Art Pack: same artwork,
 * different id, two cards offering to install it.
 */
const BUNDLED_PACKS = {
  bioart_library: {
    // Distinct from the "bioart" pack in the catalogue, which is the same
    // artwork as a download for builds that do not carry it. `supersedes` hides
    // that card when this copy is here: there is no sense offering a 90 MB
    // download for files already inside the app.
    id: "bioart-included",
    supersedes: "bioart",
    name: "NIH BioArt",
    homepage: "https://bioart.niaid.nih.gov",
    summary:
      "Public domain illustrations from the NIAID Visual and Medical Arts team: " +
      "cells and organelles, anatomy, animals and arthropods, bacteria and viruses, " +
      "lab equipment, proteins and molecules, people. Many come in several colour " +
      "variants. Included with Morphly and available offline.",
  },
};

/** The folder a bundled pack id lives in, or null if this build has no such pack. */
function findBundledDir(dirs, id) {
  for (const dir of dirs) {
    const pack = BUNDLED_PACKS[path.basename(dir)];
    if (pack && pack.id === id) return dir;
  }
  return null;
}

/**
 * Count what a manifest offers, the same way the sidebar does.
 *
 * An entry with no SVG on disk is skipped: BioArt's brush-type entries ship
 * Illustrator files only, so counting them would promise 713 illustrations and
 * show 685. Unlike `library.js` this does not stat every file, because the
 * store needs a number quickly and a zero-byte SVG is a per-file concern.
 */
function summariseManifest(manifest) {
  const categories = {};
  let entries = 0;
  let requiresAttribution = 0;
  let shareAlike = 0;

  for (const entry of manifest) {
    const hasSvg = (entry.local_files ?? []).some((g) => g.files && g.files.SVG);
    if (!hasSvg) continue;
    entries += 1;
    const category = entry.category ?? "Uncategorized";
    categories[category] = (categories[category] ?? 0) + 1;
    const needsCredit =
      entry.requires_attribution ??
      Boolean(entry.license && !/public domain|cc0/i.test(entry.license));
    if (needsCredit) requiresAttribution += 1;
    if (entry.share_alike) shareAlike += 1;
  }

  return { entries, categories, requiresAttribution, shareAlike };
}

/**
 * Describe every bundled library as an Art Store entry.
 *
 * `dirs` comes from the build (settings.bundledLibraryDirs), and `libraries` is
 * what is currently mounted, which decides whether the card offers Add or
 * Remove. A folder whose manifest cannot be read is left out rather than listed
 * as an empty pack.
 */
async function describeBundled(dirs, libraries = []) {
  const mounted = new Set(libraries.map((l) => path.resolve(l.dir)));
  const packs = [];

  for (const dir of dirs) {
    const pack = BUNDLED_PACKS[path.basename(dir)];
    if (!pack) continue;
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(manifest)) continue;

    packs.push({
      ...pack,
      ...summariseManifest(manifest),
      bundled: true,
      installed: mounted.has(path.resolve(dir)),
      installedVersion: null,
    });
  }

  return packs;
}

module.exports = { BUNDLED_PACKS, findBundledDir, summariseManifest, describeBundled };
