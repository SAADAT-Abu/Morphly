/** Small geometry helpers shared by the canvas and the alignment tools. */

/** Line and arrow elements store `points`; their box is derived from them. */
export function pointsBounds(points) {
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
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
 * Snapping candidates for a dragged element: the canvas edges and centre, plus
 * every other visible element's edges and centre. Returns the adjusted
 * position and the guide lines to draw.
 */
export function computeSnap(dragged, others, canvas, threshold) {
  const box = elementBox(dragged);
  const vLines = [0, canvas.width / 2, canvas.width];
  const hLines = [0, canvas.height / 2, canvas.height];

  for (const el of others) {
    const b = elementBox(el);
    vLines.push(b.x, b.x + b.width / 2, b.x + b.width);
    hLines.push(b.y, b.y + b.height / 2, b.y + b.height);
  }

  // Each edge of the dragged box that could latch onto a guide.
  const vEdges = [
    { offset: 0, value: box.x },
    { offset: box.width / 2, value: box.x + box.width / 2 },
    { offset: box.width, value: box.x + box.width },
  ];
  const hEdges = [
    { offset: 0, value: box.y },
    { offset: box.height / 2, value: box.y + box.height / 2 },
    { offset: box.height, value: box.y + box.height },
  ];

  let bestV = null;
  for (const edge of vEdges) {
    for (const line of vLines) {
      const dist = Math.abs(edge.value - line);
      if (dist < threshold && (!bestV || dist < bestV.dist)) {
        bestV = { dist, x: line - edge.offset, guide: line };
      }
    }
  }

  let bestH = null;
  for (const edge of hEdges) {
    for (const line of hLines) {
      const dist = Math.abs(edge.value - line);
      if (dist < threshold && (!bestH || dist < bestH.dist)) {
        bestH = { dist, y: line - edge.offset, guide: line };
      }
    }
  }

  return {
    x: bestV ? bestV.x : box.x,
    y: bestH ? bestH.y : box.y,
    guides: {
      vertical: bestV ? bestV.guide : null,
      horizontal: bestH ? bestH.guide : null,
    },
  };
}
