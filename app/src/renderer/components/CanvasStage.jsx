/**
 * The Konva canvas.
 *
 * Every element is drawn as a Group positioned at (x, y) with its shape laid
 * out at local origin. That uniformity is what lets one Transformer, one drag
 * handler and one snapping routine serve rectangles, text and BioArt vectors
 * alike -- instead of special-casing Konva's differing coordinate conventions
 * (Ellipse is centre-origin, Rect is corner-origin, and so on).
 *
 * Konva applies resizes as a scale factor on the node. We bake that scale back
 * into width/height (or points, or fontSize) on transformend and reset the
 * node's scale to 1, so element geometry stays in real canvas units and stroke
 * widths never come out stretched.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Group,
  Rect,
  Ellipse,
  Circle,
  Line,
  Path,
  Text as KonvaText,
  Image as KonvaImage,
  Transformer,
} from "react-konva";

import { useStore } from "../store";
import { useSvgImage, useSvgImageFromText, useRasterImage } from "../lib/useSvgImage";
import { offsets, cellAtPoint, cellCorners, isHeaderCell } from "../lib/tableLayout";
import { buildIsolationSvg, effectiveColorMap } from "../lib/svgPalette";
import { isPanel } from "../lib/panelLayout";
import { pointsBounds, visualBox, unionBox } from "../lib/geometry";
import { snapContext, snapMove, snapPoint } from "../lib/snapping";
import { measuredHeight, rememberHeight } from "../lib/measure";
import {
  isConnector,
  connectorGeometry,
  nearestAnchor,
  glueTargetAt,
  anchorPoints,
  bendThrough,
  elbowRatioAt,
  unglueExcept,
} from "../lib/connectors";
import CanvasScrollbars from "./CanvasScrollbars";

const SNAP_THRESHOLD = 6; // canvas units, scaled by zoom at call time
/** Smart guides are pink, so they never read as part of the figure. */
const GUIDE_COLOUR = "#ff3ea5";
const NO_GUIDES = { lines: [], gaps: [] };

/** How close, in screen pixels, a dragged line end must come to a glue point. */
const GLUE_RADIUS = 14;

// ---------------------------------------------------------------------------
// One element
// ---------------------------------------------------------------------------

/**
 * Paints only the shapes using one colour, in a vivid highlight, on top of the
 * artwork. This is what makes the colour panel legible: on a drawing with
 * twenty colours and hundreds of shapes, the swatch alone says nothing about
 * which part it controls.
 */
function ColorHighlight({ element, hex }) {
  const isolated = useMemo(
    () => buildIsolationSvg(element.svgSource, element.palette ?? [], hex),
    [element.svgSource, element.palette, hex]
  );
  const image = useSvgImageFromText(isolated);
  if (!image) return null;
  return (
    <KonvaImage
      image={image}
      width={element.width}
      height={element.height}
      listening={false}
      opacity={0.95}
    />
  );
}

function AssetShape({ element }) {
  const image = useSvgImage(element.svgSource, effectiveColorMap(element));
  if (!image) {
    // Placeholder while the SVG rasterises, so the element still has a
    // visible, selectable footprint.
    return (
      <Rect
        width={element.width}
        height={element.height}
        fill="#e8eaf0"
        stroke="#c3c8d4"
        strokeWidth={1}
        dash={[6, 4]}
      />
    );
  }
  return <KonvaImage image={image} width={element.width} height={element.height} />;
}

/**
 * An imported bitmap. It is drawn at the element's own width and height rather
 * than the file's pixel size, so resizing a plot behaves like resizing any
 * other element.
 */
function ImageShape({ element }) {
  const image = useRasterImage(element.src);
  if (!image) {
    return (
      <Rect
        width={element.width}
        height={element.height}
        fill="#e8eaf0"
        stroke="#c3c8d4"
        strokeWidth={1}
        dash={[6, 4]}
      />
    );
  }
  return (
    <KonvaImage
      image={image}
      width={element.width}
      height={element.height}
      cornerRadius={element.cornerRadius ?? 0}
    />
  );
}

/**
 * A table, drawn cell by cell.
 *
 * Each cell is its own rectangle plus its own text, rather than one background
 * with lines painted over it. That costs a few more nodes but makes header
 * fills, striped rows and rounded outer corners fall out of the same loop, and
 * it keeps what is drawn identical to what the SVG exporter emits.
 */
