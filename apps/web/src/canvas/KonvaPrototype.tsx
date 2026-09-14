import { useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import { Arrow, Group, Layer, Line, Path, Rect, Stage, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { commitHistory, createHistory, redoHistory, undoHistory } from "../domain/history";
import type {
  GraphNodeObject,
  NotebookFixture,
  NotebookObject,
  PointSample,
  StrokeObject,
} from "../domain/notebook";
import { LearningCard } from "../components/LearningCard";
import { getStrokePath } from "./strokePath";
import { objectIntersectsPolygon } from "./selectionMath";
import { appendDistinctPoints, strokeIntersectsPoint } from "./strokeMath";
import { useElementSize } from "./useElementSize";

type Props = {
  fixture: NotebookFixture;
  onObjectsChange?: (objects: NotebookObject[]) => void;
};
type Tool = "select" | "lasso" | "pen" | "highlighter" | "eraser" | "pan";
type Position = { x: number; y: number };
type Camera = Position & { scale: number };
type Gesture = {
  pointerId: number;
  kind: "stroke" | "erase" | "pan" | "lasso";
  lastScreen: Position;
  strokeTool?: StrokeObject["tool"];
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

const clampZoom = (scale: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
const isStroke = (object: NotebookObject): object is StrokeObject => object.kind === "stroke";
const isGraphNode = (object: NotebookObject): object is GraphNodeObject => object.kind === "graph-node";

export function KonvaPrototype({ fixture, onObjectsChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(rootRef);
  const [tool, setTool] = useState<Tool>("select");
  const [history, setHistory] = useState(() => createHistory(fixture.objects));
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, scale: 0.86 });
  const [penSize, setPenSize] = useState(4.5);
  const [highlighterSize, setHighlighterSize] = useState(22);
  const [fingerDrawing, setFingerDrawing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [transientPositions, setTransientPositions] = useState<Record<string, Position>>({});
  const [liveStroke, setLiveStroke] = useState<PointSample[]>([]);
  const [lassoPoints, setLassoPoints] = useState<PointSample[]>([]);
  const [erasingIds, setErasingIds] = useState<Set<string>>(() => new Set());
  const liveStrokeRef = useRef<PointSample[]>([]);
  const lassoPointsRef = useRef<PointSample[]>([]);
  const erasingIdsRef = useRef<Set<string>>(new Set());
  const gestureRef = useRef<Gesture>();
  const animationFrameRef = useRef<number>();
  const lastNotifiedObjectsRef = useRef(fixture.objects);

  const objects = history.present;
  const strokes = objects.filter(isStroke);
  const nodes = objects.filter(isGraphNode);
  const connectors = objects.filter((object) => object.kind === "connector");
  const cards = objects.filter(
    (object) => object.kind === "text-card" || object.kind === "equation-card" || object.kind === "quiz-card",
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  useEffect(() => () => {
    if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  useEffect(() => {
    if (history.present === lastNotifiedObjectsRef.current) return;
    lastNotifiedObjectsRef.current = history.present;
    onObjectsChange?.(history.present);
  }, [history.present, onObjectsChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, button, [contenteditable='true']")) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setHistory((current) => event.shiftKey ? redoHistory(current) : undoHistory(current));
      } else if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        setHistory(redoHistory);
      } else if (!modifier) {
        const shortcut: Partial<Record<string, Tool>> = { v: "select", l: "lasso", p: "pen", h: "highlighter", e: "eraser", " ": "pan" };
        const nextTool = shortcut[event.key.toLowerCase()];
        if (nextTool) {
          event.preventDefault();
          setTool(nextTool);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const positionFor = (object: NotebookObject) => transientPositions[object.id] ?? { x: object.x, y: object.y };

  const commitObjects = (update: (objects: NotebookObject[]) => NotebookObject[]) => {
    setHistory((current) => commitHistory(current, update(current.present)));
  };

  const previewPosition = (id: string, position: Position) => {
    setTransientPositions((current) => ({ ...current, [id]: position }));
  };

  const commitPosition = (id: string, position: Position) => {
    commitObjects((current) => current.map((object) =>
      object.id === id ? { ...object, x: position.x, y: position.y, revision: object.revision + 1 } : object,
    ));
    setTransientPositions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const selectObject = (id: string, additive = false) => {
    setSelectedIds((current) => {
      if (!additive) return new Set([id]);
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelection = () => {
    if (selectedIds.size === 0) return;
    const removed = new Set(selectedIds);
    commitObjects((current) => current.filter((object) =>
      !removed.has(object.id)
      && (object.kind !== "connector" || (!removed.has(object.fromId) && !removed.has(object.toId))),
    ));
    setSelectedIds(new Set());
  };

  const duplicateSelection = () => {
    if (selectedIds.size === 0) return;
    const selectedObjects = objects.filter((object) => selectedIds.has(object.id));
    const boundConnectors = objects.filter((object) =>
      object.kind === "connector" && selectedIds.has(object.fromId) && selectedIds.has(object.toId),
    );
    const sources = [...selectedObjects, ...boundConnectors.filter((connector) => !selectedIds.has(connector.id))];
    const idMap = new Map(sources.map((object) => [object.id, `${object.kind}-${crypto.randomUUID()}`]));
    const copies = sources.map((object): NotebookObject => {
      if (object.kind === "connector") {
        return {
          ...object,
          id: idMap.get(object.id)!,
          revision: 1,
          fromId: idMap.get(object.fromId) ?? object.fromId,
          toId: idMap.get(object.toId) ?? object.toId,
        };
      }
      if (object.kind === "stroke") {
        return {
          ...object,
          id: idMap.get(object.id)!,
          revision: 1,
          x: object.x + 32,
          y: object.y + 32,
          points: object.points.map((point) => ({ ...point, x: point.x + 32, y: point.y + 32 })),
        };
      }
      return { ...object, id: idMap.get(object.id)!, revision: 1, x: object.x + 32, y: object.y + 32 };
    });
    commitObjects((current) => [...current, ...copies]);
    setSelectedIds(new Set(copies.filter((object) => object.kind !== "connector").map((object) => object.id)));
  };

  const screenToWorld = (clientX: number, clientY: number, rect: DOMRect, pressure: number, time: number): PointSample => ({
    x: (clientX - rect.left - camera.x) / camera.scale,
    y: (clientY - rect.top - camera.y) / camera.scale,
    pressure: pressure > 0 ? pressure : 0.5,
    time,
  });

  const scheduleLiveStrokeRender = () => {
    if (animationFrameRef.current !== undefined) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = undefined;
      setLiveStroke([...liveStrokeRef.current]);
    });
  };

  const eraseAt = (point: PointSample) => {
    const next = new Set(erasingIdsRef.current);
    for (const stroke of strokes) {
      if (strokeIntersectsPoint(stroke, point, 10 / camera.scale)) next.add(stroke.id);
    }
    erasingIdsRef.current = next;
    setErasingIds(next);
  };

  const pointFromPointer = (nativeEvent: PointerEvent, rect: DOMRect) =>
    screenToWorld(
      nativeEvent.clientX,
      nativeEvent.clientY,
      rect,
      nativeEvent.pointerType === "mouse" ? 0.5 : nativeEvent.pressure,
      nativeEvent.timeStamp,
    );

  const beginInput = (event: KonvaEventObject<PointerEvent>) => {
    const nativeEvent = event.evt;
    if (gestureRef.current) return;
    const stage = event.target.getStage();
    const rect = stage?.container().getBoundingClientRect();
    if (!rect) return;

    nativeEvent.preventDefault();
    (nativeEvent.currentTarget as HTMLCanvasElement | null)?.setPointerCapture(nativeEvent.pointerId);
    const touchShouldPan = nativeEvent.pointerType === "touch" && !fingerDrawing && (tool === "pen" || tool === "highlighter");
    const kind: Gesture["kind"] = tool === "pan" || touchShouldPan
      ? "pan"
      : tool === "eraser"
        ? "erase"
        : tool === "lasso"
          ? "lasso"
          : "stroke";
    gestureRef.current = {
      pointerId: nativeEvent.pointerId,
      kind,
      lastScreen: { x: nativeEvent.clientX, y: nativeEvent.clientY },
      strokeTool: tool === "highlighter" ? "highlighter" : "pen",
    };

    if (kind === "stroke") {
      liveStrokeRef.current = [pointFromPointer(nativeEvent, rect)];
      scheduleLiveStrokeRender();
    } else if (kind === "lasso") {
      const point = pointFromPointer(nativeEvent, rect);
      lassoPointsRef.current = [point];
      setLassoPoints([point]);
    } else if (kind === "erase") {
      eraseAt(pointFromPointer(nativeEvent, rect));
    }
  };

  const extendInput = (event: KonvaEventObject<PointerEvent>) => {
    const gesture = gestureRef.current;
    const nativeEvent = event.evt;
    if (!gesture || gesture.pointerId !== nativeEvent.pointerId) return;

    if (gesture.kind === "pan") {
      const deltaX = nativeEvent.clientX - gesture.lastScreen.x;
      const deltaY = nativeEvent.clientY - gesture.lastScreen.y;
      gesture.lastScreen = { x: nativeEvent.clientX, y: nativeEvent.clientY };
      setCamera((current) => ({ ...current, x: current.x + deltaX, y: current.y + deltaY }));
      return;
    }

    const stage = event.target.getStage();
    const rect = stage?.container().getBoundingClientRect();
    if (!rect) return;
    const samples = nativeEvent.getCoalescedEvents?.() ?? [nativeEvent];
    const points = samples.map((sample) => pointFromPointer(sample, rect));

    if (gesture.kind === "stroke") {
      liveStrokeRef.current = appendDistinctPoints(liveStrokeRef.current, points, 0.35 / camera.scale);
      scheduleLiveStrokeRender();
    } else if (gesture.kind === "lasso") {
      lassoPointsRef.current = appendDistinctPoints(lassoPointsRef.current, points, 1 / camera.scale);
      setLassoPoints([...lassoPointsRef.current]);
    } else {
      points.forEach(eraseAt);
    }
  };

  const finishInput = (cancelled = false) => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (!cancelled && gesture.kind === "stroke" && liveStrokeRef.current.length > 1) {
      const points = liveStrokeRef.current;
      const strokeTool = gesture.strokeTool ?? "pen";
      const strokeSize = strokeTool === "highlighter" ? highlighterSize : penSize;
      const padding = strokeSize / 2;
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const stroke: StrokeObject = {
        id: `stroke-${crypto.randomUUID()}`,
        revision: 1,
        kind: "stroke",
        tool: strokeTool,
        color: strokeTool === "highlighter" ? "#f5c842" : "#183153",
        size: strokeSize,
        x: Math.min(...xs) - padding,
        y: Math.min(...ys) - padding,
        width: Math.max(...xs) - Math.min(...xs) + padding * 2,
        height: Math.max(...ys) - Math.min(...ys) + padding * 2,
        points,
      };
      commitObjects((current) => [...current, stroke]);
    }

    if (!cancelled && gesture.kind === "erase" && erasingIdsRef.current.size > 0) {
      const removedIds = new Set(erasingIdsRef.current);
      commitObjects((current) => current.filter((object) => !removedIds.has(object.id)));
    }

    if (!cancelled && gesture.kind === "lasso" && lassoPointsRef.current.length > 2) {
      const selected = new Set(
        objects
          .filter((object) => object.kind !== "connector" && objectIntersectsPolygon(object, lassoPointsRef.current))
          .map((object) => object.id),
      );
      for (const connector of connectors) {
        if (selected.has(connector.fromId) && selected.has(connector.toId)) selected.add(connector.id);
      }
      setSelectedIds(selected);
      setTool("select");
    }

    gestureRef.current = undefined;
    liveStrokeRef.current = [];
    lassoPointsRef.current = [];
    erasingIdsRef.current = new Set();
    setLiveStroke([]);
    setLassoPoints([]);
    setErasingIds(new Set());
  };

  const zoomAt = (nextScale: number, anchor: Position) => {
    setCamera((current) => {
      const scale = clampZoom(nextScale);
      const worldX = (anchor.x - current.x) / current.scale;
      const worldY = (anchor.y - current.y) / current.scale;
      return { scale, x: anchor.x - worldX * scale, y: anchor.y - worldY * scale };
    });
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.003);
      zoomAt(camera.scale * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    } else {
      setCamera((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    }
  };

  const resetCamera = () => setCamera({ x: 24, y: 24, scale: 0.86 });
  const inputActive = tool !== "select";
  const visibleStrokes = strokes.filter((stroke) => !erasingIds.has(stroke.id));
  const currentStrokeTool = tool === "highlighter" ? "highlighter" : "pen";
  const currentStrokeSize = currentStrokeTool === "highlighter" ? highlighterSize : penSize;

  return (
    <section className="prototype">
      <div className="prototype-toolbar" aria-label="Canvas tools">
        <div className="tool-group" role="group" aria-label="Drawing tools">
          {([
            ["select", "Select", "V"],
            ["lasso", "Lasso", "L"],
            ["pen", "Pen", "P"],
            ["highlighter", "Highlight", "H"],
            ["eraser", "Eraser", "E"],
            ["pan", "Hand", "Space"],
          ] as const).map(([value, label, shortcut]) => (
            <button key={value} type="button" aria-pressed={tool === value} onClick={() => setTool(value)} title={`${label} (${shortcut})`}>
              {label}
            </button>
          ))}
        </div>

        {(tool === "pen" || tool === "highlighter") && (
          <label className="size-control">
            <span>Size</span>
            <input
              type="range"
              min={tool === "pen" ? 1.5 : 10}
              max={tool === "pen" ? 14 : 40}
              step={0.5}
              value={currentStrokeSize}
              onChange={(event) => tool === "pen" ? setPenSize(Number(event.target.value)) : setHighlighterSize(Number(event.target.value))}
            />
            <output>{currentStrokeSize}px</output>
          </label>
        )}

        <label className="finger-toggle">
          <input type="checkbox" checked={fingerDrawing} onChange={(event) => setFingerDrawing(event.target.checked)} />
          Finger draws
        </label>

        <div className="tool-group" role="group" aria-label="History">
          <button type="button" disabled={history.past.length === 0} onClick={() => setHistory(undoHistory)} title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" disabled={history.future.length === 0} onClick={() => setHistory(redoHistory)} title="Redo (Ctrl+Y)">Redo</button>
        </div>

        <div className="tool-group" role="group" aria-label="Selection actions">
          <span>{selectedIds.size} selected</span>
          <button type="button" disabled={selectedIds.size === 0} onClick={duplicateSelection}>Duplicate</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={deleteSelection}>Delete</button>
        </div>

        <div className="tool-group" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomAt(camera.scale / 1.2, { x: size.width / 2, y: size.height / 2 })} aria-label="Zoom out">−</button>
          <button type="button" onClick={resetCamera} title="Reset camera">{Math.round(camera.scale * 100)}%</button>
          <button type="button" onClick={() => zoomAt(camera.scale * 1.2, { x: size.width / 2, y: size.height / 2 })} aria-label="Zoom in">+</button>
        </div>
      </div>

      <div className="canvas-viewport" ref={rootRef} data-tool={tool} onWheel={handleWheel}>
        {size.width > 0 && size.height > 0 && (
          <Stage width={size.width} height={size.height} className="konva-stage">
            <Layer>
              <Rect width={size.width} height={size.height} fill="#fbfaf5" onPointerDown={() => setSelectedIds(new Set())} />
            </Layer>
            <Layer listening={tool === "select"}>
              <Group x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale}>
                {connectors.map((connector) => {
                  const from = nodeById.get(connector.fromId);
                  const to = nodeById.get(connector.toId);
                  if (!from || !to) return null;
                  const fromPosition = positionFor(from);
                  const toPosition = positionFor(to);
                  return (
                    <Arrow
                      key={connector.id}
                      points={[fromPosition.x + from.width, fromPosition.y + from.height / 2, toPosition.x, toPosition.y + to.height / 2]}
                      stroke="#537188"
                      fill="#537188"
                      strokeWidth={2.5}
                      pointerLength={9}
                      pointerWidth={8}
                    />
                  );
                })}

                {nodes.map((node) => {
                  const position = positionFor(node);
                  return (
                    <Group
                      key={node.id}
                      x={position.x}
                      y={position.y}
                      draggable={tool === "select"}
                      onPointerDown={(event) => selectObject(node.id, event.evt.shiftKey)}
                      onDragMove={(event) => previewPosition(node.id, { x: event.target.x(), y: event.target.y() })}
                      onDragEnd={(event) => commitPosition(node.id, { x: event.target.x(), y: event.target.y() })}
                    >
                      <Rect
                        width={node.width}
                        height={node.height}
                        fill="#e7f0ef"
                        stroke={selectedIds.has(node.id) ? "#ef8c45" : "#2c5f5d"}
                        strokeWidth={selectedIds.has(node.id) ? 3 : 2}
                        cornerRadius={18}
                        shadowBlur={8}
                        shadowOpacity={0.08}
                      />
                      <Text width={node.width} height={node.height} text={node.label} align="center" verticalAlign="middle" fontSize={17} fontFamily="Inter, sans-serif" fill="#163b3a" />
                    </Group>
                  );
                })}
              </Group>
            </Layer>
          </Stage>
        )}

        <div
          className="card-layer"
          aria-hidden={tool !== "select"}
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
        >
          {cards.map((card) => (
            <LearningCard
              key={card.id}
              object={card}
              position={positionFor(card)}
              cameraScale={camera.scale}
              selected={selectedIds.has(card.id)}
              onSelect={(additive) => selectObject(card.id, additive)}
              onMove={(position) => previewPosition(card.id, position)}
              onMoveEnd={(position) => commitPosition(card.id, position)}
            />
          ))}
        </div>

        {size.width > 0 && size.height > 0 && (
          <Stage
            width={size.width}
            height={size.height}
            className="ink-stage"
            style={{ pointerEvents: inputActive ? "auto" : "none" }}
            onPointerDown={beginInput}
            onPointerMove={extendInput}
            onPointerUp={() => finishInput(false)}
            onPointerCancel={() => finishInput(true)}
          >
            <Layer listening={inputActive}>
              <Group x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale}>
                {visibleStrokes.filter((stroke) => stroke.tool === "highlighter").map((stroke) => (
                  <Path
                    key={stroke.id}
                    data={getStrokePath(stroke.points, stroke.size, stroke.tool)}
                    fill={stroke.color}
                    opacity={0.3}
                    globalCompositeOperation="multiply"
                    stroke={selectedIds.has(stroke.id) ? "#ef8c45" : undefined}
                    strokeWidth={selectedIds.has(stroke.id) ? 2 / camera.scale : 0}
                  />
                ))}
                {visibleStrokes.filter((stroke) => stroke.tool === "pen").map((stroke) => (
                  <Path
                    key={stroke.id}
                    data={getStrokePath(stroke.points, stroke.size, stroke.tool)}
                    fill={stroke.color}
                    stroke={selectedIds.has(stroke.id) ? "#ef8c45" : undefined}
                    strokeWidth={selectedIds.has(stroke.id) ? 2 / camera.scale : 0}
                  />
                ))}
                {lassoPoints.length > 1 && (
                  <Line
                    points={lassoPoints.flatMap((point) => [point.x, point.y])}
                    closed
                    fill="rgba(239, 140, 69, 0.1)"
                    stroke="#ef8c45"
                    strokeWidth={1.5 / camera.scale}
                    dash={[8 / camera.scale, 6 / camera.scale]}
                  />
                )}
                {liveStroke.length > 1 && (
                  <Path
                    data={getStrokePath(liveStroke, currentStrokeSize, currentStrokeTool)}
                    fill={currentStrokeTool === "highlighter" ? "#f5c842" : "#183153"}
                    opacity={currentStrokeTool === "highlighter" ? 0.3 : 1}
                    globalCompositeOperation={currentStrokeTool === "highlighter" ? "multiply" : "source-over"}
                  />
                )}
              </Group>
            </Layer>
          </Stage>
        )}

        <div className="canvas-status" aria-live="polite">
          <span>{tool === "eraser" ? "Whole-stroke eraser" : `${tool[0].toUpperCase()}${tool.slice(1)} tool`}</span>
          <span>{strokes.length} strokes</span>
          <span>Wheel: pan · Ctrl+wheel: zoom</span>
        </div>
      </div>
    </section>
  );
}
