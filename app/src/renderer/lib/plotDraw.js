/**
 * The pieces every graph is drawn from.
 *
 * Axes, scales, legends and the small chores of writing SVG by hand. They live
 * apart from the graphs themselves so that the everyday plots (plotRender.js)
 * and the ones built for bioinformatics (plotRenderBio.js) draw their axes the
 * same way rather than each growing its own.
 *
 * Nothing here knows what a graph means: it takes numbers and gives markup.
 */

import { ticks as makeTicks, nice } from "d3-array";

/** Group fills: light enough for black points to read on top. */
export const GROUP_COLOURS = ["#bdbdbd", "#8ab6e0", "#f2a37a", "#9fd39b", "#c3a6e0", "#f28b8b", "#8fd1cf", "#f2d17a"];
/** Series colours for X and Y graphs: strong, so thin lines stay visible. */
export const SERIES_COLOURS = ["#1f1f1f", "#2c6fbb", "#d1495b", "#3a9d5d", "#8e5bb8", "#e08a1e", "#138d90", "#7a5230"];

export const FONT = "Helvetica, Arial, sans-serif";
export const INK = "#1a1a1a";

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const r2 = (v) => Math.round(v * 100) / 100;

/** A rough width for a label in Helvetica, enough to leave room for it. */
export function textWidth(text, size) {
  let w = 0;
  for (const ch of String(text ?? "")) {
    if (/[ilIj.,:;'|!]/.test(ch)) w += 0.28;
    else if (/[mwMW]/.test(ch)) w += 0.85;
    else if (/[A-Z]/.test(ch)) w += 0.68;
    else if (ch === " ") w += 0.28;
    else w += 0.56;
  }
  return w * size;
}

/** Tick labels with as many decimals as the step needs, and no more. */
export function tickLabels(values, log = false) {
  if (log) return logLabels(values);
  if (values.length < 2) return values.map((v) => String(v));
  const step = Math.abs(values[1] - values[0]);
  const decimals = Math.max(0, Math.min(8, -Math.floor(Math.log10(step) + 1e-9)));
  return values.map((v) => (Math.abs(v) < step / 1e6 ? 0 : v).toFixed(decimals));
}

/** Parse an axis limit typed by hand; blank means automatic. */
export const limit = (v) => {
  const n = Number(String(v ?? "").trim().replace(",", "."));
  return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};

/** A nice axis range covering lo..hi, honouring limits set by hand. */
export function axisRange(lo, hi, fixedMin, fixedMax, count = 5) {
  let a = fixedMin ?? lo;
  let b = fixedMax ?? hi;
  if (a === b) {
    a -= Math.abs(a) * 0.1 || 1;
    b += Math.abs(b) * 0.1 || 1;
  }
  if (a > b) [a, b] = [b, a];
  const [na, nb] = nice(a, b, count);
  const start = fixedMin ?? na;
  const stop = fixedMax ?? nb;
  const values = makeTicks(start, stop, count).filter((t) => t >= start - 1e-9 && t <= stop + 1e-9);
  return { min: start, max: stop, ticks: values };
}

/**
 * An axis: the range, its ticks, and where a value sits along it (0 at the
 * start, 1 at the end).
 *
 * A logarithmic axis runs between whole powers of ten and ticks at each one,
 * which is what a dose response or a qPCR figure wants. Values at or below
 * zero cannot be placed on it, so they are left out and the graph says so.
 */
export function makeScale({ lo, hi, fixedMin, fixedMax, log = false, count = 5 }) {
  if (!log) {
    const range = axisRange(lo, hi, fixedMin, fixedMax, count);
    const span = range.max - range.min || 1;
    return { ...range, log: false, at: (v) => (v - range.min) / span };
  }
  const positive = [lo, hi, fixedMin, fixedMax].filter((v) => Number.isFinite(v) && v > 0);
  const smallest = fixedMin > 0 ? fixedMin : Math.min(...(positive.length ? positive : [1]));
  const largest = fixedMax > 0 ? fixedMax : Math.max(...(positive.length ? positive : [10]));
  const first = Math.floor(Math.log10(smallest));
  const last = Math.max(first + 1, Math.ceil(Math.log10(largest)));
  const ticks = [];
  for (let decade = first; decade <= last; decade += 1) ticks.push(10 ** decade);
  return {
    min: 10 ** first,
    max: 10 ** last,
    ticks,
    log: true,
    at: (v) => (Math.log10(Math.max(v, 10 ** first)) - first) / (last - first),
  };
}

/** Tick labels for a logarithmic axis: 0.01, 1, 100, then powers of ten. */
export function logLabels(values) {
  return values.map((v) => {
    if (v >= 0.001 && v <= 10000) return String(Number(v.toPrecision(6)));
    const power = Math.round(Math.log10(v));
    return `10^${power}`;
  });
}

export const colourAt = (plot, i, palette) => plot.colors?.[i] || palette[i % palette.length];

export function message(width, height, text, fontSize) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#b8bfcc" stroke-dasharray="6 4"/>` +
    `<text x="${width / 2}" y="${height / 2}" font-family="${FONT}" font-size="${fontSize}" fill="#6b7280" text-anchor="middle">${esc(text)}</text>` +
    `</svg>`
  );
}

