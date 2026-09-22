/**
 * The properties panel for a selected graph: what it shows, its axes and
 * colours, and its statistics.
 *
 * The statistics section follows the pattern scientists found easiest in the
 * layout research: Morphly suggests a test and says why (normality, spread),
 * shows the result in one line, and lists every comparison with a tick box.
 * Ticked comparisons are drawn on the graph as brackets with stars;
 * significant ones start ticked. A methods sentence can be copied straight
 * into a manuscript.
 */

import React, { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { graphAnalysis } from "../lib/graphs";
import {
  availableTests,
  methodsSentence,
  groupedMethodsSentence,
  plottedGroups,
  TESTS,
  CORRECTIONS,
  COMPARISON_SETS,
} from "../lib/analysis";
import AdvancedDialog from "./AdvancedDialog";
import { LINKS } from "../content/helpContent";
import {
  GROUP_KINDS,
  GROUPED_KINDS,
  XY_KINDS,
  GROUP_COLOURS,
  SERIES_COLOURS,
  LEGEND_POSITIONS,
  ROUND_KINDS,
} from "../lib/plotRender";
import { formatP, formatStat } from "../lib/stats";

/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

const ERRORS = [
  ["sd", "SD"],
  ["sem", "SEM"],
  ["ci", "95% CI"],
];

/** Which graph types take which options. */
const HAS_ERROR_BARS = new Set(["bar", "dots", "super"]);
const HAS_POINTS = new Set(["bar", "box", "violin"]);

function Section({ title, children }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

function Segments({ options, value, onChange, label }) {
  return (
    <div className="seg-row" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} className={value === id ? "active" : undefined} aria-pressed={value === id} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * A text field bound to one graph setting. Every keystroke redraws the graph,
 * but only the first one in a visit to the field makes an undo step.
 */
function PlotText({ element, field, label, placeholder, numeric = false }) {
  const updatePlot = useStore((s) => s.updatePlot);
  const typing = useRef(false);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={element.plot[field] ?? ""}
        placeholder={placeholder}
        inputMode={numeric ? "decimal" : undefined}
        onFocus={() => (typing.current = false)}
        onChange={(e) => {
          updatePlot(element.id, { [field]: e.target.value }, { commit: !typing.current });
          typing.current = true;
        }}
      />
    </label>
  );
}

export default function GraphPanel({ element }) {
  const dataset = useStore((s) => s.datasets.find((d) => d.id === element.datasetId) ?? null);
  const datasets = useStore((s) => s.datasets);
  const updatePlot = useStore((s) => s.updatePlot);
  const updateElement = useStore((s) => s.updateElement);
  const openData = useStore((s) => s.openData);
  const [copied, setCopied] = useState(false);
  const [axesAdvanced, setAxesAdvanced] = useState(false);

  const plot = element.plot;
  const analysis = useMemo(() => graphAnalysis(element, dataset), [element, dataset]);
  const set = (patch) => updatePlot(element.id, patch);

  if (!dataset) {
    return (
      <Section title="Graph">
        <p className="hint">The data for this graph is missing. Choose other data for it:</p>
        <select value="" onChange={(e) => updateElement(element.id, { datasetId: e.target.value })} aria-label="Data">
          <option value="" disabled>
            Choose data…
          </option>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name || "Untitled data"}
            </option>
          ))}
        </select>
      </Section>
    );
  }

  const xy = dataset.kind === "xy";
  const grouped = dataset.kind === "grouped";
  const kinds = xy ? XY_KINDS : grouped ? GROUPED_KINDS : GROUP_KINDS;
  const kind = kinds.some(([id]) => id === plot.kind) ? plot.kind : kinds[0][0];
  const sameKind = datasets.filter((d) => d.kind === dataset.kind);
  const colourCols = xy || grouped ? dataset.columns.map((_, i) => i).slice(1) : plottedGroups(dataset);
  const palette = xy ? SERIES_COLOURS : GROUP_COLOURS;
  const colourOf = (col) => plot.colors?.[col] || palette[col % palette.length];

  const setColour = (col, value) => {
    const colors = [...(plot.colors ?? [])];
    colors[col] = value;
    set({ colors });
  };

  const sentence =
    xy || !analysis || analysis.error
      ? ""
      : grouped
      ? groupedMethodsSentence(analysis, { ...plot, kind }, { version: VERSION })
      : methodsSentence(analysis, { ...plot, kind }, { version: VERSION });

  return (
    <>
      <Section title="Graph">
        {sameKind.length > 1 ? (
          <label className="field">
            <span>Data this graph draws</span>
            <select value={dataset.id} onChange={(e) => updateElement(element.id, { datasetId: e.target.value })}>
              {sameKind.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name || "Untitled data"}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="field">
            <span>Data this graph draws</span>
            <button className="ghost small data-link" onClick={() => openData(dataset.id)} title="Show these numbers under the canvas">
              {dataset.name || "Untitled data"}
            </button>
          </div>
        )}
        {kinds.length > 3 ? (
          <label className="field">
            <span>Graph type</span>
            <select value={kind} onChange={(e) => set({ kind: e.target.value })}>
              {kinds.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <div className="field-label">Graph type</div>
            <Segments label="Graph type" options={kinds} value={kind} onChange={(id) => set({ kind: id })} />
          </>
        )}
        {!xy && HAS_ERROR_BARS.has(kind) && (
          <>
            <div className="field-label">Error bars</div>
            <Segments label="Error bars" options={ERRORS} value={plot.error} onChange={(id) => set({ error: id })} />
          </>
        )}
        {!xy && HAS_POINTS.has(kind) && (
          <label className="check">
            <input type="checkbox" checked={Boolean(plot.points)} onChange={(e) => set({ points: e.target.checked })} />
            Show every point
          </label>
        )}
        {kind === "histogram" && (
          <label className="check">
            <input type="checkbox" checked={Boolean(plot.curve)} onChange={(e) => set({ curve: e.target.checked })} />
            Draw the density curve
          </label>
        )}
        {xy && (
          <label className="check">
            <input type="checkbox" checked={Boolean(plot.fit)} onChange={(e) => set({ fit: e.target.checked })} />
            Straight-line fit
          </label>
        )}
      </Section>

      <Section title={ROUND_KINDS.has(kind) ? "Text" : "Axes and text"}>
        {!ROUND_KINDS.has(kind) && (
          <>
            <PlotText element={element} field="yTitle" label="Y axis title" placeholder={kind === "histogram" ? "Count" : "For example: Viability (%)"} />
            <PlotText element={element} field="xTitle" label="X axis title" placeholder={xy ? dataset.columns[0]?.name || "X" : "None"} />
            <div className="field-grid">
              <PlotText element={element} field="yMin" label="Y from" placeholder="Auto" numeric />
              <PlotText element={element} field="yMax" label="Y to" placeholder="Auto" numeric />
            </div>
            <button className="link" onClick={() => setAxesAdvanced(true)}>
              Advanced…
            </button>
          </>
        )}
        <label className="field">
          <span>Legend</span>
          <select value={plot.legend ?? "auto"} onChange={(e) => set({ legend: e.target.value })}>
            {LEGEND_POSITIONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
                {id === "auto"
                  ? xy
                    ? " (top left, for two or more series)"
                    : grouped
                    ? " (beside the graph)"
                    : " (hidden)"
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Legend names are the column names: rename a column in the data table to rename its key.</p>
        <label className="field">
          <span>Text size</span>
          <input
            type="number"
            min="4"
            max="400"
            value={Math.round(plot.fontSize ?? 28)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 4) set({ fontSize: v });
            }}
          />
        </label>
      </Section>

      <Section title="Colours">
        <div className="swatch-list">
          {colourCols.map((col) => (
            <div key={col} className="swatch-row">
              <input type="color" value={colourOf(col)} onChange={(e) => setColour(col, e.target.value)} aria-label={`Colour of ${dataset.columns[col].name}`} />
              <span className="swatch-hex">{dataset.columns[col].name || `Column ${col + 1}`}</span>
            </div>
          ))}
        </div>
        {(plot.colors ?? []).some(Boolean) && (
          <button className="link" onClick={() => set({ colors: [] })}>
            Back to the standard colours
          </button>
        )}
      </Section>

      {axesAdvanced && (
        <AdvancedDialog
          title="Advanced axes"
          onClose={() => setAxesAdvanced(false)}
          onReset={() => set({ yScale: "linear", xScale: "linear", binWidth: "" })}
        >
          <label className="field">
            <span>Y axis scale</span>
            <select value={plot.yScale ?? "linear"} onChange={(e) => set({ yScale: e.target.value })}>
              <option value="linear">Linear</option>
              <option value="log">Logarithmic (powers of ten)</option>
            </select>
          </label>
          {xy && (
            <label className="field">
              <span>X axis scale</span>
              <select value={plot.xScale ?? "linear"} onChange={(e) => set({ xScale: e.target.value })}>
                <option value="linear">Linear</option>
                <option value="log">Logarithmic (powers of ten)</option>
              </select>
            </label>
          )}
          {kind === "histogram" && (
            <PlotText element={element} field="binWidth" label="Bin width" placeholder="Chosen for you" numeric />
          )}
          <p className="hint">
            A logarithmic axis runs between whole powers of ten. Values at or below zero cannot be placed on one, so they
            are left out of the drawing. Stacked bars stay linear, since their heights are meant to be added up.
          </p>
        </AdvancedDialog>
      )}

      {grouped && <GroupedStats element={element} dataset={dataset} analysis={analysis} sentence={sentence} copied={copied} setCopied={setCopied} />}
      {!xy && !grouped && <GroupStats element={element} analysis={analysis} sentence={sentence} copied={copied} setCopied={setCopied} />}
      {xy && <XyStats analysis={analysis} />}
    </>
  );
}

