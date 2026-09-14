/**
 * Making untrusted SVG safe to draw and export.
 *
 * Shared by Art Packs and by File > Insert image, the two places Morphly takes
 * in SVG files it did not build. Kept free of Electron so it can be tested on
 * its own.
 */

const { XMLValidator } = require("fast-xml-parser");


/**
 * Remove anything executable or externally-referencing from an SVG.
 *
 * Textual rather than DOM-based, for the same reason the recolour engine is:
 * BioArt files use `ns0:` prefixes that a parse and re-serialise round trip
 * tends to mangle.
 */
function sanitiseSvg(text) {
  return text
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script[^>]*\/>/gi, "")
    .replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, "")
    // on* handlers, quoted or bare
    .replace(/\son[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    // Remote references, javascript: URLs and non-raster data: URLs. Embedded
    // PNG, JPEG, GIF and WebP stay: a raster cannot run script, and about a
    // fifth of SciDraw's drawings (and many Bioicons ones) are built around
    // one, so stripping them blanked those drawings on install. data:image/svg+xml
    // still goes, because a nested SVG can carry script into an export.
    .replace(/\s(?:xlink:)?href\s*=\s*(["'])\s*(?:https?:|\/\/|javascript:|data:(?!image\/(?:png|jpe?g|gif|webp)[;,]))[^"']*\1/gi, "")
    .replace(/\ssrc\s*=\s*(["'])\s*(?:https?:|\/\/|javascript:|data:(?!image\/(?:png|jpe?g|gif|webp)[;,]))[^"']*\1/gi, "");
}


const DRAWABLE = /<(?:[a-z]+:)?(?:path|circle|ellipse|polygon|polyline|line|text|image|use)\b/i;
const RECT = /<(?:[a-z]+:)?rect\b[^>]*>/gi;
const WHITE_OR_NONE = /fill\s*[:=]\s*["']?\s*(?:#fff\b|#ffffff\b|white\b|none\b)/i;

/**
 * Decide what to do with one SVG from a pack.
 *
 *   ok        draw it as it is
 *   repaired  the root had no size, recovered from the first group that
 *             declares one (some Canvas exports put the page size on a
 *             <g> rather than on <svg>, which leaves the file with no size
 *             at all, so it renders as nothing)
 *   empty     the file has no content
 *   blank     all it contains is a white or unfilled page rectangle
 *
 * Broken files are dropped rather than shown as blank tiles, and a missing
 * linked raster alone is not grounds for dropping: those drawings render
 * with a gap where the image would be.
 */
function validateSvg(input) {
  if (!input || !input.trim()) return { status: "empty" };
  let text = input;
  let repaired = false;

  // Browsers render an SVG image only if it is well-formed XML; Inkscape is
  // more forgiving, which is how a broken file can look fine in one and fail
  // in the other. The common fault is stray bytes after the closing tag, and
  // trimming them recovers the drawing. Anything else malformed is dropped.
  let check = XMLValidator.validate(text);
  if (check !== true) {
    const close = /<\/(?:[a-z]+:)?svg\s*>/gi;
    let last = null;
    for (let m = close.exec(text); m; m = close.exec(text)) last = m;
    if (last) {
      const trimmed = text.slice(0, last.index + last[0].length);
      if (trimmed.length < text.length && XMLValidator.validate(trimmed) === true) {
        text = trimmed;
        repaired = true;
        check = true;
      }
    }
    if (check !== true) return { status: "malformed", detail: check.err?.msg };
  }

  const body = text.replace(/<\?xml[\s\S]*?\?>/i, "").replace(/<!DOCTYPE[\s\S]*?>/i, "");
  if (!DRAWABLE.test(body)) {
    const rects = body.match(RECT) ?? [];
    if (rects.length === 0 || rects.every((r) => WHITE_OR_NONE.test(r))) {
      return { status: "blank" };
    }
  }

  const root = /<(?:([a-z]+):)?svg\b[^>]*>/i.exec(body);
  if (root && !/\bviewBox\s*=/.test(root[0]) && !/\b(?:width|height)\s*=/.test(root[0])) {
    const sized = /<(?:[a-z]+:)?g\b[^>]*\bwidth\s*=\s*["']([\d.]+)(?:px)?["'][^>]*\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(body);
    if (sized) {
      const [, w, h] = sized;
      const fixed = root[0].replace(/\s*\/?>$/, (end) => ` viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${end}`);
      text = text.replace(root[0], fixed);
      repaired = true;
    }
  }
  return repaired ? { status: "repaired", text } : { status: "ok" };
}

module.exports = { sanitiseSvg, validateSvg };