function TableShape({ element }) {
  const xs = offsets(element.colWidths);
  const ys = offsets(element.rowHeights);
  const pad = element.padding ?? 6;

  const cells = [];
  for (let row = 0; row < element.rows; row += 1) {
    for (let col = 0; col < element.cols; col += 1) {
      const header = isHeaderCell(element, row, col);
      const striped =
        !header && element.stripeFill && (element.headerRow ? row % 2 === 0 : row % 2 === 1);
      const fill = header ? element.headerFill : striped ? element.stripeFill : element.fill;
      const width = element.colWidths[col];
      const height = element.rowHeights[row];

      cells.push(
        <Rect
          key={`bg-${row}-${col}`}
          x={xs[col]}
          y={ys[row]}
          width={width}
          height={height}
          fill={fill}
          cornerRadius={cellCorners(element, row, col)}
        />
      );

      const text = element.cells[row]?.[col];
      if (text) {
        cells.push(
          <KonvaText
            key={`tx-${row}-${col}`}
            x={xs[col] + pad}
            y={ys[row]}
            width={Math.max(1, width - pad * 2)}
            height={height}
            text={text}
            align={element.align ?? "left"}
            verticalAlign="middle"
            fontSize={element.fontSize}
            fontFamily={element.fontFamily}
            fontStyle={header ? "bold" : "normal"}
            fill={header ? element.headerTextColor : element.textColor}
            listening={false}
            wrap="word"
          />
        );
      }
    }
  }

  // Inner lines are drawn after every cell background so a header fill cannot
  // paint over the rule below it.
  const rules = [];
  if (element.showInnerLines !== false && element.strokeWidth > 0) {
    for (let col = 1; col < element.cols; col += 1) {
      rules.push(
        <Line
          key={`v${col}`}
          points={[xs[col], 0, xs[col], element.height]}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
        />
      );
    }
    for (let row = 1; row < element.rows; row += 1) {
      rules.push(
        <Line
          key={`h${row}`}
          points={[0, ys[row], element.width, ys[row]]}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
        />
      );
    }
  }

  return (
    <>
      {cells}
      {rules}
      {element.strokeWidth > 0 && (
        <Rect
          width={element.width}
          height={element.height}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
          cornerRadius={element.cornerRadius ?? 0}
          listening={false}
        />
      )}
    </>
  );
}

/**
 * A line or arrow: straight, curved or elbow, glued or free.
 *
 * Drawn from lib/connectors.js, the same geometry the SVG export uses, so the
 * two always agree. The generous hit width makes a thin line easy to click.
 */
function ConnectorShape({ element, lookup }) {
  const geometry = connectorGeometry(element, lookup);
  return (
    <>
      <Path
        data={geometry.d}
        stroke={element.fill}
        strokeWidth={element.strokeWidth}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={Math.max(12, element.strokeWidth + 8)}
      />
      {geometry.heads.map((head, i) => (
        <Line key={i} points={head} closed fill={element.fill} />
      ))}
    </>
  );
}

function ElementShape({ element, lookup }) {
  switch (element.type) {
    case "rect":
      return (
        <Rect
          width={element.width}
          height={element.height}
          // An empty fill means none, as on a panel. Such a box is picked up by
          // its outline only, so a selection band can still be started inside
          // a panel to catch the artwork in it.
          fill={element.fill || undefined}
          fillEnabled={Boolean(element.fill)}
          hitStrokeWidth={element.fill ? "auto" : Math.max(10, (element.strokeWidth ?? 0) + 8)}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
          cornerRadius={element.cornerRadius ?? 0}
        />
      );
    case "ellipse":
      return (
        <Ellipse
          x={element.width / 2}
          y={element.height / 2}
          radiusX={element.width / 2}
          radiusY={element.height / 2}
          fill={element.fill}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
        />
      );
    case "triangle":
      return (
        <Line
          points={[element.width / 2, 0, element.width, element.height, 0, element.height]}
          closed
          fill={element.fill}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
        />
      );
    case "line":
    case "arrow":
      return <ConnectorShape element={element} lookup={lookup} />;
    case "text":
      return (
        <KonvaText
          text={element.text}
          width={element.width}
          fontSize={element.fontSize}
          fontFamily={element.fontFamily}
          fontStyle={element.fontStyle}
          align={element.align}
          fill={element.fill}
          lineHeight={element.lineHeight ?? 1.25}
          wrap="word"
        />
      );
    case "image":
      return <ImageShape element={element} />;
    case "table":
      return <TableShape element={element} />;
    case "asset":
      return <AssetShape element={element} />;
    default:
      return null;
  }
}

/**
 * Centred caption drawn inside a shape. Konva's verticalAlign needs an
 * explicit height, so the label box matches the shape box exactly and the text
 * sits in the middle of it whatever the shape is.
 */
function ShapeLabel({ element }) {
  if (!element.label) return null;
  return (
    <KonvaText
      text={element.label}
      x={0}
      y={0}
      width={element.width}
      height={element.height}
      align="center"
      verticalAlign="middle"
      fontSize={element.labelSize ?? 16}
      fontFamily={element.labelFont ?? "Helvetica"}
      fill={element.labelColor ?? "#ffffff"}
      listening={false}
      wrap="word"
      padding={4}
    />
  );
}

/** A panel's letter, in its top-left corner. */
function PanelLetter({ element }) {
  if (!element.panelLabel) return null;
  const size = element.panelLetterSize ?? 32;
  return (
    <KonvaText
      text={element.panelLabel}
      x={size * 0.35}
      y={size * 0.3}
      fontSize={size}
      fontFamily="Helvetica"
      fontStyle="bold"
      fill={element.panelLetterColor ?? "#111111"}
      listening={false}
    />
  );
}

