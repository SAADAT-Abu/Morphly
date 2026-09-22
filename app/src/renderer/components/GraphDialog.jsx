/**
 * Insert > Graph: three short steps.
 *
 *   1. What does your data look like?  The shape decides which graphs and
 *      tests make sense, as Prism's table types do, but in plain words.
 *   2. Your data.  Sample data, pasted cells, a CSV file, an empty table, or
 *      data already in this figure. Pasted and imported tables show how
 *      Morphly read them (separator, decimal mark, numbers per column), so a
 *      column read wrongly is caught before the graph is drawn.
 *   3. Which graph.  Small previews drawn from your own numbers, and where to
 *      put it: filling the selected panel, or the middle of the page.
 */

import React, { useMemo, useState } from "react";
import {
  sampleDataset,
  blankDataset,
  parseTable,
  datasetFromRows,
  describeColumns,
  delimiterName,
  rowCount,
  columnNumbers,
} from "../lib/datasets";
import {
  renderPlotSvg,
  defaultPlot,
  GROUP_KINDS,
  GROUPED_KINDS,
  COUNT_KINDS,
  SURVIVAL_KINDS,
  XY_KINDS,
} from "../lib/plotRender";
import { graphSvg } from "../lib/graphs";
import { toDataUrl } from "../lib/svgPalette";

const SHAPES = [
  {
    id: "groups",
    title: "Groups",
    text: "One way of grouping, such as control against treated. Each column is a group.",
    example: "Control  Drug A  Drug B\n  98       84      64\n 101       78      58",
  },
  {
    id: "xy",
    title: "X and Y",
    text: "Every point has an X and a Y: dose and response, or a time course. The first column is X.",
    example: "Time  Wild type  Mutant\n  0     0.05      0.05\n  4     0.09      0.07",
  },
  {
    id: "grouped",
    title: "Groups by condition",
    text: "Two ways of grouping at once. The first column names each row's group; every other column is a condition.",
    example: "Genotype  Vehicle  LPS\nWild type   11.4    48.2\nKnockout    12.0    24.1",
  },
  {
    id: "contingency",
    title: "Counts in categories",
    text: "How many fell into each category, such as responders and non-responders in each arm. One count per cell.",
    example: "Treatment  Responded  Did not\nDrug           9          3\nPlacebo        2         10",
  },
  {
    id: "survival",
    title: "Survival",
    text: "Time to an event, with censored subjects, for Kaplan-Meier curves. One row per subject: the time, 1 for the event or 0 if censored, and the group.",
    example: "Time  Event  Group\n  12     1    Drug\n  30     0    Control",
  },
];

const SOURCES = [
  ["existing", "Already in this figure"],
  ["sample", "Sample data"],
  ["paste", "Paste"],
  ["csv", "Import CSV"],
  ["blank", "Empty table"],
];

const SOURCE_HINTS = {
  sample: "Numbers to try things with. Replace them with yours at any time.",
  paste: "Copy cells in Excel, LibreOffice, R or Python, and paste them here. A first row of names is used as column names.",
  csv: "A CSV or TSV file. Semicolons and decimal commas are fine.",
  blank: "An empty table opens under the canvas, and the graph fills in as you type.",
  existing:
    "Data already imported or typed into this figure, including anything from the Data tab. Several graphs can share one table and stay in step.",
};

function Preview({ kind, dataset }) {
  const url = useMemo(() => {
    const hasNumbers = dataset.columns.some((_, i) => columnNumbers(dataset, i).length > 0);
    const data = hasNumbers ? dataset : sampleDataset(dataset.kind);
    const element = { width: 220, height: 160, plot: { ...defaultPlot(kind, { fontSize: 11 }) } };
    // Survival curves need their analysis to be drawn at all, so previews go
    // through the same path the canvas uses.
    return toDataUrl(data.kind === "survival" ? graphSvg(element, data) : renderPlotSvg(element, data));
  }, [kind, dataset]);
  return <img src={url} alt="" width={220} height={160} />;
}

/**
 * Which source to start on: data already in the figure when there is some of
 * the right shape, so a table imported in the Data tab is one click away
 * rather than needing a second import.
 */
export function initialSource(datasets, shape) {
  return datasets.some((d) => d.kind === shape) ? "existing" : "sample";
}

