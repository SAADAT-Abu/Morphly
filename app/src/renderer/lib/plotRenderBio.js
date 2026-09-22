/**
 * The graphs that biology asks for and Prism does not draw.
 *
 * Heatmaps, volcanoes, PCA, ROC curves, forest plots, Venn diagrams and UpSet
 * plots, drawn the same way as everything else in Morphly: one pure function
 * from settings and numbers to SVG, so the canvas and the exported file are
 * the same picture.
 *
 * Each of these takes the analysis (lib/tableAnalysis.js) rather than working
 * the numbers out again, so what the properties panel writes beside a figure
 * is what the figure shows.
 */

import {
  FONT,
  INK,
  esc,
  r2,
  textWidth,
  maxLabelWidth,
  makeScale,
  tickLabels,
  message,
  yAxis,
  legendSvg,
  legendPlacement,
  legendWidth,
  SERIES_COLOURS,
  GROUP_COLOURS,
  colourAt,
} from "./plotDraw";
import { formatStat } from "./stats";

// ---------------------------------------------------------------------------
// Colour scales
// ---------------------------------------------------------------------------

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const readHex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const x = readHex(a);
  const y = readHex(b);
  return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
};

/** Colours through a list of stops, `t` running from 0 to 1. */
function ramp(stops, t) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.5));
  const span = 1 / (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(clamped / span));
  return mix(stops[i], stops[i + 1], (clamped - i * span) / span);
}

export const PALETTES = {
  // Blue to red through white: the one every heatmap of z scores uses, and
  // the one a reader already knows how to read.
  diverging: ["#2166ac", "#67a9cf", "#f7f7f7", "#ef8a62", "#b2182b"],
  // An approximation of viridis, which stays readable in greyscale and to
  // readers who do not see red and green apart.
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  grey: ["#ffffff", "#bdbdbd", "#737373", "#404040", "#111111"],
};

export const PALETTE_NAMES = [
  ["diverging", "Blue to red"],
  ["viridis", "Viridis"],
  ["grey", "Grey"],
];

const paletteFor = (plot) => PALETTES[plot.palette] ?? PALETTES.diverging;

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

export function heatmapSvg(element, analysis) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const { matrix, values, rowOrder, columnOrder, range } = analysis;
  const stops = paletteFor(plot);

  const rowNames = rowOrder.map((r) => matrix.rowNames[r]);
  const colNames = columnOrder.map((c) => matrix.colNames[c]);
  // Row names are only worth drawing while they can be read.
  const showRows = plot.rowNames !== false && H / rowOrder.length >= f * 0.85;
  const labelRoom = showRows ? Math.min(W * 0.35, maxLabelWidth(rowNames, f) + f * 0.4) : 0;
  const keyRoom = plot.key === false ? f * 0.3 : f * 3.6;
  const bottom = Math.min(H * 0.45, maxLabelWidth(colNames, f) * 0.71 + f * 0.7);
  const top = f * 0.3;
  const left = labelRoom + f * 0.2;
  const gridW = Math.max(10, W - left - keyRoom);
  const gridH = Math.max(10, H - top - bottom);
  const cw = gridW / columnOrder.length;
  const ch = gridH / rowOrder.length;
  const [lo, hi] = range;
  const at = (value) => ramp(stops, hi > lo ? (value - lo) / (hi - lo) : 0.5);

  let cells = `<g data-part="cells">`;
  rowOrder.forEach((r, i) => {
    columnOrder.forEach((c, j) => {
      const value = values[r][c];
      cells += `<rect x="${r2(left + j * cw)}" y="${r2(top + i * ch)}" width="${r2(cw + 0.5)}" height="${r2(ch + 0.5)}" fill="${at(value)}"/>`;
    });
  });
  cells += `</g>`;

  let labels = "";
  if (showRows) {
    labels += `<g data-part="row-labels">`;
    rowNames.forEach((name, i) => {
      labels += `<text x="${r2(left - f * 0.3)}" y="${r2(top + i * ch + ch / 2 + f * 0.35)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(name)}</text>`;
    });
    labels += `</g>`;
  }
  labels += `<g data-part="col-labels">`;
  colNames.forEach((name, j) => {
    const x = left + j * cw + cw / 2;
    const y = top + gridH + f * 0.5;
    // Slanted, which fits more names than upright and reads better than sideways.
    labels += `<text x="${r2(x)}" y="${r2(y)}" transform="rotate(-45 ${r2(x)} ${r2(y)})" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(name)}</text>`;
  });
  labels += `</g>`;

  let key = "";
  if (plot.key !== false) {
    const kx = left + gridW + f * 0.8;
    const kh = Math.min(gridH, f * 8);
    const ky = top + (gridH - kh) / 2;
    const steps = 32;
    key += `<g data-part="key">`;
    for (let i = 0; i < steps; i += 1) {
      key += `<rect x="${r2(kx)}" y="${r2(ky + kh - ((i + 1) * kh) / steps)}" width="${r2(f * 0.7)}" height="${r2(kh / steps + 0.5)}" fill="${ramp(stops, i / (steps - 1))}"/>`;
    }
    key += `<text x="${r2(kx + f * 0.9)}" y="${r2(ky + f * 0.35)}" font-family="${FONT}" font-size="${f * 0.85}" fill="${INK}">${esc(formatStat(hi))}</text>`;
    key += `<text x="${r2(kx + f * 0.9)}" y="${r2(ky + kh + f * 0.35)}" font-family="${FONT}" font-size="${f * 0.85}" fill="${INK}">${esc(formatStat(lo))}</text>`;
    key += `</g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${cells}${labels}${key}</svg>`;
}