/** Shapes that can carry a centred caption. */
const LABELLABLE = ["rect", "ellipse", "triangle"];

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export default function CanvasStage({ stageRef, onRequestTextEdit, onExternalDrop, onDropFiles, onContextMenu }) {
  const elements = useStore((s) => s.elements);
  const canvas = useStore((s) => s.canvas);
  const selectedIds = useStore((s) => s.selectedIds);
  const zoom = useStore((s) => s.zoom);
  const stagePos = useStore((s) => s.stagePos);
  const activeTool = useStore((s) => s.activeTool);
  const highlight = useStore((s) => s.highlight);
  const grid = useStore((s) => s.grid);

  const selectWithGroups = useStore((s) => s.selectWithGroups);
  const toggleSelection = useStore((s) => s.toggleSelection);
  const nudgeSelected = useStore((s) => s.nudgeSelected);
  const clearSelection = useStore((s) => s.clearSelection);
  const updateElement = useStore((s) => s.updateElement);
  const setZoom = useStore((s) => s.setZoom);
  const setStagePos = useStore((s) => s.setStagePos);
  const addShape = useStore((s) => s.addShape);
  const addText = useStore((s) => s.addText);
  const commit = useStore((s) => s.commit);

  const containerRef = useRef(null);
  const transformerRef = useRef(null);
  const nodeRefs = useRef(new Map());

  const [size, setSize] = useState({ width: 800, height: 600 });
  /** Smart guides to draw: dotted lines, and markers on equal gaps. */
  const [guides, setGuides] = useState(NO_GUIDES);
  const snapping = useStore((s) => s.snapping);
  const [isPanning, setIsPanning] = useState(false);
  /** Positions of every selected element when a drag began, so a group can be
   *  moved as one piece. */
  const dragStartRef = useRef(null);

  /**
   * Where things are mid-gesture, for connectors only.
   *
   * Konva moves nodes during a drag or resize without telling the store, which
   * only hears about it at the end. Connectors glued to a moving element have
   * to follow it live, so the moving boxes are kept here, `boxes` by id, and
   * connectors are drawn against them. `moving` lists what is being dragged,
   * so a connector dragged by hand can let go of anything left behind.
   */
  const [live, setLive] = useState(null);

  const elementsById = useMemo(() => new Map(elements.map((el) => [el.id, el])), [elements]);

  /** Elements some connector is glued to. */
  const gluedTargets = useMemo(() => {
    const ids = new Set();
    for (const el of elements) {
      if (!isConnector(el)) continue;
      if (el.start) ids.add(el.start.elementId);
      if (el.end) ids.add(el.end.elementId);
    }
    return ids;
  }, [elements]);

  const lookup = useCallback(
    (id) => {
      const el = elementsById.get(id);
      const box = live?.boxes[id];
      return el && box ? { ...el, ...box } : el;
    },
    [elementsById, live]
  );

  /** A connector as it should be drawn right now. */
  const connectorNow = useCallback(
    (el) => {
      if (!live || !live.moving.has(el.id)) return el;
      return unglueExcept({ ...el, ...live.boxes[el.id] }, live.moving);
    },
    [live]
  );

  // Keep the stage sized to its container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Attach the transformer to whatever is selected. A single line or arrow
  // gets end handles instead (ConnectorHandles), which do more for a line
  // than a resize box can.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const nodes = selectedIds
      .map((id) => nodeRefs.current.get(id))
      .filter(Boolean)
      .filter((node) => {
        const el = elements.find((e) => e.id === node.id());
        if (selectedIds.length === 1 && isConnector(el)) return false;
        return el && !el.locked && el.visible;
      });
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, elements]);

  // -- zoom / pan ----------------------------------------------------------

  const handleWheel = useCallback(
    (e) => {
      e.evt.preventDefault();
      const stage = e.target.getStage();

      // Ctrl/Cmd + wheel zooms about the pointer; plain wheel scrolls.
      if (e.evt.ctrlKey || e.evt.metaKey) {
        const pointer = stage.getPointerPosition();
        const oldScale = zoom;
        const newScale = Math.min(4, Math.max(0.05, oldScale * (e.evt.deltaY > 0 ? 0.92 : 1.08)));
        const mousePoint = {
          x: (pointer.x - stagePos.x) / oldScale,
          y: (pointer.y - stagePos.y) / oldScale,
        };
        setZoom(newScale);
        setStagePos({
          x: pointer.x - mousePoint.x * newScale,
          y: pointer.y - mousePoint.y * newScale,
        });
      } else if (e.evt.shiftKey) {
        // Shift plus wheel scrolls sideways, the convention everywhere else.
        // Without it a plain mouse, which only reports vertical delta, could
        // never reach the left or right of a zoomed-in figure.
        const amount = e.evt.deltaY || e.evt.deltaX;
        setStagePos({ x: stagePos.x - amount, y: stagePos.y });
      } else {
        setStagePos({ x: stagePos.x - e.evt.deltaX, y: stagePos.y - e.evt.deltaY });
      }
    },
    [zoom, stagePos, setZoom, setStagePos]
  );

  // -- clicking empty space -------------------------------------------------

  /**
   * Rubber-band selection.
   *
   * Pressing on empty space with the Select tool starts a band; releasing
   * selects everything it touches. A press that never moves is a plain click,
   * so it clears the selection as it always did. Holding shift adds to the
   * current selection rather than replacing it.
   *
   * The band lives in canvas coordinates, so it stays put under the cursor
   * whatever the zoom, and its live corners are kept on a ref rather than in
   * state: the mouse-up handler needs the final corner, not whichever one the
   * last render happened to see.
   */
  const marqueeRef = useRef(null);
  const [marquee, setMarquee] = useState(null);

  const pointerOnCanvas = useCallback(
    (stage) => {
      const pointer = stage.getPointerPosition();
      return {
        x: (pointer.x - stagePos.x) / zoom,
        y: (pointer.y - stagePos.y) / zoom,
      };
    },
    [stagePos, zoom]
  );

  const handleStageMouseDown = useCallback(
    (e) => {
      // The right button opens the context menu; it neither draws nor starts a band.
      if (e.evt?.button === 2) return;
      const clickedEmpty = e.target === e.target.getStage() || e.target.name() === "canvas-bg";
      if (!clickedEmpty) return;

      const at = pointerOnCanvas(e.target.getStage());

      // A drawing tool places its shape where the user clicked.
      if (activeTool !== "select") {
        if (activeTool === "text") addText(at);
        else addShape(activeTool, at);
        return;
      }

      // Space-drag panning claims the same gesture, so it wins.
      if (isPanning) return;

      marqueeRef.current = {
        origin: at,
        last: at,
        additive: e.evt?.shiftKey ?? false,
        moved: false,
      };
      setMarquee({ x1: at.x, y1: at.y, x2: at.x, y2: at.y });
    },
    [activeTool, isPanning, addShape, addText, pointerOnCanvas]
  );

  const handleStageMouseMove = useCallback(
    (e) => {
      const band = marqueeRef.current;
      if (!band) return;
      const at = pointerOnCanvas(e.target.getStage());
      band.last = at;
      // A few pixels of travel is an unsteady click, not a drag, so the band
      // only counts as one past that.
      if (Math.abs(at.x - band.origin.x) > 3 / zoom || Math.abs(at.y - band.origin.y) > 3 / zoom) {
        band.moved = true;
      }
      setMarquee({ x1: band.origin.x, y1: band.origin.y, x2: at.x, y2: at.y });
    },
    [pointerOnCanvas, zoom]
  );

  const handleStageMouseUp = useCallback(() => {
    const band = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!band) return;

    if (!band.moved) {
      // A plain click on empty space.
      if (!band.additive) clearSelection();
      return;
    }

    const box = {
      left: Math.min(band.origin.x, band.last.x),
      right: Math.max(band.origin.x, band.last.x),
      top: Math.min(band.origin.y, band.last.y),
      bottom: Math.max(band.origin.y, band.last.y),
    };

    // Anything the band touches is caught, rather than only what it fully
    // encloses. On a dense figure, having to lasso an entire illustration to
    // catch it is more work than shift-clicking the odd extra back out.
    const hits = elements
      .filter((el) => el.visible && !el.locked)
      .filter((el) => {
        const node = nodeRefs.current.get(el.id);
        if (!node) return false;
        // getClientRect relative to the layer is in real canvas units and
        // already accounts for rotation, strokes and text metrics.
        const r = node.getClientRect({ relativeTo: node.getLayer() });
        return (
          r.x < box.right &&
          r.x + r.width > box.left &&
          r.y < box.bottom &&
          r.y + r.height > box.top
        );
      })
      .map((el) => el.id);

    if (hits.length === 0) {
      if (!band.additive) clearSelection();
      return;
    }
    selectWithGroups(band.additive ? [...new Set([...selectedIds, ...hits])] : hits);
  }, [elements, selectedIds, clearSelection, selectWithGroups]);

  // -- drag with snapping ---------------------------------------------------

  const handleDragStart = useCallback(
    (element) => {
      commit();
      // Record where everything started so companions can follow exactly,
      // without accumulating rounding drift across many small moves.
      const ids = selectedIds.includes(element.id) ? selectedIds : [element.id];
      dragStartRef.current = {
        origin: { x: element.x, y: element.y },
        members: elements
          .filter((el) => ids.includes(el.id) && el.id !== element.id && !el.locked)
          .map((el) => ({ id: el.id, x: el.x, y: el.y })),
      };

      // What the smart guides can latch onto does not change during a drag,
      // so it is measured once here rather than on every mouse move.
      const moving = new Set([element.id, ...dragStartRef.current.members.map((m) => m.id)]);
      const still = elements.filter((el) => !moving.has(el.id) && el.visible);
      Object.assign(dragStartRef.current, {
        startBox: unionBox(elements.filter((el) => moving.has(el.id)).map((el) => visualBox(el, measuredHeight))),
        still: still.map((el) => visualBox(el, measuredHeight)),
        panels: still.filter(isPanel).map((el) => visualBox(el, measuredHeight)),
      });
    },
    [commit, selectedIds, elements]
  );

  const handleDragMove = useCallback(
    (e, element) => {
      const node = e.target;
      const start = dragStartRef.current;

      const movingIds = new Set([element.id, ...(start?.members ?? []).map((m) => m.id)]);
      const snap = { x: node.x(), y: node.y() };
      let shown = NO_GUIDES;

      if (grid.visible && grid.snap) {
        // Snapping to the grid, when it is on, takes precedence over the smart
        // guides: a user who asked for a grid wants things on it.
        snap.x = Math.round(snap.x / grid.size) * grid.size;
        snap.y = Math.round(snap.y / grid.size) * grid.size;
      } else if (snapping && start?.startBox && !(e.evt?.ctrlKey || e.evt?.metaKey)) {
        // Snap the box around everything moving, not just the piece under the
        // mouse, so a whole selection lines up. Ctrl moves freely.
        const box = {
          ...start.startBox,
          x: start.startBox.x + snap.x - start.origin.x,
          y: start.startBox.y + snap.y - start.origin.y,
        };
        const context = snapContext({ canvas, others: start.still, panels: start.panels, focus: box });
        const result = snapMove(box, context, SNAP_THRESHOLD / zoom);
        snap.x += result.dx;
        snap.y += result.dy;
        shown = { lines: result.guides, gaps: result.gaps };
      }

      node.x(snap.x);
      node.y(snap.y);
      setGuides(shown);

      const boxes = { [element.id]: { x: snap.x, y: snap.y } };
      if (start) {
        const dx = snap.x - start.origin.x;
        const dy = snap.y - start.origin.y;
        for (const member of start.members) {
          const companion = nodeRefs.current.get(member.id);
          if (companion) {
            companion.x(member.x + dx);
            companion.y(member.y + dy);
          }
          boxes[member.id] = { x: member.x + dx, y: member.y + dy };
        }
      }

      // Only worth a redraw of the connectors when one is involved.
      const involved = [...movingIds].some(
        (id) => gluedTargets.has(id) || isConnector(elementsById.get(id))
      );
      if (involved) setLive({ moving: movingIds, boxes });
    },
    [elements, elementsById, gluedTargets, canvas, zoom, grid, snapping]
  );

  const handleDragEnd = useCallback(
    (e, element) => {
      setGuides(NO_GUIDES);
      const start = dragStartRef.current;
      const x = e.target.x();
      const y = e.target.y();

      // A connector moved by hand lets go of anything that stayed put.
      const moving = new Set([element.id, ...(start?.members ?? []).map((m) => m.id)]);
      const release = (el) => (isConnector(el) ? unglueExcept(el, moving) : el);

      if (start && start.members.length > 0) {
        // Commit the whole move in one update, without a second history entry
        // (handleDragStart already pushed one).
        const dx = x - start.origin.x;
        const dy = y - start.origin.y;
        useStore.setState((s) => ({
          elements: s.elements.map((el) => {
            if (el.id === element.id) return release({ ...el, x, y });
            const member = start.members.find((m) => m.id === el.id);
            return member ? release({ ...el, x: member.x + dx, y: member.y + dy }) : el;
          }),
          dirty: true,
        }));
      } else {
        const moved = release({ ...element, x, y });
        updateElement(element.id, { x, y, ...(isConnector(element) ? { start: moved.start, end: moved.end } : {}) }, { commit: false });
      }
      dragStartRef.current = null;
      setLive(null);
    },
    [updateElement]
  );

  /** While resizing or rotating something a connector is glued to, let the
   *  connector follow the box as it changes. */
  const handleTransform = useCallback(
    (e, element) => {
      if (!gluedTargets.has(element.id)) return;
      const node = e.target;
      const box = {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        width: (element.width ?? 0) * node.scaleX(),
        height: (element.height ?? 0) * node.scaleY(),
      };
      setLive((current) => ({
        moving: current?.moving ?? new Set(),
        boxes: { ...(current?.boxes ?? {}), [element.id]: box },
      }));
    },
    [gluedTargets]
  );

  /**
   * Smart guides while resizing: the handle being dragged snaps to the same
   * lines a moving object would. Skipped while rotating, for a rotated
   * selection, and with Ctrl held. A side handle only moves one way, so it
   * only snaps that way.
   */
  const snapAnchor = useCallback(
    (oldPos, newPos, evt) => {
      const tr = transformerRef.current;
      const anchor = tr?.getActiveAnchor() ?? "";
      if (!snapping || evt?.ctrlKey || evt?.metaKey || !tr || anchor === "rotater" || Math.abs(tr.rotation()) > 0.01) {
        return newPos;
      }
      const moving = new Set(selectedIds);
      const still = elements.filter((el) => !moving.has(el.id) && el.visible);
      const point = { x: (newPos.x - stagePos.x) / zoom, y: (newPos.y - stagePos.y) / zoom };
      const context = snapContext({
        canvas,
        others: still.map((el) => visualBox(el, measuredHeight)),
        panels: still.filter(isPanel).map((el) => visualBox(el, measuredHeight)),
        focus: { ...point, width: 0, height: 0 },
      });
      const snapped = snapPoint(point, context, SNAP_THRESHOLD / zoom);

      const movesX = anchor !== "top-center" && anchor !== "bottom-center";
      const movesY = anchor !== "middle-left" && anchor !== "middle-right";
      setGuides({
        lines: snapped.guides.filter((g) => (g.axis === "x" ? movesX : movesY)),
        gaps: [],
      });
      return {
        x: movesX ? snapped.x * zoom + stagePos.x : newPos.x,
        y: movesY ? snapped.y * zoom + stagePos.y : newPos.y,
      };
    },
    [snapping, selectedIds, elements, stagePos, zoom, canvas]
  );

  // Text height is only known once Konva has wrapped the words; aligning and
  // snapping read it from here.
  useEffect(() => {
    for (const el of elements) {
      if (el.type !== "text") continue;
      const text = nodeRefs.current.get(el.id)?.findOne("Text");
      if (text) rememberHeight(el.id, text.height());
    }
  }, [elements]);

  // -- transform (resize / rotate) -----------------------------------------

  const handleTransformEnd = useCallback(
    (e, element) => {
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      // Bake the scale into real geometry and reset it, so strokes and text
      // stay crisp and the stored model keeps true canvas units.
      node.scaleX(1);
      node.scaleY(1);

      const patch = {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
      };

      if (element.points) {
        patch.points = element.points.map((v, i) => (i % 2 === 0 ? v * scaleX : v * scaleY));
        const b = pointsBounds(patch.points);
        patch.width = b.width;
        patch.height = b.height;
      } else if (element.type === "table") {
        // Scale every column and row rather than the outer box, so the cells
        // keep their relative proportions and the geometry stays consistent
        // with width/height being their sums.
        patch.colWidths = element.colWidths.map((w) => Math.max(20, w * scaleX));
        patch.rowHeights = element.rowHeights.map((h) => Math.max(14, h * scaleY));
        patch.width = patch.colWidths.reduce((a, b) => a + b, 0);
        patch.height = patch.rowHeights.reduce((a, b) => a + b, 0);
      } else {
        patch.width = Math.max(4, (element.width ?? 0) * scaleX);
        patch.height = Math.max(4, (element.height ?? 0) * scaleY);
        if (element.type === "text") {
          // Scaling text vertically should change the type size, not stretch it.
          patch.fontSize = Math.max(4, element.fontSize * scaleY);
          patch.height = undefined;
        }
      }
      updateElement(element.id, patch);
      setLive(null);
      setGuides(NO_GUIDES);
    },
    [updateElement]
  );

  const visibleElements = useMemo(() => elements.filter((el) => el.visible), [elements]);

  /**
   * Middle-button drag pans, as in most editors. It is handled here rather
   * than through Konva's own dragging because that begins on mouse down,
   * before a state change enabling it could take effect.
   */
  const panRef = useRef(null);

  const handlePanStart = useCallback(
    (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      panRef.current = { x: e.clientX, y: e.clientY };
    },
    []
  );

  useEffect(() => {
    const onMove = (e) => {
      if (!panRef.current) return;
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      panRef.current = { x: e.clientX, y: e.clientY };
      const { stagePos: current, setStagePos: set } = useStore.getState();
      set({ x: current.x + dx, y: current.y + dy });
    };
    const onUp = () => {
      panRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  /** Assets dragged out of the sidebar land where they were dropped. */
  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const at = {
        x: (e.clientX - rect.left - stagePos.x) / zoom,
        y: (e.clientY - rect.top - stagePos.y) / zoom,
      };

      // Image files dragged in from a file manager land where they are dropped,
      // which is the fastest way to get a plot into a figure.
      const files = [...(e.dataTransfer.files ?? [])].filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length > 0) {
        onDropFiles?.(at, files);
        return;
      }

      const raw = e.dataTransfer.getData("application/x-morphly-asset");
      if (!raw) return;
      try {
        onExternalDrop?.(at, JSON.parse(raw));
      } catch {
        /* malformed payload -- ignore rather than break the drop */
      }
    },
    [stagePos, zoom, onExternalDrop, onDropFiles]
  );

  return (
    <div
      className="canvas-host"
      ref={containerRef}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes("application/x-morphly-asset") ||
          e.dataTransfer.types.includes("Files")
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleDrop}
      onMouseDown={handlePanStart}
      onAuxClick={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        scaleX={zoom}
        scaleY={zoom}
        x={stagePos.x}
        y={stagePos.y}
        draggable={isPanning}
        onWheel={handleWheel}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          if (activeTool !== "select") return;
          const stage = e.target.getStage();
          const at = pointerOnCanvas(stage);

          // The element under the pointer, found from whatever shape was hit.
          let hit = null;
          for (let node = e.target; node && node !== stage; node = node.getParent()) {
            const id = node.id?.();
            if (id && elementsById.has(id)) {
              hit = elementsById.get(id);
              break;
            }
          }
          const onHandle = !hit && e.target !== stage && e.target.name() !== "canvas-bg";

          if (hit) {
            // Right-clicking something outside the selection selects it first,
            // including a locked element, so it can be unlocked from the menu.
            if (!selectedIds.includes(hit.id)) {
              if (hit.locked) useStore.getState().setSelection([hit.id]);
              else selectWithGroups([hit.id]);
            }
          } else if (!onHandle) {
            clearSelection();
          }
          onContextMenu?.(at, Boolean(hit) || onHandle);
        }}
        onMouseDown={handleStageMouseDown}
        onTouchStart={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onTouchMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTouchEnd={handleStageMouseUp}
        onMouseLeave={handleStageMouseUp}
        onDragEnd={(e) => {
          if (isPanning && e.target === e.target.getStage()) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        style={{ cursor: isPanning ? "grab" : activeTool === "select" ? "default" : "crosshair" }}
      >
        {/* Page */}
        <Layer listening>
          <Rect
            name="canvas-bg"
            x={0}
            y={0}
            width={canvas.width}
            height={canvas.height}
            fill={canvas.background}
            shadowColor="rgba(0,0,0,0.35)"
            shadowBlur={24 / zoom}
            shadowOffsetY={4 / zoom}
          />
        </Layer>

        {/* Grid, above the page and below the artwork */}
        {grid.visible && (
          <Layer listening={false}>
            <GridOverlay canvas={canvas} grid={grid} zoom={zoom} />
          </Layer>
        )}

        {/* Artwork */}
        <Layer>
          {visibleElements.map((element) => (
            <Group
              key={element.id}
              id={element.id}
              ref={(node) => {
                if (node) nodeRefs.current.set(element.id, node);
                else nodeRefs.current.delete(element.id);
              }}
              x={element.x}
              y={element.y}
              rotation={element.rotation}
              opacity={element.opacity}
              draggable={!element.locked && activeTool === "select"}
              onMouseDown={(e) => {
                if (activeTool !== "select" || element.locked) return;
                e.cancelBubble = true;
                if (e.evt.shiftKey) toggleSelection(element.id);
                else if (!selectedIds.includes(element.id)) selectWithGroups([element.id]);
              }}
              onDblClick={(e) => {
                if (element.locked) return;
                if (element.type === "table") {
                  // Work out which cell was hit, in the table's own
                  // coordinates, so double-click edits that cell rather than
                  // the table as a whole.
                  const pointer = e.target.getStage().getPointerPosition();
                  const cell = cellAtPoint(
                    element,
                    (pointer.x - stagePos.x) / zoom - element.x,
                    (pointer.y - stagePos.y) / zoom - element.y
                  );
                  if (cell) onRequestTextEdit(element.id, { row: cell.row, col: cell.col });
                  return;
                }
                if (element.type === "text" || LABELLABLE.includes(element.type)) {
                  onRequestTextEdit(element.id);
                }
              }}
              onDragStart={() => handleDragStart(element)}
              onDragMove={(e) => handleDragMove(e, element)}
              onDragEnd={(e) => handleDragEnd(e, element)}
              onTransformStart={() => commit()}
              onTransform={(e) => handleTransform(e, element)}
              onTransformEnd={(e) => handleTransformEnd(e, element)}
            >
              <ElementShape element={isConnector(element) ? connectorNow(element) : element} lookup={lookup} />
              {LABELLABLE.includes(element.type) && <ShapeLabel element={element} />}
              {isPanel(element) && <PanelLetter element={element} />}
              {highlight?.elementId === element.id && element.type === "asset" && (
                <ColorHighlight element={element} hex={highlight.hex} />
              )}
            </Group>
          ))}

          <Transformer
            ref={transformerRef}
            rotateEnabled
            keepRatio={false}
            borderStroke="#4c8dff"
            anchorStroke="#4c8dff"
            anchorFill="#ffffff"
            anchorSize={8}
            anchorDragBoundFunc={snapAnchor}
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 8 || newBox.height < 8 ? oldBox : newBox
            }
          />
        </Layer>

        {/* End handles for a single selected line or arrow */}
        {(() => {
          if (activeTool !== "select" || selectedIds.length !== 1) return null;
          const selected = elementsById.get(selectedIds[0]);
          if (!isConnector(selected) || selected.locked || !selected.visible) return null;
          return (
            <Layer>
              <ConnectorHandles
                element={selected}
                elements={visibleElements}
                lookup={lookup}
                zoom={zoom}
                commit={commit}
                updateElement={updateElement}
              />
            </Layer>
          );
        })()}

        {/* Snapping guides and the selection band, above everything */}
        <Layer listening={false}>
          {marquee && (
            <Rect
              x={Math.min(marquee.x1, marquee.x2)}
              y={Math.min(marquee.y1, marquee.y2)}
              width={Math.abs(marquee.x2 - marquee.x1)}
              height={Math.abs(marquee.y2 - marquee.y1)}
              fill="rgba(76, 141, 255, 0.12)"
              stroke="#4c8dff"
              strokeWidth={1 / zoom}
              dash={[5 / zoom, 4 / zoom]}
            />
          )}
          {guides.lines.map((g, i) => (
            <Line
              key={`guide-${i}`}
              points={g.axis === "x" ? [g.at, g.from, g.at, g.to] : [g.from, g.at, g.to, g.at]}
              stroke={GUIDE_COLOUR}
              strokeWidth={1.6 / zoom}
              // Zero-length dashes with round caps draw as dots.
              dash={[0, 4 / zoom]}
              lineCap="round"
            />
          ))}
          {guides.gaps.map((gap, i) => (
            <GapMarker key={`gap-${i}`} gap={gap} zoom={zoom} />
          ))}
        </Layer>
      </Stage>

      <CanvasScrollbars
        size={size}
        zoom={zoom}
        stagePos={stagePos}
        canvas={canvas}
        setStagePos={setStagePos}
      />

      <SpacebarPanHint onChange={setIsPanning} />
    </div>
  );
}

