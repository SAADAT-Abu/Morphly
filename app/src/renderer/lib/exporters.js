/**
 * Export the figure to PNG, SVG and PDF.
 *
 * SVG export builds the document by hand rather than rasterising, because
 * vector output is the entire reason the scraper goes after SVG sources in the
 * first place. BioArt assets are inlined as nested <svg> elements, which keeps
 * their own `ns0:` namespace declarations and their recoloured markup intact.
 */

import { applyPalette, parseViewBox } from "./svgPalette";

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
      const p = element.points;
      const [x1, y1, x2, y2] = [p[0], p[1], p.at(-2), p.at(-1)];
      const head = element.strokeWidth * 3;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      // Shorten the shaft so it stops at the base of the arrowhead.
      const sx = x2 - Math.cos(angle) * head;
      const sy = y2 - Math.sin(angle) * head;
      const wing = head / 2;
      const p1 = `${x2},${y2}`;
      const p2 = `${sx - Math.sin(angle) * -wing},${sy + Math.cos(angle) * -wing}`;
      const p3 = `${sx + Math.sin(angle) * -wing},${sy - Math.cos(angle) * -wing}`;
      body =
        `<line x1="${x1}" y1="${y1}" x2="${sx}" y2="${sy}" stroke="${element.fill}" ` +
        `stroke-width="${element.strokeWidth}" stroke-linecap="round"/>` +
        `<polygon points="${p1} ${p2} ${p3}" fill="${element.fill}"/>`;
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

    case "asset": {
      const recoloured = applyPalette(element.svgSource, element.colorMap ?? {});
      body = sizedSvg(recoloured, element.width, element.height);
      break;
    }

    default:
      return "";
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