// ---------------------------------------------------------------------------
// Correlation matrix
// ---------------------------------------------------------------------------

export function correlationSvg(element, analysis) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const { names, r } = analysis.correlation;
  const stops = paletteFor(plot);

  const labelRoom = Math.min(W * 0.35, maxLabelWidth(names, f) + f * 0.5);
  const top = f * 0.4;
  const bottom = Math.min(H * 0.4, maxLabelWidth(names, f) * 0.71 + f * 0.7);
  const left = labelRoom;
  const size = Math.max(10, Math.min(W - left - f * 0.5, H - top - bottom));
  const cell = size / names.length;
  const at = (value) => ramp(stops, (value + 1) / 2);

  let cells = `<g data-part="cells">`;
  let text = `<g data-part="values">`;
  names.forEach((_, i) => {
    names.forEach((__, j) => {
      const value = r[i][j];
      const x = left + j * cell;
      const y = top + i * cell;
      cells += `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(cell + 0.5)}" height="${r2(cell + 0.5)}" fill="${at(value)}" stroke="#ffffff" stroke-width="1"/>`;
      if (plot.showValues !== false && cell > f * 2) {
        // Dark cells need light type on them.
        const ink = Math.abs(value) > 0.6 ? "#ffffff" : INK;
        text += `<text x="${r2(x + cell / 2)}" y="${r2(y + cell / 2 + f * 0.3)}" font-family="${FONT}" font-size="${f * 0.8}" fill="${ink}" text-anchor="middle">${esc(formatStat(value))}</text>`;
      }
    });
  });
  cells += `</g>`;
  text += `</g>`;

  let labels = `<g data-part="labels">`;
  names.forEach((name, i) => {
    labels += `<text x="${r2(left - f * 0.3)}" y="${r2(top + i * cell + cell / 2 + f * 0.35)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(name)}</text>`;
    const x = left + i * cell + cell / 2;
    const y = top + size + f * 0.5;
    labels += `<text x="${r2(x)}" y="${r2(y)}" transform="rotate(-45 ${r2(x)} ${r2(y)})" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(name)}</text>`;
  });
  labels += `</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${cells}${text}${labels}</svg>`;
}

// ---------------------------------------------------------------------------
// A scatter with axes, which four of these graphs are underneath
// ---------------------------------------------------------------------------

/**
 * The frame every scatter here shares: both axes, their titles and ticks, and
 * the functions that turn a value into a place on the page.
 */
