/**
 * Export the figure to PNG, SVG and PDF.
 *
 * SVG export builds the document by hand rather than rasterising, because
 * vector output is the entire reason the scraper goes after SVG sources in the
 * first place. BioArt assets are inlined as nested <svg> elements, which keeps
 * their own `ns0:` namespace declarations and their recoloured markup intact.
 */

import { applyPalette, effectiveColorMap } from "./svgPalette";
import { offsets, cellCorners, isHeaderCell } from "./tableLayout";

const escapeXml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Give a nested <svg> an explicit size while preserving its viewBox. */
function sizedSvg(svgText, width, height) {
  const withoutProlog = svgText
    .replace(/<\?xml[\s\S]*?\?>/i, "")
    .replace(/<!DOCTYPE[\s\S]*?>/i, "")
    .trim();

  return withoutProlog.replace(/<(\w+:)?svg\b([^>]*)>/i, (match, prefix, attrs) => {
    const cleaned = attrs.replace(/\s(width|height|x|y)\s*=\s*["'][^"']*["']/gi, "");
    return `<${prefix ?? ""}svg${cleaned} x="0" y="0" width="${width}" height="${height}">`;
  });
}

/**
 * Triangle for one arrowhead: tip at (tipX,tipY) pointing along `angle`, with
 * base `size` behind it. Width matches Konva's default pointerWidth so canvas
 * and export agree.
 */
function arrowHeadPoints(tipX, tipY, angle, size) {
  const baseX = tipX - Math.cos(angle) * size;
  const baseY = tipY - Math.sin(angle) * size;
  const halfW = size / 2;
  const offX = Math.sin(angle) * halfW;
  const offY = Math.cos(angle) * halfW;
  return (
    `${tipX},${tipY} ${baseX - offX},${baseY + offY} ${baseX + offX},${baseY - offY}`
  );
}

/**
 * Path for a rectangle with per-corner radii, clockwise from the top-left.
 *
 * SVG's <rect rx> rounds all four corners equally, but a table needs its outer
 * corners rounded and its inner ones square, so cells are drawn as paths.
 */
function roundedRectPath(x, y, w, h, [tl, tr, br, bl]) {
  if (!tl && !tr && !br && !bl) {
    return `M${x},${y} h${w} v${h} h${-w} Z`;
  }
  // Never let a radius exceed half the shorter side, which would invert the arc.
  const cap = Math.min(w, h) / 2;
  const [a, b, c, d] = [tl, tr, br, bl].map((r) => Math.min(r, cap));
  return (
    `M${x + a},${y} h${w - a - b}` +
    (b ? ` a${b},${b} 0 0 1 ${b},${b}` : "") +
    ` v${h - b - c}` +
    (c ? ` a${c},${c} 0 0 1 ${-c},${c}` : "") +
    ` h${-(w - c - d)}` +
    (d ? ` a${d},${d} 0 0 1 ${-d},${-d}` : "") +
    ` v${-(h - d - a)}` +
    (a ? ` a${a},${a} 0 0 1 ${a},${-a}` : "") +
    " Z"
  );
}

/**
 * One table as SVG.
 *
 * Mirrors TableShape on the canvas exactly, cell by cell in the same order, so
 * the export is a faithful copy rather than a second interpretation of the
 * model. Cell text is emitted as real <text>, so it stays selectable and
 * searchable in the exported figure.
 */
