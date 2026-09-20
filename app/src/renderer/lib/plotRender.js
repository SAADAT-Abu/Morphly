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
import { columnNumbers, completeRows } from "./datasets";
import { describe } from "./stats";

/** Group fills: light enough for black points to read on top. */
export const GROUP_COLOURS = ["#bdbdbd", "#8ab6e0", "#f2a37a", "#9fd39b", "#c3a6e0", "#f28b8b", "#8fd1cf", "#f2d17a"];
/** Series colours for X and Y graphs: strong, so thin lines stay visible. */
export const SERIES_COLOURS = ["#1f1f1f", "#2c6fbb", "#d1495b", "#3a9d5d", "#8e5bb8", "#e08a1e", "#138d90", "#7a5230"];

export const GROUP_KINDS = [
  ["bar", "Bar and points"],
  ["dots", "Dot plot"],
  ["box", "Box and whiskers"],
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
function tickLabels(values) {
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
    test: "auto",
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
export function legendPlacement(plot, entryCount, isXY) {
  const chosen = plot.legend ?? "auto";
  if (chosen === "off") return null;
  if (chosen !== "auto") return chosen;
  return isXY && entryCount > 1 ? "topleft" : null;
}

/**
 * A legend box inside the plot area. `entries` are { name, colour }, drawn
 * with a round marker for X and Y series and a square one for groups. Names
 * come from the data's column names, so renaming a column renames the key.
 */
function legendSvg(entries, { position, f, sw, left, right, top, bottom, round }) {
  if (!position || entries.length === 0) return "";
  const pad = f * 0.45;
  const lineHeight = f * 1.35;
  const marker = f * 0.5;
  const width = marker + f * 0.5 + maxLabelWidth(entries.map((e) => e.name), f) + pad * 2;
  const height = entries.length * lineHeight + pad * 2 - (lineHeight - f);
  const x = position.endsWith("left") ? left + f * 0.4 : Math.max(left, right - width - f * 0.4);
  const y = position.startsWith("top") ? top + f * 0.3 : Math.max(top, bottom - height - f * 0.3);

  let out = `<g data-part="legend">`;
  out += `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(width)}" height="${r2(height)}" fill="#ffffff" fill-opacity="0.85" stroke="#c7ccd6" stroke-width="${r2(sw * 0.7)}" rx="${r2(f * 0.2)}"/>`;
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
    const e = plot.kind === "box" ? 0 : errOf(s);
    dataLo = Math.min(dataLo, s.min, s.mean - (plot.kind === "dots" ? e : 0));
    dataHi = Math.max(dataHi, s.max, s.mean + e);
  });
  // Bars start at zero; the other kinds do too when all the data are positive,
  // as Prism draws them.
  const lo = plot.kind === "bar" || dataLo >= 0 ? Math.min(0, dataLo) : dataLo;
  const range = axisRange(lo, dataHi, limit(plot.yMin), limit(plot.yMax));

  const names = cols.map((c) => dataset.columns[c].name || `Group ${c + 1}`);
  const tickText = tickLabels(range.ticks);
  const levels = brackets.length ? stackBrackets(brackets, cols) : [];
  const levelCount = levels.reduce((m, b) => Math.max(m, b.level + 1), 0);

  const axisGap = f * 0.5;
  const left = (plot.yTitle ? f * 1.7 : f * 0.3) + maxLabelWidth(tickText, f) + f * 0.7 + axisGap;
  const right = f * 0.5;
  const plotWidth = Math.max(10, W - left - right);
  const band = plotWidth / cols.length;
  const labelWidth = maxLabelWidth(names, f);
  const rotate = labelWidth > band * 0.92;
  const bottom = axisGap + f * 0.5 + (rotate ? labelWidth * 0.72 + f * 0.6 : f * 1.3) + (plot.xTitle ? f * 1.6 : 0);
  const top = f * 0.6 + levelCount * f * 1.5;
  const plotTop = top;
  const plotBottom = Math.max(plotTop + 10, H - bottom);
  const y = (v) => plotBottom - ((v - range.min) / (range.max - range.min)) * (plotBottom - plotTop);
  const cx = (i) => left + band * (i + 0.5);
  const barWidth = band * 0.6;
  const radius = Math.max(2, f * 0.2);
  const clampY = (v) => Math.max(plotTop - f * 0.2, Math.min(plotBottom, y(v)));

  const bars = [];
  const errors = [];
  const points = [];
  stats.forEach((s, i) => {
    const x = cx(i);
    const fill = colourAt(plot, cols[i], GROUP_COLOURS);
    const e = errOf(s);
    if (plot.kind === "bar") {
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
    if (plot.points || plot.kind === "dots") {
      const values = columnNumbers(dataset, cols[i]);
      const ys = values.map(clampY);
      const offsets = beeswarm(ys, radius, barWidth * (plot.kind === "dots" ? 0.45 : 0.38));
      const pointFill = plot.kind === "dots" ? fill : INK;
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
      position: legendPlacement(plot, names.length, false),
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
  const xr = axisRange(Math.min(...xs), Math.max(...xs), null, null, 6);
  const yr = axisRange(Math.min(...ys), Math.max(...ys), limit(plot.yMin), limit(plot.yMax));

  const axisGap = f * 0.5;
  const yTicks = tickLabels(yr.ticks);
  const xTicks = tickLabels(xr.ticks);
  const left = (plot.yTitle ? f * 1.7 : f * 0.3) + maxLabelWidth(yTicks, f) + f * 0.7 + axisGap;
  const right = Math.max(f * 0.5, textWidth(xTicks[xTicks.length - 1] ?? "", f) / 2);
  // The X column's name is the axis title unless one is typed, so room is
  // kept for whichever it is.
  const xTitle = plot.xTitle || dataset.columns[0]?.name || "";
  const bottom = axisGap + f * 1.9 + (xTitle ? f * 1.6 : 0);
  const top = f * 0.8;
  const plotRight = W - right;
  const plotBottom = Math.max(top + 10, H - bottom);
  const x = (v) => left + ((v - xr.min) / (xr.max - xr.min)) * (plotRight - left);
  const y = (v) => plotBottom - ((v - yr.min) / (yr.max - yr.min)) * (plotBottom - top);
  const radius = Math.max(2, f * 0.2);

  let body = "";
  series.forEach((s, idx) => {
    const colour = colourAt(plot, s.col, SERIES_COLOURS);
    const sorted = [...s.rows].sort((a, b) => a[0] - b[0]);
    if (plot.kind === "line" && sorted.length > 1) {
      body += `<polyline data-part="lines" points="${sorted.map((r) => `${r2(x(r[0]))},${r2(y(r[1]))}`).join(" ")}" fill="none" stroke="${colour}" stroke-width="${r2(sw * 1.4)}" stroke-linejoin="round"/>`;
    }
    const fit = fits?.[idx];
    if (plot.fit && fit?.regression) {
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
    { position: legendPlacement(plot, series.length, true), f, sw, left, right: plotRight, top, bottom: plotBottom, round: true }
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
  return dataset.kind === "xy" ? xySvg(sized, dataset, extras.fits) : groupsSvg(sized, dataset, extras.brackets ?? []);
}