function scatterFrame({ W, H, f, sw, xs, ys, xTitle, yTitle, plot, logX = false, symmetricX = false, legendNames = [] }) {
  let xLo = Math.min(...xs);
  let xHi = Math.max(...xs);
  if (symmetricX) {
    const reach = Math.max(Math.abs(xLo), Math.abs(xHi));
    xLo = -reach;
    xHi = reach;
  }
  const xr = makeScale({ lo: xLo, hi: xHi, log: logX, count: 6 });
  const yr = makeScale({ lo: Math.min(...ys), hi: Math.max(...ys), count: 5 });
  const yTicks = tickLabels(yr.ticks, yr.log);
  const xTicks = tickLabels(xr.ticks, xr.log);
  const axisGap = f * 0.5;
  const left = (yTitle ? f * 1.7 : f * 0.3) + maxLabelWidth(yTicks, f) + f * 0.7 + axisGap;
  const legendRoom = legendNames.length ? legendWidth(legendNames, f) + f * 0.8 : 0;
  const right = Math.max(f * 0.5, textWidth(xTicks[xTicks.length - 1] ?? "", f) / 2) + legendRoom;
  const bottom = axisGap + f * 1.9 + (xTitle ? f * 1.6 : 0);
  const top = f * 0.8;
  const plotRight = W - right;
  const plotBottom = Math.max(top + 10, H - bottom);
  const x = (v) => left + xr.at(v) * (plotRight - left);
  const y = (v) => plotBottom - yr.at(v) * (plotBottom - top);

  let axes = yAxis({ x: left - axisGap, y, range: yr, f, sw, title: yTitle, top, bottom: plotBottom });
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

  return { x, y, xr, yr, left, right: plotRight, top, bottom: plotBottom, axes };
}

// ---------------------------------------------------------------------------
// Volcano and MA
// ---------------------------------------------------------------------------

/** Grey for what did not move, and a colour each way for what did. */
const DIRECTION_COLOURS = { up: "#c0392b", down: "#2c6fbb", none: "#b9bcc4" };

export function volcanoSvg(element, analysis) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const ma = analysis.plot === "ma";

  const usable = analysis.points.filter((d) => (ma ? Number.isFinite(d.mean) : Number.isFinite(d.adjusted) && d.adjusted > 0));
  if (usable.length === 0) {
    return message(W, H, ma ? "Pick a column of mean values in the panel" : "Pick a column of p values in the panel", f);
  }

  // A volcano puts the effect across and the evidence up; an MA plot puts the
  // abundance across and the effect up.
  const points = usable.map((d) => ({
    ...d,
    px: ma ? Math.max(d.mean, 1e-6) : d.effect,
    py: ma ? d.effect : -Math.log10(Math.max(d.adjusted, 1e-300)),
  }));

  const xTitle = plot.xTitle || (ma ? analysis.names.mean : analysis.names.effect || "log2 fold change");
  const yTitle =
    plot.yTitle ||
    (ma ? analysis.names.effect || "log2 fold change" : `-log10 ${analysis.adjust === "none" ? "p" : "adjusted p"}`);
  const frame = scatterFrame({
    W,
    H,
    f,
    sw,
    xs: points.map((d) => d.px),
    ys: [...points.map((d) => d.py), ma ? 0 : -Math.log10(analysis.pCutoff)],
    xTitle,
    yTitle,
    plot,
    logX: ma && plot.xScale !== "linear",
    symmetricX: !ma,
  });
  const { x, y } = frame;

  // The lines that say what counts.
  let guides = `<g data-part="thresholds">`;
  const dash = `stroke-dasharray="${r2(f * 0.4)} ${r2(f * 0.3)}"`;
  if (ma) {
    guides += `<line x1="${r2(frame.left)}" y1="${r2(y(0))}" x2="${r2(frame.right)}" y2="${r2(y(0))}" stroke="#8b8f98" stroke-width="${r2(sw)}" ${dash}/>`;
  } else {
    const cut = -Math.log10(analysis.pCutoff);
    if (cut >= frame.yr.min && cut <= frame.yr.max) {
      guides += `<line x1="${r2(frame.left)}" y1="${r2(y(cut))}" x2="${r2(frame.right)}" y2="${r2(y(cut))}" stroke="#8b8f98" stroke-width="${r2(sw)}" ${dash}/>`;
    }
    [-analysis.fcCutoff, analysis.fcCutoff].forEach((v) => {
      if (v >= frame.xr.min && v <= frame.xr.max) {
        guides += `<line x1="${r2(x(v))}" y1="${r2(frame.top)}" x2="${r2(x(v))}" y2="${r2(frame.bottom)}" stroke="#8b8f98" stroke-width="${r2(sw)}" ${dash}/>`;
      }
    });
  }
  guides += `</g>`;

  const radius = Math.max(1.6, f * 0.16);
  let body = `<g data-part="points">`;
  for (const d of points) {
    body += `<circle cx="${r2(x(d.px))}" cy="${r2(y(d.py))}" r="${r2(radius)}" fill="${DIRECTION_COLOURS[d.direction]}" fill-opacity="${d.direction === "none" ? 0.6 : 0.9}"/>`;
  }
  body += `</g>`;

  // Names for the few points worth naming: the most significant of those that
  // passed both cuts, which is what a reader looks for first.
  const howMany = Number.isFinite(plot.labelTop) ? plot.labelTop : 10;
  if (howMany > 0) {
    const named = points
      .filter((d) => d.significant)
      .sort((a, b) => (ma ? Math.abs(b.effect) - Math.abs(a.effect) : a.adjusted - b.adjusted))
      .slice(0, howMany);
    body += `<g data-part="labels">`;
    for (const d of named) {
      body += `<text x="${r2(x(d.px) + radius + f * 0.2)}" y="${r2(y(d.py) + f * 0.32)}" font-family="${FONT}" font-size="${f * 0.85}" fill="${INK}">${esc(d.name)}</text>`;
    }
    body += `</g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${guides}${body}${frame.axes}</svg>`;
}

