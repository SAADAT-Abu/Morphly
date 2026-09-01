/**
 * SVG palette extraction and recolouring.
 *
 * This is the heart of Morphly's "recolour a BioArt vector" feature, and it is
 * shaped by two things measured in the real library:
 *
 * 1. BioArt SVGs are MULTI-COLOUR -- typically ~5 distinct colours, up to 21,
 *    spread across 25-500 shape elements. So a single "change the fill" swap is
 *    useless, and per-shape controls would be unusable at 500 shapes. What
 *    works is a palette swap: list the distinct colours, let the user remap
 *    each one, and every shape using that colour follows.
 *
 * 2. Most colours are NOT on `fill=` attributes. They live in CSS rules inside
 *    a <style> block:
 *
 *        .cls-2, .cls-3 { fill: #c5f8f6; }
 *        .cls-3, .cls-4 { stroke: #465b5a; stroke-width: 2.19px; }
 *
 *    An attribute-only recolour would silently miss most of the artwork, so we
 *    handle the CSS declaration form as well as the attribute form.
 *
 * The approach is deliberately textual rather than DOM-based: we rewrite the
 * markup with targeted regexes. That keeps the original document byte-for-byte
 * intact apart from the colours themselves -- including the `ns0:` namespace
 * prefixes every BioArt file uses, which a naive DOM serialise-and-reparse
 * round trip tends to mangle.
 */

// Colour-bearing properties, longest first so the alternation prefers
// `stop-color` over a bare `stop`. The trailing (?![\w-]) is what stops
// `stroke` from matching inside `stroke-width` or `stroke-miterlimit`.
const COLOR_PROPS = "stop-color|flood-color|lighting-color|fill|stroke";

/** fill="#abc"  /  stroke='red' */
const ATTR_RE = new RegExp(`(?<![\\w-])(${COLOR_PROPS})(?![\\w-])(\\s*=\\s*)(["'])([^"']*)\\3`, "g");

/** fill: #abc;  (inside <style> blocks or a style="" attribute) */
const CSS_RE = new RegExp(`(?<![\\w-])(${COLOR_PROPS})(?![\\w-])(\\s*:\\s*)([^;}"'<]+)`, "g");

// ---------------------------------------------------------------------------
// Colour normalisation
// ---------------------------------------------------------------------------

const _hexCache = new Map();
let _probeCtx = null;

/**
 * Normalise any CSS colour token to `#rrggbb`, or null if it isn't a colour.
 *
 * Rather than hand-rolling parsers for hex/rgb()/hsl()/named colours, we ask
 * the browser: assigning to fillStyle silently ignores invalid values, so
 * probing against two different starting values tells us whether it took.
 */
