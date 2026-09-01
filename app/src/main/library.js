/**
 * Reads scraped asset libraries and flattens them into the shape the sidebar
 * wants. Two producers exist, and both emit the same manifest format:
 *
 *   scraper/bioart_scraper.py    -> NIH BioArt   (mostly Public Domain)
 *   scraper/bioicons_fetcher.py  -> Bioicons     (mostly CC BY, some CC BY-SA)
 *
 * Manifest entries look like:
 *   { id, title, category, keywords[], license, creator, credit, citation,
 *     local_files: [ { group_id, caption, files: { SVG: "<relpath>" } } ] }
 *
 * BioArt entries may hold several file groups, which are colour/style variants
 * of the same illustration (entry 8 "Actin Filament" has 11). The sidebar shows
 * ONE tile per entry and offers the variants inside it, rather than eleven
 * near-identical tiles -- so the flattening keeps variants nested. Bioicons
 * entries always have exactly one.
 */

const path = require("node:path");
const fs = require("node:fs/promises");

/**
 * Resolve `relPath` inside `root`, refusing anything that escapes it.
 * A manifest is a file we did not write in this process, so its paths are
 * treated as untrusted input.
 */
function safeResolve(root, relPath) {
  const resolved = path.resolve(root, relPath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing to read outside the library folder: ${relPath}`);
  }
  return resolved;
}

/** Load one library folder. `key` tags every asset so the renderer can ask for
 *  the right folder later without knowing any absolute paths. */
async function loadLibrary({ key, dir }) {
  const manifestPath = path.join(dir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(
      `Could not read ${manifestPath}. Point Morphly at a folder produced by ` +
        `bioart_scraper.py or bioicons_fetcher.py (the one containing ` +
        `manifest.json). [${err.message}]`
    );
  }

  const assets = [];
  for (const entry of manifest) {
    // Keep only variants that actually have an SVG on disk. BioArt brush-type
    // entries ship Illustrator files only and are skipped by the scraper's
    // default --formats SVG, so they legitimately have nothing to show.
    const variants = (entry.local_files ?? [])
      .filter((g) => g.files && g.files.SVG)
      .map((g) => ({
        groupId: g.group_id,
        caption: g.caption || entry.title,
        svgPath: g.files.SVG,
      }));

    if (variants.length === 0) continue;

    assets.push({
      id: `${key}:${entry.id}`,
      source: key,
      collection: entry.collection ?? (entry.source === "bioicons" ? "Bioicons" : "NIH BioArt"),
      title: entry.title ?? `Entry ${entry.id}`,
      category: entry.category ?? "Uncategorized",
      keywords: entry.keywords ?? [],
      license: entry.license ?? null,
      licenseUrl: entry.license_url ?? null,
      // Bioicons records these explicitly; BioArt is Public Domain / CC-BY and
      // does not, so fall back to reading its licence string.
      requiresAttribution:
        entry.requires_attribution ??
        Boolean(entry.license && !/public domain|cc0/i.test(entry.license)),
      shareAlike: entry.share_alike ?? false,
      creator: entry.creator ?? null,
      credit: entry.credit ?? null,
      citation: entry.citation ?? null,
      sourcePage: entry.source_page ?? null,
      variants,
    });
  }

  return { key, dir, label: path.basename(dir), assets };
}

/** Load every configured library and merge them into one browsable index. */
async function loadLibraries(configured) {
  const loaded = [];
  const errors = [];

  for (const lib of configured) {
    try {
      loaded.push(await loadLibrary(lib));
    } catch (err) {
      errors.push({ dir: lib.dir, error: String(err.message ?? err) });
    }
  }

  const assets = loaded.flatMap((l) => l.assets);
  assets.sort((a, b) => a.title.localeCompare(b.title));

  return {
    libraries: loaded.map((l) => ({
      key: l.key,
      dir: l.dir,
      label: l.label,
      count: l.assets.length,
      collection: l.assets[0]?.collection ?? l.label,
    })),
    assets,
    categories: [...new Set(assets.map((a) => a.category))].sort(),
    collections: [...new Set(assets.map((a) => a.collection))].sort(),
    stats: {
      assets: assets.length,
      variants: assets.reduce((n, a) => n + a.variants.length, 0),
      needingAttribution: assets.filter((a) => a.requiresAttribution).length,
      shareAlike: assets.filter((a) => a.shareAlike).length,
    },
    errors,
  };
}

async function readSvg(dir, relPath) {
  return fs.readFile(safeResolve(dir, relPath), "utf8");
}

module.exports = { loadLibrary, loadLibraries, readSvg, safeResolve };
