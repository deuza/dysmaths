"use client";

import {
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { toBlob, toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";

type StudyMode = "college" | "lycee";
type StructuredTool = "fraction" | "division" | "power" | "root";
type UtilityMenu = "settings" | "export" | null;

type FractionBlock = {
  id: string;
  type: "fraction";
  numerator: string;
  denominator: string;
  simplified: string;
  caption: string;
  numeratorStrike?: boolean;
  denominatorStrike?: boolean;
  x: number;
  y: number;
  width: number;
};

type DivisionBlock = {
  id: string;
  type: "division";
  dividend: string;
  divisor: string;
  quotient: string;
  remainder: string;
  caption: string;
  x: number;
  y: number;
  width: number;
};

type PowerBlock = {
  id: string;
  type: "power";
  base: string;
  exponent: string;
  result: string;
  caption: string;
  x: number;
  y: number;
  width: number;
};

type RootBlock = {
  id: string;
  type: "root";
  radicand: string;
  result: string;
  caption: string;
  x: number;
  y: number;
  width: number;
};

type FloatingSymbol = {
  id: string;
  type: "symbol";
  label: string;
  content: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
};

type FloatingTextBox = {
  id: string;
  type: "textBox";
  variant?: "default" | "note";
  text: string;
  x: number;
  y: number;
  width: number;
};

type FreehandPoint = {
  x: number;
  y: number;
};

type FreehandStroke = {
  id: string;
  points: FreehandPoint[];
};

type MathBlock = FractionBlock | DivisionBlock | PowerBlock | RootBlock;

type WriterState = {
  title: string;
  mode: StudyMode;
  advancedMode: boolean;
  textHtml: string;
  blocks: MathBlock[];
  symbols: FloatingSymbol[];
  textBoxes: FloatingTextBox[];
  strokes: FreehandStroke[];
};

type ModalState =
  | {
      mode: "insert" | "edit";
      block: MathBlock;
    }
  | null;

type InlineShortcutItem = {
  id: string;
  label: string;
  hint: string;
  content: string;
  modes: StudyMode[];
};

type InlineShortcutGroup = {
  name: string;
  items: InlineShortcutItem[];
};

type DragState = {
  itemType: "block" | "symbol" | "textBox" | "stroke";
  itemId: string;
  pointerOffsetX: number;
  pointerOffsetY: number;
  groupBlockPositions: Array<{ id: string; x: number; y: number }>;
  groupSymbolPositions: Array<{ id: string; x: number; y: number }>;
  groupTextBoxPositions: Array<{ id: string; x: number; y: number }>;
  groupStrokePositions: Array<{ id: string; x: number; y: number; points: FreehandPoint[] }>;
  anchorX: number;
  anchorY: number;
} | null;

type SelectionRect = {
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
} | null;

type PendingSelection = {
  originX: number;
  originY: number;
  started: boolean;
} | null;

type ToolbarDragPayload =
  | { kind: "structured"; toolId: StructuredTool }
  | { kind: "shortcut"; shortcutId: string };

type ToolbarDragMeta = {
  offsetX: number;
  offsetY: number;
  previewNode: HTMLElement | null;
};

type EditingBlockState =
  | {
      blockId: string;
      field: string;
    }
  | null;

type CanvasQuickMenu =
  | {
      x: number;
      y: number;
      clickX: number;
      clickY: number;
    }
  | null;

type SnapGuides = {
  x: number | null;
  y: number | null;
};

type AdvancedTool = "note" | "draw" | null;

const STORAGE_KEY = "maths-facile-free-layout-v1";
const FLOATING_TEXTBOX_Y_OFFSET = 10;
const CANVAS_QUICK_MENU_OFFSET_X = 30;
const MAX_HISTORY_STEPS = 80;
const DEFAULT_CANVAS_FONT_SIZE_REM = 1.18;
const PAPER_LINE_STEP_REM = 2.95;
const CANVAS_GRID_LEFT_REM = 4.8;
const CANVAS_GRID_TOP_REM = 1.25;
const MAX_SNAP_THRESHOLD_PX = 10;

const DEFAULT_TEXT_HTML = [
  "<p><strong>Commence ici :</strong> écris librement ta méthode, tes calculs et ta réponse.</p>",
  "<p>Ajoute ensuite une fraction posée, une division posée, une puissance ou une racine, puis déplace le bloc où tu veux sur la feuille.</p>"
].join("");

const DEFAULT_STATE: WriterState = {
  title: "Mon document de maths",
  mode: "college",
  advancedMode: false,
  textHtml: DEFAULT_TEXT_HTML,
  blocks: [],
  symbols: [],
  textBoxes: [],
  strokes: []
};

const FONT_SIZE_OPTIONS = [
  { id: "size-small", label: "Petit", value: "2" },
  { id: "size-normal", label: "Normal", value: "3" },
  { id: "size-large", label: "Grand", value: "5" },
  { id: "size-xlarge", label: "Très grand", value: "7" }
] as const;

const COLOR_OPTIONS = [
  { id: "ink", label: "Encre", value: "#1f2d3d" },
  { id: "orange", label: "Orange", value: "#d56f3c" },
  { id: "blue", label: "Bleu", value: "#2169b3" },
  { id: "green", label: "Vert", value: "#2f8f57" },
  { id: "pink", label: "Rose", value: "#b54d7a" }
] as const;

const STRUCTURED_TOOLS = [
  { id: "fraction" as const, label: "Fraction posée", hint: "Numérateur au-dessus, dénominateur en dessous", modes: ["college", "lycee"] as StudyMode[] },
  { id: "division" as const, label: "Division posée", hint: "Diviseur, dividende, quotient et reste", modes: ["college", "lycee"] as StudyMode[] },
  { id: "power" as const, label: "Puissance", hint: "Base, exposant et résultat", modes: ["college", "lycee"] as StudyMode[] },
  { id: "root" as const, label: "Racine", hint: "Radicande et résultat", modes: ["college", "lycee"] as StudyMode[] }
] as const;

const INLINE_SHORTCUT_GROUPS: InlineShortcutGroup[] = [
  {
    name: "Essentiels",
    items: [
      { id: "equal", label: "=", hint: "Ajoute =", content: " = ", modes: ["college", "lycee"] },
      { id: "neq", label: "≠", hint: "Ajoute ≠", content: " ≠ ", modes: ["college", "lycee"] },
      { id: "leq", label: "≤", hint: "Inférieur ou égal", content: " ≤ ", modes: ["college", "lycee"] },
      { id: "geq", label: "≥", hint: "Supérieur ou égal", content: " ≥ ", modes: ["college", "lycee"] },
      { id: "times", label: "×", hint: "Multiplier", content: " × ", modes: ["college", "lycee"] },
      { id: "div", label: "÷", hint: "Diviser", content: " ÷ ", modes: ["college", "lycee"] },
      { id: "percent", label: "%", hint: "Pourcentage", content: "%", modes: ["college", "lycee"] },
      { id: "pi", label: "π", hint: "Pi", content: "π", modes: ["college", "lycee"] }
    ]
  },
  {
    name: "Géométrie",
    items: [
      { id: "angle", label: "∠ABC", hint: "Angle", content: "∠ABC", modes: ["college", "lycee"] },
      { id: "parallel", label: "∥", hint: "Parallèle", content: " ∥ ", modes: ["college", "lycee"] },
      { id: "perpendicular", label: "⟂", hint: "Perpendiculaire", content: " ⟂ ", modes: ["college", "lycee"] },
      { id: "degree", label: "°", hint: "Degré", content: "°", modes: ["college", "lycee"] }
    ]
  },
  {
    name: "Lycée",
    items: [
      { id: "function", label: "f(x)", hint: "Fonction", content: "f(x) = ", modes: ["lycee"] },
      { id: "limit", label: "lim", hint: "Limite", content: "lim(x→a)", modes: ["lycee"] },
      { id: "sum", label: "Σ", hint: "Somme", content: "Σ(k=1→n)", modes: ["lycee"] },
      { id: "integral", label: "∫", hint: "Intégrale", content: "∫[a;b]", modes: ["lycee"] },
      { id: "ln", label: "ln", hint: "Logarithme", content: "ln(x)", modes: ["lycee"] }
    ]
  }
];

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getTextBoxWidth(text: string) {
  const visibleText = text.trim();
  return Math.max(36, Math.min(920, visibleText.length * 14 + 12));
}

function getStrokeBounds(points: FreehandPoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys))
  };
}

