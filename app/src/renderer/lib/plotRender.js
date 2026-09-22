/**
 * Draw a graph as SVG.
 *
 * One pure function turns a graph element and its dataset into SVG markup.
 * The canvas shows that markup as a picture (the same route BioArt drawings
 * take), and SVG and PDF export embed it as real vectors, so what is on
 * screen and what is exported cannot differ.
 *
 * The look follows GraphPad Prism's defaults, which reviewers are used to:
 * axes set slightly away from the data, ticks pointing out, every point drawn
 * over the bar, and error bars above the bar only. Sizes (type, lines, points)
 * are in page units, so resizing a graph redraws it at the new size rather
 * than stretching its text.
 *
 * Parts carry a data-part attribute (y-axis, x-axis, bars, points, errors,
 * brackets, legend), which keeps them identifiable in the exported file.
 */

import { ticks as makeTicks, nice } from "d3-array";
import { columnNumbers, completeRows, groupedFactors, parseNumber, replicateMeans } from "./datasets";
import { describe, kernelDensity, histogramBins } from "./stats";

/** Group fills: light enough for black points to read on top. */
export const GROUP_COLOURS = ["#bdbdbd", "#8ab6e0", "#f2a37a", "#9fd39b", "#c3a6e0", "#f28b8b", "#8fd1cf", "#f2d17a"];
/** Series colours for X and Y graphs: strong, so thin lines stay visible. */
export const SERIES_COLOURS = ["#1f1f1f", "#2c6fbb", "#d1495b", "#3a9d5d", "#8e5bb8", "#e08a1e", "#138d90", "#7a5230"];

export const GROUP_KINDS = [
  ["bar", "Bar and points"],
  ["dots", "Dot plot"],
  ["box", "Box and whiskers"],
  ["violin", "Violin"],
  ["beforeafter", "Before and after"],
  ["histogram", "Histogram"],
  ["pie", "Pie"],
  ["donut", "Donut"],
];

/** Kinds drawn as a circle, with no axes at all. */
export const ROUND_KINDS = new Set(["pie", "donut"]);
/** Kinds that show the spread of the values rather than a summary. */
export const DISTRIBUTION_KINDS = new Set(["violin", "histogram"]);
export const GROUPED_KINDS = [
  ["bar", "Bars side by side"],
  ["stacked", "Stacked bars"],
  ["stacked100", "100% stacked"],
  ["super", "SuperPlot"],
];

/** A table of counts draws like grouped data, without the SuperPlot. */
export const COUNT_KINDS = GROUPED_KINDS.filter(([id]) => id !== "super");

export const SURVIVAL_KINDS = [
  ["survival", "Survival curve"],
  ["survivalPercent", "Percent survival"],
];
export const XY_KINDS = [
  ["scatter", "Scatter"],
  ["line", "Points and lines"],
];

const FONT = "Helvetica, Arial, sans-serif";
const INK = "#1a1a1a";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const r2 = (v) => Math.round(v * 100) / 100;

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
function tickLabels(values, log = false) {
  if (log) return logLabels(values);
  if (values.length < 2) return values.map((v) => String(v));
  const step = Math.abs(values[1] - values[0]);
  const decimals = Math.max(0, Math.min(8, -Math.floor(Math.log10(step) + 1e-9)));
  return values.map((v) => (Math.abs(v) < step / 1e6 ? 0 : v).toFixed(decimals));
}

/** Parse an axis limit typed by hand; blank means automatic. */
const limit = (v) => {
  const n = Number(String(v ?? "").trim().replace(",", "."));
  return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};

/** A nice axis range covering lo..hi, honouring limits set by hand. */
function axisRange(lo, hi, fixedMin, fixedMax, count = 5) {
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

/**
 * Spread points sideways so they do not hide each other: each point takes the
 * nearest free spot to the centre line, within `maxOffset`. Deterministic, so
 * a graph looks the same every time it is drawn.
 */
export function beeswarm(ys, radius, maxOffset) {
  const order = ys.map((y, i) => [y, i]).sort((a, b) => a[0] - b[0]);
  const placed = [];
  const out = new Array(ys.length).fill(0);
  const gap = radius * 2.1;
  for (const [y, i] of order) {
    let chosen = 0;
    for (let step = 0; step < 60; step += 1) {
      const dx = step === 0 ? 0 : Math.ceil(step / 2) * gap * 0.55 * (step % 2 ? 1 : -1);
      if (Math.abs(dx) > maxOffset) {
        chosen = Math.max(-maxOffset, Math.min(maxOffset, dx));
        break;
      }
      const clash = placed.some((p) => Math.hypot(p.x - dx, p.y - y) < gap);
      if (!clash) {
        chosen = dx;
        break;
      }
    }
    placed.push({ x: chosen, y });
    out[i] = chosen;
  }
  return out;
}

/** Default settings for a new graph, sized for the page it goes on. */
export function defaultPlot(kind = "bar", { fontSize = 28 } = {}) {
  return {
    kind,
    error: "sd",
    points: true,
    yTitle: "",
    xTitle: "",
    yMin: "",
    yMax: "",
    fontSize,
    colors: [],
    legend: "auto",
    yScale: "linear",
    normality: "shapiro",
    xScale: "linear",
    curve: false,
    binWidth: "",
    fitModel: "none",
    band: true,
    test: "auto",
    within: "conditions",
    correction: "sidak",
    control: 0,
    paired: false,
    brackets: {},
    fit: false,
  };
}

const colourAt = (plot, i, palette) => plot.colors?.[i] || palette[i % palette.length];

function message(width, height, text, fontSize) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#b8bfcc" stroke-dasharray="6 4"/>` +
    `<text x="${width / 2}" y="${height / 2}" font-family="${FONT}" font-size="${fontSize}" fill="#6b7280" text-anchor="middle">${esc(text)}</text>` +
    `</svg>`
  );
}

