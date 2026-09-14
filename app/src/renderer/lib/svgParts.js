/**
 * Parts of an SVG drawing: finding them, recolouring, hiding and moving them.
 *
 * An illustration on the canvas is one picture, drawn from its SVG. To edit a
 * single part of it, Morphly needs to know the drawing's structure, which
 * colour each shape really ends up painted in, and how to change one piece
 * without disturbing the rest.
 *
 * Like the recolour engine this works on the text, never through a DOM round
 * trip, so a file keeps every byte it had apart from the small additions an
 * edit makes (and BioArt's `ns0:` prefixes survive). Edits are stored on the
 * element as `partEdits` and applied when the drawing is drawn or exported, so
 * the original file is never altered and every edit can be reset:
 *
 *   partEdits: {
 *     "0.3": { colors: { "#c5f8f6": "#ff8800" }, hidden: true, dx: 12, dy: -4 },
 *   }
 *
 * Keys are paths of child positions from the root <svg> ("0.3" is the fourth
 * element inside the first one). The source never changes, so keys never go
 * stale. Colours are keyed by the shape's original colour, and moves are in
 * the drawing's own units, so resizing the element keeps edits in proportion.
 *
 * Clicking picks a part through a hidden copy of the drawing in which every
 * shape is painted a unique solid colour (buildHitSvg): the colour under the
 * pointer names the shape, however many thousands there are.
 */

import { applyPalette, effectiveColorMap, intrinsicSize, parseViewBox } from "./svgPalette";

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const NAME = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttributes(text, from, to) {
  const attrs = new Map();
  const chunk = text.slice(from, to);
  for (const m of chunk.matchAll(ATTRIBUTE)) {
    const value = m[2] ?? m[3];
    const valueEnd = from + m.index + m[0].length - 1;
    attrs.set(m[1], { value, valueStart: valueEnd - value.length, valueEnd });
  }
  return attrs;
}

/**
 * Every element in the text, in document order, with where its tags sit.
 * Returns null for text that is not well-formed enough to edit safely.
 */