function GroupStats({ element, analysis, sentence, copied, setCopied }) {
  const updatePlot = useStore((s) => s.updatePlot);
  const plot = element.plot;
  const set = (patch) => updatePlot(element.id, patch);

  if (!analysis || analysis.error) {
    return (
      <Section title="Statistics">
        <label className="check">
          <input type="checkbox" checked={Boolean(plot.paired)} onChange={(e) => set({ paired: e.target.checked })} />
          Paired: each row is one subject
        </label>
        <p className="hint">{analysis?.error ?? "No data yet."}</p>
      </Section>
    );
  }

  const tests = availableTests(analysis.groups.length, analysis.paired);
  const suggested = analysis.suggestion.test;
  const isSuggested = analysis.test === suggested;

  const copy = async () => {
    await window.morphly.writeClipboardText(sentence);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Section title="Statistics">
      <label className="check">
        <input type="checkbox" checked={Boolean(plot.paired)} onChange={(e) => set({ paired: e.target.checked, test: "auto" })} />
        Paired: each row is one subject
      </label>
      <label className="field">
        <span>Test</span>
        <select value={plot.test && plot.test !== "auto" && tests.some((t) => t.id === plot.test) ? plot.test : "auto"} onChange={(e) => set({ test: e.target.value })}>
          <option value="auto">Suggested: {TESTS[suggested].label}</option>
          {tests.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <div className="stats-card">
        <div className="stats-head">
          <strong>{analysis.label}</strong>
          {isSuggested && <span className="pill suggested">Suggested</span>}
        </div>
        <div className="stats-result">{analysis.summary}</div>
        {analysis.posthoc && <div className="hint">Then {analysis.posthoc}.</div>}
        <p className="hint">{analysis.suggestion.reason}</p>
        {analysis.warnings.map((w) => (
          <p key={w} className="hint warn-text">
            {w}
          </p>
        ))}
      </div>

      <div className="field-label">Show on the graph</div>
      <div className="comparison-list">
        {analysis.comparisons.map((c) => {
          const shown = plot.brackets?.[c.key] ?? c.p < 0.05;
          return (
            <label key={c.key} className="comparison">
              <input
                type="checkbox"
                checked={shown}
                onChange={(e) => set({ brackets: { ...(plot.brackets ?? {}), [c.key]: e.target.checked } })}
              />
              <span className="comparison-name">{c.label}</span>
              <span className="muted">p {c.pText.startsWith("<") ? c.pText : `= ${c.pText}`}</span>
              <span className="comparison-stars">{c.stars}</span>
            </label>
          );
        })}
      </div>
      {Object.keys(plot.brackets ?? {}).length > 0 && (
        <button className="link" onClick={() => set({ brackets: {} })}>
          Show only the significant ones
        </button>
      )}

      <div className="field-label">Methods sentence</div>
      <p className="methods">{sentence}</p>
      <button className="ghost small" onClick={copy}>
        {copied ? "Copied" : "Copy methods sentence"}
      </button>
      <button className="link" onClick={() => window.morphly.openExternal(LINKS.statistics)}>
        How is this calculated?
      </button>
    </Section>
  );
}

/**
 * Two-way ANOVA and its comparisons. Which pairs are compared and how the
 * p-values are corrected are method choices, so they sit behind Advanced.
 */
function GroupedStats({ element, dataset, analysis, sentence, copied, setCopied }) {
  const updatePlot = useStore((s) => s.updatePlot);
  const [advanced, setAdvanced] = useState(false);
  const plot = element.plot;
  const set = (patch) => updatePlot(element.id, patch);

  if (!analysis || analysis.error) {
    return (
      <Section title="Statistics">
        <p className="hint">{analysis?.error ?? "No data yet."}</p>
      </Section>
    );
  }

  const copy = async () => {
    await window.morphly.writeClipboardText(sentence);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const correction = CORRECTIONS.find(([id]) => id === (plot.correction ?? "sidak"))?.[1] ?? "Šídák";
  const comparing = COMPARISON_SETS.find(([id]) => id === (plot.within ?? "conditions"))?.[1] ?? "";

  return (
    <Section title="Statistics">
      <div className="stats-card">
        <div className="stats-head">
          <strong>Two-way ANOVA</strong>
        </div>
        {analysis.summary.map((row) => (
          <div key={row.name} className="stats-result">
            <span className="muted">{row.name}: </span>
            {row.text}
          </div>
        ))}
        {analysis.warnings.map((w) => (
          <p key={w} className="hint warn-text">
            {w}
          </p>
        ))}
      </div>

      <div className="field-label">
        Comparing: {comparing.toLowerCase()}, {correction} corrected
      </div>
      <div className="comparison-list">
        {analysis.comparisons.map((c) => {
          const shown = plot.brackets?.[c.key] ?? c.p < 0.05;
          return (
            <label key={c.key} className="comparison">
              <input
                type="checkbox"
                checked={shown}
                onChange={(e) => set({ brackets: { ...(plot.brackets ?? {}), [c.key]: e.target.checked } })}
              />
              <span className="comparison-name">{c.label}</span>
              <span className="muted">p {c.pText.startsWith("<") ? c.pText : `= ${c.pText}`}</span>
              <span className="comparison-stars">{c.stars}</span>
            </label>
          );
        })}
      </div>
      <button className="link" onClick={() => setAdvanced(true)}>
        Advanced…
      </button>

      <div className="field-label">Methods sentence</div>
      <p className="methods">{sentence}</p>
      <button className="ghost small" onClick={copy}>
        {copied ? "Copied" : "Copy methods sentence"}
      </button>
      <button className="link" onClick={() => window.morphly.openExternal(LINKS.statistics)}>
        How is this calculated?
      </button>

      {advanced && (
        <AdvancedDialog
          title="Advanced statistics"
          onClose={() => setAdvanced(false)}
          onReset={() => set({ within: "conditions", correction: "sidak", control: 0, brackets: {} })}
        >
          <label className="field">
            <span>Compare</span>
            <select value={plot.within ?? "conditions"} onChange={(e) => set({ within: e.target.value, brackets: {} })}>
              {COMPARISON_SETS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {(plot.within ?? "conditions") === "control" && (
            <label className="field">
              <span>Compare every condition with</span>
              <select value={plot.control ?? 0} onChange={(e) => set({ control: Number(e.target.value), brackets: {} })}>
                {dataset.columns.slice(1).map((c, i) => (
                  <option key={c.name} value={i}>
                    {c.name || `Condition ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Correct the p-values by</span>
            <select value={plot.correction ?? "sidak"} onChange={(e) => set({ correction: e.target.value })}>
              {CORRECTIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            Comparisons use the pooled spread from the ANOVA above, so they agree with it. Šídák is the usual choice for a
            handful of planned comparisons; Tukey suits comparing everything with everything; Holm and Bonferroni are more
            cautious. None leaves the p-values as they came, which is only honest when a single comparison was planned in
            advance.
          </p>
        </AdvancedDialog>
      )}
    </Section>
  );
}

function XyStats({ analysis }) {
  if (!analysis?.series?.length) return null;
  return (
    <Section title="Statistics">
      {analysis.series.map((s) => (
        <div key={s.col} className="stats-card">
          <strong>{s.name}</strong>
          {s.error ? (
            <p className="hint">{s.error}</p>
          ) : (
            <>
              <div className="stats-result">
                Slope {formatStat(s.regression.slope)}, R² = {s.regression.r2.toFixed(3)}, p{" "}
                {s.regression.p < 0.0001 ? "< 0.0001" : `= ${formatP(s.regression.p)}`}
              </div>
              <div className="hint">
                Y = {formatStat(s.regression.slope)} X {s.regression.intercept < 0 ? "-" : "+"} {formatStat(Math.abs(s.regression.intercept))}. Pearson r ={" "}
                {s.pearson.r.toFixed(3)}; Spearman ρ = {s.spearman.rho.toFixed(3)}; n = {s.n}.
              </div>
            </>
          )}
        </div>
      ))}
    </Section>
  );
}
