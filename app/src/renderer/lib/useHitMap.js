/**
 * The pixel map behind clicking on a part of an illustration.
 *
 * lib/svgParts.js builds a copy of the drawing with every shape painted its
 * own solid colour. This draws that copy once, at a resolution that follows
 * the element's size, and keeps for each pixel the number of the shape on
 * top there. Picking is then a lookup, and so are the highlights: a part's
 * pixels are exactly the pixels of its shapes, so the pink hover and the
 * selection tint follow the true outline of what will change.
 */

import { useEffect, useState } from "react";
import { analyseSvg, buildHitSvg, hitIndex, leavesUnder } from "./svgParts";
import { toDataUrl } from "./svgPalette";

/** Longest side of the map, in pixels: fine enough for small parts, and
 *  about two million pixels at most to read and scan. */
const MAX_SIDE = 1400;

/**
 * Build the map for a drawing (as currently drawn) at an element's size.
 * Returns null until it is ready, or when the drawing cannot be analysed.
 */
export function useHitMap(text, width, height) {
  const [map, setMap] = useState(null);

  useEffect(() => {
    if (!text || !(width > 0) || !(height > 0)) {
      setMap(null);
      return undefined;
    }
    const analysis = analyseSvg(text);
    const hitSvg = analysis && buildHitSvg(text);
    if (!hitSvg) {
      setMap(null);
      return undefined;
    }

    let cancelled = false;
    const scale = Math.min(4, MAX_SIDE / Math.max(width, height));
    const W = Math.max(1, Math.round(width * scale));
    const H = Math.max(1, Math.round(height * scale));
    const image = new Image();

    image.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, W, H);
      const pixels = ctx.getImageData(0, 0, W, H).data;

      const count = analysis.leaves.length;
      const ids = new Int32Array(W * H);
      const boxes = new Map();
      for (let p = 0, i = 0; p < ids.length; p += 1, i += 4) {
        // Only fully covered pixels count; a blended edge names no one shape.
        const id = pixels[i + 3] === 255 ? hitIndex(pixels[i], pixels[i + 1], pixels[i + 2]) : -1;
        const valid = id >= 0 && id < count ? id : -1;
        ids[p] = valid;
        if (valid < 0) continue;
        const x = p % W;
        const y = (p / W) | 0;
        const box = boxes.get(valid);
        if (!box) boxes.set(valid, [x, y, x, y]);
        else {
          if (x < box[0]) box[0] = x;
          if (y < box[1]) box[1] = y;
          if (x > box[2]) box[2] = x;
          if (y > box[3]) box[3] = y;
        }
      }
      setMap({ W, H, sx: W / width, sy: H / height, ids, boxes, analysis });
    };
    image.onerror = () => {
      if (!cancelled) setMap(null);
    };
    image.src = toDataUrl(hitSvg);
    return () => {
      cancelled = true;
    };
  }, [text, width, height]);

  return map;
}

/** The node index of the shape at a point in the element's own units, or -1.
 *  A near miss within two pixels still counts, so thin lines can be caught. */
export function pickLeaf(map, lx, ly) {
  if (!map) return -1;
  const cx = Math.floor(lx * map.sx);
  const cy = Math.floor(ly * map.sy);
  for (let r = 0; r <= 2; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= map.W || y >= map.H) continue;
        const id = map.ids[y * map.W + x];
        if (id >= 0) return map.analysis.leaves[id];
      }
    }
  }
  return -1;
}

function shapeNumbers(analysis, keys) {
  const numbers = new Set();
  for (const key of keys) {
    for (const index of leavesUnder(analysis, key)) numbers.add(analysis.nodes[index].leafIndex);
  }
  return numbers;
}

/** A canvas with the pixels of some parts painted in one colour, or null. */
export function partMask(map, analysis, keys, [r, g, b, a]) {
  if (!map || !analysis || keys.length === 0) return null;
  const wanted = shapeNumbers(analysis, keys);
  if (wanted.size === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = map.W;
  canvas.height = map.H;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(map.W, map.H);
  const out = image.data;
  let any = false;
  for (let p = 0; p < map.ids.length; p += 1) {
    if (map.ids[p] < 0 || !wanted.has(map.ids[p])) continue;
    const i = p * 4;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
    any = true;
  }
  if (!any) return null;
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** The box around the visible pixels of some parts, in the element's units. */
export function partBox(map, analysis, keys) {
  if (!map || !analysis || keys.length === 0) return null;
  let box = null;
  for (const number of shapeNumbers(analysis, keys)) {
    const b = map.boxes.get(number);
    if (!b) continue;
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b.slice();
  }
  if (!box) return null;
  return {
    x: box[0] / map.sx,
    y: box[1] / map.sy,
    width: (box[2] - box[0] + 1) / map.sx,
    height: (box[3] - box[1] + 1) / map.sy,
  };
}
