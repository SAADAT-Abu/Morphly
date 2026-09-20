/**
 * How wide a piece of text is.
 *
 * Laying out formatted text needs real widths, which only the font engine
 * knows, so this asks a canvas. Outside a window (the unit tests) it falls
 * back to the estimate in richText.js, which is close enough for the tests
 * that check layout rules rather than pixels.
 */

import { estimateWidth } from "./richText";

let context = null;

function measuringContext() {
  if (context !== null) return context;
  try {
    context = document.createElement("canvas").getContext("2d");
  } catch {
    context = false; // no window: remember, and estimate from now on
  }
  return context;
}

/** The font string a canvas and CSS both understand. */
export function fontString(size, { bold = false, italic = false, fontFamily = "Helvetica" } = {}) {
  return `${italic ? "italic " : ""}${bold ? "bold " : ""}${size}px ${fontFamily}`;
}

/** Width of `text` at `size`, in the given style. */
export function measureText(text, size, style = {}) {
  const ctx = measuringContext();
  if (!ctx) return estimateWidth(text, size, style);
  ctx.font = fontString(size, style);
  return ctx.measureText(text).width;
}