// ---------------------------------------------------------------------------
// Forest
// ---------------------------------------------------------------------------

export function forestSvg(element, analysis) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const { points, intervals } = analysis;
  const reference = Number.isFinite(plot.reference) ? plot.reference : 0;

  const names = points.map((d) => d.name);
  // Names are only drawn while there is a line's height for each of them.
  // A forest of two hundred rows is a heatmap in disguise, and writing the
  // names on top of one another helps nobody.
  const showNames = (H - f * 3.4) / Math.max(1, points.length) >= f * 1.05;
  const labelRoom = showNames ? Math.min(W * 0.4, maxLabelWidth(names, f) + f * 0.6) : f * 0.6;
  const lows = intervals ? intervals.map((i, k) => (Number.isFinite(i[0]) ? i[0] : points[k].effect)) : points.map((d) => d.effect);
  const highs = intervals ? intervals.map((i, k) => (Number.isFinite(i[1]) ? i[1] : points[k].effect)) : points.map((d) => d.effect);
  const xr = makeScale({ lo: Math.min(reference, ...lows), hi: Math.max(reference, ...highs), count: 5 });

  const axisGap = f * 0.5;
  const xTitle = plot.xTitle || analysis.names.effect || "Effect";
  const bottom = axisGap + f * 1.9 + (xTitle ? f * 1.5 : 0);
  const top = f * 0.4;
  const left = labelRoom;
  const right = W - f * 0.6;
  const plotBottom = Math.max(top + 10, H - bottom);
  const x = (v) => left + xr.at(v) * (right - left);
  const step = (plotBottom - top) / Math.max(1, points.length);
  const rowY = (i) => top + step * (i + 0.5);

  let body = `<g data-part="rows">`;
  points.forEach((d, i) => {
    const cy = rowY(i);
    if (showNames) {
      body += `<text x="${r2(left - f * 0.4)}" y="${r2(cy + f * 0.35)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(d.name)}</text>`;
    }
    if (intervals) {
      const [lo, hi] = intervals[i];
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        const cap = Math.min(f * 0.3, step * 0.3);
        body += `<line x1="${r2(x(Math.max(lo, xr.min)))}" y1="${r2(cy)}" x2="${r2(x(Math.min(hi, xr.max)))}" y2="${r2(cy)}" stroke="${INK}" stroke-width="${r2(sw * 1.1)}"/>`;
        [lo, hi].forEach((v) => {
          if (v >= xr.min && v <= xr.max) {
            body += `<line x1="${r2(x(v))}" y1="${r2(cy - cap)}" x2="${r2(x(v))}" y2="${r2(cy + cap)}" stroke="${INK}" stroke-width="${r2(sw * 1.1)}"/>`;
          }
        });
      }
    }
    const marker = Math.min(f * 0.45, step * 0.45);
    const colour = colourAt(plot, 0, SERIES_COLOURS);
    body += `<rect x="${r2(x(d.effect) - marker / 2)}" y="${r2(cy - marker / 2)}" width="${r2(marker)}" height="${r2(marker)}" fill="${colour}"/>`;
  });
  body += `</g>`;

  let guides = `<g data-part="reference"><line x1="${r2(x(reference))}" y1="${r2(top)}" x2="${r2(x(reference))}" y2="${r2(plotBottom)}" stroke="#8b8f98" stroke-width="${r2(sw)}" stroke-dasharray="${r2(f * 0.4)} ${r2(f * 0.3)}"/></g>`;

  const xTicks = tickLabels(xr.ticks);
  let axes = `<g data-part="x-axis"><line x1="${r2(x(xr.min))}" y1="${r2(plotBottom + axisGap)}" x2="${r2(x(xr.max))}" y2="${r2(plotBottom + axisGap)}" stroke="${INK}" stroke-width="${sw}" stroke-linecap="square"/>`;
  const tick = f * 0.4;
  xr.ticks.forEach((t, i) => {
    axes += `<line x1="${r2(x(t))}" y1="${r2(plotBottom + axisGap)}" x2="${r2(x(t))}" y2="${r2(plotBottom + axisGap + tick)}" stroke="${INK}" stroke-width="${sw}"/>`;
    axes += `<text x="${r2(x(t))}" y="${r2(plotBottom + axisGap + tick + f * 1.05)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${esc(xTicks[i])}</text>`;
  });
  if (xTitle) {
    axes += `<text x="${r2((left + right) / 2)}" y="${r2(H - f * 0.35)}" font-family="${FONT}" font-size="${f}" font-weight="bold" fill="${INK}" text-anchor="middle">${esc(xTitle)}</text>`;
  }
  axes += `</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${guides}${body}${axes}</svg>`;
}

