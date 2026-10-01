/** Small geometry helpers shared by the canvas, snapping and alignment. */

/** Line and arrow elements store `points`; their box is derived from them. */
export function pointsBounds(points) {
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * Bounds in the element's own coordinates, before x/y and rotation.
 *
 * Most elements start at their own origin, so this is just their size; a line
 * or arrow follows its points, which may sit either side of the origin.
 */
export function localBounds(el) {
  if (el?.points?.length) {
    const xs = el.points.filter((_, i) => i % 2 === 0);
    const ys = el.points.filter((_, i) => i % 2 === 1);
    return { x: Math.min(...xs), y: Math.min(...ys),
             width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: 0, y: 0, width: el?.width ?? 0, height: el?.height ?? 0 };
}

/**
 * Element types a mirror makes sense for.
 *
 * Artwork and shapes flip; graphs, tables and text do not, because mirroring
 * an axis, a column of numbers or a word makes it wrong rather than reversed.
 * A caption inside a flipped shape is drawn outside the mirror for the same
 * reason, so a labelled box flips and stays readable.
 */
export const FLIPPABLE = new Set([
  "asset", "image", "rect", "ellipse", "triangle", "line", "arrow", "connector",
]);

export const canFlip = (el) => FLIPPABLE.has(el?.type);

/**
 * The mirror as a transform, for whoever is drawing.
 *
 * Returned as a translate plus a scale, applied in that order inside the
 * element's own frame: p -> translate + scale * p. Mirroring about the centre
 * of the local box leaves the element exactly where it was on the page.
 *
 * Deliberately NOT expressed as Konva's `offset`, which would move the point
 * the element rotates about: rotation stays about the element's origin, which
 * is what visualBox, snapping and alignment all assume.
 */
export function flipTransform(el) {
  const box = localBounds(el);
  const flipX = Boolean(el?.flipX);
  const flipY = Boolean(el?.flipY);
  return {
    scaleX: flipX ? -1 : 1,
    scaleY: flipY ? -1 : 1,
    x: flipX ? 2 * box.x + box.width : 0,
    y: flipY ? 2 * box.y + box.height : 0,
    flipped: flipX || flipY,
  };
}

/** Axis-aligned box of an element in canvas coordinates (ignores rotation). */
export function elementBox(el) {
  if (el.points) {
    const b = pointsBounds(el.points);
    return { x: el.x, y: el.y, width: b.width, height: b.height };
  }
  return { x: el.x, y: el.y, width: el.width ?? 0, height: el.height ?? 0 };
}

/**
 * The box an element actually covers on the page, in canvas coordinates.
 *
 * Unlike elementBox this follows a line's points wherever they lie relative to
 * its origin, and turns with rotation (elements rotate about their top-left
 * corner, as Konva groups do), giving the upright box around the turned shape.
 * Text only learns its height once Konva lays it out, so `measure(el)` may
 * supply heights the model does not store.
 */
export function visualBox(el, measure) {
  let minX = 0;
  let minY = 0;
  let maxX;
  let maxY;
  if (el.points) {
    const xs = el.points.filter((_, i) => i % 2 === 0);
    const ys = el.points.filter((_, i) => i % 2 === 1);
    minX = Math.min(...xs);
    maxX = Math.max(...xs);
    minY = Math.min(...ys);
    maxY = Math.max(...ys);
  } else {
    maxX = el.width ?? 0;
    maxY = el.height ?? measure?.(el) ?? 0;
  }

  const rotation = el.rotation ?? 0;
  if (!rotation) {
    return { x: el.x + minX, y: el.y + minY, width: maxX - minX, height: maxY - minY };
  }
  const r = (rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const corners = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ].map(([lx, ly]) => [el.x + lx * cos - ly * sin, el.y + lx * sin + ly * cos]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The smallest box around several boxes, or null for none. */
export function unionBox(boxes) {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Types whose proportions are usually meant rather than chosen: a photograph
 * or an illustration squashed sideways is nearly always a mistake, while a
 * rectangle squashed sideways is nearly always deliberate. So those two start
 * locked and everything else starts free, and either can be changed per
 * element from the properties panel.
 *
 * Reading the default from the type rather than storing it means figures made
 * before this existed behave the new way too, with no change to the file
 * format.
 */
const LOCKED_BY_DEFAULT = new Set(["image", "asset"]);

/** Whether resizing this element should keep its proportions. */
export const aspectLocked = (el) => el?.lockAspect ?? LOCKED_BY_DEFAULT.has(el?.type);

/**
 * Whether dragging the handles around a selection should keep its
 * proportions. A mixed selection resizes freely, since there is no one answer
 * and freeing it is the reversible choice.
 */
export const selectionKeepsRatio = (elements) =>
  elements.length > 0 && elements.every(aspectLocked);
