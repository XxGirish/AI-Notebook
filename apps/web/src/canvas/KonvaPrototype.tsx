import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Arrow, Circle, Ellipse, Group, Layer, Line, Path, Rect, Stage, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { commitHistory, createHistory, redoHistory, undoHistory } from "../domain/history";
import type {
  AiTransactionRecord,
  GraphNodeObject,
  ImageObject,
  NotebookFixture,
  NotebookObject,
  PointSample,
  ShapeObject,
  StrokeObject,
} from "../domain/notebook";
import { applyCanvasBatch, prepareCanvasBatch, transactionRecordFromBatch, type PreparedCanvasBatch } from "../ai/proposalCompiler";
import { validateCanvasProposal, type SemanticOperationType } from "../ai/proposalSchema";
import { LearningCard } from "../components/LearningCard";
import { mockLessonProposal } from "../fixtures/mockLessonProposal";
import { saveAsset } from "../persistence/notebookDatabase";
import { isQuotaExceededError } from "../persistence/storageHealth";
import { CanvasImage } from "./CanvasImage";
import { getStrokePath } from "./strokePath";
import { expandGroupedIds, groupObjects, translateObjectGroup, ungroupObjects } from "./groupMath";
import { objectIntersectsPolygon } from "./selectionMath";
import { boundsFromPoints, sizeFromBottomRightHandle, type CanvasBounds } from "./shapeMath";
import { appendDistinctPoints, strokeIntersectsPoint } from "./strokeMath";
import { useElementSize } from "./useElementSize";
import { wheelDeltaInPixels, wheelZoomScale, zoomCameraAt, type Camera } from "./cameraMath";

type Props = {
  fixture: NotebookFixture;
  readOnly?: boolean;
  onObjectsChange?: (objects: NotebookObject[], aiTransaction?: AiTransactionRecord) => void;
};
type Tool = "select" | "lasso" | "pen" | "highlighter" | "eraser" | "rectangle" | "ellipse" | "pan";
type Position = { x: number; y: number };
type Size = { width: number; height: number };
type Gesture = {
  pointerId: number;
  kind: "stroke" | "erase" | "pan" | "lasso" | "shape";
  lastScreen: Position;
  strokeTool?: StrokeObject["tool"];
  startWorld?: Position;
  shapeType?: ShapeObject["shape"];
};

const isStroke = (object: NotebookObject): object is StrokeObject => object.kind === "stroke";
const isGraphNode = (object: NotebookObject): object is GraphNodeObject => object.kind === "graph-node";
const isShape = (object: NotebookObject): object is ShapeObject => object.kind === "shape";
const isImage = (object: NotebookObject): object is ImageObject => object.kind === "image";
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const readImageDimensions = (blob: Blob) => new Promise<Size>((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve({ width: image.naturalWidth, height: image.naturalHeight });
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error("The selected image could not be decoded."));
  };
  image.src = url;
});