/** The y axis, ticks out, set `gap` to the left of the plot area. */
export function yAxis({ x, y, range, f, sw, title, top, bottom }) {
  const labels = tickLabels(range.ticks);
  const tick = f * 0.4;
  let out = `<g data-part="y-axis">`;
  out += `<line x1="${r2(x)}" y1="${r2(y(range.min))}" x2="${r2(x)}" y2="${r2(y(range.max))}" stroke="${INK}" stroke-width="${sw}" stroke-linecap="square"/>`;
  range.ticks.forEach((t, i) => {
    out += `<line x1="${r2(x - tick)}" y1="${r2(y(t))}" x2="${r2(x)}" y2="${r2(y(t))}" stroke="${INK}" stroke-width="${sw}"/>`;
    out += `<text x="${r2(x - tick - f * 0.3)}" y="${r2(y(t) + f * 0.35)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(labels[i])}</text>`;
  });
  if (title) {
    const cy = r2((top + bottom) / 2);
    out += `<text x="${r2(f * 0.95)}" y="${cy}" transform="rotate(-90 ${r2(f * 0.95)} ${cy})" font-family="${FONT}" font-size="${f}" font-weight="bold" fill="${INK}" text-anchor="middle">${esc(title)}</text>`;
  }
  return `${out}</g>`;
}

export const maxLabelWidth = (labels, f) => Math.max(0, ...labels.map((l) => textWidth(l, f)));

/** Where a legend can sit, plus "off" and "auto". */
export const LEGEND_POSITIONS = [
  ["auto", "Automatic"],
  ["off", "Hidden"],
  ["right", "Beside the graph"],
  ["topleft", "Top left"],
  ["topright", "Top right"],
  ["bottomleft", "Bottom left"],
  ["bottomright", "Bottom right"],
];

/**
 * Where the legend goes when nobody has said: X and Y graphs of more than one
 * series get one at the top left, and groups do not, since the names are
 * already written under the bars.
 */
export function legendPlacement(plot, entryCount, shows) {
  const chosen = plot.legend ?? "auto";
  if (chosen === "off") return null;
  if (chosen !== "auto") return chosen;
  // A legend is the only thing naming the series of an X and Y graph, or the
  // conditions of a grouped one. Group names are written under the bars, so
  // those graphs need none.
  if (shows === "xy") return entryCount > 1 ? "topleft" : null;
  // Beside the graph, where it cannot sit under a significance bracket.
  if (shows === "grouped") return entryCount > 1 ? "right" : null;
  return null;
}

/** How wide a legend is, so a graph can leave room beside it. */
export function legendWidth(names, f) {
  if (!names.length) return 0;
  return f * 1.9 + maxLabelWidth(names, f);
}

/**
 * A legend, in a corner of the plot or beside it. `entries` are
 * { name, colour }, drawn with a round marker for X and Y series and a square
 * one for groups. Names come from the data's column names, so renaming a
 * column renames the key.
 *
 * "right" puts it outside the plot, which is where it belongs on a graph
 * carrying significance brackets: a corner legend and a bracket want the same
 * piece of sky.
 */
export function legendSvg(entries, { position, f, sw, left, right, top, bottom, round }) {
  if (!position || entries.length === 0) return "";
  const pad = f * 0.45;
  const lineHeight = f * 1.35;
  const marker = f * 0.5;
  const width = marker + f * 0.5 + maxLabelWidth(entries.map((e) => e.name), f) + pad * 2;
  const height = entries.length * lineHeight + pad * 2 - (lineHeight - f);
  const outside = position === "right";
  const x = outside
    ? right + f * 0.6
    : position.endsWith("left")
    ? left + f * 0.4
    : Math.max(left, right - width - f * 0.4);
  const y = outside
    ? Math.max(top, (top + bottom) / 2 - height / 2)
    : position.startsWith("top")
    ? top + f * 0.3
    : Math.max(top, bottom - height - f * 0.3);

  let out = `<g data-part="legend">`;
  if (!outside) {
    out += `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(width)}" height="${r2(height)}" fill="#ffffff" fill-opacity="0.85" stroke="#c7ccd6" stroke-width="${r2(sw * 0.7)}" rx="${r2(f * 0.2)}"/>`;
  }
  entries.forEach((entry, i) => {
    const cy = y + pad + f * 0.5 + i * lineHeight;
    out += round
      ? `<circle cx="${r2(x + pad + marker / 2)}" cy="${r2(cy)}" r="${r2(marker / 2)}" fill="${entry.colour}" stroke="${INK}" stroke-width="${r2(sw * 0.5)}"/>`
      : `<rect x="${r2(x + pad)}" y="${r2(cy - marker / 2)}" width="${r2(marker)}" height="${r2(marker)}" fill="${entry.colour}" stroke="${INK}" stroke-width="${r2(sw * 0.7)}"/>`;
    out += `<text x="${r2(x + pad + marker + f * 0.5)}" y="${r2(cy + f * 0.35)}" font-family="${FONT}" font-size="${f}" fill="${INK}">${esc(entry.name)}</text>`;
  });
  return `${out}</g>`;
}
