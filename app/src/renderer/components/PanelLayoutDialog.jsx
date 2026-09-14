/**
 * "Insert > Panel layout" dialog.
 *
 * Presets cover the shapes most journal figures take, including a wide or
 * tall panel for the main result, and a custom grid covers the rest. The
 * preview is drawn from the same layout function the store uses, at the
 * page's own proportions, so what is shown is what gets inserted.
 */

import React, { useMemo, useState } from "react";
import { PANEL_PRESETS, presetCells, gridCells, layoutPanels, panelLetter, readingOrder } from "../lib/panelLayout";

const LETTER_STYLES = [
  ["upper", "A, B, C"],
  ["lower", "a, b, c"],
  ["none", "No letters"],
];

/** Small drawing of a layout, for a preset button or the preview. */
function LayoutSketch({ layout, width, height, gap, margin, letters = null, className }) {
  const boxes = layoutPanels(layout, {
    x: margin,
    y: margin,
    width: width - 2 * margin,
    height: height - 2 * margin,
    gap,
  });
  const order = readingOrder(boxes);
  const letterOf = new Map(order.map((boxIndex, position) => [boxIndex, position]));
  const size = Math.min(width, height) * 0.08;

  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <rect x="0" y="0" width={width} height={height} className="sketch-page" />
      {boxes.map((box, i) => (
        <g key={i}>
          <rect x={box.x} y={box.y} width={Math.max(0, box.width)} height={Math.max(0, box.height)} className="sketch-panel" />
          {letters && letters !== "none" && (
            <text x={box.x + size * 0.4} y={box.y + size * 1.1} fontSize={size} className="sketch-letter">
              {panelLetter(letterOf.get(i), letters)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export default function PanelLayoutDialog({ canvas, hasPanels, onClose, onInsert }) {
  const base = Math.min(canvas.width, canvas.height);
  const [choice, setChoice] = useState("2x2");
  const [custom, setCustom] = useState({ rows: 2, cols: 3 });
  const [gap, setGap] = useState(Math.round(base * 0.025));
  const [margin, setMargin] = useState(Math.round(base * 0.03));
  const [letterStyle, setLetterStyle] = useState("upper");
  const [replace, setReplace] = useState(true);

  const layout = useMemo(() => {
    if (choice === "custom") {
      return { rows: custom.rows, cols: custom.cols, cells: gridCells(custom.rows, custom.cols) };
    }
    const preset = PANEL_PRESETS.find((p) => p.id === choice);
    return { rows: preset.rows, cols: preset.cols, cells: presetCells(preset) };
  }, [choice, custom]);

  // Panels must keep some size whatever spacing is typed in.
  const limit = Math.floor(base / 4);
  const clamp = (v) => Math.max(0, Math.min(limit, Math.round(Number(v) || 0)));
  const panelWidth = (canvas.width - 2 * margin - gap * (layout.cols - 1)) / layout.cols;
  const panelHeight = (canvas.height - 2 * margin - gap * (layout.rows - 1)) / layout.rows;
  const fits = panelWidth >= 20 && panelHeight >= 20;

  const count = layout.cells.length;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal panel-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Panel layout</h2>

        <div className="panel-presets" role="radiogroup" aria-label="Layout">
          {PANEL_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={choice === preset.id}
              className={`panel-preset${choice === preset.id ? " active" : ""}`}
              title={preset.name}
              onClick={() => setChoice(preset.id)}
            >
              <LayoutSketch
                layout={{ rows: preset.rows, cols: preset.cols, cells: presetCells(preset) }}
                width={60}
                height={42}
                gap={3}
                margin={3}
              />
              <span>{preset.name}</span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={choice === "custom"}
            className={`panel-preset${choice === "custom" ? " active" : ""}`}
            onClick={() => setChoice("custom")}
          >
            <LayoutSketch
              layout={{ rows: custom.rows, cols: custom.cols }}
              width={60}
              height={42}
              gap={3}
              margin={3}
            />
            <span>Custom grid</span>
          </button>
        </div>

        {choice === "custom" && (
          <div className="field-grid">
            <label className="field">
              <span>Rows</span>
              <input
                type="number"
                min="1"
                max="6"
                value={custom.rows}
                onChange={(e) => setCustom((c) => ({ ...c, rows: Math.max(1, Math.min(6, Number(e.target.value) || 1)) }))}
              />
            </label>
            <label className="field">
              <span>Columns</span>
              <input
                type="number"
                min="1"
                max="6"
                value={custom.cols}
                onChange={(e) => setCustom((c) => ({ ...c, cols: Math.max(1, Math.min(6, Number(e.target.value) || 1)) }))}
              />
            </label>
          </div>
        )}

        <LayoutSketch
          className="panel-preview"
          layout={layout}
          width={canvas.width}
          height={canvas.height}
          gap={gap}
          margin={margin}
          letters={letterStyle}
        />

        <div className="field-grid">
          <label className="field">
            <span>Spacing</span>
            <input type="number" min="0" max={limit} value={gap} onChange={(e) => setGap(clamp(e.target.value))} />
          </label>
          <label className="field">
            <span>Margin</span>
            <input type="number" min="0" max={limit} value={margin} onChange={(e) => setMargin(clamp(e.target.value))} />
          </label>
        </div>

        <div className="segmented" role="group" aria-label="Panel letters">
          {LETTER_STYLES.map(([value, label]) => (
            <button key={value} className={letterStyle === value ? "active" : ""} onClick={() => setLetterStyle(value)}>
              {label}
            </button>
          ))}
        </div>

        {hasPanels && (
          <label className="check">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Replace the panels already on this page
          </label>
        )}

        <p className="hint">
          {fits
            ? `${count} panels, lettered in reading order. Letters update by themselves when panels are moved or deleted. Panels sit underneath your artwork and have no fill; set their stroke width to 0 to hide the frames.`
            : "The spacing and margin leave no room for the panels. Make them smaller."}
        </p>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!fits}
            onClick={() => onInsert({ ...layout, gap, margin, letterStyle, replace: hasPanels ? replace : false })}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