function tableToSvg(element) {
  const xs = offsets(element.colWidths);
  const ys = offsets(element.rowHeights);
  const pad = element.padding ?? 6;
  const parts = [];

  for (let row = 0; row < element.rows; row += 1) {
    for (let col = 0; col < element.cols; col += 1) {
      const header = isHeaderCell(element, row, col);
      const striped =
        !header && element.stripeFill && (element.headerRow ? row % 2 === 0 : row % 2 === 1);
      const fill = header ? element.headerFill : striped ? element.stripeFill : element.fill;
      const w = element.colWidths[col];
      const h = element.rowHeights[row];

      parts.push(
        `<path d="${roundedRectPath(xs[col], ys[row], w, h, cellCorners(element, row, col))}" ` +
          `fill="${fill}"/>`
      );

      const text = element.cells[row]?.[col];
      if (!text) continue;

      const align = element.align ?? "left";
      const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
      const tx =
        align === "center"
          ? xs[col] + w / 2
          : align === "right"
          ? xs[col] + w - pad
          : xs[col] + pad;

      // Centre the block of lines vertically inside the cell, then place each
      // line on its own baseline, the same way the canvas does it.
      const lines = String(text).split("\n");
      const lineHeight = element.fontSize * 1.2;
      const first = ys[row] + h / 2 - (lines.length * lineHeight) / 2 + element.fontSize * 0.95;
      const tspans = lines
        .map((line, i) => `<tspan x="${tx}" y="${first + i * lineHeight}">${escapeXml(line)}</tspan>`)
        .join("");

      parts.push(
        `<text font-family="${escapeXml(element.fontFamily)}" font-size="${element.fontSize}" ` +
          `font-weight="${header ? "bold" : "normal"}" ` +
          `fill="${header ? element.headerTextColor : element.textColor}" ` +
          `text-anchor="${anchor}" xml:space="preserve">${tspans}</text>`
      );
    }
  }

  if (element.showInnerLines !== false && element.strokeWidth > 0) {
    for (let col = 1; col < element.cols; col += 1) {
      parts.push(
        `<line x1="${xs[col]}" y1="0" x2="${xs[col]}" y2="${element.height}" ` +
          `stroke="${element.stroke}" stroke-width="${element.strokeWidth}"/>`
      );
    }
    for (let row = 1; row < element.rows; row += 1) {
      parts.push(
        `<line x1="0" y1="${ys[row]}" x2="${element.width}" y2="${ys[row]}" ` +
          `stroke="${element.stroke}" stroke-width="${element.strokeWidth}"/>`
      );
    }
  }

  if (element.strokeWidth > 0) {
    const r = element.cornerRadius ?? 0;
    parts.push(
      `<path d="${roundedRectPath(0, 0, element.width, element.height, [r, r, r, r])}" ` +
        `fill="none" stroke="${element.stroke}" stroke-width="${element.strokeWidth}"/>`
    );
  }

  return parts.join("");
}

/** Konva wraps text internally; reuse its computed lines so the exported SVG
 *  breaks in exactly the same places the canvas does. */
function textLines(element, stage) {
  const group = stage?.findOne(`#${element.id}`);
  const node = group?.findOne("Text");
  const arr = node?.textArr;
  if (Array.isArray(arr) && arr.length > 0) return arr.map((l) => l.text);
  return String(element.text ?? "").split("\n");
}

