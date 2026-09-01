/**
 * Right-hand properties panel.
 *
 * The interesting part is RecolorPanel. BioArt vectors carry ~5 colours on
 * average (up to 21) across hundreds of shapes, so recolouring works as a
 * palette swap: we list the distinct colours found in the file and remap them
 * wholesale. The original SVG text is never modified -- the element stores a
 * { fromColour: toColour } map that is applied at render time, so any swatch
 * can be reset and the source stays intact.
 */

import React from "react";
import { useStore, CANVAS_PRESETS } from "../store";
import { extractPalette } from "../lib/svgPalette";

export default function Inspector() {
  const elements = useStore((s) => s.elements);
  const selectedIds = useStore((s) => s.selectedIds);
  const canvas = useStore((s) => s.canvas);
  const setCanvas = useStore((s) => s.setCanvas);
  const updateSelected = useStore((s) => s.updateSelected);
  const align = useStore((s) => s.align);

  const selected = elements.filter((el) => selectedIds.includes(el.id));
  const single = selected.length === 1 ? selected[0] : null;

  return (
    <div className="panel inspector">
      <div className="panel-header">Properties</div>

      {selected.length === 0 && <CanvasSettings canvas={canvas} setCanvas={setCanvas} />}

      {selected.length > 0 && (
        <>
          <Section title={selected.length === 1 ? single.name : `${selected.length} selected`}>
            <AlignButtons align={align} multi={selected.length > 1} />
          </Section>

          {single && <GeometryFields element={single} />}

          {single && single.type === "text" && <TextFields element={single} />}

          {single && ["rect", "ellipse", "triangle", "line", "arrow"].includes(single.type) && (
            <ShapeFields element={single} />
          )}

          {single && single.type === "asset" && <RecolorPanel element={single} />}

          <Section title="Appearance">
            <Field label="Opacity">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={single ? single.opacity : 1}
                onChange={(e) => updateSelected({ opacity: Number(e.target.value) })}
              />
            </Field>
          </Section>

          {single && single.type === "asset" && <AttributionBlock element={single} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recolouring
// ---------------------------------------------------------------------------

/**
 * Most assets have a handful of colours, but a few are extreme -- one Bioicons
 * illustration has 501 distinct colours across its shapes. Rendering every
 * swatch there is useless (and slow), so the list is capped at the most-used
 * colours, which are the ones that actually define how the artwork reads.
 * The rest stay reachable behind a toggle.
 */
const SWATCH_CAP = 24;

function RecolorPanel({ element }) {
  const setAssetColor = useStore((s) => s.setAssetColor);
  const resetAssetColors = useStore((s) => s.resetAssetColors);
  const [showAll, setShowAll] = React.useState(false);

  // Palette is cached on the element at placement time; recompute defensively
  // for documents saved before the field existed.
  const palette = element.palette?.length ? element.palette : extractPalette(element.svgSource);
  const changed = Object.keys(element.colorMap ?? {}).length;

  // Always keep colours the user has already changed visible, even if they
  // fall outside the cap -- otherwise an edit could scroll out of reach.
  const capped = showAll
    ? palette
    : palette.filter((p, i) => i < SWATCH_CAP || element.colorMap?.[p.hex]);
  const hidden = palette.length - capped.length;

  if (palette.length === 0) {
    return (
      <Section title="Colours">
        <p className="hint">No flat colours found in this asset.</p>
      </Section>
    );
  }

  return (
    <Section title={`Colours (${palette.length})`}>
      <p className="hint">
        Each swatch is one colour used across the whole illustration. Changing it
        recolours every shape that uses it
        {palette.length > SWATCH_CAP ? ", most-used first" : ""}.
      </p>
      <div className="swatch-list">
        {capped.map(({ hex, count }) => {
          const current = element.colorMap?.[hex] ?? hex;
          const isChanged = current !== hex;
          return (
            <div className={`swatch-row${isChanged ? " changed" : ""}`} key={hex}>
              <input
                type="color"
                value={current}
                onChange={(e) => setAssetColor(element.id, hex, e.target.value)}
                title={`${hex}${isChanged ? ` → ${current}` : ""}`}
              />
              <span className="swatch-hex">{current}</span>
              <span className="swatch-count" title={`${count} rule(s) use this colour`}>
                ×{count}
              </span>
              {isChanged && (
                <button
                  className="link"
                  onClick={() => setAssetColor(element.id, hex, null)}
                  title={`Reset to ${hex}`}
                >
                  reset
                </button>
              )}
            </div>
          );
        })}
      </div>
      {hidden > 0 && (
        <button className="ghost small" onClick={() => setShowAll(true)}>
          Show {hidden} more colour{hidden === 1 ? "" : "s"}
        </button>
      )}
      {showAll && palette.length > SWATCH_CAP && (
        <button className="ghost small" onClick={() => setShowAll(false)}>
          Show fewer
        </button>
      )}
      {changed > 0 && (
        <button className="ghost" onClick={() => resetAssetColors(element.id)}>
          Reset all {changed} change{changed === 1 ? "" : "s"}
        </button>
      )}
    </Section>
  );
}

function AttributionBlock({ element }) {
  if (!element.citation) return null;
  return (
    <Section title="Attribution">
      {element.shareAlike && (
        <p className="warning">
          <strong>Share-alike.</strong> {element.license} requires derivative works to
          carry the same licence — that can extend to this whole figure.
        </p>
      )}
      <p className="citation">{element.citation}</p>
      <p className="hint">
        {element.collection}
        {element.license ? ` · ${element.license}` : ""}
        {element.requiresAttribution === false ? " · attribution optional" : ""}
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Field groups
// ---------------------------------------------------------------------------

function GeometryFields({ element }) {
  const updateElement = useStore((s) => s.updateElement);
  const set = (patch) => updateElement(element.id, patch);

  return (
    <Section title="Position & size">
      <div className="field-grid">
        <NumberField label="X" value={element.x} onChange={(v) => set({ x: v })} />
        <NumberField label="Y" value={element.y} onChange={(v) => set({ y: v })} />
        {element.width != null && (
          <NumberField label="W" value={element.width} onChange={(v) => set({ width: Math.max(1, v) })} />
        )}
        {element.height != null && element.type !== "text" && (
          <NumberField label="H" value={element.height} onChange={(v) => set({ height: Math.max(1, v) })} />
        )}
        <NumberField label="Rotation" value={element.rotation} onChange={(v) => set({ rotation: v })} />
      </div>
    </Section>
  );
}

function TextFields({ element }) {
  const updateElement = useStore((s) => s.updateElement);
  const set = (patch) => updateElement(element.id, patch);

  return (
    <Section title="Text">
      <textarea
        className="text-input"
        rows={3}
        value={element.text}
        onChange={(e) => set({ text: e.target.value })}
      />
      <div className="field-grid">
        <NumberField label="Size" value={element.fontSize} onChange={(v) => set({ fontSize: Math.max(4, v) })} />
        <Field label="Font">
          <select value={element.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
            {["Helvetica", "Arial", "Times New Roman", "Georgia", "Courier New", "Verdana"].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Field>
        <Field label="Style">
          <select value={element.fontStyle} onChange={(e) => set({ fontStyle: e.target.value })}>
            <option value="normal">Regular</option>
            <option value="bold">Bold</option>
            <option value="italic">Italic</option>
            <option value="italic bold">Bold italic</option>
          </select>
        </Field>
        <Field label="Align">
          <select value={element.align} onChange={(e) => set({ align: e.target.value })}>
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </Field>
        <Field label="Colour">
          <input type="color" value={element.fill} onChange={(e) => set({ fill: e.target.value })} />
        </Field>
      </div>
    </Section>
  );
}

const ARROW_HEADS = [
  ["none", "⎯", "No heads"],
  ["end", "→", "Single head"],
  ["both", "↔", "Double headed"],
];

function ShapeFields({ element }) {
  const updateElement = useStore((s) => s.updateElement);
  const setArrowHeads = useStore((s) => s.setArrowHeads);
  const set = (patch) => updateElement(element.id, patch);
  const isLine = element.type === "line" || element.type === "arrow";

  return (
    <Section title="Shape">
      {element.type === "arrow" && (
        <div className="segmented" role="group" aria-label="Arrow heads">
          {ARROW_HEADS.map(([value, glyph, label]) => (
            <button
              key={value}
              className={(element.heads ?? "end") === value ? "active" : ""}
              title={label}
              onClick={() => setArrowHeads(element.id, value)}
            >
              <span className="seg-glyph">{glyph}</span>
              {label.split(" ")[0]}
            </button>
          ))}
        </div>
      )}
      <div className="field-grid">
        <Field label={isLine ? "Colour" : "Fill"}>
          <input type="color" value={element.fill} onChange={(e) => set({ fill: e.target.value })} />
        </Field>
        {!isLine && (
          <Field label="Stroke">
            <input type="color" value={element.stroke} onChange={(e) => set({ stroke: e.target.value })} />
          </Field>
        )}
        <NumberField
          label={isLine ? "Width" : "Stroke w."}
          value={element.strokeWidth}
          onChange={(v) => set({ strokeWidth: Math.max(0, v) })}
        />
        {element.type === "rect" && (
          <NumberField
            label="Corner"
            value={element.cornerRadius ?? 0}
            onChange={(v) => set({ cornerRadius: Math.max(0, v) })}
          />
        )}
      </div>
    </Section>
  );
}

function CanvasSettings({ canvas, setCanvas }) {
  return (
    <>
      <Section title="Canvas">
        <Field label="Preset">
          <select
            value={`${canvas.width}x${canvas.height}`}
            onChange={(e) => {
              const preset = CANVAS_PRESETS.find((p) => `${p.width}x${p.height}` === e.target.value);
              if (preset) setCanvas({ width: preset.width, height: preset.height });
            }}
          >
            {CANVAS_PRESETS.map((p) => (
              <option key={p.name} value={`${p.width}x${p.height}`}>
                {p.name}
              </option>
            ))}
            <option value={`${canvas.width}x${canvas.height}`}>
              Custom ({Math.round(canvas.width)}×{Math.round(canvas.height)})
            </option>
          </select>
        </Field>
        <div className="field-grid">
          <NumberField label="Width" value={canvas.width} onChange={(v) => setCanvas({ width: Math.max(50, v) })} />
          <NumberField label="Height" value={canvas.height} onChange={(v) => setCanvas({ height: Math.max(50, v) })} />
          <Field label="Background">
            <input
              type="color"
              value={canvas.background}
              onChange={(e) => setCanvas({ background: e.target.value })}
            />
          </Field>
        </div>
      </Section>
      <p className="hint pad">Select an element to edit its properties.</p>
    </>
  );
}

function AlignButtons({ align, multi }) {
  const edges = [
    ["left", "Align left"],
    ["hcenter", "Centre horizontally"],
    ["right", "Align right"],
    ["top", "Align top"],
    ["vcenter", "Centre vertically"],
    ["bottom", "Align bottom"],
  ];
  return (
    <>
      <div className="align-row">
        {edges.map(([edge, label]) => (
          <button key={edge} className="ghost small" title={label} onClick={() => align(edge)}>
            {ALIGN_ICONS[edge]}
          </button>
        ))}
      </div>
      <p className="hint">{multi ? "Aligns the selection to itself." : "Aligns to the canvas."}</p>
    </>
  );
}

const ALIGN_ICONS = {
  left: "⇤",
  hcenter: "↔",
  right: "⇥",
  top: "⤒",
  vcenter: "↕",
  bottom: "⤓",
};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function Section({ title, children }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={Math.round((value ?? 0) * 100) / 100}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
    </Field>
  );
}
