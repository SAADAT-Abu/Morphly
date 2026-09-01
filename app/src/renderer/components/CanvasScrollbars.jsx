/**
 * Scrollbars for the canvas viewport.
 *
 * Konva has no scrolling of its own: the stage is panned by moving its origin.
 * These bars translate that into something you can see and grab, so that once
 * a figure is zoomed past the window there is an obvious way to reach the rest
 * of it, in both directions, without knowing the keyboard gestures.
 *
 * The scrollable extent is the page plus a margin, unioned with wherever the
 * view currently sits. Taking the union means panning far off the page with a
 * gesture cannot put the thumb outside its track: the extent simply grows to
 * include where you are.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

const PAD = 160; // breathing room around the page, in screen pixels
const THICKNESS = 10;
const MIN_THUMB = 28;

/** Scroll geometry for one axis, all in viewport pixels. */
function metrics(viewport, pageLength, origin) {
  const contentStart = Math.min(origin - PAD, 0);
  const contentEnd = Math.max(origin + pageLength + PAD, viewport);
  const content = Math.max(contentEnd - contentStart, 1);
  return {
    content,
    viewport,
    // how far the content has scrolled past the top/left of the viewport
    offset: -contentStart,
    contentStart,
  };
}

export default function CanvasScrollbars({ size, zoom, stagePos, canvas, setStagePos }) {
  const horizontal = metrics(size.width, canvas.width * zoom, stagePos.x);
  const vertical = metrics(size.height, canvas.height * zoom, stagePos.y);

  const showH = horizontal.content > horizontal.viewport + 1;
  const showV = vertical.content > vertical.viewport + 1;

  return (
    <>
      {showH && (
        <Bar
          axis="x"
          m={horizontal}
          track={size.width - (showV ? THICKNESS : 0)}
          onScroll={(delta) => setStagePos({ x: stagePos.x - delta, y: stagePos.y })}
        />
      )}
      {showV && (
        <Bar
          axis="y"
          m={vertical}
          track={size.height - (showH ? THICKNESS : 0)}
          onScroll={(delta) => setStagePos({ x: stagePos.x, y: stagePos.y - delta })}
        />
      )}
    </>
  );
}

function Bar({ axis, m, track, onScroll }) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);

  const ratio = m.viewport / m.content;
  const thumbLength = Math.max(MIN_THUMB, track * ratio);
  // Guard against dividing by zero when the thumb fills the track.
  const travel = Math.max(track - thumbLength, 1);
  const maxOffset = Math.max(m.content - m.viewport, 1);
  const thumbStart = (m.offset / maxOffset) * travel;

  /** Convert a movement along the track into a movement of the content. */
  const trackToContent = useCallback((px) => (px / travel) * maxOffset, [travel, maxOffset]);

  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { start: axis === "x" ? e.clientX : e.clientY };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e) => {
      const current = axis === "x" ? e.clientX : e.clientY;
      const delta = current - dragRef.current.start;
      if (delta === 0) return;
      dragRef.current.start = current;
      onScroll(trackToContent(delta));
    };
    const onUp = () => setDragging(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, axis, onScroll, trackToContent]);

  /** Clicking the track pages towards the click, as scrollbars normally do. */
  const onTrackDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clicked = axis === "x" ? e.clientX - rect.left : e.clientY - rect.top;
    const direction = clicked < thumbStart ? -1 : 1;
    onScroll(direction * m.viewport * 0.9);
  };

  const style =
    axis === "x"
      ? { left: 0, bottom: 0, width: track, height: THICKNESS }
      : { top: 0, right: 0, height: track, width: THICKNESS };

  const thumbStyle =
    axis === "x"
      ? { left: thumbStart, width: thumbLength }
      : { top: thumbStart, height: thumbLength };

  return (
    <div className={`scrollbar ${axis}`} style={style} onMouseDown={onTrackDown}>
      <div
        className={`scroll-thumb${dragging ? " dragging" : ""}`}
        style={thumbStyle}
        onMouseDown={onPointerDown}
      />
    </div>
  );
}