// ---------------------------------------------------------------------------
// PCA
// ---------------------------------------------------------------------------

export function pcaSvg(element, analysis) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const [a, b] = analysis.components;
  const { scores, explained } = analysis.pca;
  const groups = analysis.groups;

  const xs = scores.map((s) => s[a]);
  const ys = scores.map((s) => s[b]);
  const legendNames = groups ? groups.names : [];
  const frame = scatterFrame({
    W,
    H,
    f,
    sw,
    xs,
    ys,
    xTitle: plot.xTitle || `PC${a + 1} (${(explained[a] * 100).toFixed(1)}%)`,
    yTitle: plot.yTitle || `PC${b + 1} (${(explained[b] * 100).toFixed(1)}%)`,
    plot,
    legendNames: legendNames.length > 1 ? legendNames : [],
  });
  const { x, y } = frame;

  const radius = Math.max(2, f * 0.22);
  let body = `<g data-part="points">`;
  scores.forEach((s, i) => {
    const group = groups ? groups.of[i] : 0;
    const colour = colourAt(plot, group, SERIES_COLOURS);
    body += `<circle cx="${r2(x(s[a]))}" cy="${r2(y(s[b]))}" r="${r2(radius)}" fill="${colour}" stroke="${INK}" stroke-width="${r2(sw * 0.5)}"/>`;
  });
  body += `</g>`;

  if (plot.pointNames) {
    body += `<g data-part="labels">`;
    analysis.matrix.rowNames.forEach((name, i) => {
      body += `<text x="${r2(x(scores[i][a]) + radius + f * 0.2)}" y="${r2(y(scores[i][b]) + f * 0.32)}" font-family="${FONT}" font-size="${f * 0.85}" fill="${INK}">${esc(name)}</text>`;
    });
    body += `</g>`;
  }

  const legend =
    legendNames.length > 1
      ? legendSvg(
          legendNames.map((name, i) => ({ name, colour: colourAt(plot, i, SERIES_COLOURS) })),
          { position: legendPlacement(plot, legendNames.length, "xy") ?? "topleft", f, sw, left: frame.left, right: frame.right, top: frame.top, bottom: frame.bottom, round: true }
        )
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}${frame.axes}${legend}</svg>`;
}

// ---------------------------------------------------------------------------
// ROC
// ---------------------------------------------------------------------------

export function rocSvg(element, analysis) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const { roc } = analysis;

  const frame = scatterFrame({
    W,
    H,
    f,
    sw,
    xs: [0, 1],
    ys: [0, 1],
    xTitle: plot.xTitle || "1 - specificity",
    yTitle: plot.yTitle || "Sensitivity",
    plot,
  });
  const { x, y } = frame;

  let body = `<g data-part="chance"><line x1="${r2(x(0))}" y1="${r2(y(0))}" x2="${r2(x(1))}" y2="${r2(y(1))}" stroke="#a8acb5" stroke-width="${r2(sw)}" stroke-dasharray="${r2(f * 0.4)} ${r2(f * 0.3)}"/></g>`;

  // The curve is a staircase, not a line through the corners: every threshold
  // moves it either up or across, and drawing it straight would flatter it.
  let d = "";
  let previous = null;
  for (const point of roc.curve) {
    if (!previous) {
      d = `M${r2(x(point.fpr))} ${r2(y(point.tpr))}`;
    } else {
      d += `L${r2(x(point.fpr))} ${r2(y(previous.tpr))}L${r2(x(point.fpr))} ${r2(y(point.tpr))}`;
    }
    previous = point;
  }
  const colour = colourAt(plot, 0, SERIES_COLOURS);
  if (plot.fillArea !== false) {
    body += `<path data-part="area" d="${d}L${r2(x(1))} ${r2(y(0))}Z" fill="${colour}" fill-opacity="0.12" stroke="none"/>`;
  }
  body += `<path data-part="curve" d="${d}" fill="none" stroke="${colour}" stroke-width="${r2(sw * 1.6)}" stroke-linejoin="round"/>`;

  if (plot.markBest !== false && Number.isFinite(roc.best.threshold)) {
    const cx = x(1 - roc.best.specificity);
    const cy = y(roc.best.sensitivity);
    body += `<circle data-part="best" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(f * 0.3)}" fill="#ffffff" stroke="${colour}" stroke-width="${r2(sw * 1.4)}"/>`;
  }

  if (plot.showAuc !== false) {
    const text = `AUC ${formatStat(roc.auc)} (${formatStat(roc.low)} to ${formatStat(roc.high)})`;
    body += `<text data-part="auc" x="${r2(frame.right - f * 0.4)}" y="${r2(frame.bottom - f * 0.5)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(text)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}${frame.axes}</svg>`;
}