/** The y axis, ticks out, set `gap` to the left of the plot area. */
function yAxis({ x, y, range, f, sw, title, top, bottom }) {
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

const maxLabelWidth = (labels, f) => Math.max(0, ...labels.map((l) => textWidth(l, f)));

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
function legendSvg(entries, { position, f, sw, left, right, top, bottom, round }) {
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

// ---------------------------------------------------------------------------
// Groups: bar, dot plot, box and whiskers
// ---------------------------------------------------------------------------

function groupsSvg(element, dataset, brackets) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const cols = dataset.columns.map((_, i) => i).filter((i) => columnNumbers(dataset, i).length > 0);
  if (cols.length === 0) return message(W, H, "Add numbers to the data to draw this graph", f);

  const stats = cols.map((c) => describe(columnNumbers(dataset, c)));
  const errOf = (s) => (plot.error === "sem" ? s.sem : plot.error === "ci" ? s.ci : s.sd);
  let dataLo = Infinity;
  let dataHi = -Infinity;
  stats.forEach((s) => {
    const e = ["box", "violin", "beforeafter"].includes(plot.kind) ? 0 : errOf(s);
    dataLo = Math.min(dataLo, s.min, s.mean - (plot.kind === "dots" ? e : 0));
    dataHi = Math.max(dataHi, s.max, s.mean + e);
  });
  // Bars start at zero; the other kinds do too when all the data are positive,
  // as Prism draws them.
  const lo = plot.kind === "bar" || dataLo >= 0 ? Math.min(0, dataLo) : dataLo;
  const range = makeScale({ lo, hi: dataHi, fixedMin: limit(plot.yMin), fixedMax: limit(plot.yMax), log: plot.yScale === "log" });

  const names = cols.map((c) => dataset.columns[c].name || `Group ${c + 1}`);
  const tickText = tickLabels(range.ticks, range.log);
  const levels = brackets.length ? stackBrackets(brackets, cols) : [];
  const levelCount = levels.reduce((m, b) => Math.max(m, b.level + 1), 0);

  const axisGap = f * 0.5;
  const left = (plot.yTitle ? f * 1.7 : f * 0.3) + maxLabelWidth(tickText, f) + f * 0.7 + axisGap;
  const right = f * 0.5;
  const plotWidth = Math.max(10, W - left - right);
  const band = plotWidth / cols.length;
  const bw = band;
  const labelWidth = maxLabelWidth(names, f);
  const rotate = labelWidth > band * 0.92;
  const bottom = axisGap + f * 0.5 + (rotate ? labelWidth * 0.72 + f * 0.6 : f * 1.3) + (plot.xTitle ? f * 1.6 : 0);
  const top = f * 0.6 + levelCount * f * 1.5;
  const plotTop = top;
  const plotBottom = Math.max(plotTop + 10, H - bottom);
  const y = (v) => plotBottom - range.at(v) * (plotBottom - plotTop);
  const cx = (i) => left + band * (i + 0.5);
  const barWidth = band * 0.6;
  const radius = Math.max(2, f * 0.2);
  const clampY = (v) => Math.max(plotTop - f * 0.2, Math.min(plotBottom, y(v)));

  const bars = [];
  const errors = [];
  const points = [];
  const lines = [];

  // Before and after: one line per row, joining that row's value in each
  // group, which is how paired measurements are shown.
  if (plot.kind === "beforeafter") {
    const rowCount = Math.max(0, ...cols.map((c) => dataset.columns[c].values.length));
    for (let row = 0; row < rowCount; row += 1) {
      const onRow = cols
        .map((c, i) => ({ i, value: parseNumber(dataset.columns[c].values[row]) }))
        .filter((p) => Number.isFinite(p.value));
      if (onRow.length < 2) continue;
      const d = onRow.map((p, k) => `${k === 0 ? "M" : "L"}${r2(cx(p.i))} ${r2(clampY(p.value))}`).join(" ");
      lines.push(`<path d="${d}" fill="none" stroke="#7b8393" stroke-width="${r2(sw * 0.9)}"/>`);
    }
  }

  stats.forEach((s, i) => {
    const x = cx(i);
    const fill = colourAt(plot, cols[i], GROUP_COLOURS);
    const e = errOf(s);
    if (plot.kind === "violin") {
      // The shape is the kernel density, mirrored about the group's centre and
      // cut off at the smallest and largest value, as Prism draws it.
      const values = columnNumbers(dataset, cols[i]);
      const curve = kernelDensity(values, { points: 64, from: s.min, to: s.max });
      const peak = Math.max(...curve.map((c) => c.y), 1e-12);
      const half = bw * 0.42;
      const right = curve.map((c) => `${r2(x + (c.y / peak) * half)},${r2(clampY(c.x))}`);
      const left2 = [...curve].reverse().map((c) => `${r2(x - (c.y / peak) * half)},${r2(clampY(c.x))}`);
      bars.push(
        `<polygon points="${[...right, ...left2].join(" ")}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`
      );
      errors.push(
        `<line x1="${r2(x - half * 0.5)}" y1="${r2(clampY(s.median))}" x2="${r2(x + half * 0.5)}" y2="${r2(clampY(s.median))}" stroke="${INK}" stroke-width="${r2(sw * 1.8)}"/>`
      );
    } else if (plot.kind === "beforeafter") {
      // The lines are the graph; each group gets a bar at its mean.
      errors.push(
        `<line x1="${r2(x - bw * 0.22)}" y1="${r2(clampY(s.mean))}" x2="${r2(x + bw * 0.22)}" y2="${r2(clampY(s.mean))}" stroke="${INK}" stroke-width="${r2(sw * 1.8)}"/>`
      );
    } else if (plot.kind === "bar") {
      const base = y(Math.max(range.min, Math.min(range.max, 0)));
      const top = clampY(s.mean);
      bars.push(`<rect x="${r2(x - barWidth / 2)}" y="${r2(Math.min(base, top))}" width="${r2(barWidth)}" height="${r2(Math.abs(base - top))}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`);
      if (e > 0) {
        const tip = clampY(s.mean >= 0 ? s.mean + e : s.mean - e);
        errors.push(`<line x1="${r2(x)}" y1="${r2(top)}" x2="${r2(x)}" y2="${r2(tip)}" stroke="${INK}" stroke-width="${sw}"/>`);
        errors.push(`<line x1="${r2(x - barWidth * 0.18)}" y1="${r2(tip)}" x2="${r2(x + barWidth * 0.18)}" y2="${r2(tip)}" stroke="${INK}" stroke-width="${sw}"/>`);
      }
    } else if (plot.kind === "dots") {
      bars.push(`<line x1="${r2(x - barWidth * 0.4)}" y1="${r2(clampY(s.mean))}" x2="${r2(x + barWidth * 0.4)}" y2="${r2(clampY(s.mean))}" stroke="${INK}" stroke-width="${r2(sw * 1.8)}"/>`);
      if (e > 0) {
        const hi = clampY(s.mean + e);
        const lo2 = clampY(s.mean - e);
        errors.push(`<line x1="${r2(x)}" y1="${r2(lo2)}" x2="${r2(x)}" y2="${r2(hi)}" stroke="${INK}" stroke-width="${sw}"/>`);
        for (const tip of [hi, lo2]) {
          errors.push(`<line x1="${r2(x - barWidth * 0.16)}" y1="${r2(tip)}" x2="${r2(x + barWidth * 0.16)}" y2="${r2(tip)}" stroke="${INK}" stroke-width="${sw}"/>`);
        }
      }
    } else {
      const w = barWidth * 0.8;
      errors.push(`<line x1="${r2(x)}" y1="${r2(clampY(s.q3))}" x2="${r2(x)}" y2="${r2(clampY(s.max))}" stroke="${INK}" stroke-width="${sw}"/>`);
      errors.push(`<line x1="${r2(x)}" y1="${r2(clampY(s.q1))}" x2="${r2(x)}" y2="${r2(clampY(s.min))}" stroke="${INK}" stroke-width="${sw}"/>`);
      for (const v of [s.max, s.min]) {
        errors.push(`<line x1="${r2(x - w * 0.25)}" y1="${r2(clampY(v))}" x2="${r2(x + w * 0.25)}" y2="${r2(clampY(v))}" stroke="${INK}" stroke-width="${sw}"/>`);
      }
      bars.push(`<rect x="${r2(x - w / 2)}" y="${r2(clampY(s.q3))}" width="${r2(w)}" height="${r2(Math.max(sw, clampY(s.q1) - clampY(s.q3)))}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`);
      bars.push(`<line x1="${r2(x - w / 2)}" y1="${r2(clampY(s.median))}" x2="${r2(x + w / 2)}" y2="${r2(clampY(s.median))}" stroke="${INK}" stroke-width="${r2(sw * 1.8)}"/>`);
    }
    const showPoints = plot.points || ["dots", "beforeafter"].includes(plot.kind);
    if (showPoints) {
      const values = columnNumbers(dataset, cols[i]);
      const ys = values.map(clampY);
      // Paired lines have to meet their own points, so those stay in line.
      const spread = plot.kind === "beforeafter" ? 0 : barWidth * (plot.kind === "dots" ? 0.45 : 0.38);
      const offsets = spread ? beeswarm(ys, radius, spread) : ys.map(() => 0);
      const pointFill = ["dots", "violin", "beforeafter"].includes(plot.kind) ? fill : INK;
      ys.forEach((py, k) => {
        points.push(`<circle cx="${r2(x + offsets[k])}" cy="${r2(py)}" r="${r2(radius)}" fill="${pointFill}" stroke="${INK}" stroke-width="${r2(sw * 0.6)}"/>`);
      });
    }
  });

  // Axes, Prism style: the x axis spans the groups, the y axis stands off.
  const axisX = left - axisGap;
  let axes = yAxis({ x: axisX, y, range, f, sw, title: plot.yTitle, top: plotTop, bottom: plotBottom });
  let xAxis = `<g data-part="x-axis">`;
  const baseY = y(range.min);
  xAxis += `<line x1="${r2(left - axisGap * 0.2)}" y1="${r2(baseY + axisGap)}" x2="${r2(left + plotWidth)}" y2="${r2(baseY + axisGap)}" stroke="${INK}" stroke-width="${sw}"/>`;
  names.forEach((name, i) => {
    const ly = baseY + axisGap + f * 1.3;
    if (rotate) {
      const lx = cx(i) + f * 0.3;
      xAxis += `<text x="${r2(lx)}" y="${r2(ly - f * 0.4)}" transform="rotate(-45 ${r2(lx)} ${r2(ly - f * 0.4)})" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(name)}</text>`;
    } else {
      xAxis += `<text x="${r2(cx(i))}" y="${r2(ly)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${esc(name)}</text>`;
    }
  });
  if (plot.xTitle) {
    xAxis += `<text x="${r2(left + plotWidth / 2)}" y="${r2(H - f * 0.4)}" font-family="${FONT}" font-size="${f}" font-weight="bold" fill="${INK}" text-anchor="middle">${esc(plot.xTitle)}</text>`;
  }
  axes += `${xAxis}</g>`;

  // Brackets: stacked from the top of the data, shortest spans lowest.
  let bracketSvg = "";
  if (levels.length) {
    const base = Math.min(y(dataHi), plotBottom) - f * 0.6;
    const tick = f * 0.35;
    bracketSvg = `<g data-part="brackets">`;
    for (const b of levels) {
      const by = Math.max(f * 1.2, base - b.level * f * 1.5);
      const x1 = cx(b.from) + band * 0.06;
      const x2 = cx(b.to) - band * 0.06;
      bracketSvg += `<path d="M${r2(x1)} ${r2(by + tick)}V${r2(by)}H${r2(x2)}V${r2(by + tick)}" fill="none" stroke="${INK}" stroke-width="${sw}"/>`;
      const label = b.stars === "ns" ? "ns" : b.stars;
      bracketSvg += `<text x="${r2((x1 + x2) / 2)}" y="${r2(by - f * (label === "ns" ? 0.25 : 0.05))}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${esc(label)}</text>`;
    }
    bracketSvg += `</g>`;
  }

  const legend = legendSvg(
    names.map((name, i) => ({ name, colour: colourAt(plot, cols[i], GROUP_COLOURS) })),
    {
      position: legendPlacement(plot, names.length, "groups"),
      f,
      sw,
      left,
      right: W - right,
      top: plotTop,
      bottom: plotBottom,
      round: false,
    }
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<g data-part="bars">${bars.join("")}</g>` +
    `<g data-part="lines">${lines.join("")}</g>` +
    `<g data-part="errors">${errors.join("")}</g>` +
    `<g data-part="points">${points.join("")}</g>` +
    axes +
    bracketSvg +
    legend +
    `</svg>`
  );
}

/**
 * Give each bracket a level so none overlap: shortest spans go lowest, and a
 * bracket moves up until its level is free across its whole span. `from` and
 * `to` are positions on the axis, not dataset columns.
 */
export function stackBrackets(brackets, cols) {
  const at = (col) => cols.indexOf(col);
  const spans = brackets
    .map((b) => ({ ...b, from: Math.min(at(b.i), at(b.j)), to: Math.max(at(b.i), at(b.j)) }))
    .filter((b) => b.from >= 0 && b.to >= 0)
    .sort((a, b) => a.to - a.from - (b.to - b.from) || a.from - b.from);
  const placed = [];
  for (const b of spans) {
    let level = 0;
    while (placed.some((p) => p.level === level && !(b.to < p.from || b.from > p.to))) level += 1;
    placed.push({ ...b, level });
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Survival curves
// ---------------------------------------------------------------------------

/**
 * Kaplan-Meier curves: a step down at each event, flat in between, with a tick
 * where a subject was censored. Percent survival is the same curve with the
 * axis in percent, which is how most papers print it.
 */
function survivalSvg(element, dataset, survival) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const groups = survival?.groups ?? [];
  if (!groups.length) return message(W, H, "Add a time and an event for each subject", f);

  const percent = plot.kind === "survivalPercent";
  const scale = percent ? 100 : 1;
  const latest = Math.max(...groups.flatMap((g) => g.curve.steps.map((s) => s.time)), 1);
  const xr = makeScale({ lo: 0, hi: latest, fixedMin: 0, count: 6 });
  const yr = makeScale({ lo: 0, hi: scale, fixedMin: 0, fixedMax: scale, count: 5 });
  const xTicks = tickLabels(xr.ticks);
  const yTicks = tickLabels(yr.ticks);

  const axisGap = f * 0.5;
  const names = groups.map((g) => g.name);
  const legendAt = legendPlacement(plot, names.length, "xy");
  const left = f * 1.7 + maxLabelWidth(yTicks, f) + f * 0.7 + axisGap;
  const right = f * 0.6;
  const bottom = axisGap + f * 1.9 + f * 1.6;
  const top = f * 0.8;
  const plotRight = W - right;
  const plotBottom = Math.max(top + 10, H - bottom);
  const x = (v) => left + xr.at(v) * (plotRight - left);
  const y = (v) => plotBottom - yr.at(v) * (plotBottom - top);

  let body = `<g data-part="curves">`;
  groups.forEach((group, index) => {
    const colour = colourAt(plot, index, SERIES_COLOURS);
    let d = `M${r2(x(0))} ${r2(y(scale))}`;
    let last = scale;
    for (const step of group.curve.steps) {
      if (step.time === 0) continue;
      // Along to the time, then down by however many had the event.
      d += `L${r2(x(step.time))} ${r2(y(last))}`;
      if (step.events > 0) {
        last = step.survival * scale;
        d += `L${r2(x(step.time))} ${r2(y(last))}`;
      }
    }
    d += `L${r2(x(latest))} ${r2(y(last))}`;
    body += `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${r2(sw * 1.6)}" stroke-linejoin="miter"/>`;

    if (plot.points !== false) {
      // A tick where a subject was censored: they left the study still alive.
      for (const step of group.curve.steps) {
        if (!step.censored) continue;
        const at = group.curve.at(step.time) * scale;
        body += `<line data-part="censored" x1="${r2(x(step.time))}" y1="${r2(y(at) - f * 0.28)}" x2="${r2(x(step.time))}" y2="${r2(y(at) + f * 0.28)}" stroke="${colour}" stroke-width="${r2(sw * 1.4)}"/>`;
      }
    }
  });
  body += `</g>`;

  let axes = yAxis({
    x: left - axisGap,
    y,
    range: yr,
    f,
    sw,
    title: plot.yTitle || (percent ? "Percent survival" : "Survival"),
    top,
    bottom: plotBottom,
  });
  const tick = f * 0.4;
  const axisY = plotBottom + axisGap;
  axes += `<g data-part="x-axis"><line x1="${r2(x(0))}" y1="${r2(axisY)}" x2="${r2(x(xr.max))}" y2="${r2(axisY)}" stroke="${INK}" stroke-width="${sw}" stroke-linecap="square"/>`;
  xr.ticks.forEach((value, i) => {
    axes += `<line x1="${r2(x(value))}" y1="${r2(axisY)}" x2="${r2(x(value))}" y2="${r2(axisY + tick)}" stroke="${INK}" stroke-width="${sw}"/>`;
    axes += `<text x="${r2(x(value))}" y="${r2(axisY + tick + f * 1.05)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${esc(xTicks[i])}</text>`;
  });
  const xTitle = plot.xTitle || dataset.columns[0]?.name || "Time";
  axes += `<text x="${r2((left + plotRight) / 2)}" y="${r2(H - f * 0.4)}" font-family="${FONT}" font-size="${f}" font-weight="bold" fill="${INK}" text-anchor="middle">${esc(xTitle)}</text></g>`;

  const legend = legendSvg(
    names.map((name, i) => ({ name, colour: colourAt(plot, i, SERIES_COLOURS) })),
    { position: legendAt, f, sw, left, right: plotRight, top, bottom: plotBottom, round: true }
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}${axes}${legend}</svg>`;
}

// ---------------------------------------------------------------------------
// SuperPlot: every measurement, coloured by which replicate it came from
// ---------------------------------------------------------------------------

/**
 * A SuperPlot (Lord and others, 2020): each condition holds every
 * measurement, coloured by the replicate it came from, with that replicate's
 * mean drawn as a large marker on top, and the mean and spread taken across
 * those replicate means rather than across the individual measurements.
 *
 * The statistics follow the same rule, which is the point of the plot: cells
 * in one dish are not independent of each other.
 */
function superSvg(element, dataset, brackets) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const { levels, conditions, valuesAt } = groupedFactors(dataset);
  if (levels.length === 0 || conditions.length === 0) {
    return message(W, H, "Name the replicates in the first column, and add a condition", f);
  }

  const means = replicateMeans(dataset);
  const summary = conditions.map((_, col) => describe(columnNumbers(means, col)));
  const errOf = (s) => (!s ? 0 : plot.error === "sem" ? s.sem : plot.error === "ci" ? s.ci : s.sd);

  let dataHi = -Infinity;
  let dataLo = Infinity;
  conditions.forEach((condition, col) => {
    levels.forEach((level) => {
      for (const v of valuesAt(level, condition.name)) {
        dataHi = Math.max(dataHi, v);
        dataLo = Math.min(dataLo, v);
      }
    });
    const s = summary[col];
    if (s) {
      dataHi = Math.max(dataHi, s.mean + errOf(s));
      dataLo = Math.min(dataLo, s.mean - errOf(s));
    }
  });
  const range = makeScale({
    lo: dataLo >= 0 ? 0 : dataLo,
    hi: dataHi,
    fixedMin: limit(plot.yMin),
    fixedMax: limit(plot.yMax),
    log: plot.yScale === "log",
  });
  const tickText = tickLabels(range.ticks, range.log);

  const placed = brackets.length ? stackBrackets(brackets, conditions.map((_, i) => i)) : [];
  const bracketLevels = placed.reduce((m, b) => Math.max(m, b.level + 1), 0);
  const axisGap = f * 0.5;
  const names = levels;
  const legendAt = legendPlacement(plot, names.length, "grouped");
  const left = (plot.yTitle ? f * 1.7 : f * 0.3) + maxLabelWidth(tickText, f) + f * 0.7 + axisGap;
  const right = f * 0.5 + (legendAt === "right" ? legendWidth(names, f) : 0);
  const plotWidth = Math.max(10, W - left - right);
  const band = plotWidth / conditions.length;
  const conditionNames = conditions.map((c) => c.name);
  const rotate = maxLabelWidth(conditionNames, f) > band * 0.92;
  const bottom = axisGap + f * 0.5 + (rotate ? maxLabelWidth(conditionNames, f) * 0.72 + f * 0.6 : f * 1.3) + (plot.xTitle ? f * 1.6 : 0);
  const top = f * 0.6 + bracketLevels * f * 1.5;
  const plotBottom = Math.max(top + 10, H - bottom);
  const y = (v) => plotBottom - range.at(v) * (plotBottom - top);
  const clampY = (v) => Math.max(top - f * 0.2, Math.min(plotBottom, y(v)));
  const cx = (col) => left + band * (col + 0.5);
  const radius = Math.max(1.6, f * 0.14);

  const points = [];
  const markers = [];
  const errors = [];
  conditions.forEach((condition, col) => {
    const x = cx(col);
    levels.forEach((level, replicate) => {
      const colour = colourAt(plot, replicate, GROUP_COLOURS);
      const values = valuesAt(level, condition.name);
      if (!values.length) return;
      const ys = values.map(clampY);
      const offsets = beeswarm(ys, radius, band * 0.3);
      ys.forEach((py, k) => {
        points.push(
          `<circle cx="${r2(x + offsets[k])}" cy="${r2(py)}" r="${r2(radius)}" fill="${colour}" fill-opacity="0.75" stroke="none"/>`
        );
      });
      const replicateMean = values.reduce((sum, v) => sum + v, 0) / values.length;
      markers.push(
        `<circle cx="${r2(x)}" cy="${r2(clampY(replicateMean))}" r="${r2(radius * 2.6)}" fill="${colour}" stroke="${INK}" stroke-width="${r2(sw * 1.1)}"/>`
      );
    });
    const s = summary[col];
    if (!s) return;
    errors.push(
      `<line x1="${r2(x - band * 0.28)}" y1="${r2(clampY(s.mean))}" x2="${r2(x + band * 0.28)}" y2="${r2(clampY(s.mean))}" stroke="${INK}" stroke-width="${r2(sw * 2)}"/>`
    );
    const e = errOf(s);
    if (e > 0) {
      errors.push(`<line x1="${r2(x)}" y1="${r2(clampY(s.mean - e))}" x2="${r2(x)}" y2="${r2(clampY(s.mean + e))}" stroke="${INK}" stroke-width="${sw}"/>`);
      for (const tip of [s.mean + e, s.mean - e]) {
        errors.push(
          `<line x1="${r2(x - band * 0.1)}" y1="${r2(clampY(tip))}" x2="${r2(x + band * 0.1)}" y2="${r2(clampY(tip))}" stroke="${INK}" stroke-width="${sw}"/>`
        );
      }
    }
  });

  let axes = yAxis({ x: left - axisGap, y, range, f, sw, title: plot.yTitle, top, bottom: plotBottom });
  const baseY = y(range.min);
  axes += `<g data-part="x-axis"><line x1="${r2(left - axisGap * 0.2)}" y1="${r2(baseY + axisGap)}" x2="${r2(left + plotWidth)}" y2="${r2(baseY + axisGap)}" stroke="${INK}" stroke-width="${sw}"/>`;
  conditionNames.forEach((name, col) => {
    const ly = baseY + axisGap + f * 1.3;
    if (rotate) {
      axes += `<text x="${r2(cx(col) + f * 0.3)}" y="${r2(ly - f * 0.4)}" transform="rotate(-45 ${r2(cx(col) + f * 0.3)} ${r2(ly - f * 0.4)})" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(name)}</text>`;
    } else {
      axes += `<text x="${r2(cx(col))}" y="${r2(ly)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${esc(name)}</text>`;
    }
  });
  if (plot.xTitle) {
    axes += `<text x="${r2(left + plotWidth / 2)}" y="${r2(H - f * 0.4)}" font-family="${FONT}" font-size="${f}" font-weight="bold" fill="${INK}" text-anchor="middle">${esc(plot.xTitle)}</text>`;
  }
  axes += `</g>`;

  let bracketSvg = "";
  if (placed.length) {
    const base = Math.min(y(dataHi), plotBottom) - f * 0.6;
    const tick = f * 0.35;
    bracketSvg = `<g data-part="brackets">`;
    for (const bracket of placed) {
      const by = Math.max(f * 1.2, base - bracket.level * f * 1.5);
      const x1 = cx(Math.min(bracket.i, bracket.j)) + band * 0.06;
      const x2 = cx(Math.max(bracket.i, bracket.j)) - band * 0.06;
      bracketSvg += `<path d="M${r2(x1)} ${r2(by + tick)}V${r2(by)}H${r2(x2)}V${r2(by + tick)}" fill="none" stroke="${INK}" stroke-width="${sw}"/>`;
      bracketSvg += `<text x="${r2((x1 + x2) / 2)}" y="${r2(by - f * (bracket.stars === "ns" ? 0.25 : 0.05))}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${esc(bracket.stars)}</text>`;
    }
    bracketSvg += `</g>`;
  }

  const legend = legendSvg(
    levels.map((level, i) => ({ name: level, colour: colourAt(plot, i, GROUP_COLOURS) })),
    { position: legendAt, f, sw, left, right: left + plotWidth, top, bottom: plotBottom, round: true }
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<g data-part="points">${points.join("")}</g>` +
    `<g data-part="replicate-means">${markers.join("")}</g>` +
    `<g data-part="errors">${errors.join("")}</g>` +
    axes +
    bracketSvg +
    legend +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Parts of a whole: pie and donut
// ---------------------------------------------------------------------------

/** A wedge path from `from` to `to` radians, hollow when `inner` is given. */
function wedge(cx, cy, radius, inner, from, to) {
  const point = (r, angle) => `${r2(cx + r * Math.cos(angle))} ${r2(cy + r * Math.sin(angle))}`;
  const large = to - from > Math.PI ? 1 : 0;
  if (!inner) {
    return `M${r2(cx)} ${r2(cy)} L${point(radius, from)} A${r2(radius)} ${r2(radius)} 0 ${large} 1 ${point(radius, to)} Z`;
  }
  return (
    `M${point(radius, from)} A${r2(radius)} ${r2(radius)} 0 ${large} 1 ${point(radius, to)} ` +
    `L${point(inner, to)} A${r2(inner)} ${r2(inner)} 0 ${large} 0 ${point(inner, from)} Z`
  );
}

/**
 * A pie or donut: each column is a slice, sized by its mean.
 *
 * Angles read worse than lengths, so this is for composition at a glance
 * rather than for comparing values; the percentage is written on every slice
 * that has room for it, and the legend names them.
 */
function pieSvg(element, dataset) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const cols = dataset.columns.map((_, i) => i).filter((i) => columnNumbers(dataset, i).length > 0);
  const values = cols.map((c) => Math.max(0, describe(columnNumbers(dataset, c)).mean));
  const total = values.reduce((sum, v) => sum + v, 0);
  if (cols.length === 0 || total <= 0) return message(W, H, "Add positive numbers to draw a pie", f);

  const names = cols.map((c) => dataset.columns[c].name || `Group ${c + 1}`);
  const legendAt = plot.legend === "off" ? null : plot.legend && plot.legend !== "auto" ? plot.legend : "right";
  const legendRoom = legendAt === "right" ? legendWidth(names, f) + f * 0.6 : 0;
  const radius = Math.max(10, Math.min((W - legendRoom) / 2, H / 2) - f * 0.6);
  const cx = (W - legendRoom) / 2;
  const cy = H / 2;
  const inner = plot.kind === "donut" ? radius * 0.55 : 0;

  let angle = -Math.PI / 2; // start at the top, as every pie does
  const slices = [];
  const labels = [];
  values.forEach((value, i) => {
    const share = value / total;
    const next = angle + share * Math.PI * 2;
    slices.push(
      `<path d="${wedge(cx, cy, radius, inner, angle, next)}" fill="${colourAt(plot, cols[i], GROUP_COLOURS)}" stroke="${INK}" stroke-width="${sw}"/>`
    );
    // Only label a slice with room for the text.
    if (share > 0.05) {
      const mid = (angle + next) / 2;
      const at = inner ? (radius + inner) / 2 : radius * 0.62;
      const percent = `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`;
      labels.push(
        `<text x="${r2(cx + at * Math.cos(mid))}" y="${r2(cy + at * Math.sin(mid) + f * 0.35)}" font-family="${FONT}" font-size="${r2(f * 0.9)}" fill="${INK}" text-anchor="middle">${esc(percent)}</text>`
      );
    }
    angle = next;
  });

  const legend = legendSvg(
    names.map((name, i) => ({ name, colour: colourAt(plot, cols[i], GROUP_COLOURS) })),
    { position: legendAt, f, sw, left: 0, right: W - legendRoom, top: 0, bottom: H, round: false }
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<g data-part="slices">${slices.join("")}</g><g data-part="labels">${labels.join("")}</g>${legend}</svg>`
  );
}