/**
 * Marks one of a set of equal gaps: a line across the gap with a tick at each
 * end, the way PowerPoint shows matching spacing.
 */
function GapMarker({ gap, zoom }) {
  const tick = 5 / zoom;
  const style = { stroke: GUIDE_COLOUR, strokeWidth: 1 / zoom, listening: false };
  const { from, to, at } = gap;
  if (gap.axis === "x") {
    return (
      <>
        <Line {...style} points={[from, at, to, at]} />
        <Line {...style} points={[from, at - tick, from, at + tick]} />
        <Line {...style} points={[to, at - tick, to, at + tick]} />
      </>
    );
  }
  return (
    <>
      <Line {...style} points={[at, from, at, to]} />
      <Line {...style} points={[at - tick, from, at + tick, from]} />
      <Line {...style} points={[at - tick, to, at + tick, to]} />
    </>
  );
}

/**
 * Handles for editing one line or arrow.
 *
 * Round handles sit on the two ends. Dragging an end near a shape, image,
 * table or icon shows its glue points, and letting go on one glues the end
 * there, so it follows that element from then on. Ctrl places the end without
 * gluing. A curved line adds a handle on the curve to bend it; an elbow whose
 * ends run the same way adds one on its middle leg to slide it.
 *
 * Each drag is one undo step: the history is written when it starts, and the
 * live updates in between do not add more.
 */
