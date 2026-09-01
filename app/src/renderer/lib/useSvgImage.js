/**
 * Turns an asset element's SVG source + colour map into an HTMLImageElement
 * that Konva can draw.
 *
 * Recolouring is applied here rather than being baked into the stored element,
 * so the original file text is never lost and any swatch can be reset. The
 * recoloured markup is memoised on the (source, colourMap) pair, so dragging a
 * colour picker re-rasterises only when the colours actually change.
 */

import { useEffect, useMemo, useState } from "react";
import { applyPalette, toDataUrl } from "./svgPalette";

export function useSvgImage(svgSource, colorMap) {
  // Stable key for the colour map -- objects are recreated on every render, so
  // comparing by identity would rebuild the image constantly.
  const colorKey = useMemo(
    () =>
      Object.entries(colorMap ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}>${v}`)
        .join(","),
    [colorMap]
  );

  const dataUrl = useMemo(() => {
    if (!svgSource) return null;
    return toDataUrl(applyPalette(svgSource, colorMap ?? {}));
    // colorKey is the real dependency; colorMap identity is not stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgSource, colorKey]);

  const [image, setImage] = useState(null);

  useEffect(() => {
    if (!dataUrl) {
      setImage(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setImage(null);
    };
    img.src = dataUrl;
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  return image;
}
