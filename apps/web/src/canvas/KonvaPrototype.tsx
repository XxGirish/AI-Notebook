import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Arrow, Circle, Ellipse, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { commitHistory, createHistory, redoHistory, undoHistory } from "../domain/history";
import { applyLearningObjectEdit, getFocusedDiagramObject } from "../domain/learningObjects";
import { buildLinearReadingItems } from "../domain/linearReading";
import { routeConnector } from "../domain/diagramAdapter";
import type {
  AiTransactionRecord,
  ConnectorObject,
  GraphNodeObject,
  ImageObject,
  InkTextObject,
  NotebookFixture,
  NotebookObject,
  PointSample,
  QuizOption,
  ShapeObject,
  StrokeObject,
  TextObject,
} from "../domain/notebook";
import { applyCanvasBatch, prepareCanvasBatch, transactionRecordFromBatch, type PreparedCanvasBatch } from "../ai/proposalCompiler";
import { mockLessonProposal, validateCanvasProposal, type AiIntent, type SemanticOperationType } from "@ai-notebook/ai-contract";
import { requestAiDraft, type AiDraftPhase } from "../ai/aiSession";
import { AI_CANVAS_ACTIONS, AI_REQUEST_PLANS } from "../ai/requestContext";
import { LearningCard } from "../components/LearningCard";
import { useQuizAttempts } from "../components/useQuizAttempts";
import { describeQuizAttempts, summarizeQuizAttempts, type QuizAssistance } from "../domain/quizAttempts";
import { DiagramLabelEditor } from "../components/DiagramLabelEditor";
import { InkTextEditor } from "../components/InkTextEditor";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CanvasTextEditor } from "../components/CanvasTextEditor";
import { saveAsset } from "../persistence/notebookDatabase";
import { isQuotaExceededError } from "../persistence/storageHealth";
import { CanvasImage } from "./CanvasImage";
import { InkStrokes } from "./InkStrokes";
import { strokeWidthAt } from "./strokePath";
import { InkTrail, limitPrediction, WetInkLayer, type WetStrokeStyle } from "./wetInk";
import { expandGroupedIds, groupObjects, translateObjectGroup, ungroupObjects } from "./groupMath";
import { objectIntersectsPolygon } from "./selectionMath";
import { boundsFromPoints, sizeFromBottomRightHandle, type CanvasBounds } from "./shapeMath";
import { gestureKindFor, isInkTool, pointerSamples, type TouchMode, type Tool } from "./pointerRouting";
import { contactSize, inkingContactId, reportsContactGeometry, type Contact } from "./palmRejection";
import { appendDistinctPoints, strokeIntersectsPoint } from "./strokeMath";
import { removeDigitizerWobble } from "./digitizerWobble";
import { useElementSize } from "./useElementSize";
import {
  editInkText,
  estimateTextWidth,
  INK_TEXT_FONT_FAMILY,
  inkBounds,
  restoreHandwriting,
  type MeasureText,
} from "./handwriting/handwritingLayout";
import { neatenHandwriting } from "./handwriting/neatenInk";
import {
  createTextObject,
  DEFAULT_TEXT_FONT_SIZE,
  editTextObject,
  normalizeText,
  resizeTextBox,
  setTextFontSize,
  textBoxFromGesture,
  textObjectAt,
  TEXT_COLOR,
  TEXT_FONT_FAMILY,
  TEXT_FONT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
} from "./textBox";
import { wheelDeltaInPixels, wheelZoomScale, zoomCameraAt, type Camera } from "./cameraMath";

/** Text the chat panel asked to place on this page, as one editable card. */
export type CanvasInsertRequest = { id: string; title: string; body: string; provider: string; model: string };
export type CanvasInsertOutcome = { ok: true } | { ok: false; message: string };

type Props = {
  fixture: NotebookFixture;
  readOnly?: boolean;
  onObjectsChange?: (objects: NotebookObject[], aiTransaction?: AiTransactionRecord) => void;
  insertRequest?: CanvasInsertRequest;
  onInsertRequestHandled?: (id: string, outcome: CanvasInsertOutcome) => void;
};

const draftLabel = (intent: AiTransactionRecord["intent"]) => (intent === "chat_answer" ? "Chat answer" : AI_REQUEST_PLANS[intent].label);
const clampText = (value: string, limit: number) => (value.length <= limit ? value : `${value.slice(0, limit - 1)}…`);
type Position = { x: number; y: number };
type Size = { width: number; height: number };
type Gesture = {
  pointerId: number;
  kind: "stroke" | "erase" | "pan" | "lasso" | "shape" | "text";
  lastScreen: Position;
  // The canvas rect is read once per gesture: reading it on every move forces
  // a layout whenever anything else on the page has changed.
  rect: DOMRect;
  strokeTool?: StrokeObject["tool"];
  strokeStyle?: WetStrokeStyle;
  startWorld?: Position;
  lastWorld?: Position;
  shapeType?: ShapeObject["shape"];
  handwriting?: boolean;
};
type DraftBox = CanvasBounds & { shape: ShapeObject["shape"] | "text" };
// A text box being typed into. A new box is not in the document until it has
// text, so an abandoned box never becomes an empty object or a history step.
type TextEditSession = {
  id: string;
  isNew: boolean;
  box: CanvasBounds;
  fontSize: number;
  color: string;
  text: string;
};

const isStroke = (object: NotebookObject): object is StrokeObject => object.kind === "stroke";
const isGraphNode = (object: NotebookObject): object is GraphNodeObject => object.kind === "graph-node";
const isShape = (object: NotebookObject): object is ShapeObject => object.kind === "shape";
const isImage = (object: NotebookObject): object is ImageObject => object.kind === "image";
const isInkText = (object: NotebookObject): object is InkTextObject => object.kind === "ink-text";
const isText = (object: NotebookObject): object is TextObject => object.kind === "text";
const TOOL_LABELS: Record<Tool, string> = {
  select: "Select", lasso: "Lasso", pen: "Pen", "pen-pro": "Pen Pro", highlighter: "Highlight",
  eraser: "Eraser", rectangle: "Rectangle", ellipse: "Ellipse", text: "Text", pan: "Hand",
};
// Pen Pro neatens once the writer pauses: long enough to finish a word, short enough to feel automatic.
const HANDWRITING_PAUSE_MS = 1_200;
/**
 * Optional shared token for a personal deployment, built into the bundle and so
 * readable by anyone who can open the app. It keeps strangers on the same
 * network off the gateway; the DeepSeek key stays in the gateway process.
 */
const GATEWAY_ACCESS_TOKEN = import.meta.env.VITE_GATEWAY_ACCESS_TOKEN as string | undefined;
const AI_PHASE_LABELS: Record<AiDraftPhase, string> = {
  sending: "Sending the selection",
  generating: "Writing",
  validating: "Checking the answer",
  repairing: "Asking for a correction",
  preparing: "Laying it out",
};
const PEN_COLOR = "#183153";
const HIGHLIGHTER_COLOR = "#f5c842";
// Predicted samples may extend the drawn tip by at most this many screen
// pixels: about one frame of fast writing, and small enough that a wrong guess
// at a sharp turn in small cursive stays inside the stroke's own width.
const MAX_PREDICTION_PX = 8;

