/**
 * Sizes only Konva knows.
 *
 * A text element stores its width but not its height: that depends on how
 * Konva wraps the words. Aligning and snapping need the real height, so the
 * canvas records each text's laid-out height here after drawing, and until it
 * has, the height is estimated from the font size and line count.
 */

const heights = new Map();

export function rememberHeight(id, height) {
  heights.set(id, height);
}

/** For visualBox(el, measure): a height for elements that do not store one. */
export function measuredHeight(el) {
  if (heights.has(el.id)) return heights.get(el.id);
  if (el.type !== "text") return undefined;
  const lines = String(el.text ?? "").split("\n").length;
  return (el.fontSize ?? 16) * (el.lineHeight ?? 1.25) * lines;
}
