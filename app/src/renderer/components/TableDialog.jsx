/**
 * "Insert > Table" dialog.
 *
 * The size picker is a hoverable grid, the way it works in a word processor,
 * because picking "4 by 3" by pointing is faster than typing two numbers. The
 * numeric fields stay for tables larger than the grid can show.
 */

import React, { useState } from "react";

const GRID_ROWS = 8;
const GRID_COLS = 8;

export default function TableDialog({ onClose, onInsert }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [headerRow, setHeaderRow] = useState(true);
  const [hover, setHover] = useState(null);

  const shownRows = hover?.rows ?? rows;
  const shownCols = hover?.cols ?? cols;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal table-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Insert table</h2>

        <div
          className="table-picker"
          onMouseLeave={() => setHover(null)}
          style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 16px)` }}
        >
          {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
            const r = Math.floor(i / GRID_COLS) + 1;
            const c = (i % GRID_COLS) + 1;
            const on = r <= shownRows && c <= shownCols;
            return (
              <button
                key={i}
                type="button"
                className={`picker-cell${on ? " on" : ""}`}
                aria-label={`${r} by ${c}`}
                onMouseEnter={() => setHover({ rows: r, cols: c })}
                onClick={() => {
                  setRows(r);
                  setCols(c);
                  setHover(null);
                }}
              />
            );
          })}
        </div>

        <p className="hint">
          {shownRows} {shownRows === 1 ? "row" : "rows"} by {shownCols}{" "}
          {shownCols === 1 ? "column" : "columns"}
          {headerRow ? ", first row as a header" : ""}. Every size can be changed
          afterwards in the properties panel.
        </p>

        <div className="field-grid">
          <label className="field">
            <span>Rows</span>
            <input
              type="number"
              min="1"
              max="60"
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
            />
          </label>
          <label className="field">
            <span>Columns</span>
            <input
              type="number"
              min="1"
              max="30"
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            />
          </label>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={headerRow}
            onChange={(e) => setHeaderRow(e.target.checked)}
          />
          Style the first row as a header
        </label>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => onInsert({ rows, cols, headerRow })}>
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