function ConnectorHandles({ element, elements, lookup, zoom, commit, updateElement }) {
  const [hint, setHint] = useState(null);
  const geometry = connectorGeometry(element, lookup);
  const toCanvas = (p) => ({ x: p.x + element.x, y: p.y + element.y });
  const start = toCanvas(geometry.start);
  const end = toCanvas(geometry.end);

  const radius = 6 / zoom;
  const stroke = 1.5 / zoom;

  const dragEnd = (e, which) => {
    const node = e.target;
    let point = { x: node.x(), y: node.y() };
    const exclude = [element.id];
    // Ctrl (Cmd on a Mac) places the end without gluing. Alt works too, but
    // several Linux desktops take Alt plus drag for moving windows.
    const free = e.evt?.ctrlKey || e.evt?.metaKey || e.evt?.altKey;
    const snap = free ? null : nearestAnchor(elements, point, GLUE_RADIUS / zoom, { exclude });
    if (snap) {
      point = { x: snap.x, y: snap.y };
      node.position(point);
    }
    setHint({
      target: snap ? elements.find((el) => el.id === snap.elementId) : glueTargetAt(elements, point, 24 / zoom, { exclude }),
      snap,
    });

    const points = geometry.points.slice();
    const i = which === "start" ? 0 : points.length - 2;
    points[i] = point.x - element.x;
    points[i + 1] = point.y - element.y;
    updateElement(
      element.id,
      { points, [which]: snap ? { elementId: snap.elementId, anchor: snap.anchor } : null },
      { commit: false }
    );
  };

  const dragBend = (e) => {
    const node = e.target;
    const local = { x: node.x() - element.x, y: node.y() - element.y };
    updateElement(element.id, { bend: bendThrough(geometry.start, geometry.end, local) }, { commit: false });
  };

  const dragElbow = (e) => {
    const node = e.target;
    const handle = geometry.elbowHandle;
    // The middle leg only slides across, so the handle is held on its line.
    if (handle.axis === "x") node.y(handle.y + element.y);
    else node.x(handle.x + element.x);
    const local = { x: node.x() - element.x, y: node.y() - element.y };
    updateElement(element.id, { elbowRatio: elbowRatioAt(geometry.route, local) }, { commit: false });
  };

  const common = {
    draggable: true,
    stroke: "#4c8dff",
    strokeWidth: stroke,
    onMouseDown: (e) => {
      e.cancelBubble = true;
    },
    onDragStart: () => commit(),
  };

  const endHandle = (which, point) => (
    <Circle
      {...common}
      x={point.x}
      y={point.y}
      radius={radius}
      // Filled means glued, hollow means free.
      fill={element[which] ? "#4c8dff" : "#ffffff"}
      onDragMove={(e) => dragEnd(e, which)}
      onDragEnd={() => setHint(null)}
    />
  );

  return (
    <>
      {hint?.target &&
        anchorPoints(lookup(hint.target.id) ?? hint.target).map((a) => {
          const chosen = hint.snap?.anchor === a.anchor;
          return (
            <Circle
              key={a.anchor}
              x={a.x}
              y={a.y}
              radius={(chosen ? 6 : 4) / zoom}
              fill={chosen ? "#4c8dff" : "#ffffff"}
              stroke="#4c8dff"
              strokeWidth={stroke}
              listening={false}
            />
          );
        })}

      {geometry.bendHandle && (
        <Rect
          {...common}
          x={geometry.bendHandle.x + element.x}
          y={geometry.bendHandle.y + element.y}
          width={radius * 1.6}
          height={radius * 1.6}
          offsetX={radius * 0.8}
          offsetY={radius * 0.8}
          rotation={45}
          fill="#ffcc4d"
          onDragMove={dragBend}
        />
      )}

      {geometry.elbowHandle && (
        <Rect
          {...common}
          x={geometry.elbowHandle.x + element.x}
          y={geometry.elbowHandle.y + element.y}
          width={radius * 1.6}
          height={radius * 1.6}
          offsetX={radius * 0.8}
          offsetY={radius * 0.8}
          fill="#ffcc4d"
          onDragMove={dragElbow}
        />
      )}

      {endHandle("start", start)}
      {endHandle("end", end)}
    </>
  );
}

