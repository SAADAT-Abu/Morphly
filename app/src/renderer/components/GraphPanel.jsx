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
  NORMALITY_TESTS,
  countsMethodsSentence,
  survivalMethodsSentence,
  fitMethodsSentence,
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
  COUNT_KINDS,
  SURVIVAL_KINDS,
} from "../lib/plotRender";
import { MODELS } from "../lib/curveFit";
import { TABLE_KINDS, RESULT_KINDS, SET_KINDS, PALETTE_NAMES } from "../lib/plotRenderBio";
import {
  guessColumns,
  wordColumns,
  HEATMAP_SCALES,
  RESULT_ADJUSTMENTS,
  tableMethodsSentence,
  resultsMethodsSentence,
  setsMethodsSentence,
} from "../lib/tableAnalysis";
import { numericColumns, CORRELATION_METHODS } from "../lib/matrix";
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
/** Graphs that draw no axes, so the axis fields would do nothing. */
const NO_AXES = new Set(["heatmap", "correlation", "venn", "upset"]);
/** Graphs drawn in one colour, whose swatch list is a single entry. */
const ONE_COLOUR = new Set(["roc", "bland", "forest", "upset"]);

/** Which colour swatches a bioinformatics graph offers. */
function bioColourCols(kind, analysis) {
  if (kind === "venn") return (analysis?.sets ?? []).slice(0, 3).map((_, i) => i);
  if (kind === "pca") return (analysis?.groups?.names ?? ["Points"]).map((_, i) => i);
  if (ONE_COLOUR.has(kind)) return [0];
  // A heatmap and a correlation matrix are coloured by a scale, not by column.
  return [];
}