// ---------------------------------------------------------------------------
// Histogram, with an optional density curve
// ---------------------------------------------------------------------------

/**
 * How often each value occurs. Several groups are drawn over each other, part
 * transparent, sharing one set of bins so the bars line up.
 */
function histogramSvg(element, dataset) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const cols = dataset.columns.map((_, i) => i).filter((i) => columnNumbers(dataset, i).length > 0);
  if (cols.length === 0) return message(W, H, "Add numbers to draw a histogram", f);

  const all = cols.flatMap((c) => columnNumbers(dataset, c));
  const shared = histogramBins(all, { binWidth: limit(plot.binWidth) });
  const perGroup = cols.map((c) => {
    const values = columnNumbers(dataset, c);
    const counts = new Array(shared.breaks.length - 1).fill(0);
    for (const value of values) {
      let index = Math.floor((value - shared.breaks[0]) / shared.width);
      index = Math.max(0, Math.min(counts.length - 1, index));
      counts[index] += 1;
    }
    return { col: c, values, counts };
  });

  const highest = Math.max(1, ...perGroup.flatMap((g) => g.counts));
  const yRange = axisRange(0, highest, limit(plot.yMin), limit(plot.yMax), 5);
  const xRange = {
    min: shared.breaks[0],
    max: shared.breaks[shared.breaks.length - 1],
    ticks: makeTicks(shared.breaks[0], shared.breaks[shared.breaks.length - 1], 6),
  };

  const yTicks = tickLabels(yRange.ticks);
  const xTicks = tickLabels(xRange.ticks);
  const axisGap = f * 0.5;
  const names = perGroup.map((g) => dataset.columns[g.col].name || `Group ${g.col + 1}`);
  const legendAt = legendPlacement(plot, names.length, "grouped");
  // A histogram always has a Y title ("Count" unless one is typed), so the
  // room for it is always reserved.
  const yTitle = plot.yTitle || "Count";
  const left = f * 1.7 + maxLabelWidth(yTicks, f) + f * 0.7 + axisGap;
  const right = f * 0.5 + (legendAt === "right" ? legendWidth(names, f) : 0);
  const bottom = axisGap + f * 1.9 + (plot.xTitle ? f * 1.6 : 0);
  const top = f * 0.8;
  const plotRight = W - right;
  const plotBottom = Math.max(top + 10, H - bottom);
  const x = (v) => left + ((v - xRange.min) / (xRange.max - xRange.min)) * (plotRight - left);
  const y = (v) => plotBottom - ((v - yRange.min) / (yRange.max - yRange.min)) * (plotBottom - top);

  let body = `<g data-part="bars">`;
  perGroup.forEach((group, gi) => {
    const colour = colourAt(plot, group.col, GROUP_COLOURS);
    group.counts.forEach((count, bin) => {
      if (!count) return;
      const x0 = x(shared.breaks[bin]);
      const x1 = x(shared.breaks[bin + 1]);
      body +=
        `<rect x="${r2(x0)}" y="${r2(y(count))}" width="${r2(Math.max(1, x1 - x0))}" height="${r2(y(0) - y(count))}" ` +
        `fill="${colour}" fill-opacity="${perGroup.length > 1 ? 0.6 : 1}" stroke="${INK}" stroke-width="${sw}"/>`;
    });
    if (plot.curve) {
      // The density, scaled to the bars: its area is one, so multiplying by
      // the count and the bin width puts it on the same footing.
      const curve = kernelDensity(group.values, { points: 96 });
      const scale = group.values.length * shared.width;
      const d = curve
        .filter((p) => p.x >= xRange.min && p.x <= xRange.max)
        .map((p, i) => `${i === 0 ? "M" : "L"}${r2(x(p.x))} ${r2(y(Math.min(yRange.max, p.y * scale)))}`)
        .join(" ");
      if (d) body += `<path data-part="density" d="${d}" fill="none" stroke="${colour}" stroke-width="${r2(sw * 1.6)}"/>`;
    }
  });
  body += `</g>`;

  let axes = yAxis({ x: left - axisGap, y, range: yRange, f, sw, title: yTitle, top, bottom: plotBottom });
  const tick = f * 0.4;
  const axisY = plotBottom + axisGap;
  axes += `<g data-part="x-axis"><line x1="${r2(x(xRange.min))}" y1="${r2(axisY)}" x2="${r2(x(xRange.max))}" y2="${r2(axisY)}" stroke="${INK}" stroke-width="${sw}" stroke-linecap="square"/>`;
  xRange.ticks.forEach((value, i) => {
    axes += `<line x1="${r2(x(value))}" y1="${r2(axisY)}" x2="${r2(x(value))}" y2="${r2(axisY + tick)}" stroke="${INK}" stroke-width="${sw}"/>`;
    axes += `<text x="${r2(x(value))}" y="${r2(axisY + tick + f * 1.05)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${esc(xTicks[i])}</text>`;
  });
  if (plot.xTitle) {
    axes += `<text x="${r2((left + plotRight) / 2)}" y="${r2(H - f * 0.4)}" font-family="${FONT}" font-size="${f}" font-weight="bold" fill="${INK}" text-anchor="middle">${esc(plot.xTitle)}</text>`;
  }
  axes += `</g>`;

  const legend = legendSvg(
    names.map((name, i) => ({ name, colour: colourAt(plot, perGroup[i].col, GROUP_COLOURS) })),
    { position: legendAt, f, sw, left, right: plotRight, top, bottom: plotBottom, round: false }
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}${axes}${legend}</svg>`;
}

// ---------------------------------------------------------------------------
// Groups by condition: bars side by side, stacked, or stacked to 100%
// ---------------------------------------------------------------------------

/**
 * Two factors at once: one cluster per group, one bar per condition inside it.
 * Stacked bars put the conditions on top of each other instead, and the 100%
 * version scales each cluster to fill the same height, for composition.
 *
 * Brackets carry the two cells they compare, so one can join two bars inside a
 * cluster or the same condition across clusters.
 */
function groupedSvg(element, dataset, brackets) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const { levels, conditions, valuesAt, rowFactor } = groupedFactors(dataset);
  if (levels.length === 0 || conditions.length === 0) {
    return message(W, H, "Name the groups in the first column, and add a condition", f);
  }

  const kind = GROUPED_KINDS.some(([id]) => id === plot.kind) ? plot.kind : "bar";
  const stacked = kind === "stacked" || kind === "stacked100";
  const stats = levels.map((level) => conditions.map((c) => describe(valuesAt(level, c.name))));
  const errOf = (s) => (!s ? 0 : plot.error === "sem" ? s.sem : plot.error === "ci" ? s.ci : s.sd);

  let dataHi = 0;
  let dataLo = 0;
  if (stacked) {
    stats.forEach((row) => {
      const total = row.reduce((sum, s) => sum + Math.max(0, s?.mean ?? 0), 0);
      dataHi = Math.max(dataHi, kind === "stacked100" ? 100 : total);
    });
  } else {
    stats.forEach((row) =>
      row.forEach((s) => {
        if (!s) return;
        dataHi = Math.max(dataHi, s.max, s.mean + errOf(s));
        dataLo = Math.min(dataLo, s.min);
      })
    );
  }
  const range = makeScale({
    lo: Math.min(0, dataLo),
    hi: kind === "stacked100" ? 100 : dataHi,
    fixedMin: limit(plot.yMin),
    fixedMax: limit(plot.yMax),
    log: plot.yScale === "log" && !stacked,
  });
  const tickText = tickLabels(range.ticks, range.log);

  const placed = stackBracketsByX(brackets);
  const levelsDeep = placed.reduce((m, b) => Math.max(m, b.level + 1), 0);
  const axisGap = f * 0.5;
  const left = (plot.yTitle ? f * 1.7 : f * 0.3) + maxLabelWidth(tickText, f) + f * 0.7 + axisGap;
  const legendAt = legendPlacement(plot, conditions.length, "grouped");
  const names = conditions.map((c) => c.name);
  const right = f * 0.5 + (legendAt === "right" ? legendWidth(names, f) : 0);
  const plotWidth = Math.max(10, W - left - right);
  const clusterWidth = plotWidth / levels.length;
  const labelWidth = maxLabelWidth(levels, f);
  const rotate = labelWidth > clusterWidth * 0.92;
  const bottom = axisGap + f * 0.5 + (rotate ? labelWidth * 0.72 + f * 0.6 : f * 1.3) + (plot.xTitle || rowFactor ? f * 1.6 : 0);
  const top = f * 0.6 + levelsDeep * f * 1.5;
  const plotBottom = Math.max(top + 10, H - bottom);
  const y = (v) => plotBottom - range.at(v) * (plotBottom - top);
  const clampY = (v) => Math.max(top - f * 0.2, Math.min(plotBottom, y(v)));
  const barWidth = stacked ? clusterWidth * 0.55 : (clusterWidth * 0.78) / conditions.length;
  const centreOf = (row, col) =>
    stacked
      ? left + clusterWidth * (row + 0.5)
      : left + clusterWidth * (row + 0.5) + (col - (conditions.length - 1) / 2) * barWidth;
  const radius = Math.max(2, f * 0.2);
  const colourOfCondition = (col) => colourAt(plot, col + 1, GROUP_COLOURS);

  const bars = [];
  const errors = [];
  const points = [];
  stats.forEach((row, rowIndex) => {
    if (stacked) {
      const total = row.reduce((sum, s) => sum + Math.max(0, s?.mean ?? 0), 0) || 1;
      let base = 0;
      row.forEach((s, col) => {
        const value = Math.max(0, s?.mean ?? 0) * (kind === "stacked100" ? 100 / total : 1);
        const x = centreOf(rowIndex, col);
        bars.push(
          `<rect x="${r2(x - barWidth / 2)}" y="${r2(clampY(base + value))}" width="${r2(barWidth)}" ` +
            `height="${r2(Math.max(0, clampY(base) - clampY(base + value)))}" fill="${colourOfCondition(col)}" stroke="${INK}" stroke-width="${sw}"/>`
        );
        base += value;
      });
      return;
    }
    row.forEach((s, col) => {
      if (!s) return;
      const x = centreOf(rowIndex, col);
      const e = errOf(s);
      const base = y(Math.max(range.min, Math.min(range.max, 0)));
      const topY = clampY(s.mean);
      bars.push(
        `<rect x="${r2(x - barWidth * 0.42)}" y="${r2(Math.min(base, topY))}" width="${r2(barWidth * 0.84)}" ` +
          `height="${r2(Math.abs(base - topY))}" fill="${colourOfCondition(col)}" stroke="${INK}" stroke-width="${sw}"/>`
      );
      if (e > 0) {
        const tip = clampY(s.mean + e);
        errors.push(`<line x1="${r2(x)}" y1="${r2(topY)}" x2="${r2(x)}" y2="${r2(tip)}" stroke="${INK}" stroke-width="${sw}"/>`);
        errors.push(
          `<line x1="${r2(x - barWidth * 0.16)}" y1="${r2(tip)}" x2="${r2(x + barWidth * 0.16)}" y2="${r2(tip)}" stroke="${INK}" stroke-width="${sw}"/>`
        );
      }
      if (plot.points) {
        const values = valuesAt(levels[rowIndex], conditions[col].name);
        const ys = values.map(clampY);
        const offsets = beeswarm(ys, radius * 0.8, barWidth * 0.3);
        ys.forEach((py, k) => {
          points.push(
            `<circle cx="${r2(x + offsets[k])}" cy="${r2(py)}" r="${r2(radius * 0.8)}" fill="${INK}" stroke="${INK}" stroke-width="${r2(sw * 0.5)}"/>`
          );
        });
      }
    });
  });

  const axisX = left - axisGap;
  let axes = yAxis({
    x: axisX,
    y,
    range,
    f,
    sw,
    title: plot.yTitle || (kind === "stacked100" ? "Percent of total" : ""),
    top,
    bottom: plotBottom,
  });
  const baseY = y(range.min);
  axes += `<g data-part="x-axis"><line x1="${r2(left - axisGap * 0.2)}" y1="${r2(baseY + axisGap)}" x2="${r2(left + plotWidth)}" y2="${r2(baseY + axisGap)}" stroke="${INK}" stroke-width="${sw}"/>`;
  levels.forEach((level, i) => {
    const cx = left + clusterWidth * (i + 0.5);
    const ly = baseY + axisGap + f * 1.3;
    if (rotate) {
      axes += `<text x="${r2(cx + f * 0.3)}" y="${r2(ly - f * 0.4)}" transform="rotate(-45 ${r2(cx + f * 0.3)} ${r2(ly - f * 0.4)})" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(level)}</text>`;
    } else {
      axes += `<text x="${r2(cx)}" y="${r2(ly)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${esc(level)}</text>`;
    }
  });
  const xTitle = plot.xTitle || rowFactor || "";
  if (xTitle) {
    axes += `<text x="${r2(left + plotWidth / 2)}" y="${r2(H - f * 0.4)}" font-family="${FONT}" font-size="${f}" font-weight="bold" fill="${INK}" text-anchor="middle">${esc(xTitle)}</text>`;
  }
  axes += `</g>`;

  let bracketSvg = "";
  if (placed.length) {
    const base = Math.min(y(dataHi), plotBottom) - f * 0.6;
    const tick = f * 0.35;
    bracketSvg = `<g data-part="brackets">`;
    for (const bracket of placed) {
      const by = Math.max(f * 1.2, base - bracket.level * f * 1.5);
      const x1 = Math.min(centreOf(bracket.a.row, bracket.a.col), centreOf(bracket.b.row, bracket.b.col));
      const x2 = Math.max(centreOf(bracket.a.row, bracket.a.col), centreOf(bracket.b.row, bracket.b.col));
      bracketSvg += `<path d="M${r2(x1)} ${r2(by + tick)}V${r2(by)}H${r2(x2)}V${r2(by + tick)}" fill="none" stroke="${INK}" stroke-width="${sw}"/>`;
      bracketSvg += `<text x="${r2((x1 + x2) / 2)}" y="${r2(by - f * (bracket.stars === "ns" ? 0.25 : 0.05))}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${esc(bracket.stars)}</text>`;
    }
    bracketSvg += `</g>`;
  }

  const legend = legendSvg(
    conditions.map((c, col) => ({ name: c.name, colour: colourOfCondition(col) })),
    {
      position: legendAt,
      f,
      sw,
      left,
      right: left + plotWidth,
      top,
      bottom: plotBottom,
      round: false,
    }
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<g data-part="bars">${bars.join("")}</g>` +
    `<g data-part="errors">${errors.join("")}</g>` +
    `<g data-part="points">${points.join("")}</g>` +
    axes +
    bracketSvg +
    legend +
    `</svg>`
  );
}

/**
 * Give brackets on a grouped graph a level each, so none overlap. Spans are
 * measured in cells across the whole graph, shortest first, exactly as for a
 * one-factor graph.
 */
export function stackBracketsByX(brackets) {
  const spans = brackets
    .map((b) => {
      const at = (cell) => cell.row * 1000 + cell.col;
      const from = Math.min(at(b.a), at(b.b));
      const to = Math.max(at(b.a), at(b.b));
      return { ...b, from, to };
    })
    .sort((x, y2) => x.to - x.from - (y2.to - y2.from) || x.from - y2.from);
  const placed = [];
  for (const bracket of spans) {
    let level = 0;
    while (placed.some((p) => p.level === level && !(bracket.to < p.from || bracket.from > p.to))) level += 1;
    placed.push({ ...bracket, level });
  }
  return placed;
}

// ---------------------------------------------------------------------------
// X and Y: scatter, points and lines, with an optional straight-line fit
// ---------------------------------------------------------------------------

function xySvg(element, dataset, fits) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const series = [];
  for (let c = 1; c < dataset.columns.length; c += 1) {
    const rows = completeRows(dataset, [0, c]);
    if (rows.length) series.push({ col: c, name: dataset.columns[c].name || `Y${c}`, rows });
  }
  if (series.length === 0) return message(W, H, "Add X and Y numbers to draw this graph", f);

  const xs = series.flatMap((s) => s.rows.map((r) => r[0]));
  const ys = series.flatMap((s) => s.rows.map((r) => r[1]));
  const xr = makeScale({ lo: Math.min(...xs), hi: Math.max(...xs), log: plot.xScale === "log", count: 6 });
  const yr = makeScale({
    lo: Math.min(...ys),
    hi: Math.max(...ys),
    fixedMin: limit(plot.yMin),
    fixedMax: limit(plot.yMax),
    log: plot.yScale === "log",
  });

  const axisGap = f * 0.5;
  const yTicks = tickLabels(yr.ticks, yr.log);
  const xTicks = tickLabels(xr.ticks, xr.log);
  const left = (plot.yTitle ? f * 1.7 : f * 0.3) + maxLabelWidth(yTicks, f) + f * 0.7 + axisGap;
  const right = Math.max(f * 0.5, textWidth(xTicks[xTicks.length - 1] ?? "", f) / 2);
  // The X column's name is the axis title unless one is typed, so room is
  // kept for whichever it is.
  const xTitle = plot.xTitle || dataset.columns[0]?.name || "";
  const bottom = axisGap + f * 1.9 + (xTitle ? f * 1.6 : 0);
  const top = f * 0.8;
  const plotRight = W - right;
  const plotBottom = Math.max(top + 10, H - bottom);
  const x = (v) => left + xr.at(v) * (plotRight - left);
  const y = (v) => plotBottom - yr.at(v) * (plotBottom - top);
  const radius = Math.max(2, f * 0.2);

  let body = "";
  series.forEach((s, idx) => {
    const colour = colourAt(plot, s.col, SERIES_COLOURS);
    const sorted = [...s.rows].sort((a, b) => a[0] - b[0]);
    if (plot.kind === "line" && sorted.length > 1) {
      body += `<polyline data-part="lines" points="${sorted.map((r) => `${r2(x(r[0]))},${r2(y(r[1]))}`).join(" ")}" fill="none" stroke="${colour}" stroke-width="${r2(sw * 1.4)}" stroke-linejoin="round"/>`;
    }
    const fit = fits?.[idx];

    // A fitted curve (lib/curveFit.js), drawn through the whole axis, with
    // the band showing how well the curve itself is pinned down.
    if (fit?.fit && !fit.fit.error) {
      const steps = 120;
      const logX = xr.log;
      const at = (i) => {
        const t = i / steps;
        return logX
          ? 10 ** (Math.log10(xr.min) + t * (Math.log10(xr.max) - Math.log10(xr.min)))
          : xr.min + t * (xr.max - xr.min);
      };
      const upper = [];
      const lower = [];
      let curve = "";
      for (let i = 0; i <= steps; i += 1) {
        const xi = at(i);
        const { value, se } = fit.fit.predict(xi);
        if (!Number.isFinite(value)) continue;
        const clamp = (v) => Math.max(yr.min, Math.min(yr.max, v));
        curve += `${curve ? "L" : "M"}${r2(x(xi))} ${r2(y(clamp(value)))}`;
        if (plot.band && Number.isFinite(se)) {
          const half = fit.fit.tCritical * se;
          upper.push(`${r2(x(xi))},${r2(y(clamp(value + half)))}`);
          lower.push(`${r2(x(xi))},${r2(y(clamp(value - half)))}`);
        }
      }
      if (plot.band && upper.length) {
        body += `<polygon data-part="band" points="${[...upper, ...lower.reverse()].join(" ")}" fill="${colour}" fill-opacity="0.15" stroke="none"/>`;
      }
      if (curve) body += `<path data-part="fit" d="${curve}" fill="none" stroke="${colour}" stroke-width="${r2(sw * 1.5)}"/>`;
    } else if (plot.fit && fit?.regression) {
      const { slope, intercept } = fit.regression;
      const x0 = xr.min;
      const x1 = xr.max;
      // Clip the line to the plot box, so a steep fit never runs off the page.
      const clipY = (v) => Math.max(yr.min, Math.min(yr.max, v));
      const ya = clipY(intercept + slope * x0);
      const yb = clipY(intercept + slope * x1);
      const xa = slope ? (ya - intercept) / slope : x0;
      const xb = slope ? (yb - intercept) / slope : x1;
      body += `<line data-part="fit" x1="${r2(x(xa))}" y1="${r2(y(ya))}" x2="${r2(x(xb))}" y2="${r2(y(yb))}" stroke="${colour}" stroke-width="${r2(sw * 1.2)}" stroke-dasharray="${r2(f * 0.4)} ${r2(f * 0.25)}"/>`;
    }
    body += `<g data-part="points">`;
    for (const r of s.rows) {
      body += `<circle cx="${r2(x(r[0]))}" cy="${r2(y(r[1]))}" r="${r2(radius)}" fill="${colour}" stroke="${INK}" stroke-width="${r2(sw * 0.5)}"/>`;
    }
    body += `</g>`;
  });

  let axes = yAxis({ x: left - axisGap, y, range: yr, f, sw, title: plot.yTitle, top, bottom: plotBottom });
  const tick = f * 0.4;
  const axisY = plotBottom + axisGap;
  axes += `<g data-part="x-axis"><line x1="${r2(x(xr.min))}" y1="${r2(axisY)}" x2="${r2(x(xr.max))}" y2="${r2(axisY)}" stroke="${INK}" stroke-width="${sw}" stroke-linecap="square"/>`;
  xr.ticks.forEach((t, i) => {
    axes += `<line x1="${r2(x(t))}" y1="${r2(axisY)}" x2="${r2(x(t))}" y2="${r2(axisY + tick)}" stroke="${INK}" stroke-width="${sw}"/>`;
    axes += `<text x="${r2(x(t))}" y="${r2(axisY + tick + f * 1.05)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${esc(xTicks[i])}</text>`;
  });
  if (xTitle) {
    axes += `<text x="${r2((left + plotRight) / 2)}" y="${r2(H - f * 0.4)}" font-family="${FONT}" font-size="${f}" font-weight="bold" fill="${INK}" text-anchor="middle">${esc(xTitle)}</text>`;
  }
  axes += `</g>`;

  const legend = legendSvg(
    series.map((s) => ({ name: s.name, colour: colourAt(plot, s.col, SERIES_COLOURS) })),
    { position: legendPlacement(plot, series.length, "xy"), f, sw, left, right: plotRight, top, bottom: plotBottom, round: true }
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}${axes}${legend}</svg>`;
}

/**
 * The SVG for a graph element. `extras.brackets` are the comparisons to draw
 * (from analysis.js); `extras.fits` the per-series analysis of an X and Y
 * graph. A graph whose dataset is gone says so instead of failing.
 */
export function renderPlotSvg(element, dataset, extras = {}) {
  const W = Math.max(20, Math.round(element.width));
  const H = Math.max(20, Math.round(element.height));
  const sized = { ...element, width: W, height: H };
  const f = element.plot?.fontSize ?? 28;
  if (!dataset) return message(W, H, "The data for this graph is missing", f);
  if (dataset.kind === "xy") return xySvg(sized, dataset, extras.fits);
  if (dataset.kind === "survival") return survivalSvg(sized, dataset, extras.survival);
  if (dataset.kind === "contingency") return groupedSvg(sized, dataset, extras.brackets ?? []);
  if (dataset.kind === "grouped") {
    if (element.plot?.kind === "super") return superSvg(sized, dataset, extras.brackets ?? []);
    return groupedSvg(sized, dataset, extras.brackets ?? []);
  }
  if (ROUND_KINDS.has(element.plot?.kind)) return pieSvg(sized, dataset);
  if (element.plot?.kind === "histogram") return histogramSvg(sized, dataset);
  return groupsSvg(sized, dataset, extras.brackets ?? []);
}