function createStrokePath(points: FreehandPoint[]): string {
  if (points.length === 0) {
    return "";
  }

  const [firstPoint, ...otherPoints] = points;
  return `M ${firstPoint.x} ${firstPoint.y} ${otherPoints.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
}

function getPointDistance(left: FreehandPoint, right: FreehandPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function getStrokeLength(points: FreehandPoint[]): number {
  let length = 0;

  for (let index = 1; index < points.length; index += 1) {
    length += getPointDistance(points[index - 1], points[index]);
  }

  return length;
}

function getDistanceToSegment(point: FreehandPoint, start: FreehandPoint, end: FreehandPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;

  if (squaredLength === 0) {
    return getPointDistance(point, start);
  }

  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength;
  const clampedProjection = Math.max(0, Math.min(1, projection));

  return Math.hypot(point.x - (start.x + clampedProjection * dx), point.y - (start.y + clampedProjection * dy));
}

function simplifyStrokePoints(points: FreehandPoint[], epsilon: number): FreehandPoint[] {
  if (points.length <= 2) {
    return points;
  }

  let maxDistance = 0;
  let splitIndex = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = getDistanceToSegment(points[index], points[0], points[points.length - 1]);

    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }

  if (maxDistance <= epsilon) {
    return [points[0], points[points.length - 1]];
  }

  const left = simplifyStrokePoints(points.slice(0, splitIndex + 1), epsilon);
  const right = simplifyStrokePoints(points.slice(splitIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

function getPolygonArea(points: FreehandPoint[]): number {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return Math.abs(area) / 2;
}

function isNearRightAngle(previous: FreehandPoint, current: FreehandPoint, next: FreehandPoint): boolean {
  const leftVector = { x: previous.x - current.x, y: previous.y - current.y };
  const rightVector = { x: next.x - current.x, y: next.y - current.y };
  const leftLength = Math.hypot(leftVector.x, leftVector.y);
  const rightLength = Math.hypot(rightVector.x, rightVector.y);

  if (leftLength === 0 || rightLength === 0) {
    return false;
  }

  const dot = (leftVector.x * rightVector.x + leftVector.y * rightVector.y) / (leftLength * rightLength);
  return Math.abs(dot) < 0.34;
}

function createCirclePoints(centerX: number, centerY: number, radius: number, segments = 28): FreehandPoint[] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / segments;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    };
  });
}

function normalizeStrokeShape(points: FreehandPoint[]): FreehandPoint[] {
  if (points.length < 2) {
    return points;
  }

  const bounds = getStrokeBounds(points);
  const diagonal = Math.hypot(bounds.width, bounds.height);
  const totalLength = getStrokeLength(points);
  const startPoint = points[0];
  const endPoint = points[points.length - 1];
  const endDistance = getPointDistance(startPoint, endPoint);
  const isClosed = diagonal > 20 && endDistance <= Math.max(14, diagonal * 0.2);

  if (totalLength > 28 && endDistance / Math.max(totalLength, 1) > 0.9) {
    const maxDeviation = points.reduce((max, point) => Math.max(max, getDistanceToSegment(point, startPoint, endPoint)), 0);

    if (maxDeviation <= Math.max(6, diagonal * 0.08)) {
      return [startPoint, endPoint];
    }
  }

  if (!isClosed) {
    return points;
  }

  const simplified = simplifyStrokePoints(points, Math.max(10, diagonal * 0.045));
  const polygon = simplified.length > 2 ? simplified.slice(0, -1) : simplified;

  if (polygon.length === 3 && getPolygonArea(polygon) > 80) {
    return [...polygon, polygon[0]];
  }

  if (polygon.length === 4 && getPolygonArea(polygon) > 120) {
    const isRectangle = polygon.every((point, index) =>
      isNearRightAngle(polygon[(index + polygon.length - 1) % polygon.length], point, polygon[(index + 1) % polygon.length])
    );

    if (isRectangle) {
      return [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y }
      ];
    }

    return [...polygon, polygon[0]];
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const radii = points.map((point) => Math.hypot(point.x - centerX, point.y - centerY));
  const averageRadius = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  const radiusVariance = radii.reduce((sum, value) => sum + Math.abs(value - averageRadius), 0) / radii.length;
  const aspectRatio = bounds.width / Math.max(1, bounds.height);
  const looksPolygonal = polygon.length >= 3 && polygon.length <= 5;

  if (
    !looksPolygonal &&
    averageRadius > 12 &&
    aspectRatio > 0.72 &&
    aspectRatio < 1.38 &&
    radiusVariance / Math.max(averageRadius, 1) < 0.2
  ) {
    return createCirclePoints(centerX, centerY, averageRadius);
  }

  return points;
}

function cloneWriterState(value: WriterState) {
  return JSON.parse(JSON.stringify(value)) as WriterState;
}

function areWriterStatesEqual(left: WriterState, right: WriterState) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getGridDimensions(count: number, columns: number) {
  return {
    columns,
    rows: Math.ceil(count / columns)
  };
}

function getRemPixels() {
  if (typeof window === "undefined") {
    return 16;
  }

  return Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
}

function parseStoredState(raw: string): WriterState | null {
  try {
    const parsed = JSON.parse(raw) as WriterState;

    if (
      typeof parsed.title !== "string" ||
      (parsed.mode !== "college" && parsed.mode !== "lycee") ||
      typeof (parsed as { advancedMode?: unknown }).advancedMode !== "boolean" && typeof (parsed as { advancedMode?: unknown }).advancedMode !== "undefined" ||
      typeof parsed.textHtml !== "string" ||
      !Array.isArray(parsed.blocks)
    ) {
      return null;
    }

    return {
      ...parsed,
      advancedMode: typeof (parsed as { advancedMode?: unknown }).advancedMode === "boolean" ? parsed.advancedMode : false,
      symbols: Array.isArray(parsed.symbols) ? parsed.symbols : [],
      textBoxes: Array.isArray((parsed as { textBoxes?: unknown }).textBoxes) ? (parsed as { textBoxes: FloatingTextBox[] }).textBoxes : [],
      strokes: Array.isArray((parsed as { strokes?: unknown }).strokes)
        ? (parsed as { strokes: FreehandStroke[] }).strokes.filter(
            (stroke) =>
              Boolean(stroke) &&
              typeof stroke.id === "string" &&
              Array.isArray(stroke.points) &&
              stroke.points.every((point) => point && typeof point.x === "number" && typeof point.y === "number")
          )
        : []
    };
  } catch {
    return null;
  }
}

function getBlockTitle(block: MathBlock) {
  switch (block.type) {
    case "fraction":
      return "Fraction posée";
    case "division":
      return "Division posée";
    case "power":
      return "Puissance";
    case "root":
      return "Racine";
    default:
      return "Bloc";
  }
}

function getDefaultWidth(type: MathBlock["type"]) {
  switch (type) {
    case "division":
      return 320;
    case "fraction":
      return 260;
    case "power":
      return 220;
    case "root":
      return 230;
    default:
      return 260;
  }
}

function renderMathPreview(block: MathBlock) {
  if (block.type === "fraction") {
    return (
      <div className="math-layout fraction-layout">
        <div className="fraction-preview">
          <div className="fraction-line top">{block.numerator || "numérateur"}</div>
          <div className="fraction-bar" />
          <div className="fraction-line">{block.denominator || "dénominateur"}</div>
        </div>
        {block.caption ? <p className="math-caption">{block.caption}</p> : null}
      </div>
    );
  }

  if (block.type === "division") {
    return (
      <div className="math-layout division-layout">
        <div className="division-preview">
          <div className="division-quotient">{block.quotient || "quotient"}</div>
          <div className="division-divisor">{block.divisor || "diviseur"}</div>
          <div className="division-bracket">
            <div className="division-dividend">{block.dividend || "dividende"}</div>
            {block.remainder ? <div className="division-remainder">{block.remainder}</div> : null}
          </div>
        </div>
        {block.caption ? <p className="math-caption">{block.caption}</p> : null}
      </div>
    );
  }

  if (block.type === "power") {
    return (
      <div className="math-layout power-layout">
        <p className="power-preview">
          <span>{block.base || "base"}</span>
          <sup>{block.exponent || "exposant"}</sup>
        </p>
        {block.caption ? <p className="math-caption">{block.caption}</p> : null}
      </div>
    );
  }

  return (
    <div className="math-layout root-layout">
      <div className="root-preview">
        <span className="root-symbol">√</span>
        <span className="root-radicand">{block.radicand || "radicande"}</span>
      </div>
      {block.caption ? <p className="math-caption">{block.caption}</p> : null}
    </div>
  );
}

function getInlineStartField(type: StructuredTool) {
  switch (type) {
    case "fraction":
      return "numerator";
    case "division":
      return "dividend";
    case "power":
      return "base";
    case "root":
      return "radicand";
    default:
      return "";
  }
}

function getInlineFieldSequence(type: StructuredTool) {
  switch (type) {
    case "fraction":
      return ["numerator", "denominator"];
    case "division":
      return ["dividend", "divisor", "quotient", "remainder"];
    case "power":
      return ["base", "exponent"];
    case "root":
      return ["radicand"];
    default:
      return [];
  }
}

function getNextInlineField(block: MathBlock, field: string) {
  const sequence = getInlineFieldSequence(block.type);
  const index = sequence.indexOf(field);
  return index >= 0 && index < sequence.length - 1 ? sequence[index + 1] : null;
}

function getPreviousInlineField(block: MathBlock, field: string) {
  const sequence = getInlineFieldSequence(block.type);
  const index = sequence.indexOf(field);
  return index > 0 ? sequence[index - 1] : null;
}

function isBlockEmpty(block: MathBlock) {
  if (block.type === "fraction") {
    return !block.numerator.trim() && !block.denominator.trim();
  }

  if (block.type === "division") {
    return !block.dividend.trim() && !block.divisor.trim() && !block.quotient.trim() && !block.remainder.trim();
  }

  if (block.type === "power") {
    return !block.base.trim() && !block.exponent.trim();
  }

  return !block.radicand.trim();
}

export function MathWorkbook() {
  const [state, setState] = useState<WriterState>(DEFAULT_STATE);
  const [historyPast, setHistoryPast] = useState<WriterState[]>([]);
  const [historyFuture, setHistoryFuture] = useState<WriterState[]>([]);
  const [openMenu, setOpenMenu] = useState<UtilityMenu>(null);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [selectedSymbolIds, setSelectedSymbolIds] = useState<string[]>([]);
  const [selectedTextBoxIds, setSelectedTextBoxIds] = useState<string[]>([]);
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const [editingBlock, setEditingBlock] = useState<EditingBlockState>(null);
  const [advancedTool, setAdvancedTool] = useState<AdvancedTool>(null);
  const [draftStroke, setDraftStroke] = useState<FreehandPoint[] | null>(null);
  const [canvasQuickMenu, setCanvasQuickMenu] = useState<CanvasQuickMenu>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuides>({ x: null, y: null });
  const [isHydrated, setIsHydrated] = useState(false);
  const [isExporting, setIsExporting] = useState<"pdf" | "word" | null>(null);
  const [isCanvasDropActive, setIsCanvasDropActive] = useState(false);
  const [selectionRect, setSelectionRect] = useState<SelectionRect>(null);
  const [isCanvasInteracting, setIsCanvasInteracting] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<Range | null>(null);
  const dragRef = useRef<DragState>(null);
  const pendingSelectionRef = useRef<PendingSelection>(null);
  const blocksRef = useRef<MathBlock[]>([]);
  const symbolsRef = useRef<FloatingSymbol[]>([]);
  const textBoxesRef = useRef<FloatingTextBox[]>([]);
  const strokesRef = useRef<FreehandStroke[]>([]);
  const selectedBlockIdsRef = useRef<string[]>([]);
  const selectedSymbolIdsRef = useRef<string[]>([]);
  const selectedTextBoxIdsRef = useRef<string[]>([]);
  const selectedStrokeIdsRef = useRef<string[]>([]);
  const isDrawingStrokeRef = useRef(false);
  const draftStrokeRef = useRef<FreehandPoint[]>([]);
  const toolbarDragUntilRef = useRef(0);
  const toolbarDragMetaRef = useRef<ToolbarDragMeta | null>(null);
  const advancedToolRef = useRef<AdvancedTool>(null);
  const blockNodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const symbolNodeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const textBoxNodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const strokeNodeRefs = useRef<Record<string, SVGGElement | null>>({});
  const pendingFocusTextBoxIdRef = useRef<string | null>(null);
  const blockInputRefs = useRef<Record<string, Record<string, HTMLInputElement | null>>>({});
  const historyInitializedRef = useRef(false);
  const skipHistoryRef = useRef(false);
  const previousStateRef = useRef<WriterState>(cloneWriterState(DEFAULT_STATE));
  const stateRef = useRef<WriterState>(cloneWriterState(DEFAULT_STATE));
  const transientHistorySnapshotRef = useRef<WriterState | null>(null);
  const transientHistoryKindRef = useRef<"drag" | "edit" | null>(null);
  const suspendHistoryRef = useRef(false);

  const activeInlineShortcuts = useMemo(
    () =>
      INLINE_SHORTCUT_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.modes.includes(state.mode))
      })).filter((group) => group.items.length > 0),
    [state.mode]
  );

  const activeStructuredTools = useMemo(
    () => STRUCTURED_TOOLS.filter((tool) => tool.modes.includes(state.mode)),
    [state.mode]
  );
  const selectedBlockId = selectedBlockIds.length === 1 && selectedSymbolIds.length === 0 && selectedTextBoxIds.length === 0 && selectedStrokeIds.length === 0 ? selectedBlockIds[0] : null;
  const selectedSymbolId = selectedSymbolIds.length === 1 && selectedBlockIds.length === 0 && selectedTextBoxIds.length === 0 && selectedStrokeIds.length === 0 ? selectedSymbolIds[0] : null;
  const selectedTextBoxId = selectedTextBoxIds.length === 1 && selectedBlockIds.length === 0 && selectedSymbolIds.length === 0 && selectedStrokeIds.length === 0 ? selectedTextBoxIds[0] : null;
  const selectedStrokeId = selectedStrokeIds.length === 1 && selectedBlockIds.length === 0 && selectedSymbolIds.length === 0 && selectedTextBoxIds.length === 0 ? selectedStrokeIds[0] : null;
  const selectedCount = selectedBlockIds.length + selectedSymbolIds.length + selectedTextBoxIds.length + selectedStrokeIds.length;
  const selectedBlock = useMemo(
    () => state.blocks.find((block) => block.id === selectedBlockId) ?? null,
    [selectedBlockId, state.blocks]
  );
  const selectedSymbol = useMemo(
    () => state.symbols.find((symbol) => symbol.id === selectedSymbolId) ?? null,
    [selectedSymbolId, state.symbols]
  );
  const selectedTextBox = useMemo(
    () => state.textBoxes.find((textBox) => textBox.id === selectedTextBoxId) ?? null,
    [selectedTextBoxId, state.textBoxes]
  );
  const selectedStroke = useMemo(
    () => state.strokes.find((stroke) => stroke.id === selectedStrokeId) ?? null,
    [selectedStrokeId, state.strokes]
  );
  const multiSelectionMenuPosition = useMemo(() => {
    if (selectedCount <= 1 || isCanvasInteracting || selectionRect || !canvasRef.current) {
      return null;
    }

    const canvasBounds = canvasRef.current.getBoundingClientRect();
    const selectedNodes = [
      ...selectedBlockIds.map((id) => blockNodeRefs.current[id]),
      ...selectedSymbolIds.map((id) => symbolNodeRefs.current[id]),
      ...selectedTextBoxIds.map((id) => textBoxNodeRefs.current[id]),
      ...selectedStrokeIds.map((id) => strokeNodeRefs.current[id])
    ].filter((node): node is HTMLElement | SVGGElement => Boolean(node));

    if (selectedNodes.length === 0) {
      return null;
    }

    const bounds = selectedNodes.map((node) => node.getBoundingClientRect());
    const minLeft = Math.min(...bounds.map((rect) => rect.left - canvasBounds.left));
    const maxRight = Math.max(...bounds.map((rect) => rect.right - canvasBounds.left));
    const minTop = Math.min(...bounds.map((rect) => rect.top - canvasBounds.top));
    const centerX = (minLeft + maxRight) / 2;

    return {
      x: centerX,
      y: Math.max(18, minTop - 52)
    };
  }, [isCanvasInteracting, selectedBlockIds, selectedCount, selectedStrokeIds, selectedSymbolIds, selectedTextBoxIds, selectionRect, state.blocks, state.strokes, state.symbols, state.textBoxes]);

  useEffect(() => {
    setIsHydrated(true);
    const saved = window.localStorage.getItem(STORAGE_KEY);

    if (!saved) {
      return;
    }

    const parsed = parseStoredState(saved);

    if (!parsed) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    setState(parsed);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [isHydrated, state]);

  useEffect(() => {
    blocksRef.current = state.blocks;
    symbolsRef.current = state.symbols;
    textBoxesRef.current = state.textBoxes;
    strokesRef.current = state.strokes;
  }, [state.blocks, state.strokes, state.symbols, state.textBoxes]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    advancedToolRef.current = advancedTool;
  }, [advancedTool]);

  useEffect(() => {
    if (!state.advancedMode) {
      setAdvancedTool(null);
    }
  }, [state.advancedMode]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (!historyInitializedRef.current) {
      previousStateRef.current = cloneWriterState(state);
      historyInitializedRef.current = true;
      return;
    }

    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      previousStateRef.current = cloneWriterState(state);
      return;
    }

    if (suspendHistoryRef.current) {
      return;
    }

    if (areWriterStatesEqual(previousStateRef.current, state)) {
      return;
    }

    const previousSnapshot = cloneWriterState(previousStateRef.current);
    previousStateRef.current = cloneWriterState(state);

    setHistoryPast((current) => [...current.slice(-(MAX_HISTORY_STEPS - 1)), previousSnapshot]);
    setHistoryFuture([]);
  }, [isHydrated, state]);

  useEffect(() => {
    selectedBlockIdsRef.current = selectedBlockIds;
    selectedSymbolIdsRef.current = selectedSymbolIds;
    selectedTextBoxIdsRef.current = selectedTextBoxIds;
    selectedStrokeIdsRef.current = selectedStrokeIds;
  }, [selectedBlockIds, selectedStrokeIds, selectedSymbolIds, selectedTextBoxIds]);

  useEffect(() => {
    if (!pendingFocusTextBoxIdRef.current) {
      return;
    }

    const node = textBoxNodeRefs.current[pendingFocusTextBoxIdRef.current]?.querySelector("input");

    if (!node) {
      return;
    }

    node.focus();
    pendingFocusTextBoxIdRef.current = null;
  }, [state.textBoxes]);

  useEffect(() => {
    if (!editingBlock) {
      return;
    }

    const input = blockInputRefs.current[editingBlock.blockId]?.[editingBlock.field];

    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, [editingBlock]);

  useEffect(() => {
    const element = editorRef.current;

    if (element && document.activeElement !== element && element.innerHTML !== state.textHtml) {
      element.innerHTML = state.textHtml;
    }
  }, [state.textHtml]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (isDrawingStrokeRef.current) {
        const point = getCanvasPoint(event.clientX, event.clientY);
        const currentPoints = draftStrokeRef.current;
        const lastPoint = currentPoints[currentPoints.length - 1];

        if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= 1.5) {
          const nextPoints = [...currentPoints, point];
          draftStrokeRef.current = nextPoints;
          setDraftStroke(nextPoints);
        }
        return;
      }

      if (!dragRef.current) {
        if (!pendingSelectionRef.current) {
          return;
        }

        const point = getCanvasPoint(event.clientX, event.clientY);
        const current = pendingSelectionRef.current;
        const distance = Math.hypot(point.x - current.originX, point.y - current.originY);

        if (!current.started && distance < 6) {
          return;
        }

        const nextRect = {
          originX: current.originX,
          originY: current.originY,
          currentX: point.x,
          currentY: point.y
        };

        if (!current.started) {
          pendingSelectionRef.current = { ...current, started: true };
        }

        setSelectionRect(nextRect);
        updateSelectionFromRect(nextRect);
        return;
      }

      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      const bounds = canvas.getBoundingClientRect();
      const nextAnchorX = event.clientX - bounds.left - dragRef.current.pointerOffsetX;
      const nextAnchorY = event.clientY - bounds.top - dragRef.current.pointerOffsetY;
      const draggedNode =
        dragRef.current.itemType === "block"
          ? blockNodeRefs.current[dragRef.current.itemId]
          : dragRef.current.itemType === "symbol"
            ? symbolNodeRefs.current[dragRef.current.itemId]
            : dragRef.current.itemType === "textBox"
              ? textBoxNodeRefs.current[dragRef.current.itemId]
              : strokeNodeRefs.current[dragRef.current.itemId];
      const snappedAnchor = getCanvasPlacementPosition(nextAnchorX, nextAnchorY, bounds.width - 24, bounds.height - 24, "soft", {
        height: draggedNode?.getBoundingClientRect().height ?? 0
      });
      setSnapGuides(snappedAnchor.guides);
      const deltaX = Math.round(snappedAnchor.x - dragRef.current.anchorX);
      const deltaY = Math.round(snappedAnchor.y - dragRef.current.anchorY);

      setState((current) => ({
        ...current,
        blocks: current.blocks.map((block) => {
          const dragged = dragRef.current?.groupBlockPositions.find((item) => item.id === block.id);

          if (!dragged) {
            return block;
          }

          return {
            ...block,
            x: Math.max(18, Math.min(bounds.width - 24, dragged.x + deltaX)),
            y: Math.max(18, Math.min(bounds.height - 24, dragged.y + deltaY))
          };
        }),
        symbols: current.symbols.map((symbol) => {
          const dragged = dragRef.current?.groupSymbolPositions.find((item) => item.id === symbol.id);

          if (!dragged) {
            return symbol;
          }

          return {
            ...symbol,
            x: Math.max(18, Math.min(bounds.width - 24, dragged.x + deltaX)),
            y: Math.max(18, Math.min(bounds.height - 24, dragged.y + deltaY))
          };
        }),
        textBoxes: current.textBoxes.map((textBox) => {
          const dragged = dragRef.current?.groupTextBoxPositions.find((item) => item.id === textBox.id);

          if (!dragged) {
            return textBox;
          }

          return {
            ...textBox,
            x: Math.max(18, Math.min(bounds.width - 24, dragged.x + deltaX)),
            y: Math.max(18, Math.min(bounds.height - 24, dragged.y + deltaY))
          };
        }),
        strokes: current.strokes.map((stroke) => {
          const dragged = dragRef.current?.groupStrokePositions.find((item) => item.id === stroke.id);

          if (!dragged) {
            return stroke;
          }

          return {
            ...stroke,
            points: dragged.points.map((point) => ({
              x: Math.max(18, Math.min(bounds.width - 24, point.x + deltaX)),
              y: Math.max(18, Math.min(bounds.height - 24, point.y + deltaY))
            }))
          };
        })
      }));
    }

    function handleMouseUp() {
      if (isDrawingStrokeRef.current) {
        const points = draftStrokeRef.current;

        isDrawingStrokeRef.current = false;
        draftStrokeRef.current = [];
        setDraftStroke(null);
        setIsCanvasInteracting(false);

        if (points.length >= 2) {
          const normalizedPoints = normalizeStrokeShape(points);

          setState((current) => ({
            ...current,
            strokes: [...current.strokes, { id: createId("stroke"), points: normalizedPoints }]
          }));
          scheduleTransientHistoryCommit("edit");
        } else {
          commitTransientHistorySession("edit");
        }

        return;
      }

      const draggedSession = dragRef.current;

      if (pendingSelectionRef.current && !pendingSelectionRef.current.started) {
        if (stateRef.current.advancedMode && advancedToolRef.current === "note") {
          createAnnotationTextBoxAt(pendingSelectionRef.current.originX, pendingSelectionRef.current.originY);
        } else {
          openCanvasQuickMenuAtPoint(pendingSelectionRef.current.originX, pendingSelectionRef.current.originY);
        }
      }

      if (draggedSession) {
        commitTransientHistorySession("drag");
      }

      dragRef.current = null;
      pendingSelectionRef.current = null;
      setSelectionRect(null);
      setSnapGuides({ x: null, y: null });
      setIsCanvasInteracting(false);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent) {
      if (!canvasQuickMenu) {
        return;
      }

      const target = event.target as Node | null;
      const canvas = canvasRef.current;

      if (!canvas) {
        setCanvasQuickMenu(null);
        return;
      }

      const quickMenu = canvas.querySelector(".canvas-quick-menu");

      if (quickMenu?.contains(target)) {
        return;
      }

      setCanvasQuickMenu(null);
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [canvasQuickMenu]);

  function createBlock(type: StructuredTool) {
    const count = state.blocks.length;
    const position = {
      x: 80 + (count % 3) * 48,
      y: 140 + count * 34,
      width: getDefaultWidth(type)
    };

    if (type === "fraction") {
      return { id: createId("fraction"), type, numerator: "", denominator: "", simplified: "", caption: "", numeratorStrike: false, denominatorStrike: false, ...position } satisfies MathBlock;
    }

    if (type === "division") {
      return {
        id: createId("division"),
        type,
        dividend: "",
        divisor: "",
        quotient: "",
        remainder: "",
        caption: "",
        ...position
      } satisfies MathBlock;
    }

    if (type === "power") {
      return { id: createId("power"), type, base: "", exponent: "", result: "", caption: "", ...position } satisfies MathBlock;
    }

    return { id: createId("root"), type, radicand: "", result: "", caption: "", ...position } satisfies MathBlock;
  }

function createFloatingSymbol(shortcut: InlineShortcutItem, x: number, y: number) {
  return {
      id: createId("symbol"),
      type: "symbol",
      label: shortcut.label,
      content: shortcut.content.trim() || shortcut.label,
      x,
      y,
      color: COLOR_OPTIONS[0].value,
      fontSize: DEFAULT_CANVAS_FONT_SIZE_REM
  } satisfies FloatingSymbol;
}

  function createFloatingTextBox(x: number, y: number, variant: "default" | "note" = "default") {
    return {
      id: createId("text"),
      type: "textBox",
      variant,
      text: "",
      x,
      y: Math.max(18, y - FLOATING_TEXTBOX_Y_OFFSET),
      width: variant === "note" ? 72 : 100
    } satisfies FloatingTextBox;
  }

  function getCanvasDropPosition(clientX: number, clientY: number, offsetX = 0, offsetY = 0) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return { x: 24, y: 24, guides: { x: null, y: null } };
    }

    const bounds = canvas.getBoundingClientRect();

    return getCanvasPlacementPosition(clientX - bounds.left - offsetX, clientY - bounds.top - offsetY, bounds.width - 24, bounds.height - 24, "soft");
  }

  function getCanvasPlacementPosition(
    x: number,
    y: number,
    maxX: number,
    maxY: number,
    mode: "soft" | "strict" = "soft",
    visualSize?: { height?: number }
  ) {
    const rem = getRemPixels();
    const horizontalStep = (PAPER_LINE_STEP_REM * rem) / 2;
    const verticalStep = PAPER_LINE_STEP_REM * rem;
    const originX = CANVAS_GRID_LEFT_REM * rem;
    const originY = CANVAS_GRID_TOP_REM * rem;
    const visualHeight = Math.max(0, visualSize?.height ?? 0);
    const clampedX = Math.max(18, Math.min(maxX, Math.round(x)));
    const clampedY = Math.max(18, Math.min(maxY, Math.round(y)));
    const snappedX = originX + Math.round((clampedX - originX) / horizontalStep) * horizontalStep;
    const centerY = clampedY + visualHeight / 2;
    const snappedY = originY + Math.round(((visualHeight > 0 ? centerY : clampedY) - originY) / verticalStep) * verticalStep;
    const horizontalThreshold = Math.min(MAX_SNAP_THRESHOLD_PX, horizontalStep * 0.26);
    const verticalThreshold = Math.min(MAX_SNAP_THRESHOLD_PX, verticalStep * 0.22);
    const useSnapX = mode === "strict" || Math.abs(clampedX - snappedX) <= horizontalThreshold;
    const useSnapY = mode === "strict" || Math.abs((visualHeight > 0 ? centerY : clampedY) - snappedY) <= verticalThreshold;
    const nextX = useSnapX ? snappedX : clampedX;
    const nextY = useSnapY
      ? Math.max(18, Math.min(maxY, Math.round((visualHeight > 0 ? snappedY - visualHeight / 2 : snappedY))))
      : clampedY;

    return {
      x: Math.max(18, Math.min(maxX, Math.round(nextX))),
      y: Math.max(18, Math.min(maxY, Math.round(nextY))),
      guides: {
        x: useSnapX ? Math.max(18, Math.min(maxX, Math.round(snappedX))) : null,
        y: useSnapY ? Math.round(nextY + (visualHeight > 0 ? visualHeight / 2 : 0)) : null
      }
    };
  }

  function findShortcutById(shortcutId: string) {
    for (const group of activeInlineShortcuts) {
      const match = group.items.find((item) => item.id === shortcutId);

      if (match) {
        return match;
      }
    }

    return null;
  }

  function clearFloatingSelection() {
    setSelectedBlockIds([]);
    setSelectedSymbolIds([]);
    setSelectedTextBoxIds([]);
    setSelectedStrokeIds([]);
  }

  function selectSingleBlock(blockId: string) {
    setSelectedBlockIds([blockId]);
    setSelectedSymbolIds([]);
    setSelectedTextBoxIds([]);
    setSelectedStrokeIds([]);
  }

  function selectSingleSymbol(symbolId: string) {
    setSelectedSymbolIds([symbolId]);
    setSelectedBlockIds([]);
    setSelectedTextBoxIds([]);
    setSelectedStrokeIds([]);
  }

  function selectSingleTextBox(textBoxId: string) {
    setSelectedTextBoxIds([textBoxId]);
    setSelectedBlockIds([]);
    setSelectedSymbolIds([]);
    setSelectedStrokeIds([]);
  }

  function selectSingleStroke(strokeId: string) {
    setSelectedStrokeIds([strokeId]);
    setSelectedBlockIds([]);
    setSelectedSymbolIds([]);
    setSelectedTextBoxIds([]);
  }

  function getCanvasPoint(clientX: number, clientY: number) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const bounds = canvas.getBoundingClientRect();

    return {
      x: Math.max(0, Math.min(bounds.width, clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, clientY - bounds.top))
    };
  }

  function normalizeSelectionRect(rect: Exclude<SelectionRect, null>) {
    return {
      left: Math.min(rect.originX, rect.currentX),
      top: Math.min(rect.originY, rect.currentY),
      right: Math.max(rect.originX, rect.currentX),
      bottom: Math.max(rect.originY, rect.currentY)
    };
  }

  function updateSelectionFromRect(rect: Exclude<SelectionRect, null>) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const canvasBounds = canvas.getBoundingClientRect();
    const normalized = normalizeSelectionRect(rect);
    const nextBlockIds = blocksRef.current
      .filter((block) => {
        const node = blockNodeRefs.current[block.id];

        if (!node) {
          return false;
        }

        const bounds = node.getBoundingClientRect();
        const left = bounds.left - canvasBounds.left;
        const top = bounds.top - canvasBounds.top;
        const right = left + bounds.width;
        const bottom = top + bounds.height;

        return right >= normalized.left && left <= normalized.right && bottom >= normalized.top && top <= normalized.bottom;
      })
      .map((block) => block.id);
    const nextSymbolIds = symbolsRef.current
      .filter((symbol) => {
        const node = symbolNodeRefs.current[symbol.id];

        if (!node) {
          return false;
        }

        const bounds = node.getBoundingClientRect();
        const left = bounds.left - canvasBounds.left;
        const top = bounds.top - canvasBounds.top;
        const right = left + bounds.width;
        const bottom = top + bounds.height;

        return right >= normalized.left && left <= normalized.right && bottom >= normalized.top && top <= normalized.bottom;
      })
      .map((symbol) => symbol.id);
    const nextTextBoxIds = textBoxesRef.current
      .filter((textBox) => {
        const node = textBoxNodeRefs.current[textBox.id];

        if (!node) {
          return false;
        }

        const bounds = node.getBoundingClientRect();
        const left = bounds.left - canvasBounds.left;
        const top = bounds.top - canvasBounds.top;
        const right = left + bounds.width;
        const bottom = top + bounds.height;

        return right >= normalized.left && left <= normalized.right && bottom >= normalized.top && top <= normalized.bottom;
      })
      .map((textBox) => textBox.id);
    const nextStrokeIds = strokesRef.current
      .filter((stroke) => {
        const node = strokeNodeRefs.current[stroke.id];

        if (!node) {
          return false;
        }

        const bounds = node.getBoundingClientRect();
        const left = bounds.left - canvasBounds.left;
        const top = bounds.top - canvasBounds.top;
        const right = left + bounds.width;
        const bottom = top + bounds.height;

        return right >= normalized.left && left <= normalized.right && bottom >= normalized.top && top <= normalized.bottom;
      })
      .map((stroke) => stroke.id);

    setSelectedBlockIds(nextBlockIds);
    setSelectedSymbolIds(nextSymbolIds);
    setSelectedTextBoxIds(nextTextBoxIds);
    setSelectedStrokeIds(nextStrokeIds);
  }

  function beginAreaSelection(clientX: number, clientY: number) {
    const point = getCanvasPoint(clientX, clientY);
    pendingSelectionRef.current = { originX: point.x, originY: point.y, started: false };
    setSelectionRect(null);
    setIsCanvasInteracting(true);
    setCanvasQuickMenu(null);
    clearFloatingSelection();
    setOpenMenu(null);
  }

  function beginTextBoxEditing(textBoxId: string) {
    beginTransientHistorySession("edit");
    setEditingTextBoxId(textBoxId);
    selectSingleTextBox(textBoxId);
    pendingFocusTextBoxIdRef.current = textBoxId;
  }

  function beginBlockEditing(blockId: string, field?: string) {
    const block = blocksRef.current.find((item) => item.id === blockId);

    if (!block) {
      return;
    }

    beginTransientHistorySession("edit");
    selectSingleBlock(blockId);
    setOpenMenu(null);
    setCanvasQuickMenu(null);
    setEditingBlock({ blockId, field: field ?? getInlineStartField(block.type) });
  }

  function closeFloatingTextEditing() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    setEditingTextBoxId(null);
    clearFloatingSelection();
    setOpenMenu(null);
    setCanvasQuickMenu(null);
  }

  function openCanvasQuickMenu(clientX: number, clientY: number) {
    const point = getCanvasPoint(clientX, clientY);
    setCanvasQuickMenu({ x: point.x + CANVAS_QUICK_MENU_OFFSET_X, y: point.y, clickX: point.x, clickY: point.y });
    clearFloatingSelection();
    setOpenMenu(null);
  }

  function openCanvasQuickMenuAtPoint(x: number, y: number) {
    setCanvasQuickMenu({ x: x + CANVAS_QUICK_MENU_OFFSET_X, y, clickX: x, clickY: y });
    clearFloatingSelection();
    setOpenMenu(null);
  }

  function createTextBoxAt(x: number, y: number) {
    const canvas = canvasRef.current;
    const bounds = canvas?.getBoundingClientRect();
    const snappedPoint = getCanvasPlacementPosition(x, y, (bounds?.width ?? 320) - 24, (bounds?.height ?? 320) - 24, "soft");
    const textBox = createFloatingTextBox(snappedPoint.x, snappedPoint.y);
    beginTransientHistorySession("edit");

    setState((current) => ({
      ...current,
      textBoxes: [...current.textBoxes, textBox]
    }));
    beginTextBoxEditing(textBox.id);
    setCanvasQuickMenu(null);
  }

  function createAnnotationTextBoxAt(x: number, y: number) {
    const canvas = canvasRef.current;
    const bounds = canvas?.getBoundingClientRect();
    const snappedPoint = getCanvasPlacementPosition(x, y, (bounds?.width ?? 320) - 24, (bounds?.height ?? 320) - 24, "soft");
    const textBox = createFloatingTextBox(snappedPoint.x, snappedPoint.y, "note");
    beginTransientHistorySession("edit");

    setState((current) => ({
      ...current,
      textBoxes: [...current.textBoxes, textBox]
    }));
    beginTextBoxEditing(textBox.id);
  }

  function beginFreehandDrawing(clientX: number, clientY: number) {
    const point = getCanvasPoint(clientX, clientY);
    beginTransientHistorySession("edit");
    isDrawingStrokeRef.current = true;
    draftStrokeRef.current = [point];
    setDraftStroke([point]);
    setCanvasQuickMenu(null);
    setOpenMenu(null);
    setIsCanvasInteracting(true);
    clearFloatingSelection();
  }

  function createStructuredToolAt(type: StructuredTool, x: number, y: number) {
    const canvas = canvasRef.current;
    const bounds = canvas?.getBoundingClientRect();
    const snappedPoint = getCanvasPlacementPosition(x, y, (bounds?.width ?? 320) - 24, (bounds?.height ?? 320) - 24, "soft");
    const block = { ...createBlock(type), x: snappedPoint.x, y: snappedPoint.y };
    beginTransientHistorySession("edit");

    setState((current) => ({
      ...current,
      blocks: [...current.blocks, block]
    }));
    beginBlockEditing(block.id, getInlineStartField(type));
    setCanvasQuickMenu(null);
  }

  function createShortcutSymbolAt(shortcutId: string, x: number, y: number) {
    const shortcut = findShortcutById(shortcutId);

    if (!shortcut) {
      return;
    }

    const canvas = canvasRef.current;
    const bounds = canvas?.getBoundingClientRect();
    const snappedPoint = getCanvasPlacementPosition(x, y, (bounds?.width ?? 320) - 24, (bounds?.height ?? 320) - 24, "soft");
    const symbol = createFloatingSymbol(shortcut, snappedPoint.x, snappedPoint.y);

    setState((current) => ({
      ...current,
      symbols: [...current.symbols, symbol]
    }));
    selectSingleSymbol(symbol.id);
    setCanvasQuickMenu(null);
  }

  function syncText() {
    const element = editorRef.current;

    if (!element) {
      return;
    }

    const html = element.innerHTML;

    setState((current) => (current.textHtml === html ? current : { ...current, textHtml: html }));
  }

  function saveSelection() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || !editorRef.current) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (!editorRef.current.contains(range.commonAncestorContainer)) {
      return;
    }

    selectionRef.current = range.cloneRange();
  }

  function restoreSelection() {
    if (!selectionRef.current || !editorRef.current) {
      return false;
    }

    const selection = window.getSelection();

    if (!selection) {
      return false;
    }

    editorRef.current.focus();
    selection.removeAllRanges();
    selection.addRange(selectionRef.current);
    return true;
  }

  function focusEditorToEnd() {
    const element = editorRef.current;

    if (!element) {
      return;
    }

    element.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
      selectionRef.current = range.cloneRange();
    }
  }

  function runCommand(command: string, value?: string) {
    if (!restoreSelection()) {
      focusEditorToEnd();
    }

    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
    syncText();
    saveSelection();
  }

  function insertTextAtCursor(content: string) {
    if (!restoreSelection()) {
      focusEditorToEnd();
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(content);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    selectionRef.current = range.cloneRange();
    syncText();
  }

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    insertTextAtCursor(event.clipboardData.getData("text/plain"));
  }

  function openInsertModal(type: StructuredTool) {
    const block = createBlock(type);
    beginTransientHistorySession("edit");

    setState((current) => ({
      ...current,
      blocks: [...current.blocks, block]
    }));
    beginBlockEditing(block.id, getInlineStartField(type));
    setOpenMenu(null);
    setCanvasQuickMenu(null);
  }

  function openEditModal(blockId: string) {
    const block = state.blocks.find((item) => item.id === blockId);

    if (!block) {
      return;
    }

    beginBlockEditing(blockId, getInlineStartField(block.type));
  }

  function updateModalField(key: string, value: string) {
    setModalState((current) =>
      current
        ? {
            ...current,
            block: { ...current.block, [key]: value } as MathBlock
          }
        : current
    );
  }

  function applyModalBlock() {
    if (!modalState) {
      return;
    }

    if (modalState.mode === "edit") {
      setState((current) => ({
        ...current,
        blocks: current.blocks.map((block) =>
          block.id === modalState.block.id ? modalState.block : block
        )
      }));
      selectSingleBlock(modalState.block.id);
      setModalState(null);
      return;
    }

    setState((current) => ({
      ...current,
      blocks: [...current.blocks, modalState.block]
    }));
    selectSingleBlock(modalState.block.id);
    setModalState(null);
  }

  function removeBlock(blockId: string) {
    setState((current) => ({
      ...current,
      blocks: current.blocks.filter((block) => block.id !== blockId)
    }));
    setSelectedBlockIds((current) => current.filter((id) => id !== blockId));
  }

  function removeSymbol(symbolId: string) {
    setState((current) => ({
      ...current,
      symbols: current.symbols.filter((symbol) => symbol.id !== symbolId)
    }));
    setSelectedSymbolIds((current) => current.filter((id) => id !== symbolId));
  }

  function updateSymbolStyle(symbolId: string, updates: Partial<Pick<FloatingSymbol, "fontSize" | "color">>) {
    setState((current) => ({
      ...current,
      symbols: current.symbols.map((symbol) =>
        symbol.id === symbolId ? { ...symbol, ...updates } : symbol
      )
    }));
  }

  function updateTextBox(textBoxId: string, updates: Partial<Pick<FloatingTextBox, "text" | "width">>) {
    setState((current) => ({
      ...current,
      textBoxes: current.textBoxes.map((textBox) =>
        textBox.id === textBoxId ? { ...textBox, ...updates } : textBox
      )
    }));
  }

  function updateInlineBlockField(blockId: string, key: string, value: string) {
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId ? ({ ...block, [key]: value } as MathBlock) : block
      )
    }));
  }

  function finishBlockEditing(blockId: string) {
    const block = blocksRef.current.find((item) => item.id === blockId);

    if (!block) {
      setEditingBlock(null);
      scheduleTransientHistoryCommit("edit");
      return;
    }

    if (isBlockEmpty(block)) {
      removeBlock(blockId);
      setEditingBlock(null);
      scheduleTransientHistoryCommit("edit");
      return;
    }

    setEditingBlock(null);
    scheduleTransientHistoryCommit("edit");
  }

  function shouldCloseEditingBlock(target: EventTarget | null) {
    if (!editingBlock?.blockId) {
      return false;
    }

    const blockNode = blockNodeRefs.current[editingBlock.blockId];

    if (!blockNode) {
      return true;
    }

    return !blockNode.contains(target as Node | null);
  }

  function handleInlineBlockKeyDown(blockId: string, field: string, event: ReactKeyboardEvent<HTMLInputElement>) {
    const block = blocksRef.current.find((item) => item.id === blockId);

    if (!block) {
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
      }
      finishBlockEditing(blockId);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const targetField = event.shiftKey ? getPreviousInlineField(block, field) : getNextInlineField(block, field);

      if (targetField) {
        setEditingBlock({ blockId, field: targetField });
        return;
      }

      finishBlockEditing(blockId);
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    const nextField = getNextInlineField(block, field);

    if (nextField) {
      setEditingBlock({ blockId, field: nextField });
      return;
    }

    finishBlockEditing(blockId);
  }

  function removeTextBox(textBoxId: string) {
    setState((current) => ({
      ...current,
      textBoxes: current.textBoxes.filter((textBox) => textBox.id !== textBoxId)
    }));
    setSelectedTextBoxIds((current) => current.filter((id) => id !== textBoxId));
  }

  function removeStroke(strokeId: string) {
    setState((current) => ({
      ...current,
      strokes: current.strokes.filter((stroke) => stroke.id !== strokeId)
    }));
    setSelectedStrokeIds((current) => current.filter((id) => id !== strokeId));
  }

  function removeSelectedItems() {
    if (selectedCount === 0) {
      return;
    }

    setState((current) => ({
      ...current,
      blocks: current.blocks.filter((block) => !selectedBlockIds.includes(block.id)),
      symbols: current.symbols.filter((symbol) => !selectedSymbolIds.includes(symbol.id)),
      textBoxes: current.textBoxes.filter((textBox) => !selectedTextBoxIds.includes(textBox.id)),
      strokes: current.strokes.filter((stroke) => !selectedStrokeIds.includes(stroke.id))
    }));
    clearFloatingSelection();
  }

  function resetTransientUi() {
    setOpenMenu(null);
    setModalState(null);
    setCanvasQuickMenu(null);
    setEditingBlock(null);
    setEditingTextBoxId(null);
    setDraftStroke(null);
    isDrawingStrokeRef.current = false;
    draftStrokeRef.current = [];
    clearFloatingSelection();
  }

  function beginTransientHistorySession(kind: "drag" | "edit") {
    if (transientHistorySnapshotRef.current) {
      return;
    }

    transientHistorySnapshotRef.current = cloneWriterState(stateRef.current);
    transientHistoryKindRef.current = kind;
    suspendHistoryRef.current = true;
  }

  function commitTransientHistorySession(kind: "drag" | "edit") {
    if (!transientHistorySnapshotRef.current || transientHistoryKindRef.current !== kind) {
      return;
    }

    const startSnapshot = transientHistorySnapshotRef.current;
    const currentSnapshot = cloneWriterState(stateRef.current);

    suspendHistoryRef.current = false;
    transientHistorySnapshotRef.current = null;
    transientHistoryKindRef.current = null;

    if (!areWriterStatesEqual(startSnapshot, currentSnapshot)) {
      setHistoryPast((current) => [...current.slice(-(MAX_HISTORY_STEPS - 1)), startSnapshot]);
      setHistoryFuture([]);
    }

    previousStateRef.current = currentSnapshot;
  }

  function scheduleTransientHistoryCommit(kind: "drag" | "edit") {
    window.setTimeout(() => {
      commitTransientHistorySession(kind);
    }, 0);
  }

  function undoHistory() {
    if (historyPast.length === 0) {
      return;
    }

    const previous = historyPast[historyPast.length - 1];
    skipHistoryRef.current = true;
    setHistoryPast((current) => current.slice(0, -1));
    setHistoryFuture((current) => [cloneWriterState(state), ...current].slice(0, MAX_HISTORY_STEPS));
    resetTransientUi();
    setState(cloneWriterState(previous));
  }

  function redoHistory() {
    if (historyFuture.length === 0) {
      return;
    }

    const next = historyFuture[0];
    skipHistoryRef.current = true;
    setHistoryFuture((current) => current.slice(1));
    setHistoryPast((current) => [...current.slice(-(MAX_HISTORY_STEPS - 1)), cloneWriterState(state)]);
    resetTransientUi();
    setState(cloneWriterState(next));
  }

  function alignSelectedItems() {
    if (selectedCount < 2) {
      return;
    }

    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const spacing = 12;
    const measuredItems = [
      ...state.blocks
        .filter((block) => selectedBlockIds.includes(block.id))
        .map((block) => {
          const node = blockNodeRefs.current[block.id];
          const rect = node?.getBoundingClientRect();

          return {
            id: block.id,
            type: "block" as const,
            x: block.x,
            y: block.y,
            width: Math.max(24, rect?.width ?? block.width ?? 64),
            height: Math.max(24, rect?.height ?? 64)
          };
        }),
      ...state.symbols
        .filter((symbol) => selectedSymbolIds.includes(symbol.id))
        .map((symbol) => {
          const node = symbolNodeRefs.current[symbol.id];
          const rect = node?.getBoundingClientRect();

          return {
            id: symbol.id,
            type: "symbol" as const,
            x: symbol.x,
            y: symbol.y,
            width: Math.max(24, rect?.width ?? 32),
            height: Math.max(24, rect?.height ?? symbol.fontSize * 18)
          };
        }),
      ...state.textBoxes
        .filter((textBox) => selectedTextBoxIds.includes(textBox.id))
        .map((textBox) => {
          const node = textBoxNodeRefs.current[textBox.id];
          const rect = node?.getBoundingClientRect();

          return {
            id: textBox.id,
            type: "textBox" as const,
            x: textBox.x,
            y: textBox.y,
            width: Math.max(24, rect?.width ?? textBox.width),
            height: Math.max(24, rect?.height ?? 32)
          };
        }),
      ...state.strokes
        .filter((stroke) => selectedStrokeIds.includes(stroke.id))
        .map((stroke) => {
          const node = strokeNodeRefs.current[stroke.id];
          const rect = node?.getBoundingClientRect();
          const strokeBounds = getStrokeBounds(stroke.points);

          return {
            id: stroke.id,
            type: "stroke" as const,
            x: strokeBounds.x,
            y: strokeBounds.y,
            width: Math.max(24, rect?.width ?? strokeBounds.width),
            height: Math.max(24, rect?.height ?? strokeBounds.height)
          };
        })
    ];

    if (measuredItems.length < 2) {
      return;
    }

    const anchorX = Math.min(...measuredItems.map((item) => item.x));
    const anchorY = Math.min(...measuredItems.map((item) => item.y));
    const currentRight = Math.max(...measuredItems.map((item) => item.x + item.width));
    const currentBottom = Math.max(...measuredItems.map((item) => item.y + item.height));
    const currentWidth = Math.max(1, currentRight - anchorX);
    const currentHeight = Math.max(1, currentBottom - anchorY);
    const orderedItems = [...measuredItems].sort((left, right) =>
      currentWidth >= currentHeight
        ? left.x === right.x
          ? left.y - right.y
          : left.x - right.x
        : left.y === right.y
          ? left.x - right.x
          : left.y - right.y
    );
    const currentAspectRatio = currentWidth / currentHeight;
    const canvasBounds = canvas.getBoundingClientRect();
    const snappedLayoutOrigin = getCanvasPlacementPosition(anchorX, anchorY, canvasBounds.width - 24, canvasBounds.height - 24, "strict");

    let bestLayout:
      | {
          positions: Array<{ id: string; type: "block" | "symbol" | "textBox" | "stroke"; x: number; y: number }>;
          score: number;
        }
      | null = null;

    for (let columnCount = 1; columnCount <= orderedItems.length; columnCount += 1) {
      const { columns, rows } = getGridDimensions(orderedItems.length, columnCount);
      const colWidths = Array.from({ length: columns }, () => 0);
      const rowHeights = Array.from({ length: rows }, () => 0);

      orderedItems.forEach((item, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        colWidths[col] = Math.max(colWidths[col], item.width);
        rowHeights[row] = Math.max(rowHeights[row], item.height);
      });

      const totalWidth = colWidths.reduce((sum, width) => sum + width, 0) + spacing * Math.max(0, columns - 1);
      const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0) + spacing * Math.max(0, rows - 1);
      const positions = orderedItems.map((item, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = snappedLayoutOrigin.x + colWidths.slice(0, col).reduce((sum, width) => sum + width, 0) + spacing * col;
        const rowTop = snappedLayoutOrigin.y + rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) + spacing * row;
        const y = rowTop + (rowHeights[row] - item.height) / 2;
        const snappedPoint = getCanvasPlacementPosition(x, y, canvasBounds.width - item.width - 18, canvasBounds.height - item.height - 18, "strict", {
          height: item.height
        });

        return {
          id: item.id,
          type: item.type,
          x: snappedPoint.x,
          y: snappedPoint.y
        };
      });

      const area = totalWidth * totalHeight;
      const nextAspectRatio = totalWidth / Math.max(1, totalHeight);
      const aspectPenalty = Math.abs(Math.log(nextAspectRatio / currentAspectRatio));
      const movementPenalty = positions.reduce((sum, position, index) => {
        const item = orderedItems[index];
        return sum + Math.hypot(position.x - item.x, position.y - item.y);
      }, 0);
      const score = area + area * aspectPenalty * 0.85 + movementPenalty * 18;

      if (!bestLayout || score < bestLayout.score) {
        bestLayout = { positions, score };
      }
    }

    if (!bestLayout) {
      return;
    }

    const positionMap = new Map(bestLayout.positions.map((item) => [`${item.type}:${item.id}`, item]));

    setCanvasQuickMenu(null);
    closeFloatingTextEditing();
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) => {
        const nextPosition = positionMap.get(`block:${block.id}`);
        return nextPosition ? { ...block, x: nextPosition.x, y: nextPosition.y } : block;
      }),
      symbols: current.symbols.map((symbol) => {
        const nextPosition = positionMap.get(`symbol:${symbol.id}`);
        return nextPosition ? { ...symbol, x: nextPosition.x, y: nextPosition.y } : symbol;
      }),
      textBoxes: current.textBoxes.map((textBox) => {
        const nextPosition = positionMap.get(`textBox:${textBox.id}`);
        return nextPosition ? { ...textBox, x: nextPosition.x, y: nextPosition.y } : textBox;
      }),
      strokes: current.strokes.map((stroke) => {
        const nextPosition = positionMap.get(`stroke:${stroke.id}`);

        if (!nextPosition) {
          return stroke;
        }

        const currentBounds = getStrokeBounds(stroke.points);
        const deltaX = nextPosition.x - currentBounds.x;
        const deltaY = nextPosition.y - currentBounds.y;

        return {
          ...stroke,
          points: stroke.points.map((point) => ({
            x: point.x + deltaX,
            y: point.y + deltaY
          }))
        };
      })
    }));
  }

  function startDragging(itemType: "block" | "symbol" | "textBox" | "stroke", itemId: string, x: number, y: number, event: ReactMouseEvent<Element>) {
    event.preventDefault();
    event.stopPropagation();
    setCanvasQuickMenu(null);
    setIsCanvasInteracting(true);

    beginTransientHistorySession("drag");

    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    const keepCurrentSelection =
      itemType === "block"
        ? selectedBlockIdsRef.current.includes(itemId)
        : itemType === "symbol"
          ? selectedSymbolIdsRef.current.includes(itemId)
          : itemType === "textBox"
            ? selectedTextBoxIdsRef.current.includes(itemId)
            : selectedStrokeIdsRef.current.includes(itemId);
    const currentBlockIds = keepCurrentSelection
      ? selectedBlockIdsRef.current
      : itemType === "block"
        ? [itemId]
        : [];
    const currentSymbolIds = keepCurrentSelection
      ? selectedSymbolIdsRef.current
      : itemType === "symbol"
        ? [itemId]
        : [];
    const currentTextBoxIds = keepCurrentSelection
      ? selectedTextBoxIdsRef.current
      : itemType === "textBox"
        ? [itemId]
        : [];
    const currentStrokeIds = keepCurrentSelection
      ? selectedStrokeIdsRef.current
      : itemType === "stroke"
        ? [itemId]
        : [];

    dragRef.current = {
      itemType,
      itemId,
      pointerOffsetX: event.clientX - bounds.left - x,
      pointerOffsetY: event.clientY - bounds.top - y,
      groupBlockPositions: blocksRef.current
        .filter((block) => currentBlockIds.includes(block.id))
        .map((block) => ({ id: block.id, x: block.x, y: block.y })),
      groupSymbolPositions: symbolsRef.current
        .filter((symbol) => currentSymbolIds.includes(symbol.id))
        .map((symbol) => ({ id: symbol.id, x: symbol.x, y: symbol.y })),
      groupTextBoxPositions: textBoxesRef.current
        .filter((textBox) => currentTextBoxIds.includes(textBox.id))
        .map((textBox) => ({ id: textBox.id, x: textBox.x, y: textBox.y })),
      groupStrokePositions: strokesRef.current
        .filter((stroke) => currentStrokeIds.includes(stroke.id))
        .map((stroke) => {
          const strokeBounds = getStrokeBounds(stroke.points);
          return { id: stroke.id, x: strokeBounds.x, y: strokeBounds.y, points: stroke.points.map((point) => ({ ...point })) };
        }),
      anchorX: x,
      anchorY: y
    };

    if (!keepCurrentSelection) {
      if (itemType === "block") {
        selectSingleBlock(itemId);
      } else if (itemType === "symbol") {
        selectSingleSymbol(itemId);
      } else if (itemType === "textBox") {
        selectSingleTextBox(itemId);
      } else {
        selectSingleStroke(itemId);
      }
    }
  }

  function handleToolDragStart(payload: ToolbarDragPayload, event: ReactDragEvent<HTMLButtonElement>) {
    const source = event.currentTarget;
    const rect = source.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const previewNode = source.cloneNode(true) as HTMLElement;

    previewNode.style.position = "fixed";
    previewNode.style.top = "-200vh";
    previewNode.style.left = "-200vw";
    previewNode.style.pointerEvents = "none";
    previewNode.style.zIndex = "9999";
    previewNode.style.boxShadow = "0 12px 30px rgba(31, 45, 61, 0.12)";
    previewNode.style.opacity = "0.92";
    document.body.append(previewNode);

    toolbarDragMetaRef.current = { offsetX, offsetY, previewNode };
    toolbarDragUntilRef.current = Date.now() + 350;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-maths-tool", JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", payload.kind === "shortcut" ? payload.shortcutId : payload.toolId);
    event.dataTransfer.setDragImage(previewNode, offsetX, offsetY);
    setOpenMenu(null);
  }

  function handleToolDragEnd() {
    const previewNode = toolbarDragMetaRef.current?.previewNode;

    if (previewNode) {
      previewNode.remove();
    }

    toolbarDragMetaRef.current = null;
    setSnapGuides({ x: null, y: null });
  }

  function shouldIgnoreToolbarClick() {
    if (Date.now() <= toolbarDragUntilRef.current) {
      toolbarDragUntilRef.current = 0;
      return true;
    }

    return false;
  }

  function handleCanvasDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("application/x-maths-tool")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsCanvasDropActive(true);
    const position = getCanvasDropPosition(
      event.clientX,
      event.clientY,
      toolbarDragMetaRef.current?.offsetX ?? 0,
      toolbarDragMetaRef.current?.offsetY ?? 0
    );
    setSnapGuides(position.guides);
  }

  function handleCanvasDragLeave(event: ReactDragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsCanvasDropActive(false);
    setSnapGuides({ x: null, y: null });
  }

  function handleCanvasDrop(event: ReactDragEvent<HTMLElement>) {
    const rawPayload = event.dataTransfer.getData("application/x-maths-tool");

    if (!rawPayload) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsCanvasDropActive(false);
    setSnapGuides({ x: null, y: null });
    clearFloatingSelection();

    let payload: ToolbarDragPayload | null = null;

    try {
      payload = JSON.parse(rawPayload) as ToolbarDragPayload;
    } catch {
      payload = null;
    }

    if (!payload) {
      return;
    }

    const position = getCanvasDropPosition(
      event.clientX,
      event.clientY,
      toolbarDragMetaRef.current?.offsetX ?? 0,
      toolbarDragMetaRef.current?.offsetY ?? 0
    );

    handleToolDragEnd();

    if (payload.kind === "structured") {
      const block = { ...createBlock(payload.toolId), x: position.x, y: position.y };
      beginTransientHistorySession("edit");
      setState((current) => ({
        ...current,
        blocks: [...current.blocks, block]
      }));
      beginBlockEditing(block.id, getInlineStartField(payload.toolId));
      return;
    }

    const shortcut = findShortcutById(payload.shortcutId);

    if (!shortcut) {
      return;
    }

    const symbol = createFloatingSymbol(shortcut, position.x, position.y);

    setState((current) => ({
      ...current,
      symbols: [...current.symbols, symbol]
    }));
    selectSingleSymbol(symbol.id);
  }

  function renderBlockPreviewButton(blockId: string, field: string, content: string, className: string, onActivate?: () => void) {
    return (
      <button
        type="button"
        className={`math-preview-button ${className}`}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (onActivate) {
            onActivate();
            return;
          }

          beginBlockEditing(blockId, field);
        }}
      >
        {content}
      </button>
    );
  }

  function renderInteractiveMathPreview(block: MathBlock) {
    if (block.type === "fraction") {
      return (
        <div className="math-layout fraction-layout">
          <div className="fraction-preview">
            {renderBlockPreviewButton(block.id, "numerator", block.numerator || "numérateur", "fraction-line top")}
            <div className="fraction-bar" />
            {renderBlockPreviewButton(block.id, "denominator", block.denominator || "dénominateur", "fraction-line")}
          </div>
          {block.caption ? <p className="math-caption">{block.caption}</p> : null}
        </div>
      );
    }

    if (block.type === "division") {
      return (
        <div className="math-layout division-layout">
          <div className="division-preview">
            {renderBlockPreviewButton(block.id, "quotient", block.quotient || "quotient", "division-quotient")}
            {renderBlockPreviewButton(block.id, "divisor", block.divisor || "diviseur", "division-divisor")}
            <div className="division-bracket">
              {renderBlockPreviewButton(block.id, "dividend", block.dividend || "dividende", "division-dividend")}
              {renderBlockPreviewButton(block.id, "remainder", block.remainder || "reste", "division-remainder")}
            </div>
          </div>
          {block.caption ? <p className="math-caption">{block.caption}</p> : null}
        </div>
      );
    }

    if (block.type === "power") {
      return (
        <div className="math-layout power-layout">
          <p className="power-preview">
            {renderBlockPreviewButton(block.id, "base", block.base || "base", "power-preview-main")}
            <sup>{renderBlockPreviewButton(block.id, "exponent", block.exponent || "exposant", "power-preview-exponent")}</sup>
          </p>
          {block.caption ? <p className="math-caption">{block.caption}</p> : null}
        </div>
      );
    }

    return (
      <div className="math-layout root-layout">
        <div className="root-preview">
          <span className="root-symbol">√</span>
          {renderBlockPreviewButton(block.id, "radicand", block.radicand || "radicande", "root-radicand")}
        </div>
        {block.caption ? <p className="math-caption">{block.caption}</p> : null}
      </div>
    );
  }

  function renderInlineBlockEditor(block: MathBlock) {
    const currentField = editingBlock?.blockId === block.id ? editingBlock.field : null;
    const bindInlineInput = (field: string) => ({
      ref: (node: HTMLInputElement | null) => {
        blockInputRefs.current[block.id] = {
          ...blockInputRefs.current[block.id],
          [field]: node
        };
      },
      className: "math-inline-input",
      onMouseDown: (event: ReactMouseEvent<HTMLInputElement>) => event.stopPropagation(),
      onFocus: () => setEditingBlock({ blockId: block.id, field }),
      onChange: (event: ReactChangeEvent<HTMLInputElement>) => updateInlineBlockField(block.id, field, event.target.value),
      onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => handleInlineBlockKeyDown(block.id, field, event),
      onBlur: (event: ReactFocusEvent<HTMLInputElement>) => {
        const nextTarget = event.relatedTarget as Node | null;

        if (nextTarget && blockNodeRefs.current[block.id]?.contains(nextTarget)) {
          return;
        }

        if (editingBlock?.field === field) {
          setTimeout(() => {
            if (editingBlock?.field === field) {
              finishBlockEditing(block.id);
            }
          }, 0);
        }
      }
    });

    if (block.type === "fraction") {
      return (
        <div className="math-layout fraction-layout">
          <div className="fraction-preview fraction-preview-editing">
            <input {...bindInlineInput("numerator")} value={block.numerator} placeholder="a" className="math-inline-input fraction-inline-input" />
            <div className="fraction-bar" />
            <input {...bindInlineInput("denominator")} value={block.denominator} placeholder="b" className="math-inline-input fraction-inline-input" />
          </div>
        </div>
      );
    }

    if (block.type === "division") {
      return (
        <div className="math-layout division-layout">
          <div className="division-preview">
            <input
              {...bindInlineInput("quotient")}
              value={block.quotient}
              placeholder="q"
              className={`math-inline-input division-inline-input division-quotient ${currentField === "quotient" ? "math-inline-input-active" : ""}`}
            />
            <input
              {...bindInlineInput("divisor")}
              value={block.divisor}
              placeholder="d"
              className={`math-inline-input division-inline-input division-divisor ${currentField === "divisor" ? "math-inline-input-active" : ""}`}
            />
            <div className="division-bracket">
              <input
                {...bindInlineInput("dividend")}
                value={block.dividend}
                placeholder="a"
                className={`math-inline-input division-inline-input division-dividend ${currentField === "dividend" ? "math-inline-input-active" : ""}`}
              />
              <input
                {...bindInlineInput("remainder")}
                value={block.remainder}
                placeholder="r"
                className={`math-inline-input division-inline-input division-remainder ${currentField === "remainder" ? "math-inline-input-active" : ""}`}
              />
            </div>
          </div>
        </div>
      );
    }

    if (block.type === "power") {
      return (
        <div className="math-layout power-layout">
          <p className="power-preview power-preview-editing">
            <input {...bindInlineInput("base")} value={block.base} placeholder="a" className="math-inline-input power-inline-base" />
            <sup>
              <input {...bindInlineInput("exponent")} value={block.exponent} placeholder="n" className="math-inline-input power-inline-exponent" />
            </sup>
          </p>
        </div>
      );
    }

    return (
      <div className="math-layout root-layout">
        <div className="root-preview root-preview-editing">
          <span className="root-symbol">√</span>
          <input {...bindInlineInput("radicand")} value={block.radicand} placeholder="a" className="math-inline-input root-inline-radicand" />
        </div>
      </div>
    );
  }

  function resetDocument() {
    window.localStorage.removeItem(STORAGE_KEY);
    setState(DEFAULT_STATE);
    setOpenMenu(null);
    setCanvasQuickMenu(null);
    setModalState(null);
    clearFloatingSelection();
    selectionRef.current = null;
    if (editorRef.current) {
      editorRef.current.innerHTML = DEFAULT_TEXT_HTML;
    }
  }

  async function exportPdf() {
    if (!canvasRef.current) {
      return;
    }

    setIsExporting("pdf");

    try {
      const imageUrl = await toPng(canvasRef.current, {
        backgroundColor: "#fffdf8",
        cacheBust: true,
        pixelRatio: 2
      });

      const image = new Image();
      image.src = imageUrl;

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Image export error"));
      });

      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageWidth / image.width, pageHeight / image.height);
      const renderWidth = image.width * ratio;
      const renderHeight = image.height * ratio;

      pdf.addImage(imageUrl, "PNG", (pageWidth - renderWidth) / 2, 20, renderWidth, renderHeight);
      pdf.save(`${safeFileName(state.title) || "maths-facile"}.pdf`);
    } finally {
      setIsExporting(null);
    }
  }

  async function exportWord() {
    if (!canvasRef.current) {
      return;
    }

    setIsExporting("word");

    try {
      const blob = await toBlob(canvasRef.current, {
        backgroundColor: "#fffdf8",
        cacheBust: true,
        pixelRatio: 2
      });

      if (!blob) {
        return;
      }

      const arrayBuffer = await blob.arrayBuffer();
      const tempImageUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.src = tempImageUrl;

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Word export image error"));
      });

      URL.revokeObjectURL(tempImageUrl);

      const documentFile = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                spacing: { after: 180 },
                children: [new TextRun({ text: state.title, bold: true, size: 34 })]
              }),
              new Paragraph({
                spacing: { after: 180 },
                children: [
                  new TextRun({
                    text: state.mode === "college" ? "Mode collège" : "Mode lycée",
                    italics: true,
                    size: 24
                  })
                ]
              }),
              new Paragraph({
                children: [
                  new ImageRun({
                    type: "png",
                    data: arrayBuffer,
                    transformation: {
                      width: 520,
                      height: Math.max(280, Math.round((image.height / image.width) * 520))
                    }
                  })
                ]
              })
            ]
          }
        ]
      });

      const docBlob = await Packer.toBlob(documentFile);
      saveAs(docBlob, `${safeFileName(state.title) || "maths-facile"}.docx`);
    } finally {
      setIsExporting(null);
    }
  }

  function renderModalFields(block: MathBlock) {
    if (block.type === "fraction") {
      return (
        <div className="math-editor-grid">
          <label>
            <span>Numérateur</span>
            <input value={block.numerator} onChange={(event) => updateModalField("numerator", event.target.value)} placeholder="3x + 2" />
          </label>
          <label>
            <span>Dénominateur</span>
            <input value={block.denominator} onChange={(event) => updateModalField("denominator", event.target.value)} placeholder="5" />
          </label>
          <label>
            <span>Consigne ou remarque</span>
            <input value={block.caption} onChange={(event) => updateModalField("caption", event.target.value)} placeholder="Je simplifie la fraction" />
          </label>
        </div>
      );
    }

    if (block.type === "division") {
      return (
        <div className="math-editor-grid">
          <label>
            <span>Dividende</span>
            <input value={block.dividend} onChange={(event) => updateModalField("dividend", event.target.value)} placeholder="245" />
          </label>
          <label>
            <span>Diviseur</span>
            <input value={block.divisor} onChange={(event) => updateModalField("divisor", event.target.value)} placeholder="7" />
          </label>
          <label>
            <span>Quotient</span>
            <input value={block.quotient} onChange={(event) => updateModalField("quotient", event.target.value)} placeholder="35" />
          </label>
          <label>
            <span>Reste</span>
            <input value={block.remainder} onChange={(event) => updateModalField("remainder", event.target.value)} placeholder="0" />
          </label>
          <label className="wide-field">
            <span>Consigne ou remarque</span>
            <input value={block.caption} onChange={(event) => updateModalField("caption", event.target.value)} placeholder="Je vérifie avec 35 × 7" />
          </label>
        </div>
      );
    }

    if (block.type === "power") {
      return (
        <div className="math-editor-grid">
          <label>
            <span>Base</span>
            <input value={block.base} onChange={(event) => updateModalField("base", event.target.value)} placeholder="2" />
          </label>
          <label>
            <span>Exposant</span>
            <input value={block.exponent} onChange={(event) => updateModalField("exponent", event.target.value)} placeholder="3" />
          </label>
          <label>
            <span>Consigne ou remarque</span>
            <input value={block.caption} onChange={(event) => updateModalField("caption", event.target.value)} placeholder="Carré, cube, puissance n" />
          </label>
        </div>
      );
    }

    return (
      <div className="math-editor-grid">
        <label>
          <span>Radicande</span>
          <input value={block.radicand} onChange={(event) => updateModalField("radicand", event.target.value)} placeholder="49" />
        </label>
        <label className="wide-field">
          <span>Consigne ou remarque</span>
          <input value={block.caption} onChange={(event) => updateModalField("caption", event.target.value)} placeholder="Racine carrée" />
        </label>
      </div>
    );
  }

  function toggleMenu(menu: Exclude<UtilityMenu, null>) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function toggleAdvancedMode() {
    setState((current) => ({
      ...current,
      advancedMode: !current.advancedMode
    }));
  }

  return (
    <main className="editor-shell">
      <header className="top-toolbar">
        <div className="top-toolbar-inner">
          <div className="toolbar-row toolbar-row-primary">
            <div className="toolbar-shortcut-group" aria-label="Blocs posés">
              {activeStructuredTools.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className="toolbar-shortcut"
                  draggable
                  title={tool.hint}
                  onDragStart={(event) => handleToolDragStart({ kind: "structured", toolId: tool.id }, event)}
                  onDragEnd={handleToolDragEnd}
                  onClick={() => {
                    if (shouldIgnoreToolbarClick()) {
                      return;
                    }

                    openInsertModal(tool.id);
                  }}
                >
                  {tool.label}
                </button>
              ))}
            </div>

            <div className="toolbar-icon-actions">
              <button
                type="button"
                className="toolbar-icon-button"
                aria-label="Annuler"
                title="Annuler"
                disabled={historyPast.length === 0}
                onClick={undoHistory}
              >
                ↶
              </button>
              <button
                type="button"
                className="toolbar-icon-button"
                aria-label="Refaire"
                title="Refaire"
                disabled={historyFuture.length === 0}
                onClick={redoHistory}
              >
                ↷
              </button>
              <button
                type="button"
                className={`toolbar-icon-button ${state.advancedMode ? "toolbar-icon-button-active" : ""}`}
                aria-label="Mode avancé"
                aria-pressed={state.advancedMode}
                title={state.advancedMode ? "Mode avancé activé" : "Activer le mode avancé"}
                onClick={toggleAdvancedMode}
              >
                ✦
              </button>
              <button
                type="button"
                className={`toolbar-icon-button ${openMenu === "export" ? "toolbar-icon-button-active" : ""}`}
                aria-label="Exporter"
                title="Exporter"
                onClick={() => toggleMenu("export")}
              >
                ⤓
              </button>
              <button
                type="button"
                className={`toolbar-icon-button ${openMenu === "settings" ? "toolbar-icon-button-active" : ""}`}
                aria-label="Réglages"
                title="Réglages"
                onClick={() => toggleMenu("settings")}
              >
                ⚙
              </button>
            </div>
          </div>

          <div className="toolbar-row toolbar-row-secondary">
            {state.advancedMode ? (
              <div className="toolbar-shortcut-group toolbar-advanced-group" aria-label="Outils avancés">
                <button
                  type="button"
                  className={`toolbar-shortcut toolbar-shortcut-symbol ${advancedTool === "note" ? "toolbar-shortcut-active" : ""}`}
                  title="Petit texte"
                  onClick={() => setAdvancedTool((current) => (current === "note" ? null : "note"))}
                >
                  Aa
                </button>
                <button
                  type="button"
                  className={`toolbar-shortcut toolbar-shortcut-symbol ${advancedTool === "draw" ? "toolbar-shortcut-active" : ""}`}
                  title="Dessin libre"
                  onClick={() => setAdvancedTool((current) => (current === "draw" ? null : "draw"))}
                >
                  ✎
                </button>
              </div>
            ) : null}

            <div className="toolbar-shortcut-group toolbar-shortcut-group-symbols" aria-label="Raccourcis maths">
              {activeInlineShortcuts.flatMap((group) => group.items).map((shortcut) => (
                <button
                  key={shortcut.id}
                  type="button"
                  className="toolbar-shortcut toolbar-shortcut-symbol"
                  draggable
                  title={shortcut.hint}
                  onDragStart={(event) => handleToolDragStart({ kind: "shortcut", shortcutId: shortcut.id }, event)}
                  onDragEnd={handleToolDragEnd}
                  onClick={() => {
                    if (shouldIgnoreToolbarClick()) {
                      return;
                    }

                    insertTextAtCursor(shortcut.content);
                  }}
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {openMenu ? (
          <div className="toolbar-popover-shell">
            {openMenu === "export" ? (
              <section className="toolbar-panel toolbar-popover-panel toolbar-file-panel" aria-label="Exporter">
                <div className="panel-block">
                  <h2>Exporter</h2>
                  <p className="toolbar-helper">Enregistre la feuille ou lance l’impression.</p>
                </div>
                <div className="panel-chip-row">
                  <button type="button" className="toolbar-action primary" onClick={exportPdf} disabled={isExporting !== null}>
                    {isExporting === "pdf" ? "Création PDF..." : "PDF"}
                  </button>
                  <button type="button" className="toolbar-action secondary" onClick={exportWord} disabled={isExporting !== null}>
                    {isExporting === "word" ? "Création Word..." : "Word"}
                  </button>
                  <button type="button" className="toolbar-action ghost" onClick={() => window.print()}>
                    Imprimer
                  </button>
                  <button type="button" className="toolbar-action ghost" onClick={resetDocument}>
                    Nouveau
                  </button>
                </div>
              </section>
            ) : null}

            {openMenu === "settings" ? (
              <section className="toolbar-panel toolbar-popover-panel toolbar-settings-panel" aria-label="Réglages">
                <div className="panel-block">
                  <h2>Réglages</h2>
                  <p className="toolbar-helper">Choisis le niveau pour adapter les raccourcis affichés.</p>
                </div>
                <div className="panel-chip-row">
                  <button
                    type="button"
                    className={`chip-button ${state.mode === "college" ? "chip-button-active" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setState((current) => ({ ...current, mode: "college" }))}
                  >
                    Collège
                  </button>
                  <button
                    type="button"
                    className={`chip-button ${state.mode === "lycee" ? "chip-button-active" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setState((current) => ({ ...current, mode: "lycee" }))}
                  >
                    Lycée
                  </button>
                </div>
                <div className="panel-block">
                  <h2>Mode avancé</h2>
                  <p className="toolbar-helper">Ajoute les outils `Note` et `Dessin libre` pour annoter la feuille comme sur une copie.</p>
                </div>
                <div className="panel-chip-row">
                  <button
                    type="button"
                    className={`chip-button ${state.advancedMode ? "chip-button-active" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={toggleAdvancedMode}
                  >
                    {state.advancedMode ? "Avancé activé" : "Activer Avancé"}
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </header>

      <section className="editor-stage">
        <div className="editor-sheet">
          <div className="editor-sheet-head">
            <div>
              <input
                className="sheet-title-input"
                value={state.title}
                onChange={(event) => setState((current) => ({ ...current, title: event.target.value }))}
                placeholder="Document sans titre"
                aria-label="Titre du document"
              />
            </div>
            <p className="editor-sheet-note">
              Écris librement, puis déplace les opérations posées où tu veux sur la feuille.
            </p>
          </div>

          <div className="editor-local-toolbar" aria-label="Mise en forme du texte">
            <div className="editor-local-toolbar-group">
              <button type="button" className="chip-button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("bold")}>
                Gras
              </button>
              <button type="button" className="chip-button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("removeFormat")}>
                Effacer
              </button>
            </div>

            <div className="editor-local-toolbar-group">
              {FONT_SIZE_OPTIONS.map((option) => (
                <button key={option.id} type="button" className="chip-button chip-button-compact" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("fontSize", option.value)}>
                  {option.label}
                </button>
              ))}
            </div>

            <div className="editor-local-toolbar-group">
              {COLOR_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="color-chip"
                  style={{ backgroundColor: option.value }}
                  aria-label={option.label}
                  title={option.label}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runCommand("foreColor", option.value)}
                />
              ))}
            </div>

            {selectedBlock ? (
              <div className="editor-local-toolbar-group editor-local-toolbar-group-block">
                <span className="selected-block-label">{getBlockTitle(selectedBlock)}</span>
                <button type="button" className="chip-button" onMouseDown={(event) => event.preventDefault()} onClick={() => openEditModal(selectedBlock.id)}>
                  Modifier
                </button>
                <button type="button" className="chip-button" onMouseDown={(event) => event.preventDefault()} onClick={() => removeBlock(selectedBlock.id)}>
                  Supprimer
                </button>
              </div>
            ) : null}

            {selectedSymbol ? (
              <div className="editor-local-toolbar-group editor-local-toolbar-group-block">
                <span className="selected-block-label">Symbole {selectedSymbol.label}</span>
                <button
                  type="button"
                  className="chip-button chip-button-compact"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => updateSymbolStyle(selectedSymbol.id, { fontSize: Math.max(0.92, selectedSymbol.fontSize - 0.12) })}
                >
                  A-
                </button>
                <button
                  type="button"
                  className="chip-button chip-button-compact"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => updateSymbolStyle(selectedSymbol.id, { fontSize: Math.min(2.4, selectedSymbol.fontSize + 0.12) })}
                >
                  A+
                </button>
                {COLOR_OPTIONS.map((option) => (
                  <button
                    key={`selected-symbol-${option.id}`}
                    type="button"
                    className="color-chip"
                    style={{ backgroundColor: option.value }}
                    aria-label={option.label}
                    title={option.label}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => updateSymbolStyle(selectedSymbol.id, { color: option.value })}
                  />
                ))}
                <button type="button" className="chip-button" onMouseDown={(event) => event.preventDefault()} onClick={() => removeSymbol(selectedSymbol.id)}>
                  Supprimer
                </button>
              </div>
            ) : null}

            {selectedTextBox ? (
              <div className="editor-local-toolbar-group editor-local-toolbar-group-block">
                <span className="selected-block-label">Zone de texte</span>
                <button type="button" className="chip-button" onMouseDown={(event) => event.preventDefault()} onClick={() => beginTextBoxEditing(selectedTextBox.id)}>
                  Modifier
                </button>
                <button type="button" className="chip-button" onMouseDown={(event) => event.preventDefault()} onClick={() => removeTextBox(selectedTextBox.id)}>
                  Supprimer
                </button>
              </div>
            ) : null}

            {selectedStroke ? (
              <div className="editor-local-toolbar-group editor-local-toolbar-group-block">
                <span className="selected-block-label">Trait</span>
                <button type="button" className="chip-button" onMouseDown={(event) => event.preventDefault()} onClick={() => removeStroke(selectedStroke.id)}>
                  Supprimer
                </button>
              </div>
            ) : null}
          </div>

          <div
            className={`document-canvas ${isCanvasDropActive ? "document-canvas-drop-active" : ""} ${isCanvasInteracting ? "document-canvas-interacting" : ""} ${state.advancedMode && advancedTool === "draw" ? "document-canvas-draw-mode" : ""}`}
            ref={canvasRef}
            onDragOver={handleCanvasDragOver}
            onDragLeave={handleCanvasDragLeave}
            onDrop={handleCanvasDrop}
            onMouseDown={(event) => {
              setCanvasQuickMenu(null);
              const activeEditingBlockId = editingBlock?.blockId;

              if (activeEditingBlockId && shouldCloseEditingBlock(event.target)) {
                event.preventDefault();
                finishBlockEditing(activeEditingBlockId);
                return;
              }

              if (event.target === event.currentTarget) {
                if (selectedTextBoxId) {
                  event.preventDefault();
                  closeFloatingTextEditing();
                  return;
                }

                event.preventDefault();
                beginAreaSelection(event.clientX, event.clientY);
                return;
              }

              clearFloatingSelection();
              setOpenMenu(null);
            }}
          >
            <div
              ref={editorRef}
              className="canvas-editor"
              contentEditable
              suppressContentEditableWarning
              onMouseDown={(event) => {
                setCanvasQuickMenu(null);
                const activeEditingBlockId = editingBlock?.blockId;

                if (activeEditingBlockId && shouldCloseEditingBlock(event.target)) {
                  event.preventDefault();
                  finishBlockEditing(activeEditingBlockId);
                  return;
                }

                if (event.target === event.currentTarget) {
                  if (selectedTextBoxId) {
                    event.preventDefault();
                    closeFloatingTextEditing();
                    return;
                  }

                  event.preventDefault();
                  beginAreaSelection(event.clientX, event.clientY);
                } else {
                  clearFloatingSelection();
                }
              }}
              onDragOver={handleCanvasDragOver}
              onDragLeave={handleCanvasDragLeave}
              onDrop={handleCanvasDrop}
              onInput={syncText}
              onFocus={saveSelection}
              onMouseUp={saveSelection}
              onKeyUp={saveSelection}
              onPaste={handlePaste}
            />

            {state.blocks.map((block) => (
              <article
                key={block.id}
                ref={(node) => {
                  blockNodeRefs.current[block.id] = node;
                }}
                className={`floating-math-block ${selectedBlockIds.includes(block.id) ? "floating-math-block-selected" : ""}`}
                style={{ left: `${block.x}px`, top: `${block.y}px` }}
                onMouseDown={(event) => {
                  startDragging("block", block.id, block.x, block.y, event);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  openEditModal(block.id);
                }}
              >
                {editingBlock?.blockId === block.id ? (
                  renderInlineBlockEditor(block)
                ) : (
                  renderInteractiveMathPreview(block)
                )}
              </article>
            ))}

            {state.symbols.map((symbol) => (
              <button
                key={symbol.id}
                type="button"
                ref={(node) => {
                  symbolNodeRefs.current[symbol.id] = node;
                }}
                className={`floating-math-symbol ${selectedSymbolIds.includes(symbol.id) ? "floating-math-symbol-selected" : ""}`}
                style={{ left: `${symbol.x}px`, top: `${symbol.y}px`, color: symbol.color, fontSize: `${symbol.fontSize}rem` }}
                onMouseDown={(event) => {
                  startDragging("symbol", symbol.id, symbol.x, symbol.y, event);
                }}
              >
                {symbol.content}
              </button>
            ))}

            {state.textBoxes.map((textBox) => (
              <article
                key={textBox.id}
                ref={(node) => {
                  textBoxNodeRefs.current[textBox.id] = node;
                }}
                className={`floating-text-box ${textBox.variant === "note" ? "floating-text-box-note" : ""} ${selectedTextBoxIds.includes(textBox.id) ? "floating-text-box-selected" : ""}`}
                style={{ left: `${textBox.x}px`, top: `${textBox.y}px`, width: `${textBox.width}px` }}
                onMouseDown={(event) => {
                  if (editingTextBoxId === textBox.id) {
                    return;
                  }

                  startDragging("textBox", textBox.id, textBox.x, textBox.y, event);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  beginTextBoxEditing(textBox.id);
                }}
              >
                {editingTextBoxId === textBox.id ? (
                  <input
                    type="text"
                    className="floating-text-input"
                    value={textBox.text}
                    placeholder="Écris ici"
                    onMouseDown={(event) => {
                      setCanvasQuickMenu(null);
                      event.stopPropagation();
                      selectSingleTextBox(textBox.id);
                    }}
                    onFocus={() => {
                      selectSingleTextBox(textBox.id);
                    }}
                    onChange={(event) => {
                      const nextText = event.target.value;
                      const minimumWidth = textBox.variant === "note" ? 56 : 100;

                      updateTextBox(textBox.id, {
                        text: nextText,
                        width: Math.max(minimumWidth, getTextBoxWidth(nextText))
                      });
                    }}
                    onBlur={(event) => {
                      if (!event.currentTarget.value.trim()) {
                        removeTextBox(textBox.id);
                        setEditingTextBoxId(null);
                        scheduleTransientHistoryCommit("edit");
                        return;
                      }

                      updateTextBox(textBox.id, {
                        text: event.currentTarget.value.trim(),
                        width: Math.max(textBox.variant === "note" ? 56 : 36, getTextBoxWidth(event.currentTarget.value))
                      });
                      setEditingTextBoxId(null);
                      clearFloatingSelection();
                      scheduleTransientHistoryCommit("edit");
                    }}
                  />
                ) : (
                  <div className="floating-text-content">
                    {textBox.text || "Zone de texte"}
                  </div>
                )}
              </article>
            ))}

            <svg
              className={`canvas-draw-layer ${state.advancedMode && advancedTool === "draw" ? "canvas-draw-layer-active" : ""}`}
              width="100%"
              height="100%"
              onMouseDown={(event) => {
                if (!(state.advancedMode && advancedTool === "draw")) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();

                if (editingBlock?.blockId) {
                  finishBlockEditing(editingBlock.blockId);
                }

                if (editingTextBoxId) {
                  closeFloatingTextEditing();
                }

                beginFreehandDrawing(event.clientX, event.clientY);
              }}
            >
              {state.strokes.map((stroke) => {
                const strokeBounds = getStrokeBounds(stroke.points);

                return (
                  <g
                    key={stroke.id}
                    ref={(node) => {
                      strokeNodeRefs.current[stroke.id] = node;
                    }}
                    className={`canvas-draw-stroke-group ${selectedStrokeIds.includes(stroke.id) ? "canvas-draw-stroke-group-selected" : ""}`}
                    onMouseDown={(event) => {
                      if (state.advancedMode && advancedTool === "draw") {
                        return;
                      }

                      startDragging("stroke", stroke.id, strokeBounds.x, strokeBounds.y, event);
                    }}
                  >
                    <path className="canvas-draw-hit" d={createStrokePath(stroke.points)} />
                    <path className="canvas-draw-path" d={createStrokePath(stroke.points)} />
                    {selectedStrokeIds.includes(stroke.id) ? <path className="canvas-draw-path canvas-draw-path-selected" d={createStrokePath(stroke.points)} /> : null}
                  </g>
                );
              })}
              {draftStroke && draftStroke.length >= 2 ? <path className="canvas-draw-path canvas-draw-path-draft" d={createStrokePath(draftStroke)} /> : null}
            </svg>

            {snapGuides.x !== null ? (
              <div className="canvas-snap-guide canvas-snap-guide-vertical" style={{ left: `${snapGuides.x}px` }} aria-hidden="true" />
            ) : null}

            {snapGuides.y !== null ? (
              <div className="canvas-snap-guide canvas-snap-guide-horizontal" style={{ top: `${snapGuides.y}px` }} aria-hidden="true" />
            ) : null}

            {multiSelectionMenuPosition ? (
              <div
                className="canvas-quick-menu canvas-selection-menu"
                style={{ left: `${multiSelectionMenuPosition.x}px`, top: `${multiSelectionMenuPosition.y}px` }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="canvas-quick-action canvas-selection-action"
                  aria-label="Aligner"
                  title="Aligner"
                  onClick={alignSelectedItems}
                >
                  <span className="align-grid-icon" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                </button>
                <button
                  type="button"
                  className="canvas-quick-action canvas-selection-action"
                  aria-label="Supprimer"
                  title="Supprimer"
                  onClick={removeSelectedItems}
                >
                  ×
                </button>
              </div>
            ) : null}

            {canvasQuickMenu ? (
              <>
                <div
                  className="canvas-quick-anchor"
                  style={{ left: `${canvasQuickMenu.clickX}px`, top: `${canvasQuickMenu.clickY}px` }}
                  aria-hidden="true"
                />
                <div
                  className="canvas-quick-menu"
                  style={{ left: `${canvasQuickMenu.x}px`, top: `${canvasQuickMenu.y}px` }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="canvas-quick-close"
                    aria-label="Fermer le menu"
                    title="Fermer"
                    onClick={() => setCanvasQuickMenu(null)}
                  >
                    ×
                  </button>
                  <button type="button" className="canvas-quick-action" onClick={() => createTextBoxAt(canvasQuickMenu.clickX, canvasQuickMenu.clickY)}>
                    T
                  </button>
                  {activeStructuredTools.map((tool) => (
                    <button
                      key={`quick-${tool.id}`}
                      type="button"
                      className="canvas-quick-action"
                      title={tool.label}
                      onClick={() => createStructuredToolAt(tool.id, canvasQuickMenu.clickX, canvasQuickMenu.clickY)}
                    >
                      {tool.id === "fraction" ? "a/b" : tool.id === "division" ? "÷" : tool.id === "power" ? "x²" : "√"}
                    </button>
                  ))}
                  {activeInlineShortcuts
                    .flatMap((group) => group.items)
                    .slice(0, 6)
                    .map((shortcut) => (
                      <button
                      key={`quick-symbol-${shortcut.id}`}
                      type="button"
                      className="canvas-quick-action"
                      title={shortcut.hint}
                      onClick={() => createShortcutSymbolAt(shortcut.id, canvasQuickMenu.clickX, canvasQuickMenu.clickY)}
                    >
                      {shortcut.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {selectionRect ? (
              <div
                className="canvas-selection-rect"
                style={{
                  left: `${Math.min(selectionRect.originX, selectionRect.currentX)}px`,
                  top: `${Math.min(selectionRect.originY, selectionRect.currentY)}px`,
                  width: `${Math.abs(selectionRect.currentX - selectionRect.originX)}px`,
                  height: `${Math.abs(selectionRect.currentY - selectionRect.originY)}px`
                }}
              />
            ) : null}
          </div>
        </div>
      </section>

      {modalState ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setModalState(null)}>
          <section className="block-modal" role="dialog" aria-modal="true" aria-labelledby="block-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="block-modal-head">
              <div>
                <p className="card-kind">Bloc guidé</p>
                <h2 id="block-modal-title">{getBlockTitle(modalState.block)}</h2>
                <p className="toolbar-helper">Prépare le bloc, puis place-le librement sur la feuille.</p>
              </div>
              <div className="card-actions">
                <button type="button" className="small-action" onClick={() => setModalState(null)}>
                  Annuler
                </button>
                <button type="button" className="small-action primary-inline-action" onClick={applyModalBlock}>
                  {modalState.mode === "insert" ? "Insérer" : "Enregistrer"}
                </button>
              </div>
            </div>

            {renderModalFields(modalState.block)}

            <div className="block-modal-preview">
              <section className="export-math-block">
                <div className="export-math-head">
                  <span>Aperçu</span>
                </div>
                {renderMathPreview(modalState.block)}
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
