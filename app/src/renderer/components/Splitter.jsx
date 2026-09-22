/**
 * A draggable boundary between two panes.
 *
 * Vertical splitters sit between the sidebar, the canvas and the properties
 * rail and change a width; horizontal ones sit above the layers list and the
 * data table and change a height. `edge` says which side the pane being sized
 * is on, so the same component serves all four.
 *
 * It is a real separator: once focused it moves with the arrow keys (Shift for
 * bigger steps, Home and End for the extremes), and a double-click puts the
 * pane back to its usual size.
 */

import React, { useRef } from "react";
import { PANES, clampPane } from "../lib/panes";

/** The size a pane should take, from where the pointer is. */
export function sizeFromPointer({ name, edge, point, bounds }) {
  const from = edge === "start" ? (bounds.horizontal ? bounds.top : bounds.left) : null;
  const size =
    from !== null ? point - from : bounds.horizontal ? bounds.bottom - point : bounds.right - point;
  return clampPane(name, size, bounds.available);
}

export default function Splitter({ name, edge = "end", horizontal = false, containerRef, size, onResize, onDone }) {
  const dragging = useRef(false);
  // The size last set, so it can be handed to onDone: React has not
  // re-rendered yet when a drag ends, so the prop would be one step behind.
  const latest = useRef(size);

  const settle = (next) => {
    latest.current = next;
    onResize(next);
  };

  const boundsOf = () => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      horizontal,
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      available: horizontal ? box.height : box.width,
    };
  };

  const apply = (point) => {
    const bounds = boundsOf();
    if (bounds) settle(sizeFromPointer({ name, edge, point, bounds }));
  };

  const stop = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    onDone?.(latest.current);
  };

  const onKeyDown = (e) => {
    const step = e.shiftKey ? 48 : 16;
    const bounds = boundsOf();
    const grow = horizontal ? "ArrowUp" : edge === "start" ? "ArrowRight" : "ArrowLeft";
    const shrink = horizontal ? "ArrowDown" : edge === "start" ? "ArrowLeft" : "ArrowRight";
    let next = null;
    if (e.key === grow) next = size + step;
    else if (e.key === shrink) next = size - step;
    else if (e.key === "Home") next = PANES[name].min;
    else if (e.key === "End" && bounds) next = bounds.available;
    if (next === null) return;
    e.preventDefault();
    settle(clampPane(name, next, bounds?.available));
    onDone?.(latest.current);
  };

  return (
    <div
      className={`splitter${horizontal ? " horizontal" : " vertical"}`}
      role="separator"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label={`Resize the ${name === "rail" ? "properties" : name} panel`}
      aria-valuenow={Math.round(size)}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => dragging.current && apply(horizontal ? e.clientY : e.clientX)}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        settle(PANES[name].size);
        onDone?.(latest.current);
      }}
      title="Drag to resize, or double-click for the usual size"
    >
      <span className="grip" aria-hidden="true" />
    </div>
  );
}