let measureContext: CanvasRenderingContext2D | null | undefined;
const canvasTextMeasure = (fontFamily: string): MeasureText => (text, fontSize) => {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return estimateTextWidth(text, fontSize);
  measureContext.font = `${fontSize}px ${fontFamily}`;
  return measureContext.measureText(text).width;
};
const measureInkText = canvasTextMeasure(INK_TEXT_FONT_FAMILY);
const measureCanvasText = canvasTextMeasure(TEXT_FONT_FAMILY);
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

export function KonvaPrototype({ fixture, readOnly = false, onObjectsChange, insertRequest, onInsertRequestHandled }: Props) {
  const prototypeRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const size = useElementSize(rootRef);
  const [tool, setTool] = useState<Tool>("select");
  const [history, setHistory] = useState(() => createHistory(fixture.objects));
  const quizAttempts = useQuizAttempts(fixture.id);
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, scale: 0.86 });
  const [penSize, setPenSize] = useState(4.5);
  const [highlighterSize, setHighlighterSize] = useState(22);
  // Touch draws by default so a touch-only screen can write immediately. An
  // active stylus switches this to "stylus" on its own the first time one is
  // used (see beginInput); a passive stylus cannot be detected that way and
  // needs "palm", which the writer picks themselves.
  const [touchMode, setTouchMode] = useState<TouchMode>("finger");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenFallback, setFullscreenFallback] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [focusedObjectId, setFocusedObjectId] = useState<string>();
  const [transientPositions, setTransientPositions] = useState<Record<string, Position>>({});
  const [transientSizes, setTransientSizes] = useState<Record<string, Size>>({});
  const [lassoPoints, setLassoPoints] = useState<PointSample[]>([]);
  const [draftShape, setDraftShape] = useState<DraftBox>();
  const [imageNotice, setImageNotice] = useState<string>();
  const [aiDraft, setAiDraft] = useState<PreparedCanvasBatch>();
  const [aiDraftError, setAiDraftError] = useState<string>();
  const [aiRun, setAiRun] = useState<{ intent: AiIntent; phase: AiDraftPhase }>();
  /** Set only when the failure is worth trying again, so Retry is never offered on a refusal. */
  const [aiRetryIntent, setAiRetryIntent] = useState<AiIntent>();
  const aiAbortRef = useRef<AbortController>();
  const [editingDiagramObjectId, setEditingDiagramObjectId] = useState<string>();
  const [erasingIds, setErasingIds] = useState<Set<string>>(() => new Set());
  const [editingInkTextId, setEditingInkTextId] = useState<string>();
  const [handwritingNotice, setHandwritingNotice] = useState<string>();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [newTextFontSize, setNewTextFontSize] = useState(DEFAULT_TEXT_FONT_SIZE);
  const [textEditing, setTextEditing] = useState<TextEditSession>();
  // Read by the window key handler, which is bound once and cannot see the current selection.
  const editSelectedTextRef = useRef<() => boolean>(() => false);
  const liveStrokeRef = useRef<PointSample[]>([]);
  const lassoPointsRef = useRef<PointSample[]>([]);
  const draftShapeRef = useRef<DraftBox>();
  const erasingIdsRef = useRef<Set<string>>(new Set());
  const gestureRef = useRef<Gesture>();
  const stylusSeenRef = useRef(false);
  const touchModeChosenRef = useRef(false);
  // Every contact currently on the glass, drawing or not: palm rejection can
  // only pick the stylus tip if it can see what else the hand is putting down.
  const contactsRef = useRef(new Map<number, Contact>());
  const geometryWarnedRef = useRef(false);
  const [activeContacts, setActiveContacts] = useState<Contact[]>([]);
  const publishedContactsRef = useRef("");
  const wetCanvasRef = useRef<HTMLCanvasElement>(null);
  const wetInkRef = useRef<WetInkLayer>();
  const inkTrailRef = useRef(new InkTrail(() => wetCanvasRef.current));
  const lastNotifiedObjectsRef = useRef(fixture.objects);
  const pendingAiTransactionRef = useRef<AiTransactionRecord>();
  const committedAiTransactionIdsRef = useRef(new Set(fixture.aiTransactions.map((transaction) => transaction.transactionId)));
  const pendingHandwritingIdsRef = useRef<string[]>([]);
  const handwritingTimerRef = useRef<number>();
  const handwritingNoticeTimerRef = useRef<number>();
  const objectsRef = useRef(fixture.objects);
  const readOnlyRef = useRef(readOnly);

  const objects = history.present;
  const strokes = objects.filter(isStroke);
  const nodes = objects.filter(isGraphNode);
  const shapes = objects.filter(isShape);
  const images = objects.filter(isImage);
  const inkTexts = objects.filter(isInkText);
  const texts = objects.filter(isText);
  // The Pen Pro pause timer fires after later renders; it reads the latest document here.
  objectsRef.current = objects;
  readOnlyRef.current = readOnly;
  const connectors = objects.filter((object) => object.kind === "connector");
  const cards = objects.filter(
    (object) => object.kind === "text-card" || object.kind === "equation-card" || object.kind === "quiz-card",
  );
  const connectables = useMemo(() => [...nodes, ...shapes, ...images], [nodes, shapes, images]);
  const connectableById = useMemo(() => new Map(connectables.map((object) => [object.id, object])), [connectables]);
  const linearReadingItems = useMemo(() => buildLinearReadingItems(objects), [objects]);

  useEffect(() => () => {
    window.clearTimeout(handwritingTimerRef.current);
    window.clearTimeout(handwritingNoticeTimerRef.current);
  }, []);

  useEffect(() => {
    const canvas = wetCanvasRef.current;
    if (!canvas) return;
    const layer = new WetInkLayer(canvas);
    wetInkRef.current = layer;
    return () => {
      layer.dispose();
      if (wetInkRef.current === layer) wetInkRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    wetInkRef.current?.resize(size.width, size.height, window.devicePixelRatio || 1);
  }, [size.width, size.height]);

  useEffect(() => {
    wetInkRef.current?.setCamera(camera);
  }, [camera]);

  // A finished stroke's wet copy goes once the committed one is on the Konva
  // layer. Layout effect: its frame must be requested after the one Konva asked
  // for while rendering this commit, so both happen in the same frame.
  useLayoutEffect(() => {
    const committed = new Set(objects.map((object) => object.id));
    wetInkRef.current?.release((id) => committed.has(id));
  }, [objects]);

  useEffect(() => {
    if (readOnly) {
      if (tool !== "select" && tool !== "pan") setTool("select");
      setAiDraft(undefined);
      aiAbortRef.current?.abort();
    }
  }, [readOnly, tool]);

  // Leaving the page, or closing the tab, must not leave the gateway generating
  // against a page that is no longer open.
  useEffect(() => () => aiAbortRef.current?.abort(), []);

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

    // The camera is the viewport's only offset. Browsers still scroll an
    // overflow-hidden element to reveal a focused descendant (for example a
    // card editor or a keyboard-focused off-screen card), which would shift the
    // stage and card layer away from pointer mapping. Convert that into a pan.
    const handleScroll = () => {
      const deltaX = viewport.scrollLeft;
      const deltaY = viewport.scrollTop;
      if (deltaX === 0 && deltaY === 0) return;
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      setCamera((current) => ({ ...current, x: current.x - deltaX, y: current.y - deltaY }));
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("scroll", handleScroll);
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("scroll", handleScroll);
    };
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
      } else if (!modifier && event.key === "Enter") {
        if (editSelectedTextRef.current()) event.preventDefault();
      } else if (!modifier) {
        const shortcut: Partial<Record<string, Tool>> = { v: "select", l: "lasso", p: "pen", w: "pen-pro", h: "highlighter", e: "eraser", r: "rectangle", o: "ellipse", t: "text", " ": "pan" };
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
    commitObjects((current) => applyLearningObjectEdit(current, id, { kind: "text-card", title, body }));
  };

  const updateEquationCard = (id: string, title: string, latex: string) => {
    commitObjects((current) => applyLearningObjectEdit(current, id, { kind: "equation-card", title, latex }));
  };

  const updateQuizCard = (
    id: string,
    prompt: string,
    options: QuizOption[],
    correctOptionId: string,
    rationale: string,
  ) => {
    commitObjects((current) => applyLearningObjectEdit(current, id, {
      kind: "quiz-card",
      prompt,
      options,
      correctOptionId,
      rationale,
    }));
  };

  const updateDiagramLabel = (id: string, label: string) => {
    commitObjects((current) => {
      const object = current.find((candidate) => candidate.id === id);
      if (object?.kind === "graph-node") {
        return applyLearningObjectEdit(current, id, { kind: "graph-node", label });
      }
      if (object?.kind === "connector") {
        return applyLearningObjectEdit(current, id, { kind: "connector", label: label || undefined });
      }
      return current;
    });
    setEditingDiagramObjectId(undefined);
  };

  const selectObject = (id: string, additive = false) => {
    setFocusedObjectId(id);
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
    setFocusedObjectId(undefined);
    setEditingDiagramObjectId(undefined);
  };

  // Wipes every object on the active page as one history step, so Undo brings
  // the whole page back.
  const clearCanvas = () => {
    setConfirmingClear(false);
    if (readOnly || objects.length === 0) return;
    window.clearTimeout(handwritingTimerRef.current);
    pendingHandwritingIdsRef.current = [];
    commitObjects(() => []);
    setSelectedIds(new Set());
    setFocusedObjectId(undefined);
    setEditingDiagramObjectId(undefined);
    setEditingInkTextId(undefined);
    setTextEditing(undefined);
    setTransientPositions({});
    setTransientSizes({});
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
  const selectedDiagramObject = getFocusedDiagramObject(objects, selectedIds, focusedObjectId);
  const diagramObjectBeingEdited = objects.find((object) =>
    object.id === editingDiagramObjectId && (object.kind === "graph-node" || object.kind === "connector"),
  ) as GraphNodeObject | ConnectorObject | undefined;
  const selectedVisualObjects = selectedObjects.filter((object) => object.kind !== "connector");
  const selectedGroupIds = new Set(selectedObjects.flatMap((object) => object.groupId ? [object.groupId] : []));
  const canGroup = selectedVisualObjects.length >= 2
    && !(selectedGroupIds.size === 1 && selectedObjects.every((object) => object.groupId && selectedGroupIds.has(object.groupId)));
  const canUngroup = selectedGroupIds.size > 0;

  const selectionBounds = (() => {
    const visualSelection = selectedObjects.filter((object) => object.kind !== "connector");
    if (visualSelection.length === 0) return undefined;
    const left = Math.min(...visualSelection.map((object) => object.x));
    const top = Math.min(...visualSelection.map((object) => object.y));
    return {
      x: left,
      y: top,
      width: Math.max(...visualSelection.map((object) => object.x + object.width)) - left,
      height: Math.max(...visualSelection.map((object) => object.y + object.height)) - top,
    };
  })();

  const viewportCenter = {
    x: (size.width / 2 - camera.x) / camera.scale,
    y: (size.height / 2 - camera.y) / camera.scale,
  };

  /**
   * Sends one AI action to the same-origin gateway. The returned draft is not
   * on the page: it is laid out locally and waits for the writer to accept it.
   */
  const runAiAction = async (intent: AiIntent) => {
    if (readOnly || aiDraft || aiRun) return;
    setAiDraftError(undefined);
    setAiRetryIntent(undefined);
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiRun({ intent, phase: "sending" });
    const outcome = await requestAiDraft({
      pageId: fixture.id,
      intent,
      objects,
      selectedIds,
      selectionBounds,
      viewportCenter,
      signal: controller.signal,
      accessToken: GATEWAY_ACCESS_TOKEN,
      onPhase: (phase) => setAiRun((current) => (current ? { ...current, phase } : current)),
    });
    aiAbortRef.current = undefined;
    setAiRun(undefined);
    if (outcome.status === "draft") {
      setAiDraft(outcome.batch);
      return;
    }
    if (outcome.status === "cancelled") return;
    setAiDraftError(outcome.message);
    if (outcome.retryable) setAiRetryIntent(intent);
  };

  const cancelAiAction = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = undefined;
  };

  const prepareMockLesson = () => {
    if (readOnly || aiDraft || aiRun) return;
    setAiDraftError(undefined);
    setAiRetryIntent(undefined);
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
        viewportCenter,
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

  /**
   * Places a chat answer the writer explicitly asked for. It is additive, so it
   * goes straight onto the page through the same validation and layout as any
   * AI proposal, as one undoable step, without a second confirmation.
   */
  const handledInsertIdsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!insertRequest || handledInsertIdsRef.current.has(insertRequest.id)) return;
    handledInsertIdsRef.current.add(insertRequest.id);
    const finish = (outcome: CanvasInsertOutcome) => onInsertRequestHandled?.(insertRequest.id, outcome);
    if (readOnly) return finish({ ok: false, message: "This tab is read-only; the notebook is open for writing in another tab." });
    if (aiDraft || aiRun) return finish({ ok: false, message: "Finish or discard the AI draft on the page first." });
    try {
      const requestId = `chat-${insertRequest.id}`;
      const proposal = validateCanvasProposal({
        schemaVersion: 1,
        operations: [{
          type: "insert_explanation",
          localId: "answer",
          anchor: { relation: selectionBounds ? "right_of_selection" : "viewport_center" },
          content: { kind: "text", title: clampText(insertRequest.title.trim() || "Study assistant", 160), body: clampText(insertRequest.body.trim(), 8_000) },
        }],
      }, {
        requestId,
        pageId: fixture.id,
        permittedOperations: new Set<SemanticOperationType>(["insert_explanation"]),
        targetObjects: new Map(),
        maxOperations: 1,
      });
      const batch = prepareCanvasBatch({
        transactionId: `transaction-${crypto.randomUUID()}`,
        pageId: fixture.id,
        existingObjects: objects,
        proposal,
        provenance: {
          requestId,
          intent: "chat_answer",
          provider: insertRequest.provider,
          model: insertRequest.model,
          configurationId: "chat",
          proposalSchemaVersion: proposal.schemaVersion,
          sources: [],
        },
        selectionBounds,
        viewportCenter,
      });
      const result = applyCanvasBatch(fixture.id, objects, batch, committedAiTransactionIdsRef.current);
      if (!result.applied) return finish({ ok: false, message: "The answer was already added." });
      pendingAiTransactionRef.current = transactionRecordFromBatch(batch);
      committedAiTransactionIdsRef.current.add(batch.transactionId);
      setHistory((current) => commitHistory(current, result.objects));
      setSelectedIds(new Set(batch.generatedObjectIds));
      setTool("select");
      finish({ ok: true });
    } catch (error) {
      finish({ ok: false, message: error instanceof Error ? error.message : "The answer could not be added to the page." });
    }
  // Only a new request should run this; the page state it reads is current at that render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRequest]);

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

  const showHandwritingNotice = (message: string | undefined, clearAfterMs?: number) => {
    window.clearTimeout(handwritingNoticeTimerRef.current);
    setHandwritingNotice(message);
    if (clearAfterMs) handwritingNoticeTimerRef.current = window.setTimeout(() => setHandwritingNotice(undefined), clearAfterMs);
  };

  // Neatens the Pen Pro strokes written since the last pause. They were saved
  // as ordinary ink first, and neatening is one more undoable step, so Undo
  // always returns the writing exactly as it was drawn.
  const neatenPendingHandwriting = () => {
    window.clearTimeout(handwritingTimerRef.current);
    const ids = new Set(pendingHandwritingIdsRef.current);
    pendingHandwritingIdsRef.current = [];
    if (ids.size === 0 || readOnlyRef.current) return;
    const sources = objectsRef.current
      .filter((object) => object.kind === "stroke" && ids.has(object.id))
      .map((object) => ({ id: object.id, revision: object.revision }));
    let neatened = false;
    setHistory((current) => {
      const result = neatenHandwriting(current.present, sources);
      neatened = result.changedIds.length > 0;
      return neatened ? commitHistory(current, result.objects) : current;
    });
    if (neatened) showHandwritingNotice("Handwriting neatened · Undo restores the original", 2_500);
  };

  const scheduleHandwritingConversion = () => {
    window.clearTimeout(handwritingTimerRef.current);
    handwritingTimerRef.current = window.setTimeout(neatenPendingHandwriting, HANDWRITING_PAUSE_MS);
  };

  // Leaving Pen Pro neatens what was written instead of waiting for the timer.
  useEffect(() => {
    if (tool !== "pen-pro" && pendingHandwritingIdsRef.current.length > 0) neatenPendingHandwriting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const saveInkText = (id: string, text: string) => {
    commitObjects((current) => editInkText(current, id, text, measureInkText));
    setEditingInkTextId(undefined);
  };

  const restoreInkText = (id: string) => {
    if (readOnly) return;
    const restored = restoreHandwriting(objects, id, () => `stroke-${crypto.randomUUID()}`);
    if (restored.restoredIds.length === 0) return;
    commitObjects(() => restored.objects);
    setEditingInkTextId(undefined);
    setSelectedIds(new Set(restored.restoredIds));
    setFocusedObjectId(undefined);
  };

  const startEditingText = (object: TextObject) => {
    if (readOnly) return;
    setSelectedIds(new Set([object.id]));
    setFocusedObjectId(object.id);
    setEditingDiagramObjectId(undefined);
    setTextEditing({
      id: object.id,
      isNew: false,
      box: { x: object.x, y: object.y, width: object.width, height: object.height },
      fontSize: object.fontSize,
      color: object.color,
      text: object.text,
    });
  };

  const finishTextEdit = (session: TextEditSession, text: string) => {
    setTextEditing(undefined);
    setTool("select");
    if (session.isNew) {
      const object = createTextObject(session.id, session.box, text, session.fontSize, measureCanvasText);
      if (!object) return;
      commitObjects((current) => [...current, object]);
      setSelectedIds(new Set([object.id]));
      setFocusedObjectId(object.id);
      return;
    }
    commitObjects((current) => editTextObject(current, session.id, text, measureCanvasText));
    // Clearing every character removes the box, so it can no longer be selected.
    if (!normalizeText(text).trim()) {
      setSelectedIds(new Set());
      setFocusedObjectId(undefined);
    }
  };

  const changeTextFontSize = (fontSize: number) => {
    setNewTextFontSize(fontSize);
    if (selectedText) commitObjects((current) => setTextFontSize(current, selectedText.id, fontSize, measureCanvasText));
  };

  const resizeTextFromHandle = (event: KonvaEventObject<DragEvent>, object: TextObject, commit: boolean) => {
    event.cancelBubble = true;
    const nextSize = resizeTextBox({ x: event.currentTarget.x(), y: event.currentTarget.y() }, object, measureCanvasText);
    event.currentTarget.position({ x: nextSize.width, y: nextSize.height });
    if (commit) commitSize(object.id, nextSize);
    else previewSize(object.id, nextSize);
  };

  const screenToWorld = (clientX: number, clientY: number, rect: DOMRect, pressure: number, time: number): PointSample => ({
    x: (clientX - rect.left - camera.x) / camera.scale,
    y: (clientY - rect.top - camera.y) / camera.scale,
    pressure: pressure > 0 ? pressure : 0.5,
    time,
  });

  const strokeStyleFor = (strokeTool: StrokeObject["tool"]): WetStrokeStyle => strokeTool === "highlighter"
    ? { tool: "highlighter", color: HIGHLIGHTER_COLOR, size: highlighterSize, opacity: 0.3 }
    : { tool: "pen", color: PEN_COLOR, size: penSize, opacity: 1 };

  // Draws the stroke under the pen straight away, outside React (see wetInk.ts).
  // Where the OS can draw the delegated ink trail it covers the gap to the pen
  // exactly; otherwise the browser's predicted samples stand in for it. The
  // wobble filter leaves the newest sample in place, so both join the tip.
  const drawWetStroke = (gesture: Gesture, nativeEvent?: PointerEvent) => {
    const layer = wetInkRef.current;
    const style = gesture.strokeStyle;
    const points = removeDigitizerWobble(liveStrokeRef.current, camera.scale);
    const tip = points.at(-1);
    if (!layer || !style || !tip) return;

    const trail = inkTrailRef.current;
    if (nativeEvent && style.tool === "pen" && trail.active) {
      layer.update(style, points);
      trail.update(nativeEvent, { color: style.color, diameter: strokeWidthAt(style.size, tip.pressure, style.tool) * camera.scale });
      return;
    }
    const predicted = nativeEvent?.getPredictedEvents?.() ?? [];
    const ahead = limitPrediction(
      tip,
      predicted.map((sample) => ({ ...pointFromPointer(sample, gesture.rect), pressure: tip.pressure })),
      MAX_PREDICTION_PX / camera.scale,
    );
    layer.update(style, points, ahead);
  };

  const eraseAt = (point: PointSample) => {
    const next = new Set(erasingIdsRef.current);
    for (const stroke of strokes) {
      if (strokeIntersectsPoint(stroke, point, 10 / camera.scale)) next.add(stroke.id);
    }
    for (const inkText of inkTexts) {
      if (point.x >= inkText.x && point.x <= inkText.x + inkText.width && point.y >= inkText.y && point.y <= inkText.y + inkText.height) {
        next.add(inkText.id);
      }
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

  // Contacts are tracked for every pointer on the glass, not just the drawing
  // one, and their footprint is kept as the largest seen: a palm lands small
  // and spreads, so its first sample understates it badly.
  const trackContact = (nativeEvent: PointerEvent) => {
    const existing = contactsRef.current.get(nativeEvent.pointerId);
    const size = Math.max(contactSize(nativeEvent), existing?.size ?? 0);
    contactsRef.current.set(nativeEvent.pointerId, {
      pointerId: nativeEvent.pointerId,
      pointerType: nativeEvent.pointerType,
      size,
      startedAt: existing?.startedAt ?? nativeEvent.timeStamp,
    });
    // Only palm mode shows the contacts. Publishing them on every move made each
    // pen sample re-render the whole canvas, which was most of the ink latency.
    if (touchMode === "palm") publishContacts();
  };

  const releaseContact = (pointerId: number) => {
    contactsRef.current.delete(pointerId);
    publishContacts();
  };

  const publishContacts = () => {
    const contacts = [...contactsRef.current.values()];
    const signature = contacts.map((contact) => `${contact.pointerId}:${Math.round(contact.size)}`).sort().join(",");
    if (signature === publishedContactsRef.current) return;
    publishedContactsRef.current = signature;
    setActiveContacts(contacts);
  };

  // Which contact is allowed to draw right now. Outside palm mode the question
  // does not arise: whatever the writer put down is what they meant.
  const inkingPointerId = () =>
    touchMode === "palm" ? inkingContactId([...contactsRef.current.values()]) : undefined;

  const beginInput = (event: KonvaEventObject<PointerEvent>) => {
    const nativeEvent = event.evt;
    const stage = event.target.getStage();
    const rect = stage?.container().getBoundingClientRect();
    if (!rect) return;

    trackContact(nativeEvent);

    if (touchMode === "palm" && isInkTool(tool)) {
      // Said once, and before anything is rejected: without contact geometry
      // this mode cannot work at all, and the writer needs to know that rather
      // than wonder why their stylus is being ignored.
      if (
        !geometryWarnedRef.current
        && contactsRef.current.size > 1
        && !reportsContactGeometry([...contactsRef.current.values()])
      ) {
        geometryWarnedRef.current = true;
        showHandwritingNotice("This screen does not report touch size · palm rejection cannot tell tip from hand", 5_000);
      }
      const winner = inkingPointerId();
      // Anything that is not the chosen contact is a palm: it must not draw and
      // must not pan either, or resting a hand would still shove the canvas.
      if (winner !== nativeEvent.pointerId) return;
      // The contact already drawing has just been out-voted, which means it was
      // the hand all along. Throw its ink away rather than leaving a palm mark.
      if (gestureRef.current && gestureRef.current.pointerId !== winner) {
        finishInput(true, gestureRef.current.pointerId);
      }
    } else if (gestureRef.current) {
      return;
    }
    if (gestureRef.current) return;

    nativeEvent.preventDefault();
    // Konva listens on its own content element, so that is the node the capture
    // has to go on: moves that leave the canvas must keep reaching this gesture.
    try {
      (nativeEvent.currentTarget as Element | null)?.setPointerCapture(nativeEvent.pointerId);
    } catch {
      // A pointer that already ended cannot be captured; the gesture still runs.
    }

    // The first stylus contact is what proves palm rejection is worth having.
    // Until then finger drawing stays on, so a touch-only screen can write.
    if (nativeEvent.pointerType === "pen" && !stylusSeenRef.current) {
      stylusSeenRef.current = true;
      if (!touchModeChosenRef.current && touchMode === "finger") {
        setTouchMode("stylus");
        showHandwritingNotice("Stylus detected · touch now pans, stylus draws", 3_000);
      }
    }

    const kind = gestureKindFor({ tool, pointerType: nativeEvent.pointerType, touchMode });
    const startPoint = pointFromPointer(nativeEvent, rect);
    const strokeTool = tool === "highlighter" ? "highlighter" : "pen";
    gestureRef.current = {
      pointerId: nativeEvent.pointerId,
      kind,
      lastScreen: { x: nativeEvent.clientX, y: nativeEvent.clientY },
      rect,
      strokeTool,
      strokeStyle: kind === "stroke" ? strokeStyleFor(strokeTool) : undefined,
      startWorld: kind === "shape" || kind === "text" ? startPoint : undefined,
      shapeType: tool === "rectangle" || tool === "ellipse" ? tool : undefined,
      handwriting: tool === "pen-pro" && kind === "stroke",
    };

    if (gestureRef.current.handwriting) {
      // Continuing the same word or line keeps collecting; starting clearly
      // elsewhere neatens what was already written as its own line.
      window.clearTimeout(handwritingTimerRef.current);
      const pendingIds = new Set(pendingHandwritingIdsRef.current);
      const pending = objectsRef.current.filter((object): object is StrokeObject => object.kind === "stroke" && pendingIds.has(object.id));
      if (pending.length > 0) {
        const bounds = inkBounds(pending);
        const margin = Math.max(48, bounds.height * 1.5);
        const nearby = startPoint.x >= bounds.x - margin && startPoint.x <= bounds.x + bounds.width + margin
          && startPoint.y >= bounds.y - margin && startPoint.y <= bounds.y + bounds.height + margin;
        if (!nearby) neatenPendingHandwriting();
      }
    }

    if (kind === "stroke") {
      liveStrokeRef.current = [startPoint];
      inkTrailRef.current.prepare();
      drawWetStroke(gestureRef.current);
    } else if (kind === "lasso") {
      lassoPointsRef.current = [startPoint];
      setLassoPoints([startPoint]);
    } else if (kind === "shape" || kind === "text") {
      const draft: DraftBox = { ...boundsFromPoints(startPoint, startPoint), shape: kind === "text" ? "text" : gestureRef.current.shapeType ?? "rectangle" };
      draftShapeRef.current = draft;
      setDraftShape(draft);
    } else if (kind === "erase") {
      eraseAt(startPoint);
    }
  };

  const extendInput = (event: KonvaEventObject<PointerEvent>) => {
    const nativeEvent = event.evt;

    if (contactsRef.current.has(nativeEvent.pointerId)) {
      // A resting palm keeps growing after it lands, so the footprint has to be
      // re-read on every move: the contact that looked tip-sized a moment ago
      // is often the hand a few samples later.
      trackContact(nativeEvent);
      if (touchMode === "palm" && isInkTool(tool)) {
        const winner = inkingPointerId();
        const drawing = gestureRef.current;
        // No winner at all means every contact on the glass is now hand-sized,
        // which includes the one drawing: a tip-sized contact that spreads as
        // it settles was a knuckle or a palm edge, so its ink goes too.
        if (drawing && winner !== drawing.pointerId) {
          finishInput(true, drawing.pointerId);
          return;
        }
      }
    }

    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== nativeEvent.pointerId) return;

    if (gesture.kind === "pan") {
      const deltaX = nativeEvent.clientX - gesture.lastScreen.x;
      const deltaY = nativeEvent.clientY - gesture.lastScreen.y;
      gesture.lastScreen = { x: nativeEvent.clientX, y: nativeEvent.clientY };
      setCamera((current) => ({ ...current, x: current.x + deltaX, y: current.y + deltaY }));
      return;
    }

    const samples = pointerSamples(nativeEvent);
    const points = samples.map((sample) => pointFromPointer(sample, gesture.rect));

    if (gesture.kind === "stroke") {
      liveStrokeRef.current = appendDistinctPoints(liveStrokeRef.current, points, 0.35 / camera.scale);
      drawWetStroke(gesture, nativeEvent);
    } else if (gesture.kind === "lasso") {
      lassoPointsRef.current = appendDistinctPoints(lassoPointsRef.current, points, 1 / camera.scale);
      setLassoPoints([...lassoPointsRef.current]);
    } else if ((gesture.kind === "shape" || gesture.kind === "text") && gesture.startWorld) {
      gesture.lastWorld = points.at(-1) ?? gesture.startWorld;
      const bounds = boundsFromPoints(gesture.startWorld, gesture.lastWorld);
      const draft: DraftBox = { ...bounds, shape: gesture.kind === "text" ? "text" : gesture.shapeType ?? "rectangle" };
      draftShapeRef.current = draft;
      setDraftShape(draft);
    } else {
      points.forEach(eraseAt);
    }
  };

  const finishInput = (cancelled = false, pointerId?: number) => {
    const gesture = gestureRef.current;
    // A palm lifting off must not end the stroke the stylus is still drawing.
    if (!gesture || (pointerId !== undefined && gesture.pointerId !== pointerId)) return;

    // A single sample is a tap: the dot of an i or j, a full stop. It is ink too.
    if (!cancelled && gesture.kind === "stroke" && gesture.strokeStyle && liveStrokeRef.current.length > 0 && !readOnly) {
      // The same filter the wet stroke was drawn with, so the ink does not shift at pen-up.
      const points = removeDigitizerWobble(liveStrokeRef.current, camera.scale);
      const style = gesture.strokeStyle;
      const strokeTool = style.tool;
      const strokeSize = style.size;
      const padding = strokeSize / 2;
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const stroke: StrokeObject = {
        id: `stroke-${crypto.randomUUID()}`,
        revision: 1,
        kind: "stroke",
        tool: strokeTool,
        color: style.color,
        size: strokeSize,
        x: Math.min(...xs) - padding,
        y: Math.min(...ys) - padding,
        width: Math.max(...xs) - Math.min(...xs) + padding * 2,
        height: Math.max(...ys) - Math.min(...ys) + padding * 2,
        points,
      };
      commitObjects((current) => [...current, stroke]);
      wetInkRef.current?.settle(stroke.id, style, points);
      if (gesture.handwriting) pendingHandwritingIdsRef.current.push(stroke.id);
    } else if (gesture.kind === "stroke") {
      wetInkRef.current?.discard();
    }
    if (gesture.handwriting && pendingHandwritingIdsRef.current.length > 0) scheduleHandwritingConversion();

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
      setFocusedObjectId(undefined);
      setEditingDiagramObjectId(undefined);
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

    if (!cancelled && gesture.kind === "text" && gesture.startWorld) {
      const start = gesture.startWorld;
      const end = gesture.lastWorld ?? start;
      const tapThreshold = 6 / camera.scale;
      const tapped = Math.abs(end.x - start.x) < tapThreshold && Math.abs(end.y - start.y) < tapThreshold;
      // Tapping existing text with the Text tool edits it rather than stacking a new box on top.
      const existing = tapped ? textObjectAt(objects, start) : undefined;
      if (existing) {
        startEditingText(existing);
      } else if (!readOnly) {
        setSelectedIds(new Set());
        setFocusedObjectId(undefined);
        setTextEditing({
          id: `text-${crypto.randomUUID()}`,
          isNew: true,
          box: textBoxFromGesture(start, end, newTextFontSize, tapThreshold),
          fontSize: newTextFontSize,
          color: TEXT_COLOR,
          text: "",
        });
      }
    }

    gestureRef.current = undefined;
    liveStrokeRef.current = [];
    lassoPointsRef.current = [];
    draftShapeRef.current = undefined;
    erasingIdsRef.current = new Set();
    setLassoPoints([]);
    setDraftShape(undefined);
    setErasingIds(new Set());
  };

  // Every contact that leaves the glass is forgotten, drawing or not, so a palm
  // that was ignored cannot linger and keep out-voting the next stroke.
  const endInput = (event: KonvaEventObject<PointerEvent>, cancelled: boolean) => {
    const pointerId = event.evt.pointerId;
    releaseContact(pointerId);
    finishInput(cancelled, pointerId);
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
  // Memoized so the stroke layer's props stay equal while nothing about strokes changes.
  const visibleStrokes = useMemo(
    () => objects.filter((object): object is StrokeObject => object.kind === "stroke" && !erasingIds.has(object.id)),
    [objects, erasingIds],
  );
  const currentStrokeTool = tool === "highlighter" ? "highlighter" : "pen";
  const selectedInkText = selectedIds.size === 1 ? inkTexts.find((inkText) => selectedIds.has(inkText.id)) : undefined;
  const inkTextBeingEdited = inkTexts.find((inkText) => inkText.id === editingInkTextId && selectedIds.has(inkText.id));
  const currentStrokeSize = currentStrokeTool === "highlighter" ? highlighterSize : penSize;
  const selectedText = selectedIds.size === 1 ? texts.find((text) => selectedIds.has(text.id)) : undefined;
  const textFontSizeValue = selectedText?.fontSize ?? newTextFontSize;
  editSelectedTextRef.current = () => {
    if (!selectedText || readOnly || textEditing) return false;
    startEditingText(selectedText);
    return true;
  };

  return (
    <section className="prototype" ref={prototypeRef} data-fullscreen-fallback={fullscreenFallback || undefined}>
      <div className="prototype-controls">
        <div className="prototype-toolbar" aria-label="Canvas tools">
        <div className="tool-group" role="group" aria-label="Drawing tools">
          {([
            ["select", "Select", "V"],
            ["lasso", "Lasso", "L"],
            ["pen", "Pen", "P"],
            ["pen-pro", "Pen Pro", "W"],
            ["highlighter", "Highlight", "H"],
            ["eraser", "Eraser", "E"],
            ["rectangle", "Rectangle", "R"],
            ["ellipse", "Ellipse", "O"],
            ["text", "Text", "T"],
            ["pan", "Hand", "Space"],
          ] as const).map(([value, label, shortcut]) => (
            <button key={value} type="button" aria-pressed={tool === value} onClick={() => setTool(value)} title={`${label} (${shortcut})`} disabled={readOnly && value !== "select" && value !== "pan"}>
              {label}
            </button>
          ))}
        </div>

        {isInkTool(tool) && (
          <label className="size-control">
            <span>Size</span>
            <input
              type="range"
              min={tool === "highlighter" ? 10 : 1.5}
              max={tool === "highlighter" ? 40 : 14}
              step={0.5}
              value={currentStrokeSize}
              onChange={(event) => tool === "highlighter" ? setHighlighterSize(Number(event.target.value)) : setPenSize(Number(event.target.value))}
            />
            <output>{currentStrokeSize}px</output>
          </label>
        )}

        {(tool === "text" || selectedText) && (
          <label className="touch-mode">
            <span>Text size</span>
            <select
              value={textFontSizeValue}
              onChange={(event) => changeTextFontSize(Number(event.target.value))}
              disabled={readOnly}
              title={selectedText ? "Size of the selected text" : "Size for new text"}
            >
              {TEXT_FONT_SIZES.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}
              {!TEXT_FONT_SIZES.some(({ value }) => value === textFontSizeValue) && (
                <option value={textFontSizeValue}>{textFontSizeValue}px</option>
              )}
            </select>
          </label>
        )}

        <label className="touch-mode">
          <span>Touch</span>
          <select
            value={touchMode}
            onChange={(event) => {
              touchModeChosenRef.current = true;
              geometryWarnedRef.current = false;
              setTouchMode(event.target.value as TouchMode);
            }}
            disabled={readOnly}
            title="How bare touch contacts are treated while inking"
          >
            <option value="finger">Finger draws</option>
            <option value="palm">Palm rejection</option>
            <option value="stylus">Stylus only</option>
          </select>
        </label>

        <div className="tool-group" role="group" aria-label="History">
          <button type="button" disabled={readOnly || history.past.length === 0} onClick={() => setHistory(undoHistory)} title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" disabled={readOnly || history.future.length === 0} onClick={() => setHistory(redoHistory)} title="Redo (Ctrl+Y)">Redo</button>
          <button type="button" disabled={readOnly || objects.length === 0} onClick={() => setConfirmingClear(true)} title="Remove everything on this page">Clear all</button>
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
          {AI_CANVAS_ACTIONS.map((intent) => (
            <button
              key={intent}
              type="button"
              onClick={() => void runAiAction(intent)}
              disabled={readOnly || Boolean(aiDraft) || Boolean(aiRun)}
              title={AI_REQUEST_PLANS[intent].requiresContext ? "Select a note, card or diagram first" : undefined}
            >
              {AI_REQUEST_PLANS[intent].label}
            </button>
          ))}
          <button type="button" onClick={prepareMockLesson} disabled={readOnly || Boolean(aiDraft) || Boolean(aiRun)} title="Build a fixture lesson on this device, with no network request">Mock lesson</button>
        </div>

        <div className="tool-group" role="group" aria-label="Selection actions">
          <span>{selectedIds.size} selected</span>
          <button type="button" disabled={readOnly || selectedIds.size === 0} onClick={duplicateSelection}>Duplicate</button>
          <button type="button" disabled={readOnly || selectedIds.size === 0} onClick={deleteSelection}>Delete</button>
          <button type="button" disabled={readOnly || !canGroup} onClick={groupSelection}>Group</button>
          <button type="button" disabled={readOnly || !canUngroup} onClick={ungroupSelection}>Ungroup</button>
          <button type="button" disabled={readOnly || !selectedDiagramObject} onClick={() => setEditingDiagramObjectId(selectedDiagramObject?.id)}>Edit label</button>
          {selectedInkText && (
            <button type="button" disabled={readOnly} onClick={() => setEditingInkTextId(selectedInkText.id)}>Edit text</button>
          )}
          {selectedText && (
            <button type="button" disabled={readOnly} onClick={() => startEditingText(selectedText)} title="Edit text (Enter or double-click)">Edit text</button>
          )}
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

        <ConfirmDialog
          open={confirmingClear}
          tone="danger"
          title="Clear this page?"
          message={`This removes all ${objects.length} ${objects.length === 1 ? "item" : "items"} on the page. You can bring them back with Undo (Ctrl+Z).`}
          confirmLabel="Clear page"
          onConfirm={clearCanvas}
          onCancel={() => setConfirmingClear(false)}
        />

        {(aiDraft || aiDraftError || aiRun) && (
          <aside className="ai-draft" aria-label="AI draft preview" aria-busy={Boolean(aiRun)}>
            <div>
              <strong>
                {aiRun
                  ? AI_REQUEST_PLANS[aiRun.intent].label
                  : aiDraft
                    ? `${draftLabel(aiDraft.provenance.intent)} draft`
                    : "Nothing was added"}
              </strong>
              <span role={aiRun ? "status" : undefined}>
                {aiRun
                  ? `${AI_PHASE_LABELS[aiRun.phase]}…`
                  : aiDraft
                    ? `${aiDraft.inserts.length} editable ${aiDraft.inserts.length === 1 ? "object" : "objects"} from ${aiDraft.provenance.provider}/${aiDraft.provenance.model}, waiting on the page.`
                    : aiDraftError}
              </span>
            </div>
            <div className="ai-draft__actions">
              {aiRun && <button type="button" onClick={cancelAiAction}>Cancel</button>}
              {!aiRun && aiDraftError && aiRetryIntent && (
                <button type="button" onClick={() => void runAiAction(aiRetryIntent)}>Try again</button>
              )}
              {!aiRun && aiDraftError && (
                <button type="button" onClick={() => { setAiDraftError(undefined); setAiRetryIntent(undefined); }}>Dismiss</button>
              )}
              {aiDraft && (
                <>
                  <button type="button" onClick={() => { setAiDraft(undefined); setAiDraftError(undefined); }}>Discard</button>
                  <button type="button" onClick={acceptAiDraft}>Add to page</button>
                </>
              )}
            </div>
          </aside>
        )}

        {diagramObjectBeingEdited && selectedIds.has(diagramObjectBeingEdited.id) && (
          <DiagramLabelEditor
            key={`${diagramObjectBeingEdited.id}:${diagramObjectBeingEdited.revision}`}
            object={diagramObjectBeingEdited}
            onCancel={() => setEditingDiagramObjectId(undefined)}
            onSave={(label) => updateDiagramLabel(diagramObjectBeingEdited.id, label)}
          />
        )}

        {inkTextBeingEdited && !readOnly && (
          <InkTextEditor
            key={`${inkTextBeingEdited.id}:${inkTextBeingEdited.revision}`}
            object={inkTextBeingEdited}
            onCancel={() => setEditingInkTextId(undefined)}
            onSave={(text) => saveInkText(inkTextBeingEdited.id, text)}
            onRestoreInk={() => restoreInkText(inkTextBeingEdited.id)}
          />
        )}

        <details className="linear-reading-view">
          <summary>Linear reading view</summary>
          {linearReadingItems.length > 0 ? (
            <ol>{linearReadingItems.map((item) => <li key={item.id}>{item.text}</li>)}</ol>
          ) : (
            <p>No readable learning objects on this page yet.</p>
          )}
        </details>
      </div>

      <div className="canvas-viewport" ref={rootRef} data-tool={tool}>
        {size.width > 0 && size.height > 0 && (
          <Stage width={size.width} height={size.height} className="konva-stage">
            <Layer>
              <Rect width={size.width} height={size.height} fill="#fbfaf5" onPointerDown={() => { setSelectedIds(new Set()); setFocusedObjectId(undefined); setEditingDiagramObjectId(undefined); }} />
            </Layer>
            <Layer listening={tool === "select"}>
              <Group x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale}>
                {connectors.map((connector) => {
                  const from = connectableById.get(connector.fromId);
                  const to = connectableById.get(connector.toId);
                  if (!from || !to) return null;
                  const { x1, y1, x2, y2 } = routeConnector(
                    { ...positionFor(from), ...sizeFor(from) },
                    { ...positionFor(to), ...sizeFor(to) },
                  );
                  return (
                    <Group key={connector.id} onPointerDown={(event) => selectObject(connector.id, event.evt.shiftKey)}>
                      <Arrow
                        points={[x1, y1, x2, y2]}
                        stroke={selectedIds.has(connector.id) ? "#ef8c45" : "#537188"}
                        fill={selectedIds.has(connector.id) ? "#ef8c45" : "#537188"}
                        strokeWidth={selectedIds.has(connector.id) ? 3.5 : 2.5}
                        pointerLength={9}
                        pointerWidth={8}
                        hitStrokeWidth={16}
                      />
                      {connector.label && (
                        <Text
                          x={(x1 + x2) / 2 - 80}
                          y={(y1 + y2) / 2 - 22}
                          width={160}
                          text={connector.label}
                          align="center"
                          fontSize={12}
                          fontFamily="Inter, sans-serif"
                          fill={selectedIds.has(connector.id) ? "#b65e26" : "#537188"}
                        />
                      )}
                    </Group>
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

                {inkTexts.map((inkText) => {
                  const position = positionFor(inkText);
                  const selected = selectedIds.has(inkText.id);
                  const edit = () => { if (!readOnly) setEditingInkTextId(inkText.id); };
                  return (
                    <Group
                      key={inkText.id}
                      x={position.x}
                      y={position.y}
                      opacity={erasingIds.has(inkText.id) ? 0.25 : 1}
                      draggable={tool === "select" && !readOnly}
                      onPointerDown={(event) => selectObject(inkText.id, event.evt.shiftKey)}
                      onDblClick={edit}
                      onDblTap={edit}
                      onDragMove={(event) => {
                        if (event.target !== event.currentTarget) return;
                        previewPosition(inkText.id, { x: event.currentTarget.x(), y: event.currentTarget.y() });
                      }}
                      onDragEnd={(event) => {
                        if (event.target !== event.currentTarget) return;
                        commitPosition(inkText.id, { x: event.currentTarget.x(), y: event.currentTarget.y() });
                      }}
                    >
                      <Rect
                        x={-4}
                        y={-2}
                        width={inkText.width + 8}
                        height={inkText.height + 4}
                        fill="rgba(255, 255, 255, 0.001)"
                        stroke={selected ? "#ef8c45" : undefined}
                        strokeWidth={selected ? 2 / camera.scale : 0}
                        dash={[6 / camera.scale, 4 / camera.scale]}
                        cornerRadius={6}
                      />
                      <Text
                        text={inkText.text}
                        height={inkText.height}
                        verticalAlign="middle"
                        fontSize={inkText.fontSize}
                        fontFamily={INK_TEXT_FONT_FAMILY}
                        fill={inkText.color}
                        wrap="none"
                      />
                    </Group>
                  );
                })}

                {texts.map((textObject) => {
                  // The editor shows these words while they are being typed.
                  if (textObject.id === textEditing?.id) return null;
                  const position = positionFor(textObject);
                  const dimensions = sizeFor(textObject);
                  const selected = selectedIds.has(textObject.id);
                  const edit = () => startEditingText(textObject);
                  return (
                    <Group
                      key={textObject.id}
                      x={position.x}
                      y={position.y}
                      draggable={tool === "select" && !readOnly}
                      onPointerDown={(event) => selectObject(textObject.id, event.evt.shiftKey)}
                      onDblClick={edit}
                      onDblTap={edit}
                      onDragMove={(event) => {
                        if (event.target !== event.currentTarget) return;
                        previewPosition(textObject.id, { x: event.currentTarget.x(), y: event.currentTarget.y() });
                      }}
                      onDragEnd={(event) => {
                        if (event.target !== event.currentTarget) return;
                        commitPosition(textObject.id, { x: event.currentTarget.x(), y: event.currentTarget.y() });
                      }}
                    >
                      <Rect
                        width={dimensions.width}
                        height={dimensions.height}
                        fill="rgba(255, 255, 255, 0.001)"
                        stroke={selected ? "#ef8c45" : undefined}
                        strokeWidth={selected ? 2 / camera.scale : 0}
                        dash={[6 / camera.scale, 4 / camera.scale]}
                        cornerRadius={4}
                      />
                      <Text
                        text={textObject.text}
                        width={dimensions.width}
                        padding={TEXT_PADDING}
                        fontSize={textObject.fontSize}
                        fontFamily={TEXT_FONT_FAMILY}
                        lineHeight={TEXT_LINE_HEIGHT}
                        fill={textObject.color}
                        wrap="word"
                      />
                      {selected && selectedIds.size === 1 && !readOnly && (
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
                          onDragMove={(event) => resizeTextFromHandle(event, textObject, false)}
                          onDragEnd={(event) => resizeTextFromHandle(event, textObject, true)}
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
              onEditEquation={(title, latex) => updateEquationCard(card.id, title, latex)}
              onEditQuiz={(prompt, options, correctOptionId, rationale) => updateQuizCard(card.id, prompt, options, correctOptionId, rationale)}
              {...(card.kind === "quiz-card" ? {
                onAnswerQuiz: (optionId: string, assistance?: QuizAssistance) => void quizAttempts.recordAnswer(card, optionId, assistance),
                attemptHistory: describeQuizAttempts(summarizeQuizAttempts(card, quizAttempts.attempts)),
                attemptError: quizAttempts.failure && (quizAttempts.failure.quizId === card.id || quizAttempts.failure.quizId === "") ? quizAttempts.failure.message : undefined,
              } : {})}
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
            onPointerUp={(event) => endInput(event, false)}
            onPointerCancel={(event) => endInput(event, true)}
          >
            {/* Nothing on this stage has handlers of its own; every gesture is
                handled at stage level. A listening layer would redraw a hit
                canvas each frame and read a pixel back from it on every move. */}
            <Layer listening={false}>
              <Group x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale}>
                <InkStrokes strokes={visibleStrokes} selectedIds={selectedIds} transientPositions={transientPositions} cameraScale={camera.scale} />
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
                  draftShape.shape === "text" ? (
                    <Rect
                      x={draftShape.x}
                      y={draftShape.y}
                      width={draftShape.width}
                      height={draftShape.height}
                      stroke="#537188"
                      strokeWidth={1.5 / camera.scale}
                      dash={[6 / camera.scale, 4 / camera.scale]}
                      cornerRadius={4}
                    />
                  ) : draftShape.shape === "ellipse" ? (
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
              </Group>
            </Layer>
          </Stage>
        )}

        <canvas ref={wetCanvasRef} className="wet-ink-layer" aria-hidden="true" />

        {textEditing && !readOnly && (
          <div
            className="text-editor-layer"
            style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
          >
            <CanvasTextEditor
              key={textEditing.id}
              box={textEditing.box}
              fontSize={textEditing.fontSize}
              color={textEditing.color}
              initialText={textEditing.text}
              canvasRef={rootRef}
              onCommit={(text) => finishTextEdit(textEditing, text)}
            />
          </div>
        )}

        {/* Transient notices float over the canvas. In the toolbar they reflowed
            a wrapping flex row, which changed its height and shoved the canvas
            down mid-stroke every time a message came and went. */}
        <div className="canvas-toast" role="status" aria-live="polite">
          {imageNotice && <p>{imageNotice}</p>}
          {handwritingNotice && <p>{handwritingNotice}</p>}
        </div>

        <div className="canvas-status" aria-live="polite">
          <span>{tool === "eraser" ? "Whole-stroke eraser" : tool === "pen-pro" ? "Pen Pro: pause to neaten your writing" : tool === "text" ? "Text: click to type, or drag to size a box" : `${TOOL_LABELS[tool]} tool`}</span>
          {touchMode === "palm" && activeContacts.length > 0 && (
            <span>
              {activeContacts.length === 1 ? "contact" : "contacts"}{" "}
              {[...activeContacts]
                .sort((a, b) => a.size - b.size)
                .map((contact) => `${Math.round(contact.size)}px${contact.pointerId === inkingPointerId() ? " (inking)" : ""}`)
                .join(", ")}
            </span>
          )}
          <span>{strokes.length} strokes</span>
          <span>{objects.length} objects</span>
          <span>Wheel: pan · Ctrl/⌘+wheel: canvas zoom</span>
        </div>
      </div>
    </section>
  );
}
