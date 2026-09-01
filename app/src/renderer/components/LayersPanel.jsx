/**
 * Layer list. Elements are stored back-to-front, so this renders the array
 * reversed -- the topmost item in the panel is the frontmost on canvas, which
 * is what every design tool does and what users expect.
 */

import React from "react";
import { useStore } from "../store";

const TYPE_ICONS = {
  asset: "🧬",
  rect: "▭",
  ellipse: "◯",
  triangle: "△",
  line: "╱",
  arrow: "↗",
  text: "T",
};

export default function LayersPanel() {
  const elements = useStore((s) => s.elements);
  const selectedIds = useStore((s) => s.selectedIds);
  const setSelection = useStore((s) => s.setSelection);
  const toggleSelection = useStore((s) => s.toggleSelection);
  const updateElement = useStore((s) => s.updateElement);
  const reorder = useStore((s) => s.reorder);
  const moveElementToIndex = useStore((s) => s.moveElementToIndex);

  // Panel order is front-to-back.
  const ordered = [...elements].reverse();

  const onDrop = (e, targetPanelIndex) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("application/x-morphly-layer");
    if (!id) return;
    // Convert panel index (front-to-back) back to store index (back-to-front).
    const storeIndex = elements.length - 1 - targetPanelIndex;
    moveElementToIndex(id, storeIndex);
  };

  return (
    <div className="panel layers">
      <div className="panel-header">
        Layers <span className="muted">{elements.length}</span>
      </div>

      {elements.length === 0 && <p className="hint pad">Nothing on the canvas yet.</p>}

      <div className="layer-list">
        {ordered.map((el, panelIndex) => {
          const selected = selectedIds.includes(el.id);
          return (
            <div
              key={el.id}
              className={`layer-row${selected ? " selected" : ""}${el.locked ? " locked" : ""}`}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("application/x-morphly-layer", el.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, panelIndex)}
              onClick={(e) => (e.shiftKey ? toggleSelection(el.id) : setSelection([el.id]))}
            >
              <span className="layer-icon">{TYPE_ICONS[el.type] ?? "?"}</span>

              <input
                className="layer-name"
                value={el.name}
                onChange={(e) => updateElement(el.id, { name: e.target.value }, { commit: false })}
                onClick={(e) => e.stopPropagation()}
              />

              <button
                className="icon"
                title={el.visible ? "Hide" : "Show"}
                onClick={(e) => {
                  e.stopPropagation();
                  updateElement(el.id, { visible: !el.visible });
                }}
              >
                {el.visible ? "👁" : "🚫"}
              </button>

              <button
                className="icon"
                title={el.locked ? "Unlock" : "Lock"}
                onClick={(e) => {
                  e.stopPropagation();
                  updateElement(el.id, { locked: !el.locked });
                }}
              >
                {el.locked ? "🔒" : "🔓"}
              </button>
            </div>
          );
        })}
      </div>

      {selectedIds.length === 1 && (
        <div className="layer-actions">
          <button className="ghost small" onClick={() => reorder(selectedIds[0], "front")}>
            Front
          </button>
          <button className="ghost small" onClick={() => reorder(selectedIds[0], "forward")}>
            +1
          </button>
          <button className="ghost small" onClick={() => reorder(selectedIds[0], "backward")}>
            −1
          </button>
          <button className="ghost small" onClick={() => reorder(selectedIds[0], "back")}>
            Back
          </button>
        </div>
      )}
    </div>
  );
}