export default function GraphDialog({ datasets = [], panelLabel = null, onClose, onInsert, flash }) {
  const [step, setStep] = useState(0);
  const [shape, setShape] = useState("groups");
  // Data already in the figure is offered first, and chosen to begin with, so
  // a table imported in the Data tab does not have to be imported again here.
  const [source, setSource] = useState(() => initialSource(datasets, "groups"));
  const [pasted, setPasted] = useState("");
  const [imported, setImported] = useState(null); // { text, name }
  const [existingId, setExistingId] = useState(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("bar");
  const [place, setPlace] = useState(panelLabel ? "panel" : "middle");

  const sameShape = datasets.filter((d) => d.kind === shape);
  const sources = SOURCES.filter(([id]) => id !== "existing" || sameShape.length > 0);

  // What the chosen source gives, worked out afresh as it changes.
  const { dataset, reading } = useMemo(() => {
    if (source === "sample") return { dataset: sampleDataset(shape), reading: null };
    if (source === "blank") return { dataset: blankDataset(shape), reading: null };
    if (source === "existing") {
      return { dataset: sameShape.find((d) => d.id === existingId) ?? sameShape[0] ?? null, reading: null };
    }
    const text = source === "paste" ? pasted : imported?.text ?? "";
    if (!text.trim()) return { dataset: null, reading: null };
    const table = parseTable(text);
    const ds = datasetFromRows(table.rows, {
      kind: shape,
      name: source === "csv" ? imported?.name ?? "Imported data" : "Pasted data",
    });
    return { dataset: ds, reading: table };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, shape, pasted, imported, existingId, datasets]);

  const kinds =
    shape === "xy"
      ? XY_KINDS
      : shape === "grouped"
      ? GROUPED_KINDS
      : shape === "contingency"
      ? COUNT_KINDS
      : shape === "survival"
      ? SURVIVAL_KINDS
      : GROUP_KINDS;
  const shapeOk = !SHAPES.find((s) => s.id === shape)?.later;

  const chooseShape = (id) => {
    setShape(id);
    setKind(id === "xy" ? "scatter" : "bar");
    // Keep the source sensible for the new shape.
    const fits = initialSource(datasets, id);
    if (source === "existing" || source === "sample") setSource(fits);
  };

  const importCsv = async () => {
    const res = await window.morphly.importTable();
    if (res.canceled) return;
    if (!res.ok) {
      flash?.(`Could not import the table: ${res.error}`);
      return;
    }
    setImported({ text: res.text, name: res.name });
  };

  const finish = () => {
    if (!dataset) return;
    const reuse = source === "existing";
    const finalName = name.trim() || dataset.name;
    onInsert({
      dataset: reuse ? null : { ...dataset, name: finalName },
      datasetId: reuse ? dataset.id : null,
      kind,
      place,
    });
  };

  const columns = dataset ? describeColumns(dataset) : [];
  const previewRows = dataset ? Math.min(5, rowCount(dataset)) : 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal graph-modal" role="dialog" aria-label="New graph" onMouseDown={(e) => e.stopPropagation()}>
        <div className="graph-modal-head">
          <h2>New graph</h2>
          <ol className="steps">
            {["Data shape", "Your data", "Graph type"].map((label, i) => (
              <li key={label} className={i === step ? "current" : i < step ? "done" : undefined}>
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        </div>

        {step === 0 && (
          <div className="graph-step">
            <p className="step-question">What does your data look like?</p>
            <div className="shape-grid">
              {SHAPES.map((s) => (
                <button
                  key={s.id}
                  className={`shape-card${shape === s.id ? " active" : ""}`}
                  disabled={s.later}
                  onClick={() => chooseShape(s.id)}
                >
                  <span className="shape-title">
                    {s.title}
                    {s.later && <span className="pill later">Later</span>}
                  </span>
                  <span className="shape-text">{s.text}</span>
                  <pre className="shape-example">{s.example}</pre>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="graph-step data-step">
            <div className="data-step-main">
              <div className="source-tabs" role="tablist">
                {sources.map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={source === id} className={source === id ? "active" : undefined} onClick={() => setSource(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="hint">{SOURCE_HINTS[source]}</p>

              {source === "paste" && (
                <textarea
                  className="paste-box"
                  autoFocus
                  value={pasted}
                  placeholder="Paste cells here (Ctrl+V)"
                  onChange={(e) => setPasted(e.target.value)}
                />
              )}
              {source === "csv" && (
                <div className="control-row">
                  <button className="ghost" onClick={importCsv}>
                    Choose a file…
                  </button>
                  {imported && <span className="muted">{imported.name}</span>}
                </div>
              )}
              {source === "existing" && (
                <select value={dataset?.id ?? ""} onChange={(e) => setExistingId(e.target.value)} aria-label="Data in this figure">
                  {sameShape.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name || "Untitled data"}
                    </option>
                  ))}
                </select>
              )}

              {dataset && source !== "existing" && (
                <label className="field">
                  <span>Name</span>
                  <input value={name} placeholder={dataset.name} onChange={(e) => setName(e.target.value)} />
                </label>
              )}

              {dataset && previewRows > 0 && (
                <div className="table-preview">
                  <table>
                    <thead>
                      <tr>
                        {dataset.columns.slice(0, 8).map((c, i) => (
                          <th key={i}>{c.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: previewRows }, (_, r) => (
                        <tr key={r}>
                          {dataset.columns.slice(0, 8).map((c, i) => (
                            <td key={i}>{c.values[r]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rowCount(dataset) > previewRows && <p className="hint">and {rowCount(dataset) - previewRows} more rows</p>}
                </div>
              )}
            </div>

            {dataset && source !== "blank" && (
              <aside className="read-panel">
                <strong>How Morphly read it</strong>
                {columns.slice(0, 10).map((c, i) => {
                  // A grouped table's first column holds names, so counting
                  // numbers in it would report every one of them as a fault.
                  const names =
                    ((shape === "grouped" || shape === "contingency") && i === 0) || (shape === "survival" && i === 2);
                  const ok = names ? c.other > 0 : c.numbers > 0;
                  return (
                    <div key={i} className={`read-row${ok ? "" : " warn"}`}>
                      <span className="read-mark">{ok ? "✓" : "!"}</span>
                      <span className="read-name">{c.name || `Column ${i + 1}`}</span>
                      <span className="muted">
                        {names
                          ? `${c.other} ${c.other === 1 ? "name" : "names"}`
                          : `${c.numbers} ${c.numbers === 1 ? "number" : "numbers"}${c.other ? `, ${c.other} not` : ""}`}
                      </span>
                    </div>
                  );
                })}
                {columns.length > 10 && <p className="hint">and {columns.length - 10} more columns</p>}
                {reading && (
                  <>
                    <div className="read-sep" />
                    <div className="read-row">
                      <span className="muted">Columns split by</span>
                      <span>{delimiterName(reading.delimiter)}</span>
                    </div>
                    <div className="read-row">
                      <span className="muted">Decimal mark</span>
                      <span>{reading.decimal === "," ? "comma" : "point"}</span>
                    </div>
                  </>
                )}
                {shape === "xy" && <p className="hint">The first column is X; every other column is a Y series.</p>}
                {shape === "grouped" && (
                  <p className="hint">The first column names each row's group; every other column is a condition.</p>
                )}
                {shape === "contingency" && (
                  <p className="hint">The first column names each row; every other column is a category, holding a count.</p>
                )}
                {shape === "survival" && (
                  <p className="hint">Three columns: the time, whether the event happened (1) or the subject was censored (0), and the group.</p>
                )}
              </aside>
            )}
          </div>
        )}

        {step === 2 && dataset && (
          <div className="graph-step">
            <p className="step-question">Pick a graph. The previews use your numbers.</p>
            <div className="kind-grid">
              {kinds.map(([id, label]) => (
                <button key={id} className={`kind-card${kind === id ? " active" : ""}`} onClick={() => setKind(id)}>
                  <Preview kind={id} dataset={dataset} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            {panelLabel && (
              <>
                <p className="step-question small">Where should it go?</p>
                <div className="source-tabs">
                  <button className={place === "panel" ? "active" : undefined} onClick={() => setPlace("panel")}>
                    Fill panel {panelLabel}
                  </button>
                  <button className={place === "middle" ? "active" : undefined} onClick={() => setPlace("middle")}>
                    Middle of the page
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <span className="spacer" />
          {step > 0 && (
            <button className="ghost" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < 2 ? (
            <button
              className="primary"
              disabled={(step === 0 && !shapeOk) || (step === 1 && !dataset)}
              onClick={() => setStep(step + 1)}
            >
              Next
            </button>
          ) : (
            <button className="primary" onClick={finish}>
              Insert graph
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