export function toHex(value) {
  if (value == null) return null;
  const key = String(value).trim();
  if (key === "") return null;
  if (_hexCache.has(key)) return _hexCache.get(key);

  // Fast path for the overwhelmingly common case, and the only path that
  // works if this ever runs outside a DOM.
  const plainHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(key);
  if (plainHex) {
    let h = plainHex[1].toLowerCase();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const out = "#" + h;
    _hexCache.set(key, out);
    return out;
  }

  // Keywords that are valid CSS but are not a colour we can offer in a picker.
  if (/^(none|inherit|currentcolor|transparent|initial|unset)$/i.test(key)) {
    _hexCache.set(key, null);
    return null;
  }
  if (/^url\(/i.test(key)) {
    _hexCache.set(key, null); // gradient / pattern reference, not a flat colour
    return null;
  }

  if (typeof document === "undefined") {
    _hexCache.set(key, null);
    return null;
  }
  if (!_probeCtx) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    _probeCtx = canvas.getContext("2d", { willReadFrequently: true });
  }

  _probeCtx.fillStyle = "#000000";
  _probeCtx.fillStyle = key;
  const fromBlack = _probeCtx.fillStyle;
  _probeCtx.fillStyle = "#ffffff";
  _probeCtx.fillStyle = key;
  const fromWhite = _probeCtx.fillStyle;

  // If the assignment was rejected, fillStyle still holds the starting value,
  // so the two probes disagree.
  const out = fromBlack === fromWhite && fromBlack.startsWith("#") ? fromBlack : null;
  _hexCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Palette extraction
// ---------------------------------------------------------------------------

/**
 * Collect the distinct colours in an SVG.
 * Returns [{ hex, count }] sorted by frequency, so the colours that dominate
 * the illustration appear first in the recolour panel.
 */
export function extractPalette(svgText) {
  if (!svgText) return [];

  // Colours inside <metadata> are descriptive text, not artwork -- skip them.
  const body = svgText.replace(/<(\w+:)?metadata\b[\s\S]*?<\/(\w+:)?metadata>/gi, "");

  const counts = new Map();
  const tally = (raw) => {
    const hex = toHex(raw);
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  };

  for (const m of body.matchAll(ATTR_RE)) tally(m[4]);
  for (const m of body.matchAll(CSS_RE)) tally(m[3]);

  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
}

/**
 * Rewrite every occurrence of the colours in `colorMap` ({ "#aabbcc": "#ff0000" }).
 * Colours not present in the map are left exactly as they were.
 */
export function applyPalette(svgText, colorMap) {
  if (!svgText || !colorMap || Object.keys(colorMap).length === 0) return svgText;

  const remap = (raw) => {
    const hex = toHex(raw);
    if (!hex) return null;
    const next = colorMap[hex];
    return next && next !== hex ? next : null;
  };

  let out = svgText.replace(ATTR_RE, (match, prop, sep, quote, value) => {
    const next = remap(value);
    return next ? `${prop}${sep}${quote}${next}${quote}` : match;
  });

  out = out.replace(CSS_RE, (match, prop, sep, value) => {
    // Preserve trailing whitespace so the CSS keeps its original formatting.
    const trailing = value.match(/\s*$/)[0];
    const next = remap(value);
    return next ? `${prop}${sep}${next}${trailing}` : match;
  });

  return out;
}

// ---------------------------------------------------------------------------
// Geometry + rasterisation helpers
// ---------------------------------------------------------------------------

/** Pull the intrinsic size out of a viewBox (BioArt files carry no width/height). */
export function parseViewBox(svgText) {
  const m = /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*["']/.exec(
    svgText ?? ""
  );
  if (!m) return { x: 0, y: 0, width: 512, height: 512 };
  return { x: +m[1], y: +m[2], width: +m[3] || 512, height: +m[4] || 512 };
}

/**
 * Give the root <svg> explicit width/height. Without an intrinsic size, an SVG
 * loaded into an <img> renders at a browser default rather than its true
 * aspect ratio, which would distort every asset placed on the canvas.
 */
export function ensureIntrinsicSize(svgText) {
  const box = parseViewBox(svgText);
  return svgText.replace(/<(\w+:)?svg\b([^>]*)>/i, (match, prefix, attrs) => {
    let next = attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "");
    return `<${prefix ?? ""}svg${next} width="${box.width}" height="${box.height}">`;
  });
}

/** Data URL suitable for an <img> / Konva image source. */
export function toDataUrl(svgText) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(ensureIntrinsicSize(svgText));
}

// ---------------------------------------------------------------------------
// Colour-part isolation and hiding
// ---------------------------------------------------------------------------

/**
 * The colour map actually used to draw an asset: the user's recolouring, plus
 * any colour parts they have hidden, which are mapped to `transparent`.
 *
 * Kept in one place because the canvas, the highlight overlay and the
 * exporters must all agree. If they drifted, a figure would export with parts
 * the user had deleted, or vice versa.
 */
export function effectiveColorMap(element) {
  const map = { ...(element.colorMap ?? {}) };
  // `none` rather than `transparent`: it is SVG's canonical "do not paint"
  // value and is honoured by every renderer, including whatever opens an
  // exported file. `transparent` is not, and falls back to black in some.
  for (const hex of element.hiddenColors ?? []) map[hex] = "none";
  return map;
}

/**
 * A version of the artwork showing ONLY the shapes that use `targetHex`,
 * painted in `highlightHex`. Everything else becomes transparent.
 *
 * Drawn on top of the normal image, this answers the question the colour panel
 * otherwise leaves unanswered: which part of the drawing does this swatch
 * control? Working out that mapping by trial and error is painful on artwork
 * with twenty colours and hundreds of shapes.
 */
export function buildIsolationSvg(svgText, palette, targetHex, highlightHex = "#ff2d95") {
  const map = {};
  for (const { hex } of palette) {
    map[hex] = hex === targetHex ? highlightHex : "none";
  }
  return applyPalette(svgText, map);
}
