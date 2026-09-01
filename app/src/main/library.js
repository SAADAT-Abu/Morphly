/**
 * Reads a scraped BioArt library (the output of scraper/bioart_scraper.py)
 * and flattens it into the shape the sidebar wants.
 *
 * Manifest entries look like:
 *   { id, title, category, keywords[], license, creator, credit, citation,
 *     local_files: [ { group_id, caption, files: { SVG: "<relpath>" } } ] }
 *
 * An entry can hold several file groups, which are colour/style variants of
 * the same illustration (entry 8 "Actin Filament" has 11). The sidebar shows
 * ONE tile per entry and offers the variants inside it, rather than eleven
 * near-identical tiles -- so the flattening keeps variants nested.
 */

const path = require("node:path");
const fs = require("node:fs/promises");

/**
 * Resolve `relPath` inside `root`, refusing anything that escapes it.
 * The manifest is a file we did not write in this process, so its paths are
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

async function loadLibrary(dir) {
  const manifestPath = path.join(dir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(
      `Could not read ${manifestPath}. Point Morphly at the folder produced by ` +
        `bioart_scraper.py (the one containing manifest.json). [${err.message}]`
    );
  }

  const assets = [];
  for (const entry of manifest) {
    // Keep only variants that actually have an SVG on disk. Brush-type entries
    // ship Illustrator files only and are skipped by the scraper's default
    // --formats SVG, so they legitimately have nothing to show.
    const variants = (entry.local_files ?? [])
      .filter((g) => g.files && g.files.SVG)
      .map((g) => ({
        groupId: g.group_id,
        caption: g.caption || entry.title,
        svgPath: g.files.SVG,
      }));

    if (variants.length === 0) continue;

    assets.push({
      id: entry.id,
      title: entry.title ?? `Entry ${entry.id}`,
      category: entry.category ?? "Uncategorized",
      keywords: entry.keywords ?? [],
      license: entry.license ?? null,
      creator: entry.creator ?? null,
      credit: entry.credit ?? null,
      citation: entry.citation ?? null,
      sourcePage: entry.source_page ?? null,
      variants,
    });
  }

  assets.sort((a, b) => a.title.localeCompare(b.title));

  const categories = [...new Set(assets.map((a) => a.category))].sort();
  const variantCount = assets.reduce((n, a) => n + a.variants.length, 0);

  return { dir, assets, categories, stats: { assets: assets.length, variants: variantCount } };
}

async function readSvg(dir, relPath) {
  return fs.readFile(safeResolve(dir, relPath), "utf8");
}

module.exports = { loadLibrary, readSvg, safeResolve };
