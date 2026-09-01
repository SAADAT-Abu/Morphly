/**
 * Hooks that turn SVG markup into an HTMLImageElement Konva can draw.
 *
 * Recolouring is applied here rather than being baked into the stored element,
 * so the original file text is never lost and any change can be undone. The
 * result is memoised on the markup itself, so dragging a colour picker
 * re-rasterises only when the output actually changes.
 */

import { useEffect, useMemo, useState } from "react";
import { applyPalette, toDataUrl } from "./svgPalette";

/** Load an image from SVG markup. */
export function useSvgImageFromText(svgText) {
  const dataUrl = useMemo(() => (svgText ? toDataUrl(svgText) : null), [svgText]);
  const [image, setImage] = useState(null);

  useEffect(() => {
    if (!dataUrl) {
      setImage(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => !cancelled && setImage(img);
    img.onerror = () => !cancelled && setImage(null);
    img.src = dataUrl;
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  return image;
}

/** Load an image from SVG markup with a colour map applied. */
export function useSvgImage(svgSource, colorMap) {
  // Stable key for the colour map: objects are recreated on every render, so
  // comparing by identity would rebuild the image constantly.
  const colorKey = useMemo(
    () =>
      Object.entries(colorMap ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}>${v}`)
        .join(","),
    [colorMap]
  );

  const recoloured = useMemo(
    () => (svgSource ? applyPalette(svgSource, colorMap ?? {}) : null),
    // colorKey is the real dependency; colorMap identity is not stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [svgSource, colorKey]
  );

  return useSvgImageFromText(recoloured);
}

/**
 * Load an imported bitmap (a plot, a micrograph, a photo) from its data URL.
 *
 * Imported images are stored as data URLs rather than file paths, so this never
 * touches the filesystem and the canvas cannot be tainted, which matters
 * because PNG export reads pixels back out of it.
 */
export function useRasterImage(src) {
  const [image, setImage] = useState(null);

  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => !cancelled && setImage(img);
    img.onerror = () => !cancelled && setImage(null);
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return image;
}
