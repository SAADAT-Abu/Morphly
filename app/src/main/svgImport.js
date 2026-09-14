/**
 * Importing SVG files (plots, diagrams, exported drawings) as editable artwork.
 *
 * An imported SVG becomes the same kind of element as a library asset, so it
 * can be recoloured, have parts hidden, and exports as true vectors. Before
 * that it is validated and sanitised like an Art Pack file, and then made
 * lighter to draw.
 *
 * Why "lighter": a scatter plot of 100,000 points saved from ggplot2 or base R
 * is 100,000 separate elements. The points of one series all look identical,
 * so they can be written as one <path> whose data holds every point: the same
 * picture from one element instead of 100,000.
 *
 * Measured in Chromium, that makes a 50,000 point ggplot2 file about 30%
 * smaller and 25% quicker to draw. It is not a cure: drawing time follows the
 * total amount of curve data, which merging cannot reduce. matplotlib, for
 * example, draws each point as a <use> of one shared marker, and writing that
 * marker out 100,000 times made the file four times larger for a 10% gain. So
 * a mark is only merged when its path data is at most half as long again as
 * the element it replaces (its styling is then written once rather than per
 * mark), and files that stay heavy are reported to the user instead.
 *
 * Merging is deliberately conservative. Marks are combined only when they are
 * direct neighbours (nothing but whitespace between them), carry exactly the
 * same styling, and have geometry that can be restated as path data without
 * changing it. Anything else is left exactly as written. In particular:
 *
 *   - translucent marks are never merged, because overlapping translucent
 *     points darken where they overlap, and one path would paint them flat
 *   - marks with an id are never merged, because something may refer to them
 *   - filters, masks and line markers are applied per element, so marks
 *     carrying them are left alone
 *   - transforms other than a plain translate are left alone
 *
 * Like the recolour engine this works on the text rather than a parsed DOM, so
 * unusual namespace prefixes and formatting elsewhere in the file are untouched.
 */

const { XMLValidator } = require("fast-xml-parser");
const { sanitiseSvg, validateSvg } = require("./svgSafety");

/** Larger files are refused before they are read into memory. */
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/** Past this many drawn elements, even after merging, the user is warned that
 *  the artwork may be slow to recolour. (Moving it is not affected: the canvas
 *  draws it from a picture that is only rebuilt when its colours change.) */
const HEAVY_MARKS = 20000;

/** How much longer a mark's path data may be than the element it replaces. */
const GROWTH_LIMIT = 1.5;

// ---------------------------------------------------------------------------
// Path data
// ---------------------------------------------------------------------------

/** Numbers each path command takes per repetition. */
const ARITY = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };

const PATH_TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

/**
 * Split path data into commands and their numbers.
 *
 * Returns null for anything it cannot read with certainty, such as arc flags
 * written without separators ("a1 1 0 011 1"), which is legal but ambiguous to
 * a simple tokenizer. A null simply means the mark is not merged.
 */
function parsePath(d) {
  if (typeof d !== "string") return null;
  if (d.replace(PATH_TOKEN, "").replace(/[\s,]/g, "") !== "") return null;

  const segments = [];
  let current = null;
  for (const m of d.matchAll(PATH_TOKEN)) {
    if (m[1]) {
      current = { cmd: m[1], args: [] };
      segments.push(current);
    } else {
      if (!current) return null;
      current.args.push(Number(m[2]));
    }
  }

  if (segments.length === 0 || segments[0].cmd.toUpperCase() !== "M") return null;
  for (const seg of segments) {
    const n = ARITY[seg.cmd.toUpperCase()];
    if (n === 0 ? seg.args.length !== 0 : seg.args.length === 0 || seg.args.length % n !== 0) {
      return null;
    }
  }
  return segments;
}

/** Short but faithful number formatting: seven significant digits. */
const fmt = (n) => String(Number(n.toPrecision(7)));

/**
 * Shift path data by (dx, dy), and make it safe to append to other path data.
 *
 * Absolute commands are moved; relative ones already follow the point before
 * them and need no change. The one subtle case is a path that opens with a
 * relative moveto: on its own that first "m" counts as absolute, but once it
 * follows another mark in a merged path it would not, so it is written out as
 * an absolute "M" (and any implicit line pairs after it as an explicit "l").
 */
