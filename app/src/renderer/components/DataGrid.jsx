/**
 * A table of numbers to type into, like the data sheet in Prism.
 *
 * Shared by the drawer under the canvas and the separate data window, which is
 * why it knows nothing about the store: it shows a dataset and reports every
 * change as an operation (lib/datasets.js applyDatasetOp) through `onOp`.
 *
 * Typing reports each keystroke, so the graph redraws as you type, but only
 * the first keystroke in a cell asks for an undo step (`commit`), so undo
 * takes back a whole value rather than one character.
 *
 * Pasting a block copied from a spreadsheet fills cells to the right and
 * below, adding columns and rows as needed. Enter and the up and down arrows
 * move between rows, as in a spreadsheet.
 */

import React, { useRef } from "react";
import { rowCount, parseTable, isNumeric, DATASET_KINDS } from "../lib/datasets";
import { columnSummaries } from "../lib/analysis";

/** Always a few empty rows below the data, so there is somewhere to type. */
const SPARE_ROWS = 3;

const fmt = (v) => (Number.isFinite(v) ? Number(v.toPrecision(4)).toString() : "");

export default function DataGrid({ dataset, onOp, colours = [] }) {
  const tableRef = useRef(null);
  // The cell being typed into, so only its first keystroke makes an undo step.
  const editing = useRef(null);

  const rows = rowCount(dataset) + SPARE_ROWS;
  const summaries = columnSummaries(dataset);
  const xy = dataset.kind === "xy";

  const focusCell = (row, col) => {
    const input = tableRef.current?.querySelector(`input[data-row="${row}"][data-col="${col}"]`);
    if (input) {
      input.focus();
      input.select();
    }
  };

  const setCell = (row, col, value) => {
    const key = `${row}:${col}`;
    const commit = editing.current !== key;
    editing.current = key;
    onOp({ op: "setCell", row, col, value }, { commit });
  };

  const onPaste = (e, row, col) => {
    const text = e.clipboardData.getData("text/plain");
    // A single value pastes like typing; a block is spread over the cells.
    if (!/[\t\n\r;]/.test(text.trim())) return;
    e.preventDefault();
    const { rows: cells } = parseTable(text);
    if (cells.length) onOp({ op: "pasteBlock", row, col, cells }, { commit: true });
    editing.current = null;
  };

  const onKeyDown = (e, row, col) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(row + 1, col);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(Math.max(0, row - 1), col);
    }
  };

  return (
    <div className="data-grid-wrap">
      <table className="data-grid" ref={tableRef}>
        <thead>
          <tr>
            <th className="row-head" aria-label="Row" />
            {dataset.columns.map((column, col) => (
              <th key={col}>
                <div className="col-head">
                  {!xy && (
                    <span className="col-swatch" style={{ background: colours[col] ?? "transparent" }} aria-hidden="true" />
                  )}
                  <input
                    className="col-name"
                    value={column.name}
                    aria-label={`Name of column ${col + 1}`}
                    placeholder={xy && col === 0 ? "X" : `${DATASET_KINDS[dataset.kind].first} ${col + 1}`}
                    onFocus={() => (editing.current = null)}
                    onChange={(e) => {
                      const key = `name:${col}`;
                      const commit = editing.current !== key;
                      editing.current = key;
                      onOp({ op: "renameColumn", col, name: e.target.value }, { commit });
                    }}
                  />
                  {dataset.columns.length > 1 && (
                    <button
                      className="icon col-remove"
                      title="Remove this column"
                      aria-label={`Remove column ${column.name || col + 1}`}
                      onClick={() => onOp({ op: "removeColumn", col }, { commit: true })}
                    >
                      ×
                    </button>
                  )}
                </div>
                {xy && <div className="col-role">{col === 0 ? "X" : "Y"}</div>}
              </th>
            ))}
            <th className="add-col">
              <button className="ghost small" onClick={() => onOp({ op: "addColumn" }, { commit: true })}>
                + Column
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              <td className="row-head">{row + 1}</td>
              {dataset.columns.map((column, col) => {
                const value = column.values[row] ?? "";
                const bad = value.trim() !== "" && !isNumeric(value);
                return (
                  <td key={col} className={bad ? "bad" : undefined}>
                    <input
                      className="cell"
                      data-row={row}
                      data-col={col}
                      value={value}
                      inputMode="decimal"
                      aria-label={`${column.name || `Column ${col + 1}`}, row ${row + 1}`}
                      title={bad ? "Not a number, so it is left out of the graph" : undefined}
                      onFocus={() => (editing.current = null)}
                      onChange={(e) => setCell(row, col, e.target.value)}
                      onPaste={(e) => onPaste(e, row, col)}
                      onKeyDown={(e) => onKeyDown(e, row, col)}
                    />
                  </td>
                );
              })}
              <td />
            </tr>
          ))}
        </tbody>
        {!xy && (
          <tfoot>
            {[
              ["Mean", (s) => fmt(s?.mean)],
              ["SD", (s) => fmt(s?.sd)],
              ["n", (s) => String(s?.n ?? 0)],
            ].map(([label, value]) => (
              <tr key={label}>
                <td className="row-head">{label}</td>
                {summaries.map((s, col) => (
                  <td key={col} className="summary">
                    {value(s)}
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  );
}