function elementToSvg(element, stage) {
  const transform = `translate(${element.x} ${element.y})${
    element.rotation ? ` rotate(${element.rotation})` : ""
  }`;
  const open = `<g transform="${transform}"${element.opacity !== 1 ? ` opacity="${element.opacity}"` : ""}>`;

  let body = "";
  switch (element.type) {
    case "rect":
      body =
        `<rect x="0" y="0" width="${element.width}" height="${element.height}" ` +
        `rx="${element.cornerRadius ?? 0}" fill="${element.fill}" ` +
        `stroke="${element.stroke}" stroke-width="${element.strokeWidth}"/>`;
      break;

    case "ellipse":
      body =
        `<ellipse cx="${element.width / 2}" cy="${element.height / 2}" ` +
        `rx="${element.width / 2}" ry="${element.height / 2}" fill="${element.fill}" ` +
        `stroke="${element.stroke}" stroke-width="${element.strokeWidth}"/>`;
      break;

    case "triangle":
      body =
        `<polygon points="${element.width / 2},0 ${element.width},${element.height} 0,${element.height}" ` +
        `fill="${element.fill}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}"/>`;
      break;

    case "line": {
      const pts = element.points.reduce(
        (acc, v, i) => (i % 2 === 0 ? [...acc, `${v}`] : [...acc.slice(0, -1), `${acc.at(-1)},${v}`]),
        []
      );
      body =
        `<polyline points="${pts.join(" ")}" fill="none" stroke="${element.fill}" ` +
        `stroke-width="${element.strokeWidth}" stroke-linecap="round"/>`;
      break;
    }

    case "arrow": {
      const pts = element.points;
      const [x1, y1, x2, y2] = [pts[0], pts[1], pts.at(-2), pts.at(-1)];
      const size = element.strokeWidth * 3;
      const angle = Math.atan2(y2 - y1, x2 - x1);

      // "none" | "end" (default) | "both" -- must mirror how Konva draws it
      // on canvas, or the export won't match what the user arranged.
      const heads = element.heads ?? "end";
      const headAtEnd = heads !== "none";
      const headAtStart = heads === "both";

      // Stop the shaft at the base of each head so the stroke doesn't show
      // through the tip.
      const ex = headAtEnd ? x2 - Math.cos(angle) * size : x2;
      const ey = headAtEnd ? y2 - Math.sin(angle) * size : y2;
      const sx = headAtStart ? x1 + Math.cos(angle) * size : x1;
      const sy = headAtStart ? y1 + Math.sin(angle) * size : y1;

      body =
        `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${element.fill}" ` +
        `stroke-width="${element.strokeWidth}" stroke-linecap="round"/>`;

      if (headAtEnd) {
        body += `<polygon points="${arrowHeadPoints(x2, y2, angle, size)}" fill="${element.fill}"/>`;
      }
      if (headAtStart) {
        // Same head, pointing the other way.
        body += `<polygon points="${arrowHeadPoints(x1, y1, angle + Math.PI, size)}" fill="${element.fill}"/>`;
      }
      break;
    }

    case "text": {
      const lines = textLines(element, stage);
      const lineHeight = element.fontSize * (element.lineHeight ?? 1.25);
      const anchor =
        element.align === "center" ? "middle" : element.align === "right" ? "end" : "start";
      const xPos =
        element.align === "center" ? element.width / 2 : element.align === "right" ? element.width : 0;

      const tspans = lines
        .map(
          (line, i) =>
            `<tspan x="${xPos}" y="${(i + 0.8) * lineHeight}">${escapeXml(line)}</tspan>`
        )
        .join("");

      const style = element.fontStyle ?? "normal";
      const weight = style.includes("bold") ? "bold" : "normal";
      const italic = style.includes("italic") ? "italic" : "normal";

      body =
        `<text font-family="${escapeXml(element.fontFamily)}" font-size="${element.fontSize}" ` +
        `font-weight="${weight}" font-style="${italic}" fill="${element.fill}" ` +
        `text-anchor="${anchor}" xml:space="preserve">${tspans}</text>`;
      break;
    }

    case "table":
      body = tableToSvg(element);
      break;

    case "image": {
      // The data URL travels with the file, so the exported SVG stands alone
      // rather than pointing at an image that may move or be renamed.
      //
      // Rounded corners go through a real <clipPath> rather than the CSS
      // `clip-path: inset(... round ...)` shorthand, which Chromium honours but
      // librsvg and Inkscape do not, so the radius would silently vanish
      // wherever the figure is opened next.
      let clip = "";
      if (element.cornerRadius) {
        const clipId = `clip-${element.id}`;
        clip = ` clip-path="url(#${clipId})"`;
        body +=
          `<defs><clipPath id="${clipId}">` +
          `<rect x="0" y="0" width="${element.width}" height="${element.height}" ` +
          `rx="${element.cornerRadius}" ry="${element.cornerRadius}"/>` +
          `</clipPath></defs>`;
      }
      body +=
        `<image x="0" y="0" width="${element.width}" height="${element.height}"` +
        `${clip} preserveAspectRatio="none" xlink:href="${element.src}" href="${element.src}"/>`;
      break;
    }

    case "asset": {
      // effectiveColorMap folds in hidden colour parts, so anything the user
      // removed on canvas is absent from the export too.
      const recoloured = applyPalette(element.svgSource, effectiveColorMap(element));
      body = sizedSvg(recoloured, element.width, element.height);
      break;
    }

    default:
      return "";
  }

  // Shapes can carry a centred caption; emit it after the shape so it sits on
  // top, matching the canvas.
  if (element.label && ["rect", "ellipse", "triangle"].includes(element.type)) {
    const size = element.labelSize ?? 16;
    const lines = String(element.label).split("\n");
    const blockHeight = lines.length * size * 1.2;
    // Centre the block vertically, then offset each line from its own baseline.
    const firstBaseline = element.height / 2 - blockHeight / 2 + size * 0.95;
    const tspans = lines
      .map(
        (line, i) =>
          `<tspan x="${element.width / 2}" y="${firstBaseline + i * size * 1.2}">` +
          `${escapeXml(line)}</tspan>`
      )
      .join("");
    body +=
      `<text font-family="${escapeXml(element.labelFont ?? "Helvetica")}" ` +
      `font-size="${size}" fill="${element.labelColor ?? "#ffffff"}" ` +
      `text-anchor="middle" xml:space="preserve">${tspans}</text>`;
  }

  return `${open}${body}</g>`;
}