export function KonvaPrototype({ fixture, readOnly = false, onObjectsChange }: Props) {
  const prototypeRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const size = useElementSize(rootRef);
  const [tool, setTool] = useState<Tool>("select");
  const [history, setHistory] = useState(() => createHistory(fixture.objects));
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, scale: 0.86 });
  const [penSize, setPenSize] = useState(4.5);
  const [highlighterSize, setHighlighterSize] = useState(22);
  const [fingerDrawing, setFingerDrawing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenFallback, setFullscreenFallback] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [transientPositions, setTransientPositions] = useState<Record<string, Position>>({});
  const [transientSizes, setTransientSizes] = useState<Record<string, Size>>({});
  const [liveStroke, setLiveStroke] = useState<PointSample[]>([]);
  const [lassoPoints, setLassoPoints] = useState<PointSample[]>([]);
  const [draftShape, setDraftShape] = useState<(CanvasBounds & { shape: ShapeObject["shape"] })>();
  const [imageNotice, setImageNotice] = useState<string>();
  const [aiDraft, setAiDraft] = useState<PreparedCanvasBatch>();
  const [aiDraftError, setAiDraftError] = useState<string>();
  const [erasingIds, setErasingIds] = useState<Set<string>>(() => new Set());
  const liveStrokeRef = useRef<PointSample[]>([]);
  const lassoPointsRef = useRef<PointSample[]>([]);
  const draftShapeRef = useRef<(CanvasBounds & { shape: ShapeObject["shape"] })>();
  const erasingIdsRef = useRef<Set<string>>(new Set());
  const gestureRef = useRef<Gesture>();
  const animationFrameRef = useRef<number>();
  const lastNotifiedObjectsRef = useRef(fixture.objects);
  const pendingAiTransactionRef = useRef<AiTransactionRecord>();
  const committedAiTransactionIdsRef = useRef(new Set(fixture.aiTransactions.map((transaction) => transaction.transactionId)));

  const objects = history.present;
  const strokes = objects.filter(isStroke);
  const nodes = objects.filter(isGraphNode);
  const shapes = objects.filter(isShape);
  const images = objects.filter(isImage);
  const connectors = objects.filter((object) => object.kind === "connector");
  const cards = objects.filter(
    (object) => object.kind === "text-card" || object.kind === "equation-card" || object.kind === "quiz-card",
  );
  const connectables = useMemo(() => [...nodes, ...shapes, ...images], [nodes, shapes, images]);
  const connectableById = useMemo(() => new Map(connectables.map((object) => [object.id, object])), [connectables]);

  useEffect(() => () => {
    if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  useEffect(() => {
    if (readOnly) {
      if (tool !== "select" && tool !== "pan") setTool("select");
      setAiDraft(undefined);
    }
  }, [readOnly, tool]);

  useEffect(() => {
    const viewport = rootRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const deltaX = wheelDeltaInPixels(event.deltaX, event.deltaMode, rect.height);
      const deltaY = wheelDeltaInPixels(event.deltaY, event.deltaMode, rect.height);

      if (event.ctrlKey || event.metaKey) {
        const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        setCamera((current) => zoomCameraAt(current, wheelZoomScale(current.scale, deltaY), anchor));
        return;
      }

      setCamera((current) => ({ ...current, x: current.x - deltaX, y: current.y - deltaY }));
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === prototypeRef.current;
      setIsFullscreen(active || fullscreenFallback);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [fullscreenFallback]);

  useEffect(() => {
    if (!fullscreenFallback) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreenFallback(false);
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", exitOnEscape);
    };
  }, [fullscreenFallback]);

  useEffect(() => {
    if (history.present === lastNotifiedObjectsRef.current) return;
    lastNotifiedObjectsRef.current = history.present;
    const transaction = pendingAiTransactionRef.current;
    pendingAiTransactionRef.current = undefined;
    onObjectsChange?.(history.present, transaction);
  }, [history.present, onObjectsChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, button, [contenteditable='true']")) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        if (readOnly) return;
        event.preventDefault();
        setHistory((current) => event.shiftKey ? redoHistory(current) : undoHistory(current));
      } else if (modifier && event.key.toLowerCase() === "y") {
        if (readOnly) return;
        event.preventDefault();
        setHistory(redoHistory);
      } else if (!modifier) {
        const shortcut: Partial<Record<string, Tool>> = { v: "select", l: "lasso", p: "pen", h: "highlighter", e: "eraser", r: "rectangle", o: "ellipse", " ": "pan" };
        const nextTool = shortcut[event.key.toLowerCase()];
        if (nextTool && (!readOnly || nextTool === "select" || nextTool === "pan")) {
          event.preventDefault();
          setTool(nextTool);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [readOnly]);

  const positionFor = (object: NotebookObject) => transientPositions[object.id] ?? { x: object.x, y: object.y };
  const sizeFor = (object: NotebookObject) => transientSizes[object.id] ?? { width: object.width, height: object.height };

  const commitObjects = (update: (objects: NotebookObject[]) => NotebookObject[]) => {
    if (readOnly) return;
    setHistory((current) => commitHistory(current, update(current.present)));
  };

  const previewPosition = (id: string, position: Position) => {
    const anchor = objects.find((object) => object.id === id);
    if (!anchor) return;
    const members = anchor.groupId ? objects.filter((object) => object.groupId === anchor.groupId) : [anchor];
    const delta = { x: position.x - anchor.x, y: position.y - anchor.y };
    setTransientPositions((current) => {
      const next = { ...current };
      for (const member of members) {
        if (member.kind !== "connector") next[member.id] = { x: member.x + delta.x, y: member.y + delta.y };
      }
      return next;
    });
  };

  const commitPosition = (id: string, position: Position) => {
    const anchor = objects.find((object) => object.id === id);
    const movedIds = new Set(anchor?.groupId
      ? objects.filter((object) => object.groupId === anchor.groupId).map((object) => object.id)
      : [id]);
    commitObjects((current) => translateObjectGroup(current, id, position));
    setTransientPositions((current) => {
      const next = { ...current };
      for (const movedId of movedIds) delete next[movedId];
      return next;
    });
  };

  const previewSize = (id: string, nextSize: Size) => {
    setTransientSizes((current) => ({ ...current, [id]: nextSize }));
  };

  const commitSize = (id: string, nextSize: Size) => {
    commitObjects((current) => current.map((object) =>
      object.id === id ? { ...object, width: nextSize.width, height: nextSize.height, revision: object.revision + 1 } : object,
    ));
    setTransientSizes((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const resizeFromHandle = (event: KonvaEventObject<DragEvent>, id: string, minimum: Size, commit: boolean) => {
    event.cancelBubble = true;
    const nextSize = sizeFromBottomRightHandle(
      { x: event.currentTarget.x(), y: event.currentTarget.y() },
      minimum,
    );

    // Keep the handle under the pointer at the minimum instead of allowing the
    // draggable Konva node to visually detach from the clamped object bounds.
    event.currentTarget.position({ x: nextSize.width, y: nextSize.height });
    if (commit) commitSize(id, nextSize);
    else previewSize(id, nextSize);
  };

  const updateTextCard = (id: string, title: string, body: string) => {
    commitObjects((current) => current.map((object) =>
      object.id === id && object.kind === "text-card"
        ? { ...object, title, body, revision: object.revision + 1 }
        : object,
    ));
  };

  const selectObject = (id: string, additive = false) => {
    const targetIds = expandGroupedIds(objects, new Set([id]));
    setSelectedIds((current) => {
      if (!additive) return targetIds;
      const next = new Set(current);
      const remove = [...targetIds].every((targetId) => next.has(targetId));
      for (const targetId of targetIds) {
        if (remove) next.delete(targetId);
        else next.add(targetId);
      }
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
    const groupIdMap = new Map(
      sources.filter((object) => object.groupId).map((object) => [object.groupId!, `group-${crypto.randomUUID()}`]),
    );
    const copies = sources.map((object): NotebookObject => {
      const groupId = object.groupId ? groupIdMap.get(object.groupId) : undefined;
      if (object.kind === "connector") {
        return {
          ...object,
          id: idMap.get(object.id)!,
          revision: 1,
          groupId,
          fromId: idMap.get(object.fromId) ?? object.fromId,
          toId: idMap.get(object.toId) ?? object.toId,
        };
      }
      if (object.kind === "stroke") {
        return {
          ...object,
          id: idMap.get(object.id)!,
          revision: 1,
          groupId,
          x: object.x + 32,
          y: object.y + 32,
          points: object.points.map((point) => ({ ...point, x: point.x + 32, y: point.y + 32 })),
        };
      }
      return { ...object, id: idMap.get(object.id)!, revision: 1, groupId, x: object.x + 32, y: object.y + 32 };
    });
    commitObjects((current) => [...current, ...copies]);
    setSelectedIds(new Set(copies.filter((object) => object.kind !== "connector").map((object) => object.id)));
  };

  const selectedObjects = objects.filter((object) => selectedIds.has(object.id));
  const selectedVisualObjects = selectedObjects.filter((object) => object.kind !== "connector");
  const selectedGroupIds = new Set(selectedObjects.flatMap((object) => object.groupId ? [object.groupId] : []));
  const canGroup = selectedVisualObjects.length >= 2
    && !(selectedGroupIds.size === 1 && selectedObjects.every((object) => object.groupId && selectedGroupIds.has(object.groupId)));
  const canUngroup = selectedGroupIds.size > 0;

  const prepareMockLesson = () => {
    if (readOnly || aiDraft) return;
    setAiDraftError(undefined);
    try {
      const operationType: SemanticOperationType = "insert_lesson_section";
      const requestId = `request-${crypto.randomUUID()}`;
      const proposal = validateCanvasProposal(mockLessonProposal, {
        requestId,
        pageId: fixture.id,
        permittedOperations: new Set([operationType]),
        targetObjects: new Map(),
        maxOperations: 1,
      });
      const visualSelection = selectedObjects.filter((object) => object.kind !== "connector");
      const left = visualSelection.length > 0 ? Math.min(...visualSelection.map((object) => object.x)) : 0;
      const top = visualSelection.length > 0 ? Math.min(...visualSelection.map((object) => object.y)) : 0;
      const selectionBounds = visualSelection.length === 0 ? undefined : {
        x: left,
        y: top,
        width: Math.max(...visualSelection.map((object) => object.x + object.width)) - left,
        height: Math.max(...visualSelection.map((object) => object.y + object.height)) - top,
      };
      setAiDraft(prepareCanvasBatch({
        transactionId: `transaction-${crypto.randomUUID()}`,
        pageId: fixture.id,
        existingObjects: objects,
        proposal,
        provenance: {
          requestId,
          intent: "teach_section",
          provider: "mock",
          model: "deterministic-force-fixture",
          configurationId: "mock-v1",
          proposalSchemaVersion: proposal.schemaVersion,
          sources: selectedObjects.map((object) => ({ id: object.id, revision: object.revision })),
        },
        selectionBounds,
        viewportCenter: {
          x: (size.width / 2 - camera.x) / camera.scale,
          y: (size.height / 2 - camera.y) / camera.scale,
        },
      }));
    } catch (error) {
      setAiDraftError(error instanceof Error ? error.message : "The mock proposal could not be prepared.");
    }
  };

  const acceptAiDraft = () => {
    if (!aiDraft || readOnly) return;
    try {
      const result = applyCanvasBatch(fixture.id, objects, aiDraft, committedAiTransactionIdsRef.current);
      if (!result.applied) {
        setAiDraft(undefined);
        return;
      }
      pendingAiTransactionRef.current = transactionRecordFromBatch(aiDraft);
      committedAiTransactionIdsRef.current.add(aiDraft.transactionId);
      setHistory((current) => commitHistory(current, result.objects));
      setSelectedIds(new Set(aiDraft.generatedObjectIds));
      setAiDraft(undefined);
      setAiDraftError(undefined);
      setTool("select");
    } catch (error) {
      setAiDraftError(error instanceof Error ? error.message : "The draft became stale and was not applied.");
    }
  };

  const groupSelection = () => {
    if (!canGroup) return;
    const groupId = `group-${crypto.randomUUID()}`;
    const boundConnectorIds = connectors
      .filter((connector) => selectedIds.has(connector.fromId) && selectedIds.has(connector.toId))
      .map((connector) => connector.id);
    const groupedIds = new Set([...selectedIds, ...boundConnectorIds]);
    commitObjects((current) => groupObjects(current, groupedIds, groupId));
    setSelectedIds(groupedIds);
  };

  const ungroupSelection = () => {
    if (!canUngroup) return;
    commitObjects((current) => ungroupObjects(current, selectedIds));
  };

  const insertionPoint = (width: number, height: number) => ({
    x: (size.width / 2 - camera.x) / camera.scale - width / 2 + (objects.length % 5) * 24,
    y: (size.height / 2 - camera.y) / camera.scale - height / 2 + (objects.length % 5) * 24,
  });

  const insertNote = () => {
    const dimensions = { width: 270, height: 160 };
    const object: NotebookObject = {
      id: `text-card-${crypto.randomUUID()}`,
      revision: 1,
      kind: "text-card",
      ...insertionPoint(dimensions.width, dimensions.height),
      ...dimensions,
      title: "New note",
      body: "Add your ideas here.",
    };
    commitObjects((current) => [...current, object]);
    setSelectedIds(new Set([object.id]));
    setTool("select");
  };

  const insertImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setImageNotice("Choose a PNG, JPEG, WebP, or GIF image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageNotice("Images must be 12 MB or smaller.");
      return;
    }

    setImageNotice("Importing image…");
    try {
      const [asset, naturalSize] = await Promise.all([saveAsset(file), readImageDimensions(file)]);
      const scale = Math.min(1, 480 / naturalSize.width, 360 / naturalSize.height);
      const dimensions = {
        width: Math.max(48, naturalSize.width * scale),
        height: Math.max(48, naturalSize.height * scale),
      };
      const object: ImageObject = {
        id: `image-${crypto.randomUUID()}`,
        revision: 1,
        kind: "image",
        ...insertionPoint(dimensions.width, dimensions.height),
        ...dimensions,
        assetHash: asset.hash,
        mimeType: asset.mimeType,
        name: file.name,
      };
      commitObjects((current) => [...current, object]);
      setSelectedIds(new Set([object.id]));
      setTool("select");
      setImageNotice(`${file.name} added`);
    } catch (error) {
      setImageNotice(isQuotaExceededError(error) ? "Storage is full; the image was not added." : "The image could not be imported.");
    }
  };

  const selectedConnectables = connectables.filter((object) => selectedIds.has(object.id));
  const connectSelection = () => {
    if (selectedConnectables.length !== 2) return;
    const connector: NotebookObject = {
      id: `connector-${crypto.randomUUID()}`,
      revision: 1,
      kind: "connector",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      fromId: selectedConnectables[0].id,
      toId: selectedConnectables[1].id,
    };
    commitObjects((current) => [...current, connector]);
    setSelectedIds(new Set([connector.id]));
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
          : tool === "rectangle" || tool === "ellipse"
            ? "shape"
            : "stroke";
    const startPoint = pointFromPointer(nativeEvent, rect);
    gestureRef.current = {
      pointerId: nativeEvent.pointerId,
      kind,
      lastScreen: { x: nativeEvent.clientX, y: nativeEvent.clientY },
      strokeTool: tool === "highlighter" ? "highlighter" : "pen",
      startWorld: kind === "shape" ? startPoint : undefined,
      shapeType: tool === "rectangle" || tool === "ellipse" ? tool : undefined,
    };

    if (kind === "stroke") {
      liveStrokeRef.current = [pointFromPointer(nativeEvent, rect)];
      scheduleLiveStrokeRender();
    } else if (kind === "lasso") {
      lassoPointsRef.current = [startPoint];
      setLassoPoints([startPoint]);
    } else if (kind === "shape") {
      const draft = { ...boundsFromPoints(startPoint, startPoint), shape: gestureRef.current.shapeType ?? "rectangle" };
      draftShapeRef.current = draft;
      setDraftShape(draft);
    } else if (kind === "erase") {
      eraseAt(startPoint);
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
    } else if (gesture.kind === "shape" && gesture.startWorld) {
      const bounds = boundsFromPoints(gesture.startWorld, points.at(-1) ?? gesture.startWorld);
      const draft = { ...bounds, shape: gesture.shapeType ?? "rectangle" };
      draftShapeRef.current = draft;
      setDraftShape(draft);
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
      const directSelection = new Set(
        objects
          .filter((object) => object.kind !== "connector" && objectIntersectsPolygon(object, lassoPointsRef.current))
          .map((object) => object.id),
      );
      for (const connector of connectors) {
        if (directSelection.has(connector.fromId) && directSelection.has(connector.toId)) directSelection.add(connector.id);
      }
      setSelectedIds(expandGroupedIds(objects, directSelection));
      setTool("select");
    }

    const completedShape = draftShapeRef.current;
    if (!cancelled && gesture.kind === "shape" && completedShape && completedShape.width >= 8 && completedShape.height >= 8) {
      const shapeType = gesture.shapeType ?? "rectangle";
      const object: ShapeObject = {
        id: `shape-${crypto.randomUUID()}`,
        revision: 1,
        kind: "shape",
        shape: shapeType,
        x: completedShape.x,
        y: completedShape.y,
        width: completedShape.width,
        height: completedShape.height,
        fill: shapeType === "ellipse" ? "#fff1cf" : "#e4efed",
        stroke: shapeType === "ellipse" ? "#a3672c" : "#2c5f5d",
      };
      commitObjects((current) => [...current, object]);
      setSelectedIds(new Set([object.id]));
      setTool("select");
    }

    gestureRef.current = undefined;
    liveStrokeRef.current = [];
    lassoPointsRef.current = [];
    draftShapeRef.current = undefined;
    erasingIdsRef.current = new Set();
    setLiveStroke([]);
    setLassoPoints([]);
    setDraftShape(undefined);
    setErasingIds(new Set());
  };

  const zoomAt = (nextScale: number, anchor: Position) => {
    setCamera((current) => zoomCameraAt(current, nextScale, anchor));
  };

  const toggleFullscreen = async () => {
    const element = prototypeRef.current;
    if (!element) return;

    if (fullscreenFallback) {
      setFullscreenFallback(false);
      setIsFullscreen(false);
      return;
    }

    if (document.fullscreenElement === element) {
      await document.exitFullscreen();
      return;
    }

    try {
      await element.requestFullscreen();
    } catch {
      setFullscreenFallback(true);
      setIsFullscreen(true);
    }
  };

  const resetCamera = () => setCamera({ x: 24, y: 24, scale: 0.86 });
  const inputActive = tool !== "select" && (!readOnly || tool === "pan");
  const visibleStrokes = strokes.filter((stroke) => !erasingIds.has(stroke.id));
  const currentStrokeTool = tool === "highlighter" ? "highlighter" : "pen";
  const currentStrokeSize = currentStrokeTool === "highlighter" ? highlighterSize : penSize;

  return (
    <section className="prototype" ref={prototypeRef} data-fullscreen-fallback={fullscreenFallback || undefined}>
      <div className="prototype-toolbar" aria-label="Canvas tools">
        <div className="tool-group" role="group" aria-label="Drawing tools">
          {([
            ["select", "Select", "V"],
            ["lasso", "Lasso", "L"],
            ["pen", "Pen", "P"],
            ["highlighter", "Highlight", "H"],
            ["eraser", "Eraser", "E"],
            ["rectangle", "Rectangle", "R"],
            ["ellipse", "Ellipse", "O"],
            ["pan", "Hand", "Space"],
          ] as const).map(([value, label, shortcut]) => (
            <button key={value} type="button" aria-pressed={tool === value} onClick={() => setTool(value)} title={`${label} (${shortcut})`} disabled={readOnly && value !== "select" && value !== "pan"}>
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
          <input type="checkbox" checked={fingerDrawing} onChange={(event) => setFingerDrawing(event.target.checked)} disabled={readOnly} />
          Finger draws
        </label>

        <div className="tool-group" role="group" aria-label="History">
          <button type="button" disabled={readOnly || history.past.length === 0} onClick={() => setHistory(undoHistory)} title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" disabled={readOnly || history.future.length === 0} onClick={() => setHistory(redoHistory)} title="Redo (Ctrl+Y)">Redo</button>
        </div>

        <div className="tool-group" role="group" aria-label="Insert objects">
          <button type="button" onClick={insertNote} disabled={readOnly}>Note</button>
          <button type="button" onClick={() => imageInputRef.current?.click()} disabled={readOnly}>Image</button>
          <input
            ref={imageInputRef}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={insertImage}
            tabIndex={-1}
            disabled={readOnly}
          />
          <button type="button" disabled={readOnly || selectedConnectables.length !== 2} onClick={connectSelection}>Connect</button>
        </div>

        <div className="tool-group" role="group" aria-label="Learning tools">
          <button type="button" onClick={prepareMockLesson} disabled={readOnly || Boolean(aiDraft)}>Mock lesson</button>
        </div>

        {imageNotice && <span className="asset-message" role="status">{imageNotice}</span>}

        <div className="tool-group" role="group" aria-label="Selection actions">
          <span>{selectedIds.size} selected</span>
          <button type="button" disabled={readOnly || selectedIds.size === 0} onClick={duplicateSelection}>Duplicate</button>
          <button type="button" disabled={readOnly || selectedIds.size === 0} onClick={deleteSelection}>Delete</button>
          <button type="button" disabled={readOnly || !canGroup} onClick={groupSelection}>Group</button>
          <button type="button" disabled={readOnly || !canUngroup} onClick={ungroupSelection}>Ungroup</button>
        </div>

        <div className="tool-group" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomAt(camera.scale / 1.2, { x: size.width / 2, y: size.height / 2 })} aria-label="Zoom out">−</button>
          <button type="button" onClick={resetCamera} title="Reset camera">{Math.round(camera.scale * 100)}%</button>
          <button type="button" onClick={() => zoomAt(camera.scale * 1.2, { x: size.width / 2, y: size.height / 2 })} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => void toggleFullscreen()} aria-pressed={isFullscreen} aria-label={isFullscreen ? "Exit canvas fullscreen" : "Enter canvas fullscreen"}>
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      {(aiDraft || aiDraftError) && (
        <aside className="ai-draft" aria-label="AI draft preview">
          <div>
            <strong>{aiDraft ? "Mock lesson draft" : "Draft unavailable"}</strong>
            <span>{aiDraft ? `${aiDraft.inserts.length} editable objects prepared locally. No network request was made.` : aiDraftError}</span>
          </div>
          {aiDraft && (
            <div className="ai-draft__actions">
              <button type="button" onClick={() => { setAiDraft(undefined); setAiDraftError(undefined); }}>Discard</button>
              <button type="button" onClick={acceptAiDraft}>Add to page</button>
            </div>
          )}
        </aside>
      )}

      <div className="canvas-viewport" ref={rootRef} data-tool={tool}>
        {size.width > 0 && size.height > 0 && (
          <Stage width={size.width} height={size.height} className="konva-stage">
            <Layer>
              <Rect width={size.width} height={size.height} fill="#fbfaf5" onPointerDown={() => setSelectedIds(new Set())} />
            </Layer>
            <Layer listening={tool === "select"}>
              <Group x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale}>
                {connectors.map((connector) => {
                  const from = connectableById.get(connector.fromId);
                  const to = connectableById.get(connector.toId);
                  if (!from || !to) return null;
                  const fromPosition = positionFor(from);
                  const toPosition = positionFor(to);
                  const fromSize = sizeFor(from);
                  const toSize = sizeFor(to);
                  return (
                    <Arrow
                      key={connector.id}
                      points={[fromPosition.x + fromSize.width, fromPosition.y + fromSize.height / 2, toPosition.x, toPosition.y + toSize.height / 2]}
                      stroke={selectedIds.has(connector.id) ? "#ef8c45" : "#537188"}
                      fill={selectedIds.has(connector.id) ? "#ef8c45" : "#537188"}
                      strokeWidth={selectedIds.has(connector.id) ? 3.5 : 2.5}
                      pointerLength={9}
                      pointerWidth={8}
                      hitStrokeWidth={16}
                      onPointerDown={(event) => selectObject(connector.id, event.evt.shiftKey)}
                    />
                  );
                })}

                {shapes.map((shape) => {
                  const position = positionFor(shape);
                  const dimensions = sizeFor(shape);
                  const selected = selectedIds.has(shape.id);
                  return (
                    <Group
                      key={shape.id}
                      x={position.x}
                      y={position.y}
                      draggable={tool === "select" && !readOnly}
                      onPointerDown={(event) => selectObject(shape.id, event.evt.shiftKey)}
                      onDragMove={(event) => {
                        if (event.target !== event.currentTarget) return;
                        previewPosition(shape.id, { x: event.currentTarget.x(), y: event.currentTarget.y() });
                      }}
                      onDragEnd={(event) => {
                        if (event.target !== event.currentTarget) return;
                        commitPosition(shape.id, { x: event.currentTarget.x(), y: event.currentTarget.y() });
                      }}
                    >
                      {shape.shape === "ellipse" ? (
                        <Ellipse x={dimensions.width / 2} y={dimensions.height / 2} radiusX={dimensions.width / 2} radiusY={dimensions.height / 2} fill={shape.fill} stroke={selected ? "#ef8c45" : shape.stroke} strokeWidth={selected ? 3 : 2} />
                      ) : (
                        <Rect width={dimensions.width} height={dimensions.height} fill={shape.fill} stroke={selected ? "#ef8c45" : shape.stroke} strokeWidth={selected ? 3 : 2} cornerRadius={12} />
                      )}
                      {selected && selectedIds.size === 1 && (
                        <Circle
                          x={dimensions.width}
                          y={dimensions.height}
                          radius={8 / camera.scale}
                          fill="#ef8c45"
                          stroke="white"
                          strokeWidth={2 / camera.scale}
                          draggable
                          onPointerDown={(event) => { event.cancelBubble = true; }}
                          onDragStart={(event) => { event.cancelBubble = true; }}
                          onDragMove={(event) => resizeFromHandle(event, shape.id, { width: 40, height: 40 }, false)}
                          onDragEnd={(event) => resizeFromHandle(event, shape.id, { width: 40, height: 40 }, true)}
                          hitStrokeWidth={28 / camera.scale}
                        />
                      )}
                    </Group>
                  );
                })}

                {images.map((imageObject) => {
                  const position = positionFor(imageObject);
                  const dimensions = sizeFor(imageObject);
                  const selected = selectedIds.has(imageObject.id);
                  return (
                    <Group
                      key={imageObject.id}
                      x={position.x}
                      y={position.y}
                      draggable={tool === "select" && !readOnly}
                      onPointerDown={(event) => selectObject(imageObject.id, event.evt.shiftKey)}
                      onDragMove={(event) => {
                        if (event.target !== event.currentTarget) return;
                        previewPosition(imageObject.id, { x: event.currentTarget.x(), y: event.currentTarget.y() });
                      }}
                      onDragEnd={(event) => {
                        if (event.target !== event.currentTarget) return;
                        commitPosition(imageObject.id, { x: event.currentTarget.x(), y: event.currentTarget.y() });
                      }}
                    >
                      <CanvasImage assetHash={imageObject.assetHash} name={imageObject.name} width={dimensions.width} height={dimensions.height} />
                      <Rect width={dimensions.width} height={dimensions.height} stroke={selected ? "#ef8c45" : "rgba(44, 95, 93, 0.35)"} strokeWidth={selected ? 3 : 1} />
                      {selected && selectedIds.size === 1 && (
                        <Circle
                          x={dimensions.width}
                          y={dimensions.height}
                          radius={8 / camera.scale}
                          fill="#ef8c45"
                          stroke="white"
                          strokeWidth={2 / camera.scale}
                          draggable
                          onPointerDown={(event) => { event.cancelBubble = true; }}
                          onDragStart={(event) => { event.cancelBubble = true; }}
                          onDragMove={(event) => resizeFromHandle(event, imageObject.id, { width: 60, height: 60 }, false)}
                          onDragEnd={(event) => resizeFromHandle(event, imageObject.id, { width: 60, height: 60 }, true)}
                          hitStrokeWidth={28 / camera.scale}
                        />
                      )}
                    </Group>
                  );
                })}

                {nodes.map((node) => {
                  const position = positionFor(node);
                  const dimensions = sizeFor(node);
                  const selected = selectedIds.has(node.id);
                  return (
                    <Group
                      key={node.id}
                      x={position.x}
                      y={position.y}
                      draggable={tool === "select" && !readOnly}
                      onPointerDown={(event) => selectObject(node.id, event.evt.shiftKey)}
                      onDragMove={(event) => {
                        if (event.target !== event.currentTarget) return;
                        previewPosition(node.id, { x: event.currentTarget.x(), y: event.currentTarget.y() });
                      }}
                      onDragEnd={(event) => {
                        if (event.target !== event.currentTarget) return;
                        commitPosition(node.id, { x: event.currentTarget.x(), y: event.currentTarget.y() });
                      }}
                    >
                      <Rect
                        width={dimensions.width}
                        height={dimensions.height}
                        fill="#e7f0ef"
                        stroke={selected ? "#ef8c45" : "#2c5f5d"}
                        strokeWidth={selected ? 3 : 2}
                        cornerRadius={18}
                        shadowBlur={8}
                        shadowOpacity={0.08}
                      />
                      <Text width={dimensions.width} height={dimensions.height} text={node.label} align="center" verticalAlign="middle" fontSize={17} fontFamily="Inter, sans-serif" fill="#163b3a" />
                      {selected && selectedIds.size === 1 && (
                        <Circle
                          x={dimensions.width}
                          y={dimensions.height}
                          radius={8 / camera.scale}
                          fill="#ef8c45"
                          stroke="white"
                          strokeWidth={2 / camera.scale}
                          draggable
                          onPointerDown={(event) => { event.cancelBubble = true; }}
                          onDragStart={(event) => { event.cancelBubble = true; }}
                          onDragMove={(event) => resizeFromHandle(event, node.id, { width: 80, height: 48 }, false)}
                          onDragEnd={(event) => resizeFromHandle(event, node.id, { width: 80, height: 48 }, true)}
                          hitStrokeWidth={28 / camera.scale}
                        />
                      )}
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
              size={sizeFor(card)}
              cameraScale={camera.scale}
              selected={selectedIds.has(card.id)}
              resizable={!readOnly && selectedIds.size === 1}
              readOnly={readOnly}
              onSelect={(additive) => selectObject(card.id, additive)}
              onMove={(position) => previewPosition(card.id, position)}
              onMoveEnd={(position) => commitPosition(card.id, position)}
              onResize={(nextSize) => previewSize(card.id, nextSize)}
              onResizeEnd={(nextSize) => commitSize(card.id, nextSize)}
              onEditText={(title, body) => updateTextCard(card.id, title, body)}
            />
          ))}
        </div>

        <div className="visually-hidden" aria-label="Canvas images">
          {images.map((imageObject) => <span key={imageObject.id}>Image: {imageObject.name}. </span>)}
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
                    x={positionFor(stroke).x - stroke.x}
                    y={positionFor(stroke).y - stroke.y}
                  />
                ))}
                {visibleStrokes.filter((stroke) => stroke.tool === "pen").map((stroke) => (
                  <Path
                    key={stroke.id}
                    data={getStrokePath(stroke.points, stroke.size, stroke.tool)}
                    fill={stroke.color}
                    stroke={selectedIds.has(stroke.id) ? "#ef8c45" : undefined}
                    strokeWidth={selectedIds.has(stroke.id) ? 2 / camera.scale : 0}
                    x={positionFor(stroke).x - stroke.x}
                    y={positionFor(stroke).y - stroke.y}
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
                {draftShape && (
                  draftShape.shape === "ellipse" ? (
                    <Ellipse
                      x={draftShape.x + draftShape.width / 2}
                      y={draftShape.y + draftShape.height / 2}
                      radiusX={draftShape.width / 2}
                      radiusY={draftShape.height / 2}
                      fill="rgba(255, 241, 207, 0.72)"
                      stroke="#a3672c"
                      strokeWidth={2 / camera.scale}
                      dash={[7 / camera.scale, 5 / camera.scale]}
                    />
                  ) : (
                    <Rect
                      x={draftShape.x}
                      y={draftShape.y}
                      width={draftShape.width}
                      height={draftShape.height}
                      fill="rgba(228, 239, 237, 0.72)"
                      stroke="#2c5f5d"
                      strokeWidth={2 / camera.scale}
                      dash={[7 / camera.scale, 5 / camera.scale]}
                      cornerRadius={12}
                    />
                  )
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
          <span>{objects.length} objects</span>
          <span>Wheel: pan · Ctrl/⌘+wheel: canvas zoom</span>
        </div>
      </div>
    </section>
  );
}