// ---------------------------------------------------------------------------
// Bland-Altman
// ---------------------------------------------------------------------------

export function blandSvg(element, analysis) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const { points, bias, lower, upper } = analysis.agreement;

  const frame = scatterFrame({
    W,
    H,
    f,
    sw,
    xs: points.map((d) => d.mean),
    ys: [...points.map((d) => d.difference), lower, upper],
    xTitle: plot.xTitle || `Mean of ${analysis.names.a} and ${analysis.names.b}`,
    yTitle: plot.yTitle || `${analysis.names.a} minus ${analysis.names.b}`,
    plot,
  });
  const { x, y } = frame;

  let guides = `<g data-part="limits">`;
  const line = (value, style, label) => {
    guides += `<line x1="${r2(frame.left)}" y1="${r2(y(value))}" x2="${r2(frame.right)}" y2="${r2(y(value))}" stroke="${style}" stroke-width="${r2(sw * 1.2)}" ${value === bias ? "" : `stroke-dasharray="${r2(f * 0.45)} ${r2(f * 0.3)}"`}/>`;
    guides += `<text x="${r2(frame.right)}" y="${r2(y(value) - f * 0.25)}" font-family="${FONT}" font-size="${f * 0.85}" fill="${style}" text-anchor="end">${esc(label)}</text>`;
  };
  line(bias, "#2c6fbb", `Bias ${formatStat(bias)}`);
  line(upper, "#c0392b", `+1.96 SD ${formatStat(upper)}`);
  line(lower, "#c0392b", `-1.96 SD ${formatStat(lower)}`);
  guides += `</g>`;

  const radius = Math.max(2, f * 0.2);
  let body = `<g data-part="points">`;
  for (const d of points) {
    body += `<circle cx="${r2(x(d.mean))}" cy="${r2(y(d.difference))}" r="${r2(radius)}" fill="${colourAt(plot, 0, SERIES_COLOURS)}" fill-opacity="0.85"/>`;
  }
  body += `</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${guides}${body}${frame.axes}</svg>`;
}

// ---------------------------------------------------------------------------
// Venn
// ---------------------------------------------------------------------------

/**
 * Where the circles and the numbers go, in a unit square, for two and for
 * three lists. Three circles of equal size cannot make every region the right
 * area, so these are the conventional positions rather than a true area
 * diagram, and the numbers are written in.
 */
