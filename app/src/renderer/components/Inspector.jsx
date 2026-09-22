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
import { isPanel } from "../lib/panelLayout";
import { lineEnds } from "../lib/connectors";
import { analyseSvg, topContainer, partPalette, partLabel } from "../lib/svgParts";
import { effectiveColorMap } from "../lib/svgPalette";
import { extractPalette } from "../lib/svgPalette";
import { baseMarks, marksIn, plainText, runsOf, withBase } from "../lib/richText";
import GraphPanel from "./GraphPanel";

export default function Inspector() {
  const elements = useStore((s) => s.elements);
  const selectedIds = useStore((s) => s.selectedIds);
  const canvas = useStore((s) => s.canvas);
  const setCanvas = useStore((s) => s.setCanvas);
  const partEdit = useStore((s) => s.partEdit);
  const updateSelected = useStore((s) => s.updateSelected);

  const selected = elements.filter((el) => selectedIds.includes(el.id));
  const single = selected.length === 1 ? selected[0] : null;

  return (
    <div className="panel inspector">
      <div className="panel-header">Properties</div>

      {selected.length === 0 && (
        <>
          <CanvasSettings canvas={canvas} setCanvas={setCanvas} />
          <GridSettings />
        </>
      )}

      {selected.length > 0 && (
        <>
          <Section title={selected.length === 1 ? single.name : `${selected.length} selected`}>
            <p className="hint">Align and distribute from the Arrange buttons in the toolbar.</p>
          </Section>

          {single && <GeometryFields element={single} />}

          {single && single.type === "text" && <TextFields element={single} />}

          {single && ["rect", "ellipse", "triangle", "line", "arrow"].includes(single.type) && (
            <ShapeFields element={single} />
          )}

          {single && isPanel(single) && <PanelFields element={single} />}

          {single && single.type === "table" && <TableFields element={single} />}

          {single && single.type === "image" && <ImageFields element={single} />}

          {single && single.type === "plot" && <GraphPanel element={single} />}

          {single && single.type === "asset" && (
            partEdit?.elementId === single.id ? (
              <PartsPanel element={single} />
            ) : (
              <>
                <PartsLauncher element={single} />
                <RecolorPanel element={single} />
              </>
            )
          )}

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

/**
 * Editable hex value for one swatch.
 *
 * Typing a colour is faster than dragging a picker when you already know the
 * value, such as a journal's palette or a lab's house colours, and it is
 * exact. It commits on Enter or when the field loses focus, reverts on
 * Escape, and ignores anything that is not a hex colour rather than applying
 * half a value. Typing the original colour back clears the change.
 */
function HexField({ value, disabled, onCommit }) {
  const [draft, setDraft] = React.useState(value);
  const cancelled = React.useRef(false);

  React.useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value);
      return;
    }
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(draft.trim());
    if (!match) {
      setDraft(value);
      return;
    }
    const digits = match[1].length === 3
      ? match[1].split("").map((c) => c + c).join("")
      : match[1];
    const next = `#${digits.toLowerCase()}`;
    if (next !== value) onCommit(next);
    else setDraft(value);
  };

  return (
    <input
      className="swatch-hex"
      value={draft}
      disabled={disabled}
      spellCheck={false}
      maxLength={7}
      aria-label="Hex colour"
      title="Type a hex colour, then press Enter"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

/** The way into editing parts, above the whole-drawing colours. */
function PartsLauncher({ element }) {
  const enterPartEdit = useStore((s) => s.enterPartEdit);
  return (
    <Section title="Parts">
      <button className="ghost" onClick={() => enterPartEdit(element.id)} disabled={element.locked}>
        Edit parts…
      </button>
      <p className="hint">
        Or double-click the illustration. Select, recolour, hide and move individual pieces of it.
      </p>
    </Section>
  );
}

/**
 * The selected parts of the illustration being edited: their own colours,
 * hiding, and putting them back. Colours listed are the ones inside the
 * selected parts, and changing one changes it only there.
 */
function PartsPanel({ element }) {
  const partEdit = useStore((s) => s.partEdit);
  const updateParts = useStore((s) => s.updateParts);
  const resetParts = useStore((s) => s.resetParts);
  const exitPartEdit = useStore((s) => s.exitPartEdit);
  const partEditUp = useStore((s) => s.partEditUp);
  const openPartGroup = useStore((s) => s.openPartGroup);
  const analysis = React.useMemo(() => analyseSvg(element.svgSource), [element.svgSource]);
  if (!analysis || !partEdit) return null;

  const keys = partEdit.selected;
  const edits = element.partEdits ?? {};
  const wholeDrawing = effectiveColorMap(element);
  const top = topContainer(analysis);
  const palette = keys.length ? partPalette(analysis, keys) : [];
  const allHidden = keys.length > 0 && keys.every((k) => edits[k]?.hidden);
  const one = keys.length === 1 ? analysis.byKey.get(keys[0]) : null;
  const editedCount = Object.keys(edits).length;

  const setColour = (hex, value) =>
    updateParts(keys, (edit) => ({ colors: { ...(edit.colors ?? {}), [hex]: value } }));
  const clearColour = (hex) =>
    updateParts(keys, (edit) => {
      const colors = { ...(edit.colors ?? {}) };
      delete colors[hex];
      return { colors };
    });

  return (
    <Section title="Editing parts">
      <div className="part-level">
        <span>{partEdit.container === top ? "Whole drawing" : partLabel(analysis, partEdit.container)}</span>
        {partEdit.container !== top && (
          <button className="ghost small" onClick={partEditUp}>Up one level</button>
        )}
        <button className="primary small" onClick={exitPartEdit}>Done</button>
      </div>
      <p className="hint">
        Click a part to select it. Shift adds more, Ctrl picks a single shape, and double-click
        opens a group. Click a selected part again to reach a tint or shading layer drawn
        over it. Drag or use the arrow keys to move; Delete hides; Esc goes back.
      </p>

      {keys.length > 0 && (
        <>
          <p className="part-selection">{one ? partLabel(analysis, keys[0]) : `${keys.length} parts`}</p>
          {palette.length > 0 && (
            <div className="swatch-list">
              {palette.slice(0, SWATCH_CAP).map(({ hex }) => {
                const own = edits[keys[0]]?.colors?.[hex];
                const drawn = wholeDrawing[hex] && wholeDrawing[hex] !== "none" ? wholeDrawing[hex] : hex;
                const current = own ?? drawn;
                const changed = keys.some((k) => edits[k]?.colors?.[hex]);
                return (
                  <div className={`swatch-row${changed ? " changed" : ""}`} key={hex}>
                    <input type="color" value={current} onChange={(e) => setColour(hex, e.target.value)} title={hex} />
                    <HexField value={current} onCommit={(next) => setColour(hex, next)} />
                    {changed && (
                      <button className="link" onClick={() => clearColour(hex)} title="Back to the drawing's colour">
                        reset
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="table-buttons">
            <button className="ghost small" onClick={() => updateParts(keys, { hidden: !allHidden })}>
              {allHidden ? "Show" : "Hide"}
            </button>
            <button className="ghost small" onClick={() => resetParts(keys)} disabled={!keys.some((k) => edits[k])}>
              Reset
            </button>
            {one?.container && (
              <button className="ghost small" onClick={() => openPartGroup(keys[0])}>Open group</button>
            )}
          </div>
        </>
      )}

      {editedCount > 0 && (
        <button className="ghost small part-reset-all" onClick={() => resetParts(null)}>
          Reset all parts ({editedCount})
        </button>
      )}
    </Section>
  );
}

function RecolorPanel({ element }) {
  const setAssetColor = useStore((s) => s.setAssetColor);
  const resetAssetColors = useStore((s) => s.resetAssetColors);
  const toggleAssetColorHidden = useStore((s) => s.toggleAssetColorHidden);
  const setHighlight = useStore((s) => s.setHighlight);
  const [showAll, setShowAll] = React.useState(false);

  // Never leave a highlight painted on the canvas after the panel goes away,
  // whether from deselecting, deleting, or switching to another element.
  React.useEffect(() => {
    setHighlight(null);
    return () => setHighlight(null);
  }, [element.id, setHighlight]);

  // Palette is cached on the element at placement time; recompute defensively
  // for documents saved before the field existed.
  const palette = element.palette?.length ? element.palette : extractPalette(element.svgSource);
  const changed = Object.keys(element.colorMap ?? {}).length;
  const hidden = new Set(element.hiddenColors ?? []);

  // Always keep colours the user has already changed visible, even if they
  // fall outside the cap -- otherwise an edit could scroll out of reach.
  const capped = showAll
    ? palette
    : palette.filter(
        (p, i) => i < SWATCH_CAP || element.colorMap?.[p.hex] || hidden.has(p.hex)
      );
  const notShown = palette.length - capped.length;

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
        Each swatch is one colour used across the whole illustration. Hover a row to
        see which parts it controls, change it to recolour them, or use the eye to
        remove them
        {palette.length > SWATCH_CAP ? ". Most-used first" : ""}.
      </p>
      <div className="swatch-list">
        {capped.map(({ hex, count }) => {
          const current = element.colorMap?.[hex] ?? hex;
          const isChanged = current !== hex;
          const isHidden = hidden.has(hex);
          return (
            <div
              className={`swatch-row${isChanged ? " changed" : ""}${isHidden ? " removed" : ""}`}
              key={hex}
              onMouseEnter={() => setHighlight({ elementId: element.id, hex })}
              onMouseLeave={() => setHighlight(null)}
            >
              <input
                type="color"
                value={current}
                disabled={isHidden}
                onChange={(e) => setAssetColor(element.id, hex, e.target.value)}
                title={`${hex}${isChanged ? ` changed to ${current}` : ""}`}
              />
              <HexField
                value={current}
                disabled={isHidden}
                onCommit={(next) => setAssetColor(element.id, hex, next)}
              />
              <span className="swatch-count" title={`${count} rule(s) use this colour`}>
                x{count}
              </span>
              {isChanged && !isHidden && (
                <button
                  className="link"
                  onClick={() => setAssetColor(element.id, hex, null)}
                  title={`Reset to ${hex}`}
                >
                  reset
                </button>
              )}
              <button
                className="icon"
                onClick={() => toggleAssetColorHidden(element.id, hex)}
                title={isHidden ? "Restore these parts" : "Remove these parts"}
              >
                {isHidden ? "\u{1F441}\u{200D}\u{1F5E8}" : "\u{2716}"}
              </button>
            </div>
          );
        })}
      </div>
      {notShown > 0 && (
        <button className="ghost small" onClick={() => setShowAll(true)}>
          Show {notShown} more colour{notShown === 1 ? "" : "s"}
        </button>
      )}
      {showAll && palette.length > SWATCH_CAP && (
        <button className="ghost small" onClick={() => setShowAll(false)}>
          Show fewer
        </button>
      )}
      {(changed > 0 || hidden.size > 0) && (
        <button className="ghost" onClick={() => resetAssetColors(element.id)}>
          Restore original artwork
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
          carry the same licence, which can extend to this whole figure.
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
          <TextMarks element={element} />
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

const PANEL_LETTER_STYLES = [
  ["upper", "A, B"],
  ["lower", "a, b"],
  ["none", "None"],
];

/** Letters are shared by every panel on the page, so a figure stays consistent. */
function PanelFields({ element }) {
  const setPanelLetters = useStore((s) => s.setPanelLetters);
  return (
    <Section title="Panel letter">
      <div className="segmented" role="group" aria-label="Panel letters">
        {PANEL_LETTER_STYLES.map(([value, label]) => (
          <button
            key={value}
            className={(element.panelLetterStyle ?? "upper") === value ? "active" : ""}
            onClick={() => setPanelLetters({ panelLetterStyle: value })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="field-grid">
        <NumberField
          label="Size"
          value={element.panelLetterSize ?? 32}
          onChange={(v) => setPanelLetters({ panelLetterSize: Math.max(4, v) })}
        />
        <Field label="Colour">
          <input
            type="color"
            value={element.panelLetterColor ?? "#111111"}
            onChange={(e) => setPanelLetters({ panelLetterColor: e.target.value })}
          />
        </Field>
      </div>
      <p className="hint">
        Letters follow reading order and update by themselves. Changes here apply to every
        panel on this page.
      </p>
    </Section>
  );
}

const LINE_ROUTES = [
  ["straight", "∕", "Straight"],
  ["curved", "⌒", "Curved"],
  ["elbow", "└", "Elbow"],
];

const HEAD_LABELS = [
  ["none", "None"],
  ["triangle", "Arrow"],
  ["open", "Open arrow"],
  ["square", "Square"],
  ["circle", "Dot"],
  ["bar", "Bar (inhibition)"],
];

const DASH_LABELS = [
  ["solid", "Solid"],
  ["dashed", "Dashed"],
  ["dotted", "Dotted"],
];

function ShapeFields({ element }) {
  const updateElement = useStore((s) => s.updateElement);
  const setLineStyle = useStore((s) => s.setLineStyle);
  const setConnectorRoute = useStore((s) => s.setConnectorRoute);
  const set = (patch) => updateElement(element.id, patch);
  const isLine = element.type === "line" || element.type === "arrow";

  return (
    <>
    <Section title="Shape">
      {isLine && (
        <div className="field-grid">
          <Field label="Start">
            <select
              value={lineEnds(element).start}
              onChange={(e) => setLineStyle({ startHead: e.target.value }, [element.id])}
            >
              {HEAD_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="End">
            <select
              value={lineEnds(element).end}
              onChange={(e) => setLineStyle({ endHead: e.target.value }, [element.id])}
            >
              {HEAD_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Line">
            <select
              value={element.dash ?? "solid"}
              onChange={(e) => setLineStyle({ dash: e.target.value }, [element.id])}
            >
              {DASH_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </div>
      )}
      {isLine && (
        <div className="segmented" role="group" aria-label="Line route">
          {LINE_ROUTES.map(([value, glyph, label]) => (
            <button
              key={value}
              className={(element.route ?? "straight") === value ? "active" : ""}
              title={`${label} line`}
              onClick={() => setConnectorRoute(element.id, value)}
            >
              <span className="seg-glyph">{glyph}</span>
              {label}
            </button>
          ))}
        </div>
      )}
      {isLine && (
        <p className="hint">
          {element.start || element.end
            ? `Glued at the ${[element.start && "start", element.end && "end"].filter(Boolean).join(" and ")}. ` +
              "Drag a glued end away to let go."
            : "Drag an end onto a shape, image, table or icon to glue it. Hold Ctrl to place it without gluing."}
        </p>
      )}
      <div className="field-grid">
        <Field label={isLine ? "Colour" : "Fill"}>
          <input type="color" value={element.fill || "#ffffff"} onChange={(e) => set({ fill: e.target.value })} />
        </Field>
        {!isLine && (
          <label className="check">
            <input
              type="checkbox"
              checked={!element.fill}
              onChange={(e) => set({ fill: e.target.checked ? "" : "#ffffff" })}
            />
            No fill
          </label>
        )}
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

    {!isLine && (
      <Section title="Label">
        <textarea
          className="text-input"
          rows={2}
          placeholder="Text inside the shape"
          value={element.label ?? ""}
          onChange={(e) => set({ label: e.target.value })}
        />
        {element.label ? (
          <div className="field-grid">
            <NumberField
              label="Size"
              value={element.labelSize ?? 16}
              onChange={(v) => set({ labelSize: Math.max(4, v) })}
            />
            <Field label="Colour">
              <input
                type="color"
                value={element.labelColor ?? "#ffffff"}
                onChange={(e) => set({ labelColor: e.target.value })}
              />
            </Field>
            <Field label="Font">
              <select
                value={element.labelFont ?? "Helvetica"}
                onChange={(e) => set({ labelFont: e.target.value })}
              >
                {["Helvetica", "Arial", "Times New Roman", "Georgia", "Courier New", "Verdana"].map(
                  (f) => (
                    <option key={f}>{f}</option>
                  )
                )}
              </select>
            </Field>
          </div>
        ) : (
          <p className="hint">Double-click the shape on the canvas to label it.</p>
        )}
      </Section>
    )}
    </>
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

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Grid controls.
 *
 * The grid is a drawing aid, not part of the figure: it is never exported and
 * never saved, so it lives with the canvas settings rather than on any
 * element. Snapping is opt-in because a grid is often wanted for eyeballing
 * alignment without constraining where things can go.
 */
function GridSettings() {
  const grid = useStore((s) => s.grid);
  const setGrid = useStore((s) => s.setGrid);

  const PRESETS = [10, 20, 25, 50, 100];

  return (
    <Section title="Grid">
      <label className="check">
        <input
          type="checkbox"
          checked={grid.visible}
          onChange={(e) => setGrid({ visible: e.target.checked })}
        />
        Show grid
      </label>

      <div className="field-grid" style={{ marginTop: 8 }}>
        <NumberField
          label="Spacing (px)"
          value={grid.size}
          onChange={(v) => setGrid({ size: Math.max(5, Math.min(1000, v)) })}
        />
        <Field label="Colour">
          <input
            type="color"
            value={grid.color}
            onChange={(e) => setGrid({ color: e.target.value })}
          />
        </Field>
      </div>

      <div className="preset-row">
        {PRESETS.map((size) => (
          <button
            key={size}
            className={`ghost small${grid.size === size ? " active" : ""}`}
            onClick={() => setGrid({ size, visible: true })}
          >
            {size}
          </button>
        ))}
      </div>

      <label className="check" style={{ marginTop: 8 }}>
        <input
          type="checkbox"
          checked={grid.snap}
          onChange={(e) => setGrid({ snap: e.target.checked })}
        />
        Snap elements to the grid
      </label>

      <p className="hint">
        Every fifth line is drawn stronger, so a fine spacing is still countable.
        The grid is a guide only: it never appears in an export.
      </p>
    </Section>
  );
}

/** Everything about a table except its cell text, which is edited on canvas. */
function TableFields({ element }) {
  const updateElement = useStore((s) => s.updateElement);
  const resizeTable = useStore((s) => s.resizeTable);
  const setTableUniform = useStore((s) => s.setTableUniform);
  const set = (patch) => updateElement(element.id, patch);

  // Uniform sizes are shown as the average, so setting either field makes
  // every column or row that size again.
  const uniform = (list) =>
    Math.round(list.reduce((a, b) => a + b, 0) / Math.max(1, list.length));

  const FONTS = ["Helvetica", "Arial", "Georgia", "Times New Roman", "Courier New", "Verdana"];

  return (
    <>
      <Section title={`Table (${element.rows} by ${element.cols})`}>
        <p className="hint">Double-click any cell on the canvas to edit its text.</p>

        <div className="table-buttons">
          <button className="ghost small" onClick={() => resizeTable(element.id, "row", "add")}>
            + Row
          </button>
          <button
            className="ghost small"
            onClick={() => resizeTable(element.id, "row", "remove")}
            disabled={element.rows <= 1}
          >
            &minus; Row
          </button>
          <button className="ghost small" onClick={() => resizeTable(element.id, "col", "add")}>
            + Column
          </button>
          <button
            className="ghost small"
            onClick={() => resizeTable(element.id, "col", "remove")}
            disabled={element.cols <= 1}
          >
            &minus; Column
          </button>
        </div>

        <div className="field-grid" style={{ marginTop: 8 }}>
          <NumberField
            label="Column width"
            value={uniform(element.colWidths)}
            onChange={(v) => setTableUniform(element.id, "col", v)}
          />
          <NumberField
            label="Row height"
            value={uniform(element.rowHeights)}
            onChange={(v) => setTableUniform(element.id, "row", v)}
          />
        </div>
        <p className="hint">
          Setting either makes every column or row that size. Drag the corner
          handles to scale the whole table instead.
        </p>
      </Section>

      <Section title="Table style">
        <div className="field-grid">
          <NumberField
            label="Corner radius"
            value={element.cornerRadius ?? 0}
            onChange={(v) => set({ cornerRadius: Math.max(0, v) })}
          />
          <NumberField
            label="Cell padding"
            value={element.padding ?? 6}
            onChange={(v) => set({ padding: Math.max(0, v) })}
          />
          <NumberField
            label="Border width"
            value={element.strokeWidth}
            onChange={(v) => set({ strokeWidth: Math.max(0, v) })}
          />
          <Field label="Border">
            <input
              type="color"
              value={element.stroke}
              onChange={(e) => set({ stroke: e.target.value })}
            />
          </Field>
          <Field label="Cell fill">
            <input
              type="color"
              value={element.fill}
              onChange={(e) => set({ fill: e.target.value })}
            />
          </Field>
          <Field label="Header fill">
            <input
              type="color"
              value={element.headerFill}
              onChange={(e) => set({ headerFill: e.target.value })}
            />
          </Field>
        </div>

        <label className="check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={element.showInnerLines !== false}
            onChange={(e) => set({ showInnerLines: e.target.checked })}
          />
          Draw lines between cells
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(element.stripeFill)}
            onChange={(e) => set({ stripeFill: e.target.checked ? "#eef1f7" : "" })}
          />
          Shade alternate rows
        </label>
        {element.stripeFill ? (
          <Field label="Shading colour">
            <input
              type="color"
              value={element.stripeFill}
              onChange={(e) => set({ stripeFill: e.target.value })}
            />
          </Field>
        ) : null}
      </Section>

      <Section title="Headers">
        <label className="check">
          <input
            type="checkbox"
            checked={element.headerRow}
            onChange={(e) => set({ headerRow: e.target.checked })}
          />
          First row is a header
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={element.headerCol}
            onChange={(e) => set({ headerCol: e.target.checked })}
          />
          First column is a header
        </label>
        <Field label="Header text">
          <input
            type="color"
            value={element.headerTextColor}
            onChange={(e) => set({ headerTextColor: e.target.value })}
          />
        </Field>
      </Section>

      <Section title="Cell text">
        <div className="field-grid">
          <Field label="Font">
            <select
              value={element.fontFamily}
              onChange={(e) => set({ fontFamily: e.target.value })}
            >
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <NumberField
            label="Size"
            value={element.fontSize}
            onChange={(v) => set({ fontSize: Math.max(4, v) })}
          />
          <Field label="Align">
            <select value={element.align} onChange={(e) => set({ align: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </Field>
          <Field label="Colour">
            <input
              type="color"
              value={element.textColor}
              onChange={(e) => set({ textColor: e.target.value })}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}

/** Imported bitmaps: proportions and rounded corners. */
function ImageFields({ element }) {
  const updateElement = useStore((s) => s.updateElement);
  const set = (patch) => updateElement(element.id, patch);

  const ratio = element.naturalWidth / element.naturalHeight;
  const distorted =
    Number.isFinite(ratio) && Math.abs(element.width / element.height - ratio) > 0.01;

  return (
    <Section title="Image">
      <p className="hint">
        {element.naturalWidth} by {element.naturalHeight} px in the source file.
      </p>

      <div className="field-grid">
        <NumberField
          label="Corner radius"
          value={element.cornerRadius ?? 0}
          onChange={(v) => set({ cornerRadius: Math.max(0, v) })}
        />
      </div>

      {distorted && <p className="hint">This image is not at its original proportions.</p>}

      <div className="table-buttons" style={{ marginTop: 8 }}>
        <button
          className="ghost small"
          onClick={() => set({ height: element.width / ratio })}
          disabled={!Number.isFinite(ratio)}
        >
          Restore proportions
        </button>
        <button
          className="ghost small"
          onClick={() => set({ width: element.naturalWidth, height: element.naturalHeight })}
        >
          Original size
        </button>
      </div>
    </Section>
  );
}

/**
 * Bold, italic, underline, strikethrough, superscript and subscript for the
 * whole text element. A button is on when every character carries the mark,
 * and half lit when only some do; double-click the text on the canvas to mark
 * single words instead.
 */
function TextMarks({ element }) {
  const toggleTextStyle = useStore((s) => s.toggleTextStyle);
  const runs = withBase(runsOf(element), baseMarks(element.fontStyle));
  const marks = marksIn(runs, 0, plainText(runs).length);
  const state = (mark) =>
    mark === "super" || mark === "sub"
      ? marks.baseline === mark
        ? "on"
        : marks.baseline === "mixed"
        ? "mixed"
        : "off"
      : marks[mark] === true
      ? "on"
      : marks[mark] === "mixed"
      ? "mixed"
      : "off";

  const BUTTONS = [
    ["bold", "B", "Bold (Ctrl+B)", { fontWeight: 700 }],
    ["italic", "I", "Italic (Ctrl+I)", { fontStyle: "italic" }],
    ["underline", "U", "Underline (Ctrl+U)", { textDecoration: "underline" }],
    ["strike", "S", "Strikethrough", { textDecoration: "line-through" }],
    ["super", "x²", "Superscript", {}],
    ["sub", "x₂", "Subscript", {}],
  ];

  return (
    <div className="mark-row" role="group" aria-label="Text style">
      {BUTTONS.map(([mark, glyph, title, css]) => {
        const how = state(mark);
        return (
          <button
            key={mark}
            className={`tool${how === "on" ? " active" : how === "mixed" ? " mixed" : ""}`}
            title={title}
            aria-label={title}
            aria-pressed={how === "on"}
            style={css}
            onClick={() => toggleTextStyle(mark)}
          >
            {glyph}
          </button>
        );
      })}
    </div>
  );
}

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