function bioColourName(kind, analysis, col) {
  if (kind === "venn") return analysis?.sets?.[col]?.name;
  if (kind === "pca") return analysis?.groups?.names?.[col] ?? "Points";
  return "Graph";
}

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
  const counts = dataset.kind === "contingency";
  const survival = dataset.kind === "survival";
  const table = dataset.kind === "table";
  const results = dataset.kind === "results";
  const sets = dataset.kind === "sets";
  // The graphs built for bioinformatics share a panel of their own, since
  // their settings are about which column means what rather than about bars.
  const bio = table || results || sets;
  const kinds = xy
    ? XY_KINDS
    : grouped
    ? GROUPED_KINDS
    : counts
    ? COUNT_KINDS
    : survival
    ? SURVIVAL_KINDS
    : table
    ? TABLE_KINDS
    : results
    ? RESULT_KINDS
    : sets
    ? SET_KINDS
    : GROUP_KINDS;
  const kind = kinds.some(([id]) => id === plot.kind) ? plot.kind : kinds[0][0];
  const sameKind = datasets.filter((d) => d.kind === dataset.kind);
  // Survival draws one curve per group in the data, not one per column, so its
  // swatches are named after the groups the analysis found.
  const colourCols = survival
    ? (analysis?.groups ?? []).map((_, i) => i)
    : bio
    ? bioColourCols(kind, analysis)
    : xy || grouped || counts
    ? dataset.columns.map((_, i) => i).slice(1)
    : plottedGroups(dataset);
  const colourName = (col) =>
    (survival
      ? analysis?.groups?.[col]?.name
      : bio
      ? bioColourName(kind, analysis, col)
      : dataset.columns[col]?.name) || `Column ${col + 1}`;
  const palette = kind === "venn" ? GROUP_COLOURS : xy || survival || bio ? SERIES_COLOURS : GROUP_COLOURS;
  const colourOf = (col) => plot.colors?.[col] || palette[col % palette.length];

  const setColour = (col, value) => {
    const colors = [...(plot.colors ?? [])];
    colors[col] = value;
    set({ colors });
  };

  const sentence =
    !analysis || analysis.error
      ? ""
      : table
      ? tableMethodsSentence(analysis, { version: VERSION })
      : results
      ? resultsMethodsSentence(analysis, { version: VERSION })
      : sets
      ? setsMethodsSentence(analysis, { version: VERSION })
      : xy
      ? fitMethodsSentence(analysis, plot.fitModel ?? "none", { version: VERSION })
      : survival
      ? survivalMethodsSentence(analysis, { version: VERSION })
      : counts
      ? countsMethodsSentence(analysis, { version: VERSION })
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
        {bio && <BioOptions element={element} dataset={dataset} analysis={analysis} kind={kind} />}
        {!xy && !counts && !survival && !bio && HAS_ERROR_BARS.has(kind) && (
          <>
            <div className="field-label">Error bars</div>
            <Segments label="Error bars" options={ERRORS} value={plot.error} onChange={(id) => set({ error: id })} />
          </>
        )}
        {survival && (
          <label className="check">
            <input type="checkbox" checked={plot.points !== false} onChange={(e) => set({ points: e.target.checked })} />
            Mark censored subjects with a tick
          </label>
        )}
        {!xy && !counts && !survival && !bio && HAS_POINTS.has(kind) && (
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
          <>
            <label className="field">
              <span>Fitted curve</span>
              <select value={plot.fitModel ?? "none"} onChange={(e) => set({ fitModel: e.target.value, fit: e.target.value === "linear" })}>
                <option value="none">None</option>
                <option value="linear">Straight line</option>
                {Object.entries(MODELS).map(([id, model]) => (
                  <option key={id} value={id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
            {(plot.fitModel ?? "none") !== "none" && (plot.fitModel ?? "none") !== "linear" && (
              <label className="check">
                <input type="checkbox" checked={plot.band !== false} onChange={(e) => set({ band: e.target.checked })} />
                Show the 95% confidence band
              </label>
            )}
          </>
        )}
      </Section>

      <Section title={NO_AXES.has(kind) || ROUND_KINDS.has(kind) ? "Text" : "Axes and text"}>
        {!ROUND_KINDS.has(kind) && !NO_AXES.has(kind) && (
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
              <input type="color" value={colourOf(col)} onChange={(e) => setColour(col, e.target.value)} aria-label={`Colour of ${colourName(col)}`} />
              <span className="swatch-hex">{colourName(col)}</span>
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

      {survival && (
        <SurvivalStats element={element} analysis={analysis} sentence={sentence} copied={copied} setCopied={setCopied} />
      )}
      {counts && <CountStats element={element} analysis={analysis} sentence={sentence} copied={copied} setCopied={setCopied} />}
      {grouped && <GroupedStats element={element} dataset={dataset} analysis={analysis} sentence={sentence} copied={copied} setCopied={setCopied} />}
      {bio && <BioStats element={element} analysis={analysis} sentence={sentence} copied={copied} setCopied={setCopied} />}
      {!xy && !grouped && !counts && !survival && !bio && (
        <GroupStats element={element} dataset={dataset} analysis={analysis} sentence={sentence} copied={copied} setCopied={setCopied} />
      )}
      {xy && !bio && <XyStats analysis={analysis} sentence={sentence} copied={copied} setCopied={setCopied} />}
    </>
  );
}

function GroupStats({ element, dataset, analysis, sentence, copied, setCopied }) {
  const updatePlot = useStore((s) => s.updatePlot);
  const [advanced, setAdvanced] = useState(false);
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
        {analysis.effect && <div className="hint">{analysis.effect}</div>}
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
          onReset={() => set({ normality: "shapiro", control: 0, test: "auto", brackets: {} })}
        >
          <label className="field">
            <span>Check normality with</span>
            <select value={plot.normality ?? "shapiro"} onChange={(e) => set({ normality: e.target.value })}>
              {NORMALITY_TESTS.map(([id, label, smallest]) => (
                <option key={id} value={id}>
                  {label} (needs {smallest} or more values)
                </option>
              ))}
            </select>
          </label>
          {analysis.groups.length > 2 && (
            <label className="field">
              <span>Control group, for Dunnett's test</span>
              <select value={plot.control ?? 0} onChange={(e) => set({ control: Number(e.target.value) })}>
                {analysis.groups.map((col, i) => (
                  <option key={col} value={i}>
                    {dataset.columns[col]?.name || `Group ${col + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="hint">
            Normality decides whether Morphly suggests a t test or ANOVA, or their rank based counterparts. It is only
            checked when every group holds five values or more: below that the test says almost nothing, so normality is
            assumed instead. Dunnett's test compares every group with the control only, which is the right comparison when
            that is the question, and costs less than comparing everything with everything.
          </p>
        </AdvancedDialog>
      )}
    </Section>
  );
}

/** A table of counts: which test, the result, and what it means. */
function CountStats({ element, analysis, sentence, copied, setCopied }) {
  const updatePlot = useStore((s) => s.updatePlot);
  const plot = element.plot;
  const set = (patch) => updatePlot(element.id, patch);

  if (!analysis || analysis.error) {
    return (
      <Section title="Statistics">
        <p className="hint">{analysis?.error ?? "No counts yet."}</p>
      </Section>
    );
  }

  const copy = async () => {
    await window.morphly.writeClipboardText(sentence);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Section title="Statistics">
      <label className="field">
        <span>Test</span>
        <select value={plot.test && plot.test !== "auto" ? plot.test : "auto"} onChange={(e) => set({ test: e.target.value })}>
          <option value="auto">Suggested: {analysis.available.find((t) => t.id === analysis.suggested)?.label}</option>
          {analysis.available.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="stats-card">
        <div className="stats-head">
          <strong>{analysis.label}</strong>
          {analysis.test === analysis.suggested && <span className="pill suggested">Suggested</span>}
        </div>
        <div className="stats-result">{analysis.summary}</div>
        {analysis.extra.map((line) => (
          <div key={line} className="hint">
            {line}
          </div>
        ))}
        {analysis.warnings.map((w) => (
          <p key={w} className="hint warn-text">
            {w}
          </p>
        ))}
      </div>
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

/**
 * Kaplan-Meier curves: which test compares them, and what it found.
 */
function SurvivalStats({ element, analysis, sentence, copied, setCopied }) {
  const updatePlot = useStore((s) => s.updatePlot);
  const plot = element.plot;

  if (!analysis || analysis.error) {
    return (
      <Section title="Statistics">
        <p className="hint">{analysis?.error ?? "No survival data yet."}</p>
      </Section>
    );
  }

  const copy = async () => {
    await window.morphly.writeClipboardText(sentence);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Section title="Statistics">
      {analysis.comparison && (
        <label className="field">
          <span>Compare curves with</span>
          <select value={plot.test ?? "logrank"} onChange={(e) => updatePlot(element.id, { test: e.target.value })}>
            <option value="logrank">Log-rank (Mantel-Cox)</option>
            <option value="gehan">Gehan-Breslow-Wilcoxon</option>
          </select>
        </label>
      )}
      <div className="stats-card">
        <strong>{analysis.label}</strong>
        <div className="stats-result">{analysis.summary}</div>
        {analysis.extra.map((line) => (
          <div key={line} className="hint">
            {line}
          </div>
        ))}
        {analysis.warnings.map((warning) => (
          <p key={warning} className="hint">
            {warning}
          </p>
        ))}
      </div>
      {analysis.comparison && (
        <p className="hint">
          The log-rank test weighs every time equally, which is what most papers report. Gehan-Breslow-Wilcoxon weighs
          early times more heavily, which suits curves that separate early and then come back together.
        </p>
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

/** One fitted curve, written out with its parameters and their intervals. */
function FitResult({ fit }) {
  if (!fit) return null;
  if (fit.error) return <p className="hint">{fit.error}</p>;
  const headline = fit.names.indexOf(MODELS[fit.model]?.key ?? "");
  return (
    <>
      {headline >= 0 && (
        <div className="stats-result">
          {fit.names[headline]} = {formatStat(fit.parameters[headline])} (95% CI{" "}
          {formatStat(fit.intervals[headline][0])} to {formatStat(fit.intervals[headline][1])})
        </div>
      )}
      {fit.names.map((name, i) => (
        <div key={name} className="hint">
          {name} = {formatStat(fit.parameters[i])} ± {formatStat(fit.errors[i])} (95% CI {formatStat(fit.intervals[i][0])}{" "}
          to {formatStat(fit.intervals[i][1])})
        </div>
      ))}
      {Object.entries(fit.derived ?? {}).map(([name, value]) => (
        <div key={name} className="hint">
          {name} = {formatStat(value)}
        </div>
      ))}
      <div className="hint">
        R² = {fit.r2.toFixed(4)}, from {fit.n} points.
      </div>
    </>
  );
}

function XyStats({ analysis, sentence, copied, setCopied }) {
  if (!analysis?.series?.length) return null;
  const copy = async () => {
    await window.morphly.writeClipboardText(sentence);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Section title="Statistics">
      {analysis.series.map((s) => (
        <div key={s.col} className="stats-card">
          <strong>{s.name}</strong>
          {s.error ? (
            <p className="hint">{s.error}</p>
          ) : s.fit ? (
            <FitResult fit={s.fit} />
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
      {sentence && (
        <>
          <div className="field-label">Methods sentence</div>
          <p className="methods">{sentence}</p>
          <button className="ghost small" onClick={copy}>
            {copied ? "Copied" : "Copy methods sentence"}
          </button>
          <button className="link" onClick={() => window.morphly.openExternal(LINKS.statistics)}>
            How is this calculated?
          </button>
        </>
      )}
    </Section>
  );
}

/** A drop-down that picks one column of the data, with "None" when allowed. */
function ColumnPicker({ dataset, label, columns, value, onChange, allowNone = false, hint = null }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        title={hint ?? undefined}
      >
        {allowNone && <option value="">None</option>}
        {columns.map((col) => (
          <option key={col} value={col}>
            {dataset.columns[col]?.name || `Column ${col + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The settings for a heatmap, volcano, PCA and the rest.
 *
 * Which column holds the fold change, and which the p value, is the whole
 * question for these graphs, so the guesses Morphly made are shown as the
 * chosen values rather than hidden: every drop-down starts on what is being
 * used, and changing it changes the figure.
 */
function BioOptions({ element, dataset, analysis, kind }) {
  const updatePlot = useStore((s) => s.updatePlot);
  const plot = element.plot;
  const set = (patch) => updatePlot(element.id, patch);
  const guess = useMemo(() => guessColumns(dataset), [dataset]);
  const numbers = guess.numeric;
  const words = guess.words;
  const check = (field, text, fallback = true) => (
    <label className="check">
      <input
        type="checkbox"
        checked={fallback ? plot[field] !== false : Boolean(plot[field])}
        onChange={(e) => set({ [field]: e.target.checked })}
      />
      {text}
    </label>
  );

  if (kind === "heatmap") {
    return (
      <>
        <label className="field">
          <span>Show each row as</span>
          <select value={plot.scaleRows ?? "row"} onChange={(e) => set({ scaleRows: e.target.value })}>
            {HEATMAP_SCALES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {check("clusterRows", "Order the rows by how alike they are")}
        {check("clusterColumns", "Order the columns the same way")}
        {check("rowNames", "Write the row names")}
        {check("key", "Show the colour key")}
      </>
    );
  }

  if (kind === "correlation") {
    return (
      <>
        <label className="field">
          <span>Correlation</span>
          <select value={plot.corrMethod ?? "pearson"} onChange={(e) => set({ corrMethod: e.target.value })}>
            {CORRELATION_METHODS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {check("showValues", "Write the numbers in the squares")}
        <p className="hint">Pearson looks for a straight line; Spearman only for an order, which suits a skewed column.</p>
      </>
    );
  }

  if (kind === "pca") {
    return (
      <>
        <ColumnPicker
          dataset={dataset}
          label="Colour the points by"
          columns={words}
          value={plot.groupCol ?? guess.words[0] ?? null}
          onChange={(col) => set({ groupCol: col })}
          allowNone
        />
        {check("pcaScale", "Give every column the same weight")}
        {check("pointNames", "Name each point", false)}
        <p className="hint">
          Each row is a point. Giving every column the same weight is usually right when the columns are measured in
          different units.
        </p>
      </>
    );
  }

  if (kind === "roc") {
    const classCol = plot.classCol ?? guess.words[0] ?? null;
    const levels = analysis?.levels ?? [];
    return (
      <>
        <ColumnPicker
          dataset={dataset}
          label="Score"
          columns={numbers}
          value={plot.scoreCol ?? numbers[0] ?? null}
          onChange={(col) => set({ scoreCol: col })}
        />
        <ColumnPicker
          dataset={dataset}
          label="True class"
          columns={words.length ? words : numbers}
          value={classCol}
          onChange={(col) => set({ classCol: col, positive: null })}
        />
        {levels.length > 1 && (
          <label className="field">
            <span>Counts as positive</span>
            <select value={analysis?.positive ?? ""} onChange={(e) => set({ positive: e.target.value })}>
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        )}
        {check("markBest", "Mark the best cut")}
        {check("fillArea", "Shade the area under the curve")}
        {check("showAuc", "Write the area on the graph")}
      </>
    );
  }

  if (kind === "bland") {
    return (
      <>
        <ColumnPicker
          dataset={dataset}
          label="First method"
          columns={numbers}
          value={plot.methodA ?? numbers[0] ?? null}
          onChange={(col) => set({ methodA: col })}
        />
        <ColumnPicker
          dataset={dataset}
          label="Second method"
          columns={numbers}
          value={plot.methodB ?? numbers.find((c) => c !== (plot.methodA ?? numbers[0])) ?? null}
          onChange={(col) => set({ methodB: col })}
        />
        <p className="hint">Both columns should measure the same thing on the same subjects, one row each.</p>
      </>
    );
  }

  if (kind === "volcano" || kind === "ma") {
    return (
      <>
        <ColumnPicker
          dataset={dataset}
          label="Effect (log2 fold change)"
          columns={numbers}
          value={plot.effectCol ?? guess.effect}
          onChange={(col) => set({ effectCol: col })}
        />
        {kind === "ma" && (
          <ColumnPicker
            dataset={dataset}
            label="Mean expression"
            columns={numbers}
            value={plot.meanCol ?? guess.mean}
            onChange={(col) => set({ meanCol: col })}
            allowNone
          />
        )}
        <ColumnPicker
          dataset={dataset}
          label="p value"
          columns={numbers}
          value={plot.pCol ?? guess.p}
          onChange={(col) => set({ pCol: col })}
          allowNone
        />
        <label className="field">
          <span>Correct for multiple testing</span>
          <select value={analysis?.adjust ?? "bh"} onChange={(e) => set({ adjust: e.target.value })}>
            {RESULT_ADJUSTMENTS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="field-grid">
          <label className="field">
            <span>Fold change at least</span>
            <input
              type="number"
              step="0.1"
              value={plot.fcCutoff ?? 1}
              onChange={(e) => set({ fcCutoff: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>p at most</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={plot.pCutoff ?? 0.05}
              onChange={(e) => set({ pCutoff: Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="field">
          <span>Name the top</span>
          <input
            type="number"
            min="0"
            max="200"
            value={plot.labelTop ?? 10}
            onChange={(e) => set({ labelTop: Number(e.target.value) })}
          />
        </label>
      </>
    );
  }

  if (kind === "forest") {
    return (
      <>
        <ColumnPicker
          dataset={dataset}
          label="Effect"
          columns={numbers}
          value={plot.effectCol ?? guess.effect}
          onChange={(col) => set({ effectCol: col })}
        />
        <ColumnPicker
          dataset={dataset}
          label="Interval, lower"
          columns={numbers}
          value={plot.lowCol ?? guess.low}
          onChange={(col) => set({ lowCol: col })}
          allowNone
        />
        <ColumnPicker
          dataset={dataset}
          label="Interval, upper"
          columns={numbers}
          value={plot.highCol ?? guess.high}
          onChange={(col) => set({ highCol: col })}
          allowNone
        />
        <ColumnPicker
          dataset={dataset}
          label="Standard error"
          columns={numbers}
          value={plot.seCol ?? guess.se}
          onChange={(col) => set({ seCol: col })}
          allowNone
        />
        <label className="field">
          <span>Line of no effect at</span>
          <input
            type="number"
            step="0.5"
            value={plot.reference ?? 0}
            onChange={(e) => set({ reference: Number(e.target.value) })}
          />
        </label>
        <p className="hint">
          Two interval columns are used when there are two; otherwise the interval is the effect plus and minus 1.96
          standard errors. A ratio belongs on a line of no effect at 1.
        </p>
      </>
    );
  }

  if (kind === "upset") {
    return (
      <>
        <label className="field">
          <span>Count each name</span>
          <select value={plot.setMode ?? "exclusive"} onChange={(e) => set({ setMode: e.target.value })}>
            <option value="exclusive">Once, in the lists it is in</option>
            <option value="inclusive">In every overlap it belongs to</option>
          </select>
        </label>
        <label className="field">
          <span>Show at most</span>
          <input
            type="number"
            min="1"
            max="60"
            value={plot.setLimit ?? 20}
            onChange={(e) => set({ setLimit: Number(e.target.value) })}
          />
        </label>
        {check("showValues", "Write the size above each bar")}
      </>
    );
  }

  return null;
}

/** The numbers beside a heatmap, volcano, ROC curve and the rest. */
function BioStats({ element, analysis, sentence, copied, setCopied }) {
  const updatePlot = useStore((s) => s.updatePlot);
  const plot = element.plot;

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

  return (
    <Section title="Statistics">
      {analysis.kind === "sets" && (
        <label className="field">
          <span>Things tested in all</span>
          <input
            inputMode="decimal"
            placeholder="For example: 20000 genes"
            value={plot.background ?? ""}
            onChange={(e) => updatePlot(element.id, { background: e.target.value })}
          />
        </label>
      )}
      <div className="stats-card">
        <strong>{analysis.label}</strong>
        <div className="stats-result">{analysis.summary}</div>
        {analysis.extra && <div className="hint">{analysis.extra}</div>}
        {(analysis.warnings ?? []).map((warning) => (
          <p key={warning} className="hint">
            {warning}
          </p>
        ))}
      </div>
      {analysis.kind === "results" && analysis.plot !== "forest" && (
        <p className="hint">
          Red and blue mark what passed both cuts; grey is everything else. A volcano drawn on uncorrected p values
          overstates what was found, so the correction is on unless you turn it off.
        </p>
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