export function scanSvg(text) {
  if (typeof text !== "string") return null;
  const nodes = [];
  const stack = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt === -1) break;

    if (text.startsWith("<!--", lt)) {
      const e = text.indexOf("-->", lt + 4);
      if (e === -1) return null;
      i = e + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const e = text.indexOf("]]>", lt + 9);
      if (e === -1) return null;
      i = e + 3;
      continue;
    }
    if (text.startsWith("<?", lt)) {
      const e = text.indexOf("?>", lt + 2);
      if (e === -1) return null;
      i = e + 2;
      continue;
    }
    if (text.startsWith("<!", lt)) {
      // A doctype, which may carry an internal subset in brackets.
      let j = lt + 2;
      let depth = 0;
      for (; j < n; j += 1) {
        const c = text[j];
        if (c === "[") depth += 1;
        else if (c === "]") depth -= 1;
        else if (c === ">" && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    if (text[lt + 1] === "/") {
      const e = text.indexOf(">", lt);
      const node = stack.pop();
      if (e === -1 || !node) return null;
      node.innerEnd = lt;
      node.end = e + 1;
      i = e + 1;
      continue;
    }

    NAME.lastIndex = lt + 1;
    const m = NAME.exec(text);
    if (!m) {
      i = lt + 1;
      continue;
    }
    // The tag ends at the first ">" outside quotes.
    let j = NAME.lastIndex;
    let quote = null;
    for (; j < n; j += 1) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (j >= n) return null;

    const selfClosing = text[j - 1] === "/";
    const qname = m[0];
    const colon = qname.indexOf(":");
    const parent = stack[stack.length - 1] ?? null;
    const attrEnd = selfClosing ? j - 1 : j;
    const node = {
      index: nodes.length,
      name: colon === -1 ? qname : qname.slice(colon + 1),
      prefix: colon === -1 ? null : qname.slice(0, colon),
      start: lt,
      attrEnd,
      tagEnd: j + 1,
      innerEnd: selfClosing ? j + 1 : null,
      end: selfClosing ? j + 1 : null,
      selfClosing,
      parent: parent ? parent.index : -1,
      children: [],
      attrs: parseAttributes(text, NAME.lastIndex, attrEnd),
    };
    if (parent) parent.children.push(node.index);
    nodes.push(node);
    if (!selfClosing) stack.push(node);
    i = j + 1;
  }
  return stack.length === 0 ? nodes : null;
}

// ---------------------------------------------------------------------------
// Colours and style
// ---------------------------------------------------------------------------

const NAMED = Object.fromEntries(
  (
    "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 " +
    "black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 " +
    "chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff " +
    "darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 " +
    "darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 " +
    "darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f " +
    "darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 " +
    "dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc " +
    "ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 " +
    "honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa " +
    "lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff " +
    "lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 " +
    "lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 " +
    "lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 " +
    "mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 " +
    "mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 " +
    "midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 " +
    "oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa " +
    "palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f " +
    "pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f " +
    "royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee " +
    "sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa " +
    "springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 " +
    "violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32"
  )
    .split(" ")
    .reduce((pairs, word, i, words) => (i % 2 === 0 ? [...pairs, [word, `#${words[i + 1]}`]] : pairs), [])
);

/**
 * A paint value as "none", "#rrggbb", or "other" (a gradient, pattern or
 * anything else that is not one flat colour). Works without a browser, so the
 * same answer comes out on the canvas, in export and in tests.
 */
export function normalisePaint(value, currentColor = "#000000") {
  if (value == null) return "none";
  const v = String(value).trim().toLowerCase().replace(/\s*!important$/, "");
  if (v === "" || v === "none" || v === "transparent") return "none";
  if (v === "currentcolor") return normalisePaint(currentColor);
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return `#${h}`;
  }
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(v);
  if (m) {
    if (m[7] !== undefined && Number(m[7]) === 0) return "none";
    const channel = (num, pct) => Math.max(0, Math.min(255, Math.round(pct ? (Number(num) * 255) / 100 : Number(num))));
    return `#${[channel(m[1], m[2]), channel(m[3], m[4]), channel(m[5], m[6])].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }
  return NAMED[v] ?? "other";
}

function parseDeclarations(css) {
  const decls = new Map();
  for (const part of String(css).split(";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    decls.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim().replace(/\s*!important$/i, ""));
  }
  return decls;
}

/** Simple selectors only (tag, #id, .class and combinations of them, or *),
 *  which is what drawing programs write. Anything fancier is ignored. */
function parseSelector(selector) {
  const m = /^(\*|[A-Za-z][\w-]*)?((?:[#.][\w-]+)*)$/.exec(selector);
  if (!m || (!m[1] && !m[2])) return null;
  const ids = [...m[2].matchAll(/#([\w-]+)/g)].map((x) => x[1]);
  const classes = [...m[2].matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
  const tag = m[1] && m[1] !== "*" ? m[1] : null;
  return { tag, ids, classes, specificity: ids.length * 10000 + classes.length * 100 + (tag ? 1 : 0) };
}

/** Properties that decide what a shape looks like and whether it can be clicked. */
const STYLE_PROPS = ["fill", "stroke", "color", "display", "opacity", "fill-opacity", "stroke-opacity", "mask", "mix-blend-mode"];

/** An opacity value (a number or a percentage) as 0..1; anything unreadable counts as 1. */
function amount(value) {
  if (value === undefined) return 1;
  const v = String(value).trim();
  const n = v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

/**
 * CSS rules that set anything Morphly reads, in cascade order, indexed so
 * each element only looks at rules that could apply to it. Checking every
 * rule against every element made drawings with thousands of shapes and
 * hundreds of rules take over a second to analyse.
 */
function parseCss(css) {
  const rules = [];
  const clean = css.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  let order = 0;
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = parseDeclarations(m[2]);
    if (!STYLE_PROPS.some((prop) => decls.has(prop))) continue;
    for (const raw of m[1].split(",")) {
      const selector = parseSelector(raw.trim());
      if (selector) rules.push({ ...selector, decls, order: (order += 1) });
    }
  }
  rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);

  const index = { byId: new Map(), byClass: new Map(), byTag: new Map(), universal: [] };
  const file = (map, name, rule) => {
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(rule);
  };
  rules.forEach((rule, rank) => {
    rule.rank = rank;
    if (rule.ids.length) file(index.byId, rule.ids[0], rule);
    else if (rule.classes.length) file(index.byClass, rule.classes[0], rule);
    else if (rule.tag) file(index.byTag, rule.tag, rule);
    else index.universal.push(rule);
  });
  return index;
}

/** An element's own declared values: attribute, then CSS rules, then inline style. */
function ownStyle(node, rules) {
  const own = {};
  for (const prop of STYLE_PROPS) {
    const attr = node.attrs.get(prop);
    if (attr) own[prop] = attr.value;
  }
  const classList = (node.attrs.get("class")?.value ?? "").split(/\s+/).filter(Boolean);
  const classes = new Set(classList);
  const id = node.attrs.get("id")?.value;

  const candidates = [...rules.universal, ...(rules.byTag.get(node.name) ?? []), ...(id ? rules.byId.get(id) ?? [] : [])];
  for (const name of classList) candidates.push(...(rules.byClass.get(name) ?? []));
  const matching = [...new Set(candidates)]
    .filter(
      (rule) =>
        (!rule.tag || rule.tag === node.name) &&
        rule.ids.every((x) => x === id) &&
        rule.classes.every((c) => classes.has(c))
    )
    .sort((a, b) => a.rank - b.rank);
  for (const rule of matching) {
    for (const prop of STYLE_PROPS) if (rule.decls.has(prop)) own[prop] = rule.decls.get(prop);
  }
  const inline = parseDeclarations(node.attrs.get("style")?.value ?? "");
  for (const prop of STYLE_PROPS) if (inline.has(prop)) own[prop] = inline.get(prop);
  return own;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/** Shapes that paint something. */
const DRAWABLE = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "image", "use"]);
/** Elements that can hold parts. */
const CONTAINERS = new Set(["svg", "g", "a", "switch"]);
/** Elements whose contents are never drawn where they stand. */
const NOT_DRAWN = new Set([
  "defs", "clipPath", "mask", "pattern", "marker", "symbol", "linearGradient", "radialGradient",
  "filter", "style", "metadata", "title", "desc", "script", "foreignObject",
]);

const cache = new Map();

/**
 * The structure of a drawing.
 *
 *   nodes     every element, with `key`, `leaf`, `paint` ({ fill, stroke }),
 *             `hidden`, and `last` (the index of its last descendant)
 *   leaves    node indices of the shapes, in drawing order
 *   byKey     node by part key
 *   root      the root <svg> node
 *
 * Returns null for text that cannot be analysed. Results are cached by text,
 * because the same drawing is analysed for drawing, picking and export.
 */
export function analyseSvg(text) {
  if (cache.has(text)) return cache.get(text);
  const result = analyse(text);
  cache.set(text, result);
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  return result;
}

function analyse(text) {
  const nodes = scanSvg(text);
  if (!nodes) return null;
  const root = nodes.find((node) => node.parent === -1 && node.name === "svg");
  if (!root) return null;

  const css = nodes
    .filter((node) => node.name === "style" && !node.selfClosing)
    .map((node) => text.slice(node.tagEnd, node.innerEnd))
    .join("\n");
  const rules = parseCss(css);
  const leaves = [];
  const byKey = new Map();

  const walk = (index, inherited, key, hidden, inert) => {
    const node = nodes[index];
    const own = ownStyle(node, rules);
    const pick = (prop) => (own[prop] === undefined || own[prop] === "inherit" ? inherited[prop] : own[prop]);
    const effective = {
      fill: pick("fill"),
      stroke: pick("stroke"),
      color: pick("color"),
      "fill-opacity": pick("fill-opacity"),
      "stroke-opacity": pick("stroke-opacity"),
      // Opacity multiplies down through groups; a mask anywhere above softens.
      alpha: inherited.alpha * amount(own.opacity),
      masked: inherited.masked || (own.mask !== undefined && own.mask.trim() !== "none"),
      // Many BioArt drawings lay a tint or shading shape over the whole drawing
      // with a blend mode; it changes the colours beneath rather than covering
      // them. Only a shape's own blend mode counts: inside a blended group the
      // shapes paint normally among themselves, and the hit copy switches the
      // group's blending off, so they are picked like any solid shape.
      blended: own["mix-blend-mode"] !== undefined && own["mix-blend-mode"].trim() !== "normal",
    };

    node.key = key;
    node.hidden = hidden || own.display === "none";
    const notDrawn = inert || NOT_DRAWN.has(node.name);
    node.leaf = DRAWABLE.has(node.name) && !notDrawn;
    node.container = CONTAINERS.has(node.name) && !notDrawn;
    byKey.set(key, node);

    if (node.leaf) {
      node.leafIndex = leaves.length;
      leaves.push(index);
      const currentColor = normalisePaint(effective.color);
      node.paint = {
        fill: normalisePaint(effective.fill, currentColor),
        stroke: normalisePaint(effective.stroke, currentColor),
      };
      // See-through or masked shapes are picked only where nothing solid is
      // under the pointer (buildHitSvg's "back" layer).
      node.translucent =
        effective.alpha < 0.999 ||
        effective.masked ||
        effective.blended ||
        (node.paint.fill !== "none" && amount(effective["fill-opacity"]) < 0.999) ||
        (node.paint.stroke !== "none" && amount(effective["stroke-opacity"]) < 0.999);
    }

    node.children.forEach((child, position) => {
      const childKey = key === "" ? `${position}` : `${key}.${position}`;
      // A shape's own children (a text's tspans) are part of that shape.
      walk(child, effective, childKey, node.hidden, notDrawn || node.leaf);
    });
    node.last = node.children.length ? nodes[node.children[node.children.length - 1]].last : index;
  };
  walk(
    root.index,
    { fill: "#000000", stroke: "none", color: "#000000", "fill-opacity": "1", "stroke-opacity": "1", alpha: 1, masked: false },
    "",
    false,
    false
  );

  return { nodes, leaves, byKey, root };
}

/** Leaf node indices inside a part (the part itself, if it is a shape). */
export function leavesUnder(analysis, key) {
  const node = analysis.byKey.get(key);
  if (!node) return [];
  return analysis.leaves.filter((index) => index >= node.index && index <= node.last);
}

/** Children of a node that are parts: shapes, or containers that hold shapes. */
function partChildren(analysis, node) {
  return node.children
    .map((index) => analysis.nodes[index])
    .filter((child) => child.leaf || (child.container && leavesUnder(analysis, child.key).length > 0));
}

/**
 * Where editing starts. Drawing programs often wrap the whole drawing in one
 * layer group (or several nested ones); starting inside those means the first
 * click picks a real piece of the drawing rather than the entire thing.
 */
export function topContainer(analysis) {
  let node = analysis.root;
  for (;;) {
    const parts = partChildren(analysis, node);
    if (parts.length === 1 && parts[0].container) node = parts[0];
    else return node.key;
  }
}

/**
 * The part a click on a shape selects: the piece directly inside the current
 * container that holds the shape, or the shape itself when `single` is set.
 * Null when the shape is not inside the container.
 */
export function partForLeaf(analysis, leafNodeIndex, containerKey, { single = false } = {}) {
  const leaf = analysis.nodes[leafNodeIndex];
  if (!leaf) return null;
  if (single) return leaf.key;
  const container = analysis.byKey.get(containerKey);
  if (!container || leafNodeIndex < container.index || leafNodeIndex > container.last) return null;
  let node = leaf;
  while (node.parent !== -1 && node.parent !== container.index) node = analysis.nodes[node.parent];
  return node.parent === container.index ? node.key : null;
}

/** The container holding a part, or null at the root. */
export function parentKey(key) {
  if (!key) return null;
  const dot = key.lastIndexOf(".");
  return dot === -1 ? "" : key.slice(0, dot);
}

/** The distinct flat colours used inside some parts, most used first. */
export function partPalette(analysis, keys) {
  const counts = new Map();
  const seen = new Set();
  for (const key of keys) {
    for (const index of leavesUnder(analysis, key)) {
      if (seen.has(index)) continue;
      seen.add(index);
      const node = analysis.nodes[index];
      for (const paint of [node.paint.fill, node.paint.stroke]) {
        if (paint.startsWith("#")) counts.set(paint, (counts.get(paint) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
}

/** A readable name for a part. */
export function partLabel(analysis, key) {
  const node = analysis.byKey.get(key);
  if (!node) return "Part";
  const id = node.attrs.get("id")?.value;
  if (id && !/^(?:[a-z]+[-_]?)?\d+$/i.test(id)) return id.replace(/[-_]+/g, " ");
  const shapes = leavesUnder(analysis, key).length;
  if (node.leaf) return node.name === "text" ? "Text" : "Shape";
  return `Group of ${shapes} shape${shapes === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

const multiply = ([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) => [
  a1 * a2 + c1 * b2,
  b1 * a2 + d1 * b2,
  a1 * c2 + c1 * d2,
  b1 * c2 + d1 * d2,
  a1 * e2 + c1 * f2 + e1,
  b1 * e2 + d1 * f2 + f1,
];

/** An SVG transform attribute as a matrix [a, b, c, d, e, f]. */
export function parseTransform(value) {
  let matrix = [1, 0, 0, 1, 0, 0];
  for (const m of String(value ?? "").matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const v = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t;
    switch (m[1]) {
      case "matrix": t = v.length === 6 ? v : [1, 0, 0, 1, 0, 0]; break;
      case "translate": t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]; break;
      case "scale": t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]; break;
      case "rotate": {
        const r = ((v[0] ?? 0) * Math.PI) / 180;
        const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
        t = multiply(multiply([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX": t = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      default: t = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    matrix = multiply(matrix, t);
  }
  return matrix;
}

/**
 * A move in the drawing's own units, as the translate to give a part: the
 * same distance measured in the coordinates its parent draws in, which differ
 * wherever an enclosing group is scaled or rotated.
 */
export function userDeltaToPart(analysis, key, dx, dy) {
  const node = analysis.byKey.get(key);
  let matrix = [1, 0, 0, 1, 0, 0];
  const chain = [];
  for (let p = node ? node.parent : -1; p !== -1 && p !== analysis.root.index; p = analysis.nodes[p].parent) {
    chain.unshift(analysis.nodes[p]);
  }
  for (const ancestor of chain) matrix = multiply(matrix, parseTransform(ancestor.attrs.get("transform")?.value));
  const [a, b, c, d] = matrix;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return { x: dx, y: dy };
  return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det };
}

/**
 * How many drawing units one unit of the element's own box is, on each axis.
 * The canvas stretches the drawing's picture to the element's box, and the
 * drawing maps its viewBox into its own size (preserving aspect unless told
 * not to).
 */
export function elementToUserScale(element, text = element.svgSource) {
  const size = intrinsicSize(text);
  const box = parseViewBox(text) ?? { x: 0, y: 0, width: size.width, height: size.height };
  const rootTag = /<(?:\w+:)?svg\b[^>]*>/i.exec(text ?? "")?.[0] ?? "";
  const none = /preserveAspectRatio\s*=\s*["']\s*none/i.test(rootTag);
  const kx = size.width / (box.width || size.width);
  const ky = size.height / (box.height || size.height);
  const k = none ? null : Math.min(kx, ky);
  return {
    x: size.width / (element.width || size.width) / (k ?? kx),
    y: size.height / (element.height || size.height) / (k ?? ky),
  };
}

/** A move on the page, turned into the drawing's own units for an element. */
export function canvasDeltaToUser(element, dx, dy) {
  const r = (-(element.rotation ?? 0) * Math.PI) / 180;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  const scale = elementToUserScale(element);
  return { x: lx * scale.x, y: ly * scale.y };
}

// ---------------------------------------------------------------------------
// Applying edits
// ---------------------------------------------------------------------------

const num = (v) => String(Math.round(v * 1000) / 1000);

/**
 * Splice insertions into text in one pass. Re-slicing the whole text for each
 * insertion is quadratic, and a drawing with thousands of shapes (so thousands
 * of insertions over megabytes of text) took tens of seconds that way.
 * Insertions at the same position keep the order they were given in.
 */
function applyInsertions(text, insertions) {
  if (insertions.length === 0) return text;
  const sorted = insertions.map((ins, order) => ({ ...ins, order })).sort((a, b) => a.at - b.at || a.order - b.order);
  const parts = [];
  let cursor = 0;
  for (const { at, text: piece } of sorted) {
    parts.push(text.slice(cursor, at), piece);
    cursor = at;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

/** Insertions giving a node extra inline style and a translate in front of its transform. */
function nodeInsertions(node, { style = new Map(), dx = 0, dy = 0 }) {
  const insertions = [];
  const decls = [...style].map(([prop, value]) => `${prop}:${value}`).join(";");
  let tail = "";

  if (decls) {
    const existing = node.attrs.get("style");
    if (existing) {
      const trimmed = existing.value.trim();
      insertions.push({ at: existing.valueEnd, text: `${trimmed === "" || trimmed.endsWith(";") ? "" : ";"}${decls}` });
    } else {
      tail += ` style="${decls}"`;
    }
  }
  if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
    const translate = `translate(${num(dx)} ${num(dy)})`;
    const existing = node.attrs.get("transform");
    if (existing) insertions.push({ at: existing.valueStart, text: `${translate} ` });
    else tail += ` transform="${translate}"`;
  }
  if (tail) insertions.push({ at: node.attrEnd, text: tail });
  return insertions;
}

/**
 * The drawing with part edits applied.
 *
 * `text` may already be recoloured by the whole-drawing palette; its structure
 * is the same as the source's, so the source's `analysis` still says which
 * original colour each shape had. Deeper parts are applied after their
 * containers, so an edit to a single shape wins over one to its group.
 */
export function applyPartEdits(text, analysis, edits) {
  if (!edits || !analysis || Object.keys(edits).length === 0) return text;
  const nodes = scanSvg(text);
  if (!nodes || nodes.length !== analysis.nodes.length) return text;

  const changes = new Map();
  const changeFor = (index) => {
    if (!changes.has(index)) changes.set(index, { style: new Map(), dx: 0, dy: 0 });
    return changes.get(index);
  };

  const depth = (key) => (key === "" ? 0 : key.split(".").length);
  const ordered = Object.entries(edits).sort(([a], [b]) => depth(a) - depth(b));

  for (const [key, edit] of ordered) {
    const part = analysis.byKey.get(key);
    if (!part || part === analysis.root) continue;

    if (edit.colors) {
      for (const index of leavesUnder(analysis, key)) {
        const leaf = analysis.nodes[index];
        for (const prop of ["fill", "stroke"]) {
          const next = edit.colors[leaf.paint[prop]];
          if (next) changeFor(index).style.set(prop, next);
        }
      }
    }
    if (edit.hidden) changeFor(part.index).style.set("display", "none");
    // A nested <svg> cannot take a transform, so it cannot be moved this way.
    if ((edit.dx || edit.dy) && part.name !== "svg") {
      const local = userDeltaToPart(analysis, key, edit.dx ?? 0, edit.dy ?? 0);
      const change = changeFor(part.index);
      change.dx += local.x;
      change.dy += local.y;
    }
  }

  const insertions = [];
  for (const [index, change] of changes) insertions.push(...nodeInsertions(nodes[index], change));
  return applyInsertions(text, insertions);
}

/** The drawing as it should look: palette recolouring, then part edits. */
export function artworkText(element) {
  const recoloured = applyPalette(element.svgSource, effectiveColorMap(element));
  if (!element.partEdits || Object.keys(element.partEdits).length === 0) return recoloured;
  return applyPartEdits(recoloured, analyseSvg(element.svgSource), element.partEdits);
}

/** Tidy an edit: drop what does nothing, and return null if nothing is left. */
export function cleanEdit(edit) {
  const out = {};
  if (edit?.hidden) out.hidden = true;
  if (Math.abs(edit?.dx ?? 0) > 1e-9) out.dx = edit.dx;
  if (Math.abs(edit?.dy ?? 0) > 1e-9) out.dy = edit.dy;
  const colors = Object.entries(edit?.colors ?? {}).filter(([from, to]) => to && to !== from);
  if (colors.length) out.colors = Object.fromEntries(colors);
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

/** The unique colour shape number `i` is painted in the hit picture. */
export const hitColour = (i) => `#${(i + 1).toString(16).padStart(6, "0")}`;

/** The shape number for a pixel of the hit picture, or -1 for none. */
export const hitIndex = (r, g, b) => ((r << 16) | (g << 8) | b) - 1;

/** Whether a drawing has shapes that belong in the "back" hit layer. */
export function hasTranslucentShapes(analysis) {
  return analysis.leaves.some((index) => !analysis.nodes[index].hidden && analysis.nodes[index].translucent);
}

/**
 * A copy of the drawing (as currently drawn) for finding what is under the
 * pointer: every shape painted one solid colour of its own, without effects
 * or anti-aliasing, so each pixel names exactly one shape. Hidden shapes stay
 * hidden. Embedded pictures cannot be recoloured, so a plain box stands in.
 *
 * Two layers, because see-through shapes cannot be given exact colours in
 * place: their colour mixes with whatever is beneath.
 *
 *   front   the solid shapes only, drawn with the drawing's real opacity, so
 *           a click lands on what the eye sees as the part
 *   back    the see-through, masked and blended shapes only, made fully
 *           opaque, for clicks where nothing solid is under the pointer, or
 *           a second click on a part to reach the tint drawn over it
 */
export function buildHitSvg(text, { layer = "front" } = {}) {
  const analysis = analyseSvg(text);
  if (!analysis) return null;
  const insertions = [];

  // Blending and filters would turn a shape's colour into one that names no
  // shape, and they can sit on any group, so one rule switches them off
  // everywhere. The back layer also drops opacity and masks, since everything
  // in it is see-through by nature. Clipping stays: it decides where a shape
  // can be clicked at all.
  const root = analysis.root;
  const prefix = root.prefix ? `${root.prefix}:` : "";
  insertions.push(...nodeInsertions(root, { style: new Map([["shape-rendering", "crispEdges"], ["text-rendering", "optimizeSpeed"]]) }));
  const back = layer === "back";
  insertions.push({
    at: root.tagEnd,
    text:
      `<${prefix}style>*{mix-blend-mode:normal!important;isolation:auto!important;` +
      "filter:none!important;shape-rendering:crispEdges!important" +
      (back ? ";opacity:1!important;fill-opacity:1!important;stroke-opacity:1!important;mask:none!important" : "") +
      `}</${prefix}style>`,
  });

  for (const index of analysis.leaves) {
    const leaf = analysis.nodes[index];
    if (leaf.hidden) continue;
    if (Boolean(leaf.translucent) !== back) {
      insertions.push(...nodeInsertions(leaf, { style: new Map([["display", "none"]]) }));
      continue;
    }
    const colour = hitColour(leaf.leafIndex);
    const style = new Map([
      ["fill", leaf.paint.fill === "none" ? "none" : colour],
      ["stroke", leaf.paint.stroke === "none" ? "none" : colour],
    ]);

    if (leaf.name === "image") {
      style.set("display", "none");
      const copy = ["x", "y", "width", "height", "transform"]
        .filter((name) => leaf.attrs.has(name))
        .map((name) => ` ${name}="${leaf.attrs.get(name).value}"`)
        .join("");
      insertions.push({ at: leaf.end, text: `<${leaf.prefix ? `${leaf.prefix}:` : ""}rect${copy} style="fill:${colour}"/>` });
    }
    insertions.push(...nodeInsertions(leaf, { style }));

    // Inner elements of a shape (a text's tspans) paint in the shape's colour too.
    for (let inner = index + 1; inner <= leaf.last; inner += 1) {
      insertions.push(...nodeInsertions(analysis.nodes[inner], { style: new Map([["fill", style.get("fill")], ["stroke", style.get("stroke")]]) }));
    }
  }
  return applyInsertions(text, insertions);
}
