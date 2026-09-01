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
  Line,
  Arrow,
  Text as KonvaText,
  Image as KonvaImage,
  Transformer,
} from "react-konva";

import { useStore } from "../store";
import { useSvgImage, useSvgImageFromText, useRasterImage } from "../lib/useSvgImage";
import { offsets, cellAtPoint, cellCorners, isHeaderCell } from "../lib/tableLayout";
import { buildIsolationSvg, effectiveColorMap } from "../lib/svgPalette";
import { computeSnap, pointsBounds } from "../lib/geometry";
import CanvasScrollbars from "./CanvasScrollbars";

const SNAP_THRESHOLD = 6; // canvas units, scaled by zoom at call time

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

function ElementShape({ element }) {
  switch (element.type) {
    case "rect":
      return (
        <Rect
          width={element.width}
          height={element.height}
          fill={element.fill}
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
      return (
        <Line
          points={element.points}
          stroke={element.fill}
          strokeWidth={element.strokeWidth}
          lineCap="round"
        />
      );
    case "arrow":
      return (
        <Arrow
          points={element.points}
          stroke={element.fill}
          fill={element.fill}
          strokeWidth={element.strokeWidth}
          pointerLength={element.strokeWidth * 3}
          pointerWidth={element.strokeWidth * 3}
          // "none" | "end" (default) | "both"
          pointerAtEnding={element.heads !== "none"}
          pointerAtBeginning={element.heads === "both"}
          lineCap="round"
        />
      );
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

/** Shapes that can carry a centred caption. */
const LABELLABLE = ["rect", "ellipse", "triangle"];

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export default function CanvasStage({ stageRef, onRequestTextEdit, onExternalDrop, onDropFiles }) {
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
  const [guides, setGuides] = useState({ vertical: null, horizontal: null });
  const [isPanning, setIsPanning] = useState(false);
  /** Positions of every selected element when a drag began, so a group can be
   *  moved as one piece. */
  const dragStartRef = useRef(null);

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

  // Attach the transformer to whatever is selected.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const nodes = selectedIds
      .map((id) => nodeRefs.current.get(id))
      .filter(Boolean)
      .filter((node) => {
        const el = elements.find((e) => e.id === node.id());
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
    },
    [commit, selectedIds, elements]
  );

  const handleDragMove = useCallback(
    (e, element) => {
      const node = e.target;
      const start = dragStartRef.current;

      // Snap against everything that isn't moving with us.
      const movingIds = new Set([element.id, ...(start?.members ?? []).map((m) => m.id)]);
      const others = elements.filter((el) => !movingIds.has(el.id) && el.visible);
      const dragged = { ...element, x: node.x(), y: node.y() };
      const snap = computeSnap(dragged, others, canvas, SNAP_THRESHOLD / zoom);

      // Snapping to the grid, when it is on, takes precedence over the element
      // guides: a user who asked for a grid wants things on it.
      if (grid.visible && grid.snap) {
        snap.x = Math.round(snap.x / grid.size) * grid.size;
        snap.y = Math.round(snap.y / grid.size) * grid.size;
        snap.guides = { vertical: null, horizontal: null };
      }

      node.x(snap.x);
      node.y(snap.y);
      setGuides(snap.guides);

      if (start) {
        const dx = snap.x - start.origin.x;
        const dy = snap.y - start.origin.y;
        for (const member of start.members) {
          const companion = nodeRefs.current.get(member.id);
          if (companion) {
            companion.x(member.x + dx);
            companion.y(member.y + dy);
          }
        }
      }
    },
    [elements, canvas, zoom, grid]
  );

  const handleDragEnd = useCallback(
    (e, element) => {
      setGuides({ vertical: null, horizontal: null });
      const start = dragStartRef.current;
      const x = e.target.x();
      const y = e.target.y();

      if (start && start.members.length > 0) {
        // Commit the whole move in one update, without a second history entry
        // (handleDragStart already pushed one).
        const dx = x - start.origin.x;
        const dy = y - start.origin.y;
        useStore.setState((s) => ({
          elements: s.elements.map((el) => {
            if (el.id === element.id) return { ...el, x, y };
            const member = start.members.find((m) => m.id === el.id);
            return member ? { ...el, x: member.x + dx, y: member.y + dy } : el;
          }),
          dirty: true,
        }));
      } else {
        updateElement(element.id, { x, y }, { commit: false });
      }
      dragStartRef.current = null;
    },
    [updateElement]
  );

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
              onTransformEnd={(e) => handleTransformEnd(e, element)}
            >
              <ElementShape element={element} />
              {LABELLABLE.includes(element.type) && <ShapeLabel element={element} />}
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
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 8 || newBox.height < 8 ? oldBox : newBox
            }
          />
        </Layer>

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
          {guides.vertical !== null && (
            <Line
              points={[guides.vertical, -10000, guides.vertical, 10000]}
              stroke="#ff3ea5"
              strokeWidth={1 / zoom}
              dash={[4 / zoom, 4 / zoom]}
            />
          )}
          {guides.horizontal !== null && (
            <Line
              points={[-10000, guides.horizontal, 10000, guides.horizontal]}
              stroke="#ff3ea5"
              strokeWidth={1 / zoom}
              dash={[4 / zoom, 4 / zoom]}
            />
          )}
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
