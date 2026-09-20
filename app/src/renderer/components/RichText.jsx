/**
 * Formatted text on the canvas.
 *
 * Konva draws one style per text node, so a text element that carries marks
 * (lib/richText.js) is drawn here instead: the layout says where every piece
 * goes, and this paints them straight onto the canvas at that baseline. The
 * SVG exporter walks the same layout, so the exported figure matches the
 * screen piece for piece.
 *
 * Plain text still goes through Konva's own Text node, which wraps and
 * measures it as it always has.
 */

import React, { useMemo } from "react";
import { Shape } from "react-konva";
import { layoutRichText } from "../lib/richText";
import { measureText, fontString } from "../lib/textMeasure";

/** Lay an element's text out, ready for drawing or exporting. */
export function layoutFor({ runs, width, fontSize, fontFamily, lineHeight, align }) {
  return layoutRichText({
    runs,
    width,
    fontSize,
    fontFamily,
    lineHeight,
    align,
    measure: measureText,
  });
}

/** How far down the box the text starts: the top, the middle, or the bottom. */
export function verticalOffset(verticalAlign, boxHeight, textHeight) {
  if (!boxHeight || verticalAlign === "top") return 0;
  if (verticalAlign === "middle") return Math.max(0, (boxHeight - textHeight) / 2);
  return Math.max(0, boxHeight - textHeight);
}

export default function RichText({
  runs,
  x = 0,
  y = 0,
  width,
  height,
  fontSize = 16,
  fontFamily = "Helvetica",
  lineHeight = 1.25,
  align = "left",
  verticalAlign = "top",
  fill = "#111111",
  opacity = 1,
  listening = false,
  onLayout,
}) {
  const layout = useMemo(
    () => layoutFor({ runs, width, fontSize, fontFamily, lineHeight, align }),
    [runs, width, fontSize, fontFamily, lineHeight, align]
  );
  const top = verticalOffset(verticalAlign, height, layout.height);
  if (onLayout) onLayout(layout);

  return (
    <Shape
      x={x}
      y={y + top}
      width={width ?? layout.width}
      height={layout.height}
      opacity={opacity}
      listening={listening}
      sceneFunc={(context, shape) => {
        for (const line of layout.lines) {
          for (const piece of line.pieces) {
            if (!piece.text.trim()) continue;
            const baseline = line.y + piece.rise;
            context.setAttr("font", fontString(piece.size, { bold: piece.run.bold, italic: piece.run.italic, fontFamily }));
            context.setAttr("textBaseline", "alphabetic");
            context.setAttr("fillStyle", piece.run.color || fill);
            context.fillText(piece.text, piece.x, baseline);
            // Underline and strikethrough are drawn as thin bars, so their
            // thickness follows the type size rather than the zoom.
            const bar = Math.max(1, piece.size * 0.07);
            const width2 = piece.width;
            if (piece.run.underline) context.fillRect(piece.x, baseline + piece.size * 0.16, width2, bar);
            if (piece.run.strike) context.fillRect(piece.x, baseline - piece.size * 0.28, width2, bar);
          }
        }
      }}
      // The whole box takes clicks, so sparse text is still easy to select;
      // without this only the ink itself would be hit.
      hitFunc={(context, shape) => {
        context.beginPath();
        context.rect(0, 0, shape.width(), shape.height());
        context.closePath();
        context.fillStrokeShape(shape);
      }}
    />
  );
}