function translatePath(segments, dx, dy) {
  const parts = [];
  segments.forEach((seg, i) => {
    const upper = seg.cmd.toUpperCase();
    const n = ARITY[upper];
    const args = seg.args.slice();

    if (i === 0 && seg.cmd === "m") {
      parts.push(`M${fmt(args[0] + dx)} ${fmt(args[1] + dy)}`);
      if (args.length > 2) parts.push(`l${args.slice(2).map(fmt).join(" ")}`);
      return;
    }

    if (seg.cmd === upper) {
      for (let k = 0; k < args.length; k += 1) {
        const p = k % n;
        if (upper === "H") args[k] += dx;
        else if (upper === "V") args[k] += dy;
        else if (upper === "A") {
          // Only the end point of an arc is a position; radii and flags are not.
          if (p === 5) args[k] += dx;
          else if (p === 6) args[k] += dy;
        } else {
          args[k] += p % 2 === 0 ? dx : dy;
        }
      }
    }
    parts.push(seg.cmd + args.map(fmt).join(" "));
  });
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

/** A self-closing shape element, with an optional namespace prefix. */
const LEAF =
  /<(?:([A-Za-z][\w.-]*):)?(circle|ellipse|rect|line|polygon|polyline|path|use)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/>/g;

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Attributes that say where a mark is, rather than how it looks. */
const GEOMETRY = {
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height"],
  line: ["x1", "y1", "x2", "y2"],
  polygon: ["points"],
  polyline: ["points"],
  path: ["d"],
  use: ["x", "y"],
};

const TRANSLATE = /^\s*translate\(\s*([-+]?[\d.]+(?:e[-+]?\d+)?)(?:[\s,]+([-+]?[\d.]+(?:e[-+]?\d+)?))?\s*\)\s*$/i;

/** Things applied to each element as a whole, which merging would change. */
const PER_ELEMENT = /(?:^|;|\s)(?:filter|mask|marker(?:-start|-mid|-end)?)\s*:/i;
const PER_ELEMENT_ATTRS = ["filter", "mask", "marker-start", "marker-mid", "marker-end"];

const OPACITY_NAMES = ["opacity", "fill-opacity", "stroke-opacity"];
const OPACITY_IN_STYLE = OPACITY_NAMES.map(
  (name) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i")
);

function parseAttrs(source) {
  if (source.replace(ATTR, "").trim() !== "") return null;
  const attrs = new Map();
  for (const m of source.matchAll(ATTR)) attrs.set(m[1], m[2] ?? m[3]);
  return attrs;
}

/** Fully opaque means every opacity it declares is 1 (or 100%). Anything we
 *  cannot read counts as translucent, which only means "do not merge". */
function isOpaque(attrs) {
  const style = attrs.get("style") ?? "";
  for (let i = 0; i < OPACITY_NAMES.length; i += 1) {
    for (const raw of [attrs.get(OPACITY_NAMES[i]), OPACITY_IN_STYLE[i].exec(style)?.[1]]) {
      if (raw === undefined) continue;
      const value = raw.trim();
      const n = value.endsWith("%") ? parseFloat(value) / 100 : parseFloat(value);
      if (!(n >= 1)) return false;
    }
  }
  return true;
}

function hasPerElementEffects(attrs) {
  return PER_ELEMENT_ATTRS.some((a) => attrs.has(a)) || PER_ELEMENT.test(attrs.get("style") ?? "");
}

/** Read plain numeric geometry; units such as mm or % make it NaN. */
function numberAttr(attrs, name) {
  const raw = attrs.get(name);
  if (raw === undefined) return 0;
  const value = raw.trim().replace(/px$/i, "");
  return value === "" ? NaN : Number(value);
}

function pointsPath(raw, close) {
  const nums = (raw ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length < 4 || nums.length % 2 !== 0 || nums.some((n) => !Number.isFinite(n))) return null;
  let d = `M${fmt(nums[0])} ${fmt(nums[1])}L`;
  const rest = [];
  for (let i = 2; i < nums.length; i += 1) rest.push(fmt(nums[i]));
  d += rest.join(" ");
  return close ? `${d}Z` : d;
}

/**
 * Restate one mark as path data plus the styling it is drawn with.
 * Returns null when the mark should be left exactly as it is.
 */
function describeMark(prefix, tag, attrSource, defs, markLength = Infinity) {
  const attrs = parseAttrs(attrSource);
  if (!attrs || attrs.has("id")) return null;
  if (hasPerElementEffects(attrs) || !isOpaque(attrs)) return null;

  let dx = 0;
  let dy = 0;
  if (attrs.has("transform")) {
    const t = TRANSLATE.exec(attrs.get("transform"));
    if (!t) return null;
    dx = Number(t[1]);
    dy = Number(t[2] ?? 0);
  }

  const n = (name) => numberAttr(attrs, name);
  const style = new Map(attrs);
  for (const name of [...GEOMETRY[tag], "transform"]) style.delete(name);

  let d = null;
  switch (tag) {
    case "circle": {
      const [cx, cy, r] = [n("cx") + dx, n("cy") + dy, n("r")];
      if (!(r > 0) || !Number.isFinite(cx + cy)) return null;
      d =
        `M${fmt(cx - r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)}` +
        `A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)}Z`;
      break;
    }
    case "ellipse": {
      const [cx, cy, rx, ry] = [n("cx") + dx, n("cy") + dy, n("rx"), n("ry")];
      if (!(rx > 0 && ry > 0) || !Number.isFinite(cx + cy)) return null;
      d =
        `M${fmt(cx - rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}` +
        `A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`;
      break;
    }
    case "rect": {
      // Rounded rectangles would need their corners spelled out; not worth it.
      if (attrs.has("rx") || attrs.has("ry")) return null;
      const [x, y, w, h] = [n("x") + dx, n("y") + dy, n("width"), n("height")];
      if (!(w > 0 && h > 0) || !Number.isFinite(x + y)) return null;
      d = `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
      break;
    }
    case "line": {
      const [x1, y1, x2, y2] = [n("x1") + dx, n("y1") + dy, n("x2") + dx, n("y2") + dy];
      if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
      d = `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`;
      break;
    }
    case "polygon":
    case "polyline": {
      if (dx !== 0 || dy !== 0) return null;
      d = pointsPath(attrs.get("points"), tag === "polygon");
      break;
    }
    case "path": {
      const segments = parsePath(attrs.get("d"));
      if (!segments) return null;
      // Untouched data keeps the author's exact numbers when nothing moves.
      d =
        dx === 0 && dy === 0 && segments[0].cmd === "M"
          ? attrs.get("d").trim()
          : translatePath(segments, dx, dy);
      break;
    }
    case "use": {
      // matplotlib draws every point as <use> of one marker path in <defs>.
      const href = attrs.get("xlink:href") ?? attrs.get("href");
      const def = href?.startsWith("#") ? defs.get(href.slice(1)) : null;
      if (!def || def.prefix !== prefix) return null;
      const x = n("x");
      const y = n("y");
      if (!Number.isFinite(x + y)) return null;
      if (def.attrs.get("d").length > markLength * GROWTH_LIMIT) return null;
      const segments = parsePath(def.attrs.get("d"));
      if (!segments) return null;
      d = translatePath(segments, dx + x, dy + y);

      // The marker's own styling beats what it inherits from the <use>. On one
      // merged element that has to be spelled out: a property the marker sets
      // replaces the same property on the <use>, and is written as a style
      // declaration so nothing left over from the <use> can outrank it.
      style.delete("xlink:href");
      style.delete("href");
      const fromDef = new Map();
      for (const [name, value] of def.attrs) {
        if (name === "id" || name === "d") continue;
        if (name === "class" || name === "transform" || name === "clip-path") return null;
        if (name === "style") {
          for (const decl of value.split(";")) {
            const colon = decl.indexOf(":");
            if (colon > 0) fromDef.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
          }
        } else {
          fromDef.set(name, value);
        }
      }
      if (!isOpaque(def.attrs) || hasPerElementEffects(def.attrs)) return null;
      if (fromDef.size > 0) {
        const inherited = (style.get("style") ?? "")
          .split(";")
          .map((decl) => decl.trim())
          .filter((decl) => decl && !fromDef.has(decl.slice(0, decl.indexOf(":")).trim()));
        for (const name of fromDef.keys()) style.delete(name);
        const declarations = [...inherited, ...[...fromDef].map(([k, v]) => `${k}: ${v}`)];
        style.set("style", declarations.join("; "));
      }
      break;
    }
    default:
      return null;
  }
  if (!d || d.length > markLength * GROWTH_LIMIT) return null;

  const entries = [...style].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { d, entries, key: `${prefix ?? ""}|${JSON.stringify(entries)}` };
}

const escapeAttr = (value) => value.replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Merge runs of neighbouring, identically styled marks into single paths.
 * Returns the new text and how many elements were folded away.
 *
 * A mark whose path data would be much longer than the element it came from
 * is left alone, so merging never makes a file meaningfully larger.
 */
function mergeMarks(text) {
  const matches = [...text.matchAll(LEAF)];

  // Marker definitions that <use> elements may point at.
  const defs = new Map();
  for (const m of matches) {
    if (m[2] !== "path") continue;
    const attrs = parseAttrs(m[3]);
    const id = attrs?.get("id");
    if (id && attrs.has("d")) defs.set(id, { prefix: m[1], attrs });
  }

  const chunks = [];
  let cursor = 0;
  let folded = 0;
  let run = [];

  const flush = () => {
    if (run.length >= 2) {
      const first = run[0];
      const last = run[run.length - 1];
      const tag = first.prefix ? `${first.prefix}:path` : "path";
      const attrs = first.mark.entries.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
      chunks.push(text.slice(cursor, first.start));
      chunks.push(`<${tag}${attrs} d="${run.map((r) => r.mark.d).join("")}"/>`);
      cursor = last.end;
      folded += run.length - 1;
    }
    run = [];
  };

  for (const m of matches) {
    const start = m.index;
    const end = m.index + m[0].length;
    const mark = describeMark(m[1], m[2], m[3], defs, m[0].length);
    const previous = run[run.length - 1];
    const joins =
      mark &&
      previous &&
      previous.mark.key === mark.key &&
      /^\s*$/.test(text.slice(previous.end, start));

    if (!joins) flush();
    if (mark) run.push({ mark, start, end, prefix: m[1] });
  }
  flush();

  if (folded === 0) return { text, folded: 0 };
  chunks.push(text.slice(cursor));
  return { text: chunks.join(""), folded };
}

// ---------------------------------------------------------------------------
// The whole import
// ---------------------------------------------------------------------------

const DRAWN = /<(?:[\w.-]+:)?(?:path|circle|ellipse|rect|line|polygon|polyline|use|text|image)\b/g;
const countDrawn = (text) => (text.match(DRAWN) ?? []).length;

/**
 * Check, clean and lighten an SVG someone chose to import.
 *
 *   { ok: true, svg, marks, drawn, heavy }   marks: elements in the file,
 *                                            drawn: elements after merging
 *   { ok: false, error }                     with a message for the user
 */
function prepareSvg(input, { heavyMarks = HEAVY_MARKS } = {}) {
  if (typeof input !== "string") return { ok: false, error: "That file could not be read as text." };

  const verdict = validateSvg(input);
  if (verdict.status === "empty" || verdict.status === "blank") {
    return { ok: false, error: "This SVG has nothing to draw." };
  }
  if (verdict.status === "malformed") {
    return {
      ok: false,
      error: `This SVG is not well-formed${verdict.detail ? ` (${verdict.detail})` : ""}.`,
    };
  }
  const text = verdict.status === "repaired" ? verdict.text : input;
  if (!/<(?:[\w.-]+:)?svg\b/.test(text)) {
    return { ok: false, error: "That file is not an SVG drawing." };
  }

  const clean = sanitiseSvg(text);
  const marks = countDrawn(clean);
  let { text: svg, folded } = mergeMarks(clean);

  // Belt and braces: a merge must never turn a good file into a broken one.
  if (folded > 0 && XMLValidator.validate(svg) !== true) {
    svg = clean;
    folded = 0;
  }

  const drawn = marks - folded;
  return { ok: true, svg, marks, drawn, heavy: drawn > heavyMarks };
}

module.exports = {
  MAX_IMPORT_BYTES,
  HEAVY_MARKS,
  parsePath,
  translatePath,
  mergeMarks,
  prepareSvg,
};
