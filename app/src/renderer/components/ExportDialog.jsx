/**
 * Export sheet: PNG, JPEG, SVG or PDF.
 *
 * The citation option exists because BioArt asks for attribution on CC-BY
 * entries and appreciates it on public-domain ones. The scraper already builds
 * a correctly formatted citation string per entry, so offering to stamp them
 * onto the figure is nearly free and keeps users on the right side of the
 * licence without having to think about it.
 */

import React, { useState } from "react";
import { useStore } from "../store";
import { buildSvg, buildRaster, RASTER_FORMATS } from "../lib/exporters";

const FORMATS = [
  ["png", "PNG", "Raster, transparency"],
  ["jpeg", "JPEG", "Raster, smaller file"],
  ["svg", "SVG", "Editable vector"],
  ["pdf", "PDF", "Vector, print-ready"],
];

/** JPEG quality choices, from the browser's 0 to 1 scale. */
const JPEG_QUALITIES = [
  [1, "Best"],
  [0.92, "High"],
  [0.8, "Smaller file"],
];

export default function ExportDialog({ stageRef, onClose }) {
  const elements = useStore((s) => s.elements);
  const canvas = useStore((s) => s.canvas);
  const zoom = useStore((s) => s.zoom);
  const stagePos = useStore((s) => s.stagePos);
  const citations = useStore((s) => s.citations);
  // Exports are named after the figure, and land in the default folder.
  const title = useStore((s) => s.title);
  const baseName = title.replace(/[\\/:*?"<>|]/g, " ").trim() || "figure";

  const [format, setFormat] = useState("png");
  const [scale, setScale] = useState(2);
  const [quality, setQuality] = useState(0.92);
  const [transparent, setTransparent] = useState(false);
  const [includeCitations, setIncludeCitations] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const isRaster = format in RASTER_FORMATS;
  // JPEG has no transparency, and PDF always has a page.
  const canBeTransparent = format === "png" || format === "svg";

  const citationList = citations();
  const shareAlike = citationList.filter((c) => c.shareAlike);

  // Group credits by collection so the footer reads as attribution rather
  // than an undifferentiated list of strings.
  const citationText = (() => {
    if (!includeCitations || citationList.length === 0) return null;
    const byCollection = new Map();
    for (const c of citationList) {
      if (!byCollection.has(c.collection)) byCollection.set(c.collection, []);
      byCollection.get(c.collection).push(c.citation);
    }
    const lines = [];
    for (const [collection, items] of byCollection) {
      lines.push(`Illustrations from ${collection}:`);
      lines.push(...items);
    }
    return lines.join("\n");
  })();

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const stage = stageRef.current;
      if (!stage) throw new Error("Canvas is not ready yet.");

      let result;
      if (isRaster) {
        const { extension } = RASTER_FORMATS[format];
        const dataUrl = buildRaster({
          stage,
          canvas,
          zoom,
          stagePos,
          scale,
          transparent: canBeTransparent && transparent,
          format,
          quality,
        });
        result = await window.morphly.exportFile({
          content: dataUrl.split(",")[1],
          encoding: "base64",
          defaultName: `${baseName}.${extension}`,
          filters:
            format === "jpeg"
              ? [{ name: "JPEG image", extensions: ["jpg", "jpeg"] }]
              : [{ name: "PNG image", extensions: ["png"] }],
        });
      } else if (format === "svg") {
        const svg = buildSvg({ elements, canvas, stage, transparent, citationText });
        result = await window.morphly.exportFile({
          content: svg,
          encoding: "utf8",
          defaultName: `${baseName}.svg`,
          filters: [{ name: "SVG image", extensions: ["svg"] }],
        });
      } else {
        const svg = buildSvg({ elements, canvas, stage, transparent: false, citationText });
        // SVG user units map 1:1 to CSS px; PDF points are 72/96 of that.
        const ptPerPx = 72 / 96;
        const extra = citationText ? citationText.split("\n").length * canvas.height * 0.021 : 0;
        result = await window.morphly.exportPdf({
          svg,
          widthPt: Math.round(canvas.width * ptPerPx),
          heightPt: Math.round((canvas.height + extra) * ptPerPx),
          defaultName: `${baseName}.pdf`,
        });
      }

      if (result.canceled) setMessage(null);
      else if (result.ok) setMessage(`Saved to ${result.filePath}`);
      else setMessage(`Export failed: ${result.error}`);
    } catch (err) {
      setMessage(`Export failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export figure</h2>

        <div className="format-row">
          {FORMATS.map(([value, label, hint]) => (
            <button
              key={value}
              className={`format-card${format === value ? " active" : ""}`}
              onClick={() => setFormat(value)}
            >
              <strong>{label}</strong>
              <span>{hint}</span>
            </button>
          ))}
        </div>

        {isRaster && (
          <label className="field row">
            <span>Resolution</span>
            <select id="export-scale" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              <option value={1}>1× ({canvas.width}×{canvas.height} px)</option>
              <option value={2}>2× ({canvas.width * 2}×{canvas.height * 2} px)</option>
              <option value={4}>4× ({canvas.width * 4}×{canvas.height * 4} px)</option>
            </select>
          </label>
        )}

        {format === "jpeg" && (
          <label className="field row">
            <span>Quality</span>
            <select id="export-quality" value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
              {JPEG_QUALITIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label} ({Math.round(value * 100)}%)
                </option>
              ))}
            </select>
          </label>
        )}

        {canBeTransparent && (
          <label className="check">
            <input
              id="export-transparent"
              type="checkbox"
              checked={transparent}
              onChange={(e) => setTransparent(e.target.checked)}
            />
            Transparent background
          </label>
        )}

        {format === "jpeg" && (
          <p className="hint">JPEG has no transparency, so the page colour fills the background.</p>
        )}

        <label className="check">
          <input
            id="export-citations"
            type="checkbox"
            checked={includeCitations}
            onChange={(e) => setIncludeCitations(e.target.checked)}
            disabled={citationList.length === 0}
          />
          Append asset citations
          {citationList.length > 0 ? ` (${citationList.length})` : " (no library assets used)"}
        </label>

        {citationText && isRaster && (
          <p className="hint">
            Citations are drawn into SVG and PDF exports. For PNG and JPEG, copy them from
            the properties panel instead.
          </p>
        )}

        {shareAlike.length > 0 && (
          <p className="warning">
            <strong>{shareAlike.length} share-alike asset
            {shareAlike.length === 1 ? "" : "s"} in this figure.</strong> Their licences
            require derivative works to carry the same licence, which can extend to the
            whole figure. Check this against where you intend to publish.
          </p>
        )}

        {message && <p className="message">{message}</p>}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Close</button>
          <button className="primary" onClick={run} disabled={busy}>
            {busy ? "Exporting…" : `Export ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