/** Full SVG document for the current figure. */
export function buildSvg({ elements, canvas, stage, transparent = false, citationText = null }) {
  const visible = elements.filter((el) => el.visible);
  const body = visible.map((el) => elementToSvg(el, stage)).join("\n  ");

  const background = transparent
    ? ""
    : `<rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="${canvas.background}"/>`;

  // Citations are appended as real text at the foot of the figure so the
  // credit travels with the exported file.
  let citations = "";
  let extraHeight = 0;
  if (citationText) {
    const lines = citationText.split("\n");
    const size = Math.max(10, canvas.height * 0.014);
    extraHeight = lines.length * size * 1.5 + size;
    citations =
      `<g transform="translate(${size} ${canvas.height + size * 1.6})">` +
      lines
        .map(
          (line, i) =>
            `<text x="0" y="${i * size * 1.5}" font-family="Helvetica" font-size="${size}" ` +
            `fill="#555555">${escapeXml(line)}</text>`
        )
        .join("") +
      `</g>`;
  }

  const totalHeight = canvas.height + extraHeight;
  const footer = citationText
    ? `<rect x="0" y="${canvas.height}" width="${canvas.width}" height="${extraHeight}" fill="${
        transparent ? "#ffffff" : canvas.background
      }"/>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${canvas.width}" height="${totalHeight}" ` +
    `viewBox="0 0 ${canvas.width} ${totalHeight}">\n  ` +
    `${background}${footer}\n  ${body}\n  ${citations}\n</svg>`
  );
}

/**
 * PNG of just the page area.
 *
 * Konva's toDataURL takes a rect in screen coordinates and re-renders the
 * scene into it, so we hand it the page's on-screen box and let pixelRatio do
 * the scaling. That yields exactly canvas.width * scale pixels regardless of
 * the current zoom level or how the page is scrolled.
 */
export function buildPng({ stage, canvas, zoom, stagePos, scale = 2, transparent = false }) {
  const bg = stage.findOne(".canvas-bg");
  const transformers = stage.find("Transformer");

  const bgWasVisible = bg?.visible();
  if (transparent && bg) bg.visible(false);
  transformers.forEach((t) => t.visible(false));
  stage.batchDraw();

  try {
    return stage.toDataURL({
      x: stagePos.x,
      y: stagePos.y,
      width: canvas.width * zoom,
      height: canvas.height * zoom,
      pixelRatio: scale / zoom,
      mimeType: "image/png",
    });
  } finally {
    if (bg && bgWasVisible !== undefined) bg.visible(bgWasVisible);
    transformers.forEach((t) => t.visible(true));
    stage.batchDraw();
  }
}