/**
 * The grid overlay.
 *
 * Lines are drawn only across the page, not the infinite canvas, because the
 * grid exists to place things within the figure. Line width is divided by the
 * zoom so it stays hairline-thin at any magnification, and every fifth line is
 * drawn stronger so a spacing of 10 is still countable.
 */
function GridOverlay({ canvas, grid, zoom }) {
  const size = Math.max(2, grid.size);
  const lines = [];

  for (let x = size, i = 1; x < canvas.width; x += size, i += 1) {
    lines.push(
      <Line
        key={`gx${i}`}
        points={[x, 0, x, canvas.height]}
        stroke={grid.color}
        strokeWidth={(i % 5 === 0 ? 1.4 : 0.7) / zoom}
        opacity={i % 5 === 0 ? 0.55 : 0.3}
      />
    );
  }
  for (let y = size, i = 1; y < canvas.height; y += size, i += 1) {
    lines.push(
      <Line
        key={`gy${i}`}
        points={[0, y, canvas.width, y]}
        stroke={grid.color}
        strokeWidth={(i % 5 === 0 ? 1.4 : 0.7) / zoom}
        opacity={i % 5 === 0 ? 0.55 : 0.3}
      />
    );
  }
  return <>{lines}</>;
}

/**
 * Hold space to pan, like every other design tool. Kept as its own component
 * so the key listeners don't re-register on every stage render.
 */
function SpacebarPanHint({ onChange }) {
  useEffect(() => {
    const isTypingTarget = (t) =>
      t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

    const down = (e) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) {
        e.preventDefault();
        onChange(true);
      }
    };
    const up = (e) => {
      if (e.code === "Space") onChange(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [onChange]);
  return null;
}