const VENN = {
  2: {
    circles: [
      { cx: 0.38, cy: 0.5, r: 0.3 },
      { cx: 0.62, cy: 0.5, r: 0.3 },
    ],
    regions: { "10": [0.26, 0.5], "01": [0.74, 0.5], "11": [0.5, 0.5] },
    labels: [
      [0.24, 0.12],
      [0.76, 0.12],
    ],
  },
  3: {
    circles: [
      { cx: 0.39, cy: 0.42, r: 0.29 },
      { cx: 0.61, cy: 0.42, r: 0.29 },
      { cx: 0.5, cy: 0.62, r: 0.29 },
    ],
    regions: {
      "100": [0.28, 0.35],
      "010": [0.72, 0.35],
      "001": [0.5, 0.76],
      "110": [0.5, 0.34],
      "101": [0.36, 0.58],
      "011": [0.64, 0.58],
      "111": [0.5, 0.51],
    },
    labels: [
      [0.2, 0.08],
      [0.8, 0.08],
      [0.5, 0.97],
    ],
  },
};

export function vennSvg(element, analysis) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const sets = analysis.sets.slice(0, 3);
  const layout = VENN[sets.length] ?? VENN[3];
  const size = Math.min(W, H);
  const ox = (W - size) / 2;
  const oy = (H - size) / 2;
  const px = (u) => ox + u * size;
  const py = (u) => oy + u * size;

  let body = `<g data-part="circles">`;
  layout.circles.forEach((c, i) => {
    body += `<circle cx="${r2(px(c.cx))}" cy="${r2(py(c.cy))}" r="${r2(c.r * size)}" fill="${colourAt(plot, i, GROUP_COLOURS)}" fill-opacity="0.45" stroke="${INK}" stroke-width="${r2(sw)}"/>`;
  });
  body += `</g>`;

  // Counts in each region. A region with nothing in it is written as 0 rather
  // than left blank, so a reader is never left wondering.
  body += `<g data-part="counts">`;
  Object.entries(layout.regions).forEach(([key, [ux, uy]]) => {
    const count = analysis.regions.find((region) => region.key === key)?.count ?? 0;
    body += `<text x="${r2(px(ux))}" y="${r2(py(uy) + f * 0.35)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="middle">${count}</text>`;
  });
  body += `</g>`;

  body += `<g data-part="labels">`;
  sets.forEach((set, i) => {
    const [ux, uy] = layout.labels[i];
    body += `<text x="${r2(px(ux))}" y="${r2(py(uy))}" font-family="${FONT}" font-size="${f}" font-weight="bold" fill="${INK}" text-anchor="middle">${esc(set.name)}</text>`;
  });
  body += `</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

// ---------------------------------------------------------------------------
// UpSet
// ---------------------------------------------------------------------------

export function upsetSvg(element, analysis) {
  const plot = element.plot;
  const W = element.width;
  const H = element.height;
  const f = plot.fontSize ?? 28;
  const sw = Math.max(1, f * 0.075);
  const { sets } = analysis;
  const { intersections } = analysis.upset;
  if (!intersections.length) return message(W, H, "No overlaps to show", f);

  const names = sets.map((s) => s.name);
  const labelRoom = Math.min(W * 0.3, maxLabelWidth(names, f) + f * 0.5);
  const setBarRoom = f * 3;
  const left = labelRoom + setBarRoom;
  const matrixHeight = Math.min(H * 0.45, sets.length * f * 1.5);
  const bottom = f * 0.6;
  const matrixTop = H - bottom - matrixHeight;
  const barTop = f * 1.4;
  const barBottom = matrixTop - f * 0.6;
  const columnWidth = (W - left - f * 0.5) / intersections.length;
  const biggest = Math.max(...intersections.map((i) => i.count));
  const rowY = (i) => matrixTop + matrixHeight * ((i + 0.5) / sets.length);
  const colX = (i) => left + columnWidth * (i + 0.5);

  // The bars: how many belong to each combination.
  let bars = `<g data-part="bars">`;
  intersections.forEach((entry, i) => {
    const height = biggest > 0 ? ((barBottom - barTop) * entry.count) / biggest : 0;
    const w = Math.max(2, columnWidth * 0.62);
    bars += `<rect x="${r2(colX(i) - w / 2)}" y="${r2(barBottom - height)}" width="${r2(w)}" height="${r2(height)}" fill="${colourAt(plot, 0, SERIES_COLOURS)}"/>`;
    if (plot.showValues !== false && columnWidth > f * 1.2) {
      bars += `<text x="${r2(colX(i))}" y="${r2(barBottom - height - f * 0.3)}" font-family="${FONT}" font-size="${f * 0.85}" fill="${INK}" text-anchor="middle">${entry.count}</text>`;
    }
  });
  bars += `</g>`;

  // The matrix: a filled dot for every list in the combination, joined by a
  // line, which is the whole idea of an UpSet plot.
  let matrix = `<g data-part="matrix">`;
  sets.forEach((_, row) => {
    matrix += `<rect x="${r2(left)}" y="${r2(matrixTop + (matrixHeight * row) / sets.length)}" width="${r2(W - left - f * 0.5)}" height="${r2(matrixHeight / sets.length)}" fill="${row % 2 ? "#f2f3f5" : "#ffffff"}"/>`;
  });
  const dot = Math.min(f * 0.42, (matrixHeight / sets.length) * 0.32, columnWidth * 0.32);
  intersections.forEach((entry, i) => {
    const rows = entry.sets;
    if (rows.length > 1) {
      matrix += `<line x1="${r2(colX(i))}" y1="${r2(rowY(Math.min(...rows)))}" x2="${r2(colX(i))}" y2="${r2(rowY(Math.max(...rows)))}" stroke="${INK}" stroke-width="${r2(sw * 1.4)}"/>`;
    }
    sets.forEach((__, row) => {
      const inside = rows.includes(row);
      matrix += `<circle cx="${r2(colX(i))}" cy="${r2(rowY(row))}" r="${r2(dot)}" fill="${inside ? INK : "#d4d7dd"}"/>`;
    });
  });
  matrix += `</g>`;

  // How big each list is in the first place, as bars running leftwards.
  const largestSet = Math.max(...sets.map((s) => s.size));
  let sizes = `<g data-part="set-sizes">`;
  sets.forEach((set, row) => {
    const width = largestSet > 0 ? (setBarRoom - f * 0.4) * (set.size / largestSet) : 0;
    const height = Math.min(f * 0.9, (matrixHeight / sets.length) * 0.6);
    sizes += `<rect x="${r2(left - f * 0.3 - width)}" y="${r2(rowY(row) - height / 2)}" width="${r2(width)}" height="${r2(height)}" fill="#9aa0aa"/>`;
    sizes += `<text x="${r2(labelRoom - f * 0.3)}" y="${r2(rowY(row) + f * 0.33)}" font-family="${FONT}" font-size="${f}" fill="${INK}" text-anchor="end">${esc(set.name)}</text>`;
  });
  sizes += `</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bars}${matrix}${sizes}</svg>`;
}

