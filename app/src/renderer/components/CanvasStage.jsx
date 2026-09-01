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
import { useSvgImage, useSvgImageFromText } from "../lib/useSvgImage";
import { buildIsolationSvg, effectiveColorMap } from "../lib/svgPalette";
import { computeSnap, pointsBounds } from "../lib/geometry";

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

export default function CanvasStage({ stageRef, onRequestTextEdit, onExternalDrop }) {
  const elements = useStore((s) => s.elements);
  const canvas = useStore((s) => s.canvas);
  const selectedIds = useStore((s) => s.selectedIds);
  const zoom = useStore((s) => s.zoom);
  const stagePos = useStore((s) => s.stagePos);
  const activeTool = useStore((s) => s.activeTool);
  const highlight = useStore((s) => s.highlight);

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
      } else {
        setStagePos({ x: stagePos.x - e.evt.deltaX, y: stagePos.y - e.evt.deltaY });
      }
    },
    [zoom, stagePos, setZoom, setStagePos]
  );

  // -- clicking empty space -------------------------------------------------

  const handleStageMouseDown = useCallback(
    (e) => {
      const clickedEmpty = e.target === e.target.getStage() || e.target.name() === "canvas-bg";
      if (!clickedEmpty) return;

      // A drawing tool places its shape where the user clicked.
      if (activeTool !== "select") {
        const stage = e.target.getStage();
        const pointer = stage.getPointerPosition();
        const at = {
          x: (pointer.x - stagePos.x) / zoom,
          y: (pointer.y - stagePos.y) / zoom,
        };
        if (activeTool === "text") addText(at);
        else addShape(activeTool, at);
        return;
      }
      clearSelection();
    },
    [activeTool, stagePos, zoom, addShape, addText, clearSelection]
  );

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
    [elements, canvas, zoom]
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

  /** Assets dragged out of the sidebar land where they were dropped. */
  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/x-morphly-asset");
      if (!raw) return;
      const rect = containerRef.current.getBoundingClientRect();
      const at = {
        x: (e.clientX - rect.left - stagePos.x) / zoom,
        y: (e.clientY - rect.top - stagePos.y) / zoom,
      };
      try {
        onExternalDrop?.(at, JSON.parse(raw));
      } catch {
        /* malformed payload -- ignore rather than break the drop */
      }
    },
    [stagePos, zoom, onExternalDrop]
  );

  return (
    <div
      className="canvas-host"
      ref={containerRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-morphly-asset")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleDrop}
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
              onDblClick={() => {
                if (element.locked) return;
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

        {/* Snapping guides, drawn above everything */}
        <Layer listening={false}>
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

      <SpacebarPanHint onChange={setIsPanning} />
    </div>
  );
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