// ---------------------------------------------------------------------------

/** The graph kinds this file draws, by the analysis they need. */
export const TABLE_KINDS = [
  ["heatmap", "Heatmap"],
  ["correlation", "Correlation matrix"],
  ["pca", "PCA"],
  ["roc", "ROC curve"],
  ["bland", "Bland-Altman"],
];
export const RESULT_KINDS = [
  ["volcano", "Volcano"],
  ["ma", "MA plot"],
  ["forest", "Forest"],
];
export const SET_KINDS = [
  ["venn", "Venn diagram"],
  ["upset", "UpSet"],
];

/**
 * Draw whichever of these a graph asks for. Returns null when the graph is
 * not one of them, so the ordinary renderer can go on and draw it.
 */
export function renderBioSvg(element, dataset, analysis) {
  const W = element.width;
  const H = element.height;
  const f = element.plot?.fontSize ?? 28;
  if (!analysis) return null;
  if (analysis.error) return message(W, H, analysis.error, f);
  if (analysis.kind === "results") return analysis.plot === "forest" ? forestSvg(element, analysis) : volcanoSvg(element, analysis);
  if (analysis.kind === "sets") return analysis.plot === "upset" ? upsetSvg(element, analysis) : vennSvg(element, analysis);
  if (analysis.kind !== "table") return null;
  if (analysis.plot === "correlation") return correlationSvg(element, analysis);
  if (analysis.plot === "pca") return pcaSvg(element, analysis);
  if (analysis.plot === "roc") return rocSvg(element, analysis);
  if (analysis.plot === "bland") return blandSvg(element, analysis);
  return heatmapSvg(element, analysis);
}
