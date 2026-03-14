"use client";

import {
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
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
type ToolbarPanel = "text" | "math";

type TextBlock = {
  id: string;
  type: "text";
  html: string;
};

type FractionBlock = {
  id: string;
  type: "fraction";
  numerator: string;
  denominator: string;
  simplified: string;
  caption: string;
};

type DivisionBlock = {
  id: string;
  type: "division";
  dividend: string;
  divisor: string;
  quotient: string;
  remainder: string;
  caption: string;
};

type PowerBlock = {
  id: string;
  type: "power";
  base: string;
  exponent: string;
  result: string;
  caption: string;
};

type RootBlock = {
  id: string;
  type: "root";
  radicand: string;
  result: string;
  caption: string;
};

type DocumentBlock = TextBlock | FractionBlock | DivisionBlock | PowerBlock | RootBlock;
type StructuredBlock = Exclude<DocumentBlock, TextBlock>;

type WriterState = {
  title: string;
  mode: StudyMode;
  blocks: DocumentBlock[];
};

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

type StructuredTool = {
  id: Exclude<DocumentBlock["type"], "text">;
  label: string;
  hint: string;
  modes: StudyMode[];
};

type PendingFocus = {
  blockId: string;
  moveToEnd: boolean;
} | null;

type ModalState =
  | {
      mode: "insert" | "edit";
      block: StructuredBlock;
      anchorBlockId: string | null;
    }
  | {
      mode: "editInline";
      block: StructuredBlock;
      anchorBlockId: string;
      chipId: string;
    }
  | null;

type SelectedInlineChip = {
  blockId: string;
  chipId: string;
  block: StructuredBlock;
  width: number;
} | null;

type DragInlineChip = {
  blockId: string;
  chipId: string;
} | null;

type InlineChipData = {
  chipId: string;
  block: StructuredBlock;
  width: number;
};

const INLINE_WIDTH_MIN = 150;
const INLINE_WIDTH_MAX = 420;
const INLINE_WIDTH_STEP = 36;

function getDefaultInlineWidth(type: StructuredBlock["type"]) {
  switch (type) {
    case "division":
      return 300;
    case "fraction":
      return 250;
    case "power":
      return 200;
    case "root":
      return 220;
    default:
      return 240;
  }
}

function clampInlineWidth(value: number) {
  return Math.min(INLINE_WIDTH_MAX, Math.max(INLINE_WIDTH_MIN, Math.round(value)));
}

function encodeInlineBlock(block: StructuredBlock) {
  return encodeURIComponent(JSON.stringify(block));
}

function decodeInlineBlock(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as DocumentBlock;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.type === "text" ||
      !["fraction", "division", "power", "root"].includes(parsed.type)
    ) {
      return null;
    }

    return parsed as StructuredBlock;
  } catch {
    return null;
  }
}

function getInlineChipElement(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  const chip = target.closest(".math-inline-chip");

  return chip instanceof HTMLSpanElement ? chip : null;
}

function readInlineChipData(chip: HTMLSpanElement): InlineChipData | null {
  const chipId = chip.dataset.inlineId;
  const block = decodeInlineBlock(chip.dataset.mathBlock);

  if (!chipId || !block) {
    return null;
  }

  const width = clampInlineWidth(Number(chip.dataset.mathWidth) || getDefaultInlineWidth(block.type));

  return {
    chipId,
    block,
    width
  };
}

function createRangeAtEnd(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  return range;
}

function getRangeFromPoint(target: HTMLElement, x: number, y: number) {
  const documentWithCaret = document as unknown as {
    caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
    caretPositionFromPoint?: (
      clientX: number,
      clientY: number
    ) => {
      offsetNode: Node;
      offset: number;
    } | null;
  };

  if (documentWithCaret.caretRangeFromPoint) {
    const range = documentWithCaret.caretRangeFromPoint(x, y);

    if (range && target.contains(range.startContainer)) {
      return range;
    }
  }

  const caretPosition = documentWithCaret.caretPositionFromPoint?.(x, y);

  if (caretPosition && target.contains(caretPosition.offsetNode)) {
    const range = document.createRange();
    range.setStart(caretPosition.offsetNode, caretPosition.offset);
    range.collapse(true);
    return range;
  }

  return createRangeAtEnd(target);
}

function trimFollowingSpacer(chip: HTMLSpanElement) {
  const sibling = chip.nextSibling;

  if (sibling?.nodeType !== Node.TEXT_NODE) {
    return;
  }

  const text = sibling.textContent ?? "";

  if (!text.startsWith(" ")) {
    return;
  }

  const nextText = text.slice(1);

  if (nextText.length === 0) {
    sibling.parentNode?.removeChild(sibling);
    return;
  }

  sibling.textContent = nextText;
}

function updateInlineChipElement(chip: HTMLSpanElement, block: StructuredBlock, width: number) {
  chip.dataset.inlineId ||= createId("inline");
  chip.dataset.mathBlock = encodeInlineBlock(block);
  chip.dataset.mathWidth = String(clampInlineWidth(width));
  chip.contentEditable = "false";
  chip.draggable = true;
  chip.tabIndex = 0;

  let image = chip.querySelector("img");

  if (!(image instanceof HTMLImageElement)) {
    image = document.createElement("img");
    image.className = "math-inline-image";
    image.draggable = false;
    chip.replaceChildren(image);
  }

  image.src = structuredBlockToDataUrl(block);
  image.alt = getStructuredBlockTitle(block);
  image.style.width = `${clampInlineWidth(width)}px`;
}

function createInlineChipElement(block: StructuredBlock, width = getDefaultInlineWidth(block.type)) {
  const wrapper = document.createElement("span");
  wrapper.className = "math-inline-chip";
  updateInlineChipElement(wrapper, block, width);
  return wrapper;
}

const STORAGE_KEY = "maths-facile-block-writer-v1";

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

const STRUCTURED_TOOLS: StructuredTool[] = [
  {
    id: "fraction",
    label: "Fraction posée",
    hint: "Numérateur au-dessus, dénominateur en dessous",
    modes: ["college", "lycee"]
  },
  {
    id: "division",
    label: "Division posée",
    hint: "Diviseur, dividende, quotient et reste",
    modes: ["college", "lycee"]
  },
  {
    id: "power",
    label: "Puissance",
    hint: "Base, exposant et résultat",
    modes: ["college", "lycee"]
  },
  {
    id: "root",
    label: "Racine",
    hint: "Radicande et résultat",
    modes: ["college", "lycee"]
  }
];

const INLINE_SHORTCUT_GROUPS: InlineShortcutGroup[] = [
  {
    name: "Essentiels",
    items: [
      { id: "equal", label: "Égal", hint: "Ajoute =", content: " = ", modes: ["college", "lycee"] },
      { id: "neq", label: "Différent", hint: "Ajoute ≠", content: " ≠ ", modes: ["college", "lycee"] },
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

const DEFAULT_TEXT_HTML = [
  "<p><strong>Commence ici :</strong> écris ta méthode, ta réponse ou ton raisonnement.</p>",
  "<p>Tu peux ensuite ajouter une fraction posée, une division posée ou une puissance avec la barre du haut.</p>"
].join("");

const INITIAL_TEXT_BLOCK_ID = "text-initial";

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function createTextBlock(html = ""): TextBlock {
  return { id: createId("text"), type: "text", html };
}

function createStructuredBlock(type: StructuredTool["id"]): StructuredBlock {
  if (type === "fraction") {
    return { id: createId("fraction"), type, numerator: "", denominator: "", simplified: "", caption: "" };
  }

  if (type === "division") {
    return {
      id: createId("division"),
      type,
      dividend: "",
      divisor: "",
      quotient: "",
      remainder: "",
      caption: ""
    };
  }

  if (type === "power") {
    return { id: createId("power"), type, base: "", exponent: "", result: "", caption: "" };
  }

  return { id: createId("root"), type, radicand: "", result: "", caption: "" };
}

function getStructuredBlockTitle(block: DocumentBlock) {
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

const DEFAULT_STATE: WriterState = {
  title: "Mon document de maths",
  mode: "college",
  blocks: [
    {
      id: INITIAL_TEXT_BLOCK_ID,
      type: "text",
      html: DEFAULT_TEXT_HTML
    }
  ]
};

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function shorten(value: string, max = 28) {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1)}…`;
}

function structuredBlockToSvg(block: StructuredBlock) {
  const card = `<rect x="8" y="8" width="344" height="184" rx="22" fill="#fffdf8" stroke="#e2d6bf" stroke-width="2"/>`;
  const caption = block.caption
    ? `<text x="32" y="168" font-size="14" fill="#5c6775" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeSvgText(shorten(block.caption, 34))}</text>`
    : "";

  if (block.type === "fraction") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200">
        ${card}
        <text x="32" y="40" font-size="18" font-weight="700" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">Fraction posée</text>
        <text x="180" y="86" text-anchor="middle" font-size="28" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeSvgText(shorten(block.numerator || "numérateur"))}</text>
        <line x1="96" y1="104" x2="264" y2="104" stroke="#1f2d3d" stroke-width="4" stroke-linecap="round"/>
        <text x="180" y="138" text-anchor="middle" font-size="28" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeSvgText(shorten(block.denominator || "dénominateur"))}</text>
        ${block.simplified ? `<text x="32" y="84" font-size="15" fill="#bc5f2d" font-family="Trebuchet MS, Segoe UI, sans-serif">Résultat : ${escapeSvgText(shorten(block.simplified, 22))}</text>` : ""}
        ${caption}
      </svg>
    `;
  }

  if (block.type === "division") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200">
        ${card}
        <text x="32" y="40" font-size="18" font-weight="700" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">Division posée</text>
        <text x="248" y="72" text-anchor="middle" font-size="28" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeSvgText(shorten(block.quotient || "quotient", 14))}</text>
        <line x1="116" y1="92" x2="310" y2="92" stroke="#1f2d3d" stroke-width="4"/>
        <line x1="150" y1="92" x2="150" y2="142" stroke="#1f2d3d" stroke-width="4"/>
        <text x="102" y="126" text-anchor="middle" font-size="25" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeSvgText(shorten(block.divisor || "diviseur", 10))}</text>
        <text x="234" y="126" text-anchor="middle" font-size="25" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeSvgText(shorten(block.dividend || "dividende", 16))}</text>
        <text x="32" y="84" font-size="15" fill="#bc5f2d" font-family="Trebuchet MS, Segoe UI, sans-serif">Reste : ${escapeSvgText(shorten(block.remainder || "reste", 12))}</text>
        ${caption}
      </svg>
    `;
  }

  if (block.type === "power") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200">
        ${card}
        <text x="32" y="40" font-size="18" font-weight="700" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">Puissance</text>
        <text x="104" y="112" font-size="42" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeSvgText(shorten(block.base || "base", 8))}</text>
        <text x="178" y="82" font-size="24" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeSvgText(shorten(block.exponent || "expo", 8))}</text>
        ${block.result ? `<text x="32" y="150" font-size="16" fill="#bc5f2d" font-family="Trebuchet MS, Segoe UI, sans-serif">Résultat : ${escapeSvgText(shorten(block.result, 18))}</text>` : ""}
        ${caption}
      </svg>
    `;
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200">
      ${card}
      <text x="32" y="40" font-size="18" font-weight="700" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">Racine</text>
      <text x="72" y="122" font-size="64" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">√</text>
      <line x1="120" y1="86" x2="274" y2="86" stroke="#1f2d3d" stroke-width="4" stroke-linecap="round"/>
      <text x="132" y="120" font-size="28" fill="#1f2d3d" font-family="Trebuchet MS, Segoe UI, sans-serif">${escapeSvgText(shorten(block.radicand || "radicande", 12))}</text>
      ${block.result ? `<text x="32" y="150" font-size="16" fill="#bc5f2d" font-family="Trebuchet MS, Segoe UI, sans-serif">Résultat : ${escapeSvgText(shorten(block.result, 18))}</text>` : ""}
      ${caption}
    </svg>
  `;
}

function structuredBlockToDataUrl(block: StructuredBlock) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(structuredBlockToSvg(block))}`;
}

function isTextBlock(block: DocumentBlock): block is TextBlock {
  return block.type === "text";
}

function isHtmlEmpty(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "")
    .trim().length === 0;
}

function parseStoredState(raw: string): WriterState | null {
  try {
    const parsed = JSON.parse(raw) as WriterState;

    if (
      typeof parsed.title !== "string" ||
      (parsed.mode !== "college" && parsed.mode !== "lycee") ||
      !Array.isArray(parsed.blocks) ||
      parsed.blocks.length === 0
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function MathWorkbook() {
  const [state, setState] = useState<WriterState>(DEFAULT_STATE);
  const [toolbarPanel, setToolbarPanel] = useState<ToolbarPanel>("math");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isExporting, setIsExporting] = useState<"pdf" | "word" | null>(null);
  const [activeBlockId, setActiveBlockId] = useState(DEFAULT_STATE.blocks[0].id);
  const [activeTextBlockId, setActiveTextBlockId] = useState(DEFAULT_STATE.blocks[0].id);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus>(null);
  const [selectedInlineChip, setSelectedInlineChip] = useState<SelectedInlineChip>(null);
  const [dragOverTextBlockId, setDragOverTextBlockId] = useState<string | null>(null);
  const textBlockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectionRef = useRef<{ blockId: string; range: Range } | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const draggingInlineChipRef = useRef<DragInlineChip>(null);
  const suppressSelectionSaveRef = useRef(false);

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
    setActiveBlockId(parsed.blocks[0].id);

    const firstTextBlock = parsed.blocks.find((block) => block.type === "text");

    if (firstTextBlock) {
      setActiveTextBlockId(firstTextBlock.id);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [isHydrated, state]);

  useEffect(() => {
    for (const block of state.blocks) {
      if (!isTextBlock(block)) {
        continue;
      }

      const element = textBlockRefs.current[block.id];

      if (
        element &&
        document.activeElement !== element &&
        element.innerHTML !== block.html
      ) {
        element.innerHTML = block.html;
      }

      if (element) {
        hydrateInlineChips(block.id);
      }
    }
  }, [state.blocks]);

  useEffect(() => {
    if (!pendingFocus) {
      return;
    }

    const element = textBlockRefs.current[pendingFocus.blockId];

    if (!element) {
      return;
    }

    element.focus();

    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(!pendingFocus.moveToEnd);

    const selection = window.getSelection();

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
      selectionRef.current = {
        blockId: pendingFocus.blockId,
        range: range.cloneRange()
      };
    }

    setActiveBlockId(pendingFocus.blockId);
    setActiveTextBlockId(pendingFocus.blockId);
    setPendingFocus(null);
  }, [pendingFocus, state.blocks]);

  useEffect(() => {
    document.querySelectorAll(".math-inline-chip-selected").forEach((chip) => {
      chip.classList.remove("math-inline-chip-selected");
    });

    if (!selectedInlineChip) {
      return;
    }

    const container = textBlockRefs.current[selectedInlineChip.blockId];

    if (!container) {
      setSelectedInlineChip(null);
      return;
    }

    const chip = container.querySelector(`[data-inline-id="${selectedInlineChip.chipId}"]`);

    if (!(chip instanceof HTMLSpanElement)) {
      setSelectedInlineChip(null);
      return;
    }

    chip.classList.add("math-inline-chip-selected");
  }, [selectedInlineChip, state.blocks]);

  function findBlockIndex(blockId: string, blocks = state.blocks) {
    return blocks.findIndex((block) => block.id === blockId);
  }

  function findBlock(blockId: string, blocks = state.blocks) {
    return blocks.find((block) => block.id === blockId) ?? null;
  }

  function findInlineChip(blockId: string, chipId: string) {
    const container = textBlockRefs.current[blockId];

    if (!container) {
      return null;
    }

    const chip = container.querySelector(`[data-inline-id="${chipId}"]`);

    return chip instanceof HTMLSpanElement ? chip : null;
  }

  function bindInlineChipInteractions(blockId: string, chip: HTMLSpanElement) {
    chip.dataset.ownerBlockId = blockId;
    chip.draggable = true;

    chip.onmousedown = (event) => {
      suppressSelectionSaveRef.current = true;
      window.requestAnimationFrame(() => {
        suppressSelectionSaveRef.current = false;
      });
      event.preventDefault();
      event.stopPropagation();
      selectInlineChipFromElement(blockId, chip);
    };

    chip.ondblclick = (event) => {
      suppressSelectionSaveRef.current = true;
      window.requestAnimationFrame(() => {
        suppressSelectionSaveRef.current = false;
      });
      event.preventDefault();
      event.stopPropagation();
      openInlineChipEditor(blockId, chip);
    };

    chip.ondragstart = (event) => {
      const data = readInlineChipData(chip);

      if (!data || !event.dataTransfer) {
        return;
      }

      draggingInlineChipRef.current = {
        blockId: chip.dataset.ownerBlockId ?? blockId,
        chipId: data.chipId
      };

      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", data.chipId);
      selectInlineChipFromElement(chip.dataset.ownerBlockId ?? blockId, chip);
    };

    chip.ondragend = () => {
      handleTextDragEnd();
    };
  }

  function hydrateInlineChips(blockId: string) {
    const container = textBlockRefs.current[blockId];

    if (!container) {
      return;
    }

    container.querySelectorAll(".math-inline-chip").forEach((chip) => {
      if (chip instanceof HTMLSpanElement) {
        bindInlineChipInteractions(blockId, chip);
      }
    });
  }

  function selectInlineChipFromElement(blockId: string, chip: HTMLSpanElement) {
    const data = readInlineChipData(chip);

    if (!data) {
      return;
    }

    setSelectedInlineChip({
      blockId,
      chipId: data.chipId,
      block: data.block,
      width: data.width
    });
    setActiveTextBlockId(blockId);
    setActiveBlockId(blockId);
  }

  function openInlineChipEditor(blockId: string, chip: HTMLSpanElement) {
    const data = readInlineChipData(chip);

    if (!data) {
      return;
    }

    setSelectedInlineChip({
      blockId,
      chipId: data.chipId,
      block: data.block,
      width: data.width
    });
    setModalState({
      mode: "editInline",
      block: { ...data.block },
      anchorBlockId: blockId,
      chipId: data.chipId
    });
  }

  function resizeSelectedInlineChip(nextWidth: number) {
    if (!selectedInlineChip) {
      return;
    }

    const chip = findInlineChip(selectedInlineChip.blockId, selectedInlineChip.chipId);

    if (!chip) {
      setSelectedInlineChip(null);
      return;
    }

    const width = clampInlineWidth(nextWidth);
    updateInlineChipElement(chip, selectedInlineChip.block, width);
    syncTextBlock(selectedInlineChip.blockId);
    setSelectedInlineChip({
      ...selectedInlineChip,
      width
    });
  }

  function removeSelectedInlineChip() {
    if (!selectedInlineChip) {
      return false;
    }

    const chip = findInlineChip(selectedInlineChip.blockId, selectedInlineChip.chipId);

    if (!chip) {
      setSelectedInlineChip(null);
      return false;
    }

    trimFollowingSpacer(chip);
    chip.remove();
    syncTextBlock(selectedInlineChip.blockId);
    focusTextBlock(selectedInlineChip.blockId, true);
    setSelectedInlineChip(null);
    return true;
  }

  function saveSelection(blockId: string) {
    if (suppressSelectionSaveRef.current) {
      return;
    }

    const selection = window.getSelection();
    const element = textBlockRefs.current[blockId];

    if (!selection || selection.rangeCount === 0 || !element) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (!element.contains(range.commonAncestorContainer)) {
      return;
    }

    selectionRef.current = {
      blockId,
      range: range.cloneRange()
    };
    setSelectedInlineChip(null);
    setActiveTextBlockId(blockId);
    setActiveBlockId(blockId);
  }

  function focusTextBlock(blockId: string, moveToEnd = false) {
    const element = textBlockRefs.current[blockId];

    if (!element) {
      return false;
    }

    element.focus();

    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(!moveToEnd);

    const selection = window.getSelection();

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
      selectionRef.current = {
        blockId,
        range: range.cloneRange()
      };
    }

    setSelectedInlineChip(null);
    setActiveTextBlockId(blockId);
    setActiveBlockId(blockId);
    return true;
  }

  function restoreSelection() {
    if (!selectionRef.current) {
      return false;
    }

    const element = textBlockRefs.current[selectionRef.current.blockId];
    const selection = window.getSelection();

    if (!element || !selection) {
      return false;
    }

    element.focus();
    selection.removeAllRanges();
    selection.addRange(selectionRef.current.range);
    return true;
  }

  function syncTextBlock(blockId: string) {
    const element = textBlockRefs.current[blockId];

    if (!element) {
      return;
    }

    const html = isHtmlEmpty(element.innerHTML) ? "" : element.innerHTML;

    setState((current) => {
      let hasChanged = false;

      const blocks = current.blocks.map((block) => {
        if (block.id !== blockId || block.type !== "text") {
          return block;
        }

        if (block.html === html) {
          return block;
        }

        hasChanged = true;
        return { ...block, html };
      });

      if (!hasChanged) {
        return current;
      }

      return {
        ...current,
        blocks
      };
    });
  }

  function updateTitle(title: string) {
    setState((current) => ({
      ...current,
      title
    }));
  }

  function updateMode(mode: StudyMode) {
    setState((current) => ({
      ...current,
      mode
    }));
  }

  function updateModalBlockField(field: string, value: string) {
    setModalState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        block: { ...current.block, [field]: value } as StructuredBlock
      };
    });
  }

  function handleTextMouseDown(blockId: string, event: ReactMouseEvent<HTMLDivElement>) {
    const chip = getInlineChipElement(event.target);

    if (!chip) {
      return;
    }

    suppressSelectionSaveRef.current = true;
    window.requestAnimationFrame(() => {
      suppressSelectionSaveRef.current = false;
    });
    event.preventDefault();
    event.stopPropagation();
    selectInlineChipFromElement(blockId, chip);
  }

  function handleTextDoubleClick(blockId: string, event: ReactMouseEvent<HTMLDivElement>) {
    const chip = getInlineChipElement(event.target);

    if (!chip) {
      return;
    }

    suppressSelectionSaveRef.current = true;
    window.requestAnimationFrame(() => {
      suppressSelectionSaveRef.current = false;
    });
    event.preventDefault();
    event.stopPropagation();
    openInlineChipEditor(blockId, chip);
  }

  function handleTextDragOver(blockId: string, event: ReactDragEvent<HTMLDivElement>) {
    if (!draggingInlineChipRef.current) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (dragOverTextBlockId !== blockId) {
      setDragOverTextBlockId(blockId);
    }
  }

  function handleTextDragLeave(blockId: string, event: ReactDragEvent<HTMLDivElement>) {
    if (
      dragOverTextBlockId === blockId &&
      event.relatedTarget instanceof Node &&
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setDragOverTextBlockId(null);
    }
  }

  function handleTextDrop(blockId: string, event: ReactDragEvent<HTMLDivElement>) {
    const dragging = draggingInlineChipRef.current;

    if (!dragging) {
      return;
    }

    event.preventDefault();
    setDragOverTextBlockId(null);

    const target = textBlockRefs.current[blockId];
    const chip = findInlineChip(dragging.blockId, dragging.chipId);

    if (!target || !chip) {
      draggingInlineChipRef.current = null;
      return;
    }

    const data = readInlineChipData(chip);

    if (!data) {
      draggingInlineChipRef.current = null;
      return;
    }

    trimFollowingSpacer(chip);

    const range = getRangeFromPoint(target, event.clientX, event.clientY);
    range.deleteContents();
    range.insertNode(chip);

    const spacer = document.createTextNode(" ");
    range.setStartAfter(chip);
    range.collapse(true);
    range.insertNode(spacer);
    range.setStartAfter(spacer);
    range.collapse(true);

    const selection = window.getSelection();

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
      selectionRef.current = {
        blockId,
        range: range.cloneRange()
      };
    }

    setActiveTextBlockId(blockId);
    setActiveBlockId(blockId);
    syncTextBlock(dragging.blockId);
    syncTextBlock(blockId);
    bindInlineChipInteractions(blockId, chip);
    setSelectedInlineChip({
      blockId,
      chipId: data.chipId,
      block: data.block,
      width: data.width
    });
    draggingInlineChipRef.current = null;
  }

  function handleTextMouseUp(blockId: string, event: ReactMouseEvent<HTMLDivElement>) {
    if (getInlineChipElement(event.target)) {
      return;
    }

    saveSelection(blockId);
  }

  function handleTextDragEnd() {
    draggingInlineChipRef.current = null;
    setDragOverTextBlockId(null);
  }

  function insertTextAtCursor(content: string) {
    const targetTextBlockId = activeTextBlockId;

    if (!targetTextBlockId) {
      return;
    }

    if (!restoreSelection()) {
      focusTextBlock(targetTextBlockId, true);
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
    selectionRef.current = {
      blockId: targetTextBlockId,
      range: range.cloneRange()
    };

    syncTextBlock(targetTextBlockId);
  }

  function insertStructuredImageAtCursor(block: StructuredBlock) {
    const targetTextBlockId = activeTextBlockId;

    if (!targetTextBlockId) {
      return;
    }

    if (!restoreSelection()) {
      focusTextBlock(targetTextBlockId, true);
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const wrapper = createInlineChipElement(block);

    const spacer = document.createTextNode(" ");
    const fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);
    fragment.appendChild(spacer);
    range.insertNode(fragment);

    range.setStartAfter(spacer);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
    selectionRef.current = {
      blockId: targetTextBlockId,
      range: range.cloneRange()
    };

    syncTextBlock(targetTextBlockId);
    bindInlineChipInteractions(targetTextBlockId, wrapper);
    selectInlineChipFromElement(targetTextBlockId, wrapper);
  }

  function runCommand(command: string, value?: string) {
    const targetTextBlockId = activeTextBlockId;

    if (!targetTextBlockId) {
      return;
    }

    if (!restoreSelection()) {
      focusTextBlock(targetTextBlockId, true);
    }

    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
    syncTextBlock(targetTextBlockId);
    saveSelection(targetTextBlockId);
  }

  function insertTextBlockAfter(blockId: string) {
    const newTextBlock = createTextBlock("");

    setState((current) => {
      const index = findBlockIndex(blockId, current.blocks);
      const blocks = [...current.blocks];
      blocks.splice(index + 1, 0, newTextBlock);

      return {
        ...current,
        blocks
      };
    });

    setPendingFocus({
      blockId: newTextBlock.id,
      moveToEnd: false
    });
  }

  function insertStructuredBlock(type: StructuredTool["id"]) {
    const structuredBlock = createStructuredBlock(type);
    setModalState({
      mode: "insert",
      block: structuredBlock,
      anchorBlockId: activeBlockId ?? null
    });
  }

  function removeBlock(blockId: string) {
    setState((current) => {
      const remainingBlocks = current.blocks.filter((block) => block.id !== blockId);

      if (remainingBlocks.length === 0) {
        const fallbackText = createTextBlock("");
        setPendingFocus({
          blockId: fallbackText.id,
          moveToEnd: false
        });

        return {
          ...current,
          blocks: [fallbackText]
        };
      }

      if (!remainingBlocks.some((block) => block.type === "text")) {
        const fallbackText = createTextBlock("");
        remainingBlocks.push(fallbackText);
        setPendingFocus({
          blockId: fallbackText.id,
          moveToEnd: false
        });
      }

      return {
        ...current,
        blocks: remainingBlocks
      };
    });

    if (selectedInlineChip?.blockId === blockId) {
      setSelectedInlineChip(null);
    }
  }

  function resetDocument() {
    const nextState: WriterState = {
      title: "Mon document de maths",
      mode: "college",
      blocks: [createTextBlock(DEFAULT_TEXT_HTML)]
    };

    setState(nextState);
    setToolbarPanel("math");
    setModalState(null);
    setSelectedInlineChip(null);
    setDragOverTextBlockId(null);
    setActiveBlockId(nextState.blocks[0].id);
    setActiveTextBlockId(nextState.blocks[0].id);
    selectionRef.current = null;
    window.localStorage.removeItem(STORAGE_KEY);
    setPendingFocus({
      blockId: nextState.blocks[0].id,
      moveToEnd: true
    });
  }

  function handleTextInput(blockId: string) {
    syncTextBlock(blockId);
    saveSelection(blockId);
  }

  function handleTextPaste(blockId: string, event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const pastedText = event.clipboardData.getData("text/plain");
    setActiveTextBlockId(blockId);
    setActiveBlockId(blockId);
    saveSelection(blockId);
    insertTextAtCursor(pastedText);
  }

  function handleTextKeyDown(blockId: string, event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.key === "Backspace" || event.key === "Delete") && removeSelectedInlineChip()) {
      event.preventDefault();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      setActiveTextBlockId(blockId);
      setActiveBlockId(blockId);
      saveSelection(blockId);
      insertTextAtCursor("    ");
      return;
    }

    window.requestAnimationFrame(() => {
      saveSelection(blockId);
      syncTextBlock(blockId);
    });
  }

  async function exportPdf() {
    if (!exportRef.current) {
      return;
    }

    setIsExporting("pdf");

    try {
      const imageUrl = await toPng(exportRef.current, {
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

      const pdf = new jsPDF({
        orientation: image.width > image.height ? "landscape" : "portrait",
        unit: "pt",
        format: "a4"
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageWidth / image.width, pageHeight / image.height);
      const renderWidth = image.width * ratio;
      const renderHeight = image.height * ratio;

      pdf.addImage(
        imageUrl,
        "PNG",
        (pageWidth - renderWidth) / 2,
        20,
        renderWidth,
        renderHeight
      );
      pdf.save(`${safeFileName(state.title) || "maths-facile"}.pdf`);
    } finally {
      setIsExporting(null);
    }
  }

  async function exportWord() {
    if (!exportRef.current) {
      return;
    }

    setIsExporting("word");

    try {
      const blob = await toBlob(exportRef.current, {
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

      const maxWidth = 520;
      const ratio = maxWidth / image.width;
      const height = Math.max(280, Math.round(image.height * ratio));

      const documentFile = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                spacing: { after: 180 },
                children: [new TextRun({ text: state.title, bold: true, size: 34 })]
              }),
              new Paragraph({
                spacing: { after: 160 },
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
                    data: arrayBuffer,
                    type: "png",
                    transformation: { width: maxWidth, height }
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

  function openBlockEditor(blockId: string) {
    const block = findBlock(blockId);

    if (!block || block.type === "text") {
      return;
    }

    setActiveBlockId(blockId);
    setModalState({
      mode: "edit",
      block: { ...block },
      anchorBlockId: blockId
    });
  }

  function closeBlockEditor() {
    setModalState(null);
  }

  function getBlockTitle(block: DocumentBlock) {
    return getStructuredBlockTitle(block);
  }

  function applyModalBlock() {
    if (!modalState) {
      return;
    }

    if (modalState.mode === "editInline") {
      const chip = findInlineChip(modalState.anchorBlockId, modalState.chipId);

      if (chip) {
        const currentData = readInlineChipData(chip);
        const width = currentData?.width ?? getDefaultInlineWidth(modalState.block.type);
        updateInlineChipElement(chip, modalState.block, width);
        syncTextBlock(modalState.anchorBlockId);
        setSelectedInlineChip({
          blockId: modalState.anchorBlockId,
          chipId: modalState.chipId,
          block: modalState.block,
          width
        });
      }

      closeBlockEditor();
      return;
    }

    if (modalState.mode === "edit") {
      setState((current) => ({
        ...current,
        blocks: current.blocks.map((block) =>
          block.id === modalState.block.id ? modalState.block : block
        )
      }));
      setActiveBlockId(modalState.block.id);
      closeBlockEditor();
      return;
    }

    insertStructuredImageAtCursor(modalState.block);
    closeBlockEditor();
  }

  function renderTextBlock(block: TextBlock, isExport = false) {
    if (isExport) {
      return (
        <div
          className="export-text-block"
          dangerouslySetInnerHTML={{
            __html: block.html || "<p></p>"
          }}
        />
      );
    }

    return (
      <section
        key={block.id}
        className={`document-card text-card ${activeBlockId === block.id ? "card-active" : ""}`}
        onClick={() => setActiveBlockId(block.id)}
      >
        <div className="card-head">
          <div>
            <p className="card-kind">Texte libre</p>
            <h2>Zone d&apos;écriture</h2>
          </div>
        </div>

        <div
          ref={(node) => {
            textBlockRefs.current[block.id] = node;
          }}
          className={`rich-text-block ${dragOverTextBlockId === block.id ? "rich-text-block-dragover" : ""}`}
          contentEditable
          suppressContentEditableWarning
          data-block-id={block.id}
          data-empty={isHtmlEmpty(block.html) ? "true" : "false"}
          onMouseDown={(event) => handleTextMouseDown(block.id, event)}
          onDoubleClick={(event) => handleTextDoubleClick(block.id, event)}
          onInput={() => handleTextInput(block.id)}
          onFocus={() => saveSelection(block.id)}
          onMouseUp={(event) => handleTextMouseUp(block.id, event)}
          onKeyUp={() => saveSelection(block.id)}
          onPaste={(event) => handleTextPaste(block.id, event)}
          onKeyDown={(event) => handleTextKeyDown(block.id, event)}
          onDragOver={(event) => handleTextDragOver(block.id, event)}
          onDragLeave={(event) => handleTextDragLeave(block.id, event)}
          onDrop={(event) => handleTextDrop(block.id, event)}
        />
      </section>
    );
  }

  function renderMathCard(
    block: DocumentBlock,
    title: string,
    content: ReactElement,
    isExport = false
  ) {
    if (isExport) {
      return (
        <section className="export-math-block">
          <div className="export-math-head">
            <span>{title}</span>
          </div>
          {content}
        </section>
      );
    }

    return (
      <section
        key={block.id}
        className={`document-card math-card ${activeBlockId === block.id ? "card-active" : ""}`}
        onClick={() => setActiveBlockId(block.id)}
      >
        <div className="card-head">
          <div>
            <p className="card-kind">Bloc guidé</p>
            <h2>{title}</h2>
          </div>
          <div className="card-actions">
            <button type="button" className="small-action" onClick={() => openBlockEditor(block.id)}>
              Modifier
            </button>
            <button type="button" className="small-action" onClick={() => insertTextBlockAfter(block.id)}>
              Texte après
            </button>
            <button type="button" className="small-action" onClick={() => removeBlock(block.id)}>
              Supprimer
            </button>
          </div>
        </div>

        {content}
      </section>
    );
  }

  function renderFractionBlock(block: FractionBlock, isExport = false) {
    const content = (
      <div className="math-layout fraction-layout">
        <div className="fraction-preview">
          <div className="fraction-line top">{block.numerator || "numérateur"}</div>
          <div className="fraction-bar" />
          <div className="fraction-line">{block.denominator || "dénominateur"}</div>
        </div>
        {block.simplified ? <p className="math-result">Résultat : {block.simplified}</p> : null}
        {block.caption ? <p className="math-caption">{block.caption}</p> : null}
      </div>
    );

    return renderMathCard(block, "Fraction posée", content, isExport);
  }

  function renderDivisionBlock(block: DivisionBlock, isExport = false) {
    const content = (
      <div className="math-layout division-layout">
        <div className="division-sheet">
          <div className="division-quotient">{block.quotient || "quotient"}</div>
          <div className="division-body">
            <div className="division-divisor">{block.divisor || "diviseur"}</div>
            <div className="division-dividend">{block.dividend || "dividende"}</div>
          </div>
          <div className="division-remainder">
            {block.remainder ? `Reste : ${block.remainder}` : "reste"}
          </div>
        </div>
        {block.caption ? <p className="math-caption">{block.caption}</p> : null}
      </div>
    );

    return renderMathCard(block, "Division posée", content, isExport);
  }

  function renderPowerBlock(block: PowerBlock, isExport = false) {
    const content = (
      <div className="math-layout power-layout">
        <p className="power-preview">
          <span>{block.base || "base"}</span>
          <sup>{block.exponent || "exposant"}</sup>
        </p>
        {block.result ? <p className="math-result">Résultat : {block.result}</p> : null}
        {block.caption ? <p className="math-caption">{block.caption}</p> : null}
      </div>
    );

    return renderMathCard(block, "Puissance", content, isExport);
  }

  function renderRootBlock(block: RootBlock, isExport = false) {
    const content = (
      <div className="math-layout root-layout">
        <div className="root-preview">
          <span className="root-symbol">√</span>
          <span className="root-radicand">{block.radicand || "radicande"}</span>
        </div>
        {block.result ? <p className="math-result">Résultat : {block.result}</p> : null}
        {block.caption ? <p className="math-caption">{block.caption}</p> : null}
      </div>
    );

    return renderMathCard(block, "Racine", content, isExport);
  }

  function renderBlock(block: DocumentBlock, isExport = false) {
    if (block.type === "text") {
      return renderTextBlock(block, isExport);
    }

    if (block.type === "fraction") {
      return renderFractionBlock(block, isExport);
    }

    if (block.type === "division") {
      return renderDivisionBlock(block, isExport);
    }

    if (block.type === "power") {
      return renderPowerBlock(block, isExport);
    }

    return renderRootBlock(block, isExport);
  }

  const modalBlock = modalState?.block ?? null;

  function renderModalFields(block: DocumentBlock) {
    if (block.type === "fraction") {
      return (
        <div className="math-editor-grid">
          <label>
            <span>Numérateur</span>
            <input
              value={block.numerator}
              onChange={(event) => updateModalBlockField("numerator", event.target.value)}
              placeholder="3x + 2"
            />
          </label>
          <label>
            <span>Dénominateur</span>
            <input
              value={block.denominator}
              onChange={(event) => updateModalBlockField("denominator", event.target.value)}
              placeholder="5"
            />
          </label>
          <label>
            <span>Résultat simplifié</span>
            <input
              value={block.simplified}
              onChange={(event) => updateModalBlockField("simplified", event.target.value)}
              placeholder="7/5"
            />
          </label>
          <label>
            <span>Consigne ou remarque</span>
            <input
              value={block.caption}
              onChange={(event) => updateModalBlockField("caption", event.target.value)}
              placeholder="Je simplifie la fraction"
            />
          </label>
        </div>
      );
    }

    if (block.type === "division") {
      return (
        <div className="math-editor-grid">
          <label>
            <span>Dividende</span>
            <input
              value={block.dividend}
              onChange={(event) => updateModalBlockField("dividend", event.target.value)}
              placeholder="245"
            />
          </label>
          <label>
            <span>Diviseur</span>
            <input
              value={block.divisor}
              onChange={(event) => updateModalBlockField("divisor", event.target.value)}
              placeholder="7"
            />
          </label>
          <label>
            <span>Quotient</span>
            <input
              value={block.quotient}
              onChange={(event) => updateModalBlockField("quotient", event.target.value)}
              placeholder="35"
            />
          </label>
          <label>
            <span>Reste</span>
            <input
              value={block.remainder}
              onChange={(event) => updateModalBlockField("remainder", event.target.value)}
              placeholder="0"
            />
          </label>
          <label className="wide-field">
            <span>Consigne ou remarque</span>
            <input
              value={block.caption}
              onChange={(event) => updateModalBlockField("caption", event.target.value)}
              placeholder="Je vérifie avec 35 × 7"
            />
          </label>
        </div>
      );
    }

    if (block.type === "power") {
      return (
        <div className="math-editor-grid">
          <label>
            <span>Base</span>
            <input
              value={block.base}
              onChange={(event) => updateModalBlockField("base", event.target.value)}
              placeholder="2"
            />
          </label>
          <label>
            <span>Exposant</span>
            <input
              value={block.exponent}
              onChange={(event) => updateModalBlockField("exponent", event.target.value)}
              placeholder="3"
            />
          </label>
          <label>
            <span>Résultat</span>
            <input
              value={block.result}
              onChange={(event) => updateModalBlockField("result", event.target.value)}
              placeholder="8"
            />
          </label>
          <label>
            <span>Consigne ou remarque</span>
            <input
              value={block.caption}
              onChange={(event) => updateModalBlockField("caption", event.target.value)}
              placeholder="Carré, cube, puissance n"
            />
          </label>
        </div>
      );
    }

    if (block.type !== "root") {
      return null;
    }

    return (
      <div className="math-editor-grid">
        <label>
          <span>Radicande</span>
          <input
            value={block.radicand}
            onChange={(event) => updateModalBlockField("radicand", event.target.value)}
            placeholder="49"
          />
        </label>
        <label>
          <span>Résultat</span>
          <input
            value={block.result}
            onChange={(event) => updateModalBlockField("result", event.target.value)}
            placeholder="7"
          />
        </label>
        <label className="wide-field">
          <span>Consigne ou remarque</span>
          <input
            value={block.caption}
            onChange={(event) => updateModalBlockField("caption", event.target.value)}
            placeholder="Racine carrée"
          />
        </label>
      </div>
    );
  }

  return (
    <main className="editor-shell">
      <header className="top-toolbar">
        <div className="toolbar-main-row">
          <div className="toolbar-brand">
            <p className="toolbar-eyebrow">Maths facile</p>
            <label className="document-title-field">
              <span>Titre</span>
              <input
                value={state.title}
                onChange={(event) => updateTitle(event.target.value)}
                placeholder="Mon document de maths"
              />
            </label>
          </div>

          <div className="toolbar-side">
            <div className="mode-switch" aria-label="Choix du mode">
              <button
                type="button"
                className={state.mode === "college" ? "mode-active" : ""}
                onClick={() => updateMode("college")}
                aria-pressed={state.mode === "college"}
              >
                Collège
              </button>
              <button
                type="button"
                className={state.mode === "lycee" ? "mode-active" : ""}
                onClick={() => updateMode("lycee")}
                aria-pressed={state.mode === "lycee"}
              >
                Lycée
              </button>
            </div>

            <div className="toolbar-actions">
              <button
                type="button"
                className="toolbar-action primary"
                onClick={exportPdf}
                disabled={isExporting !== null}
              >
                {isExporting === "pdf" ? "Création PDF..." : "PDF"}
              </button>
              <button
                type="button"
                className="toolbar-action secondary"
                onClick={exportWord}
                disabled={isExporting !== null}
              >
                {isExporting === "word" ? "Création Word..." : "Word"}
              </button>
              <button type="button" className="toolbar-action ghost" onClick={() => window.print()}>
                Imprimer
              </button>
              <button type="button" className="toolbar-action ghost" onClick={resetDocument}>
                Nouveau
              </button>
            </div>
          </div>
        </div>

        <div className="toolbar-tab-row">
          <button
            type="button"
            className={toolbarPanel === "text" ? "tab-active" : ""}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setToolbarPanel("text")}
          >
            Texte
          </button>
          <button
            type="button"
            className={toolbarPanel === "math" ? "tab-active" : ""}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setToolbarPanel("math")}
          >
            Maths
          </button>
          <p className="toolbar-helper">
            Le texte reste libre. Les blocs guidés servent à poser proprement une fraction, une division, une puissance ou une racine.
          </p>
        </div>

        {selectedInlineChip ? (
          <section className="toolbar-panel inline-chip-toolbar" aria-label="Bloc maths sélectionné">
            <div className="panel-block">
              <h2>{getBlockTitle(selectedInlineChip.block)}</h2>
              <p className="toolbar-helper">
                Fais glisser le bloc dans le texte pour le déplacer. Double-clique dessus pour modifier son contenu.
              </p>
            </div>
            <div className="panel-chip-row">
              <button
                type="button"
                className="chip-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => resizeSelectedInlineChip(selectedInlineChip.width - INLINE_WIDTH_STEP)}
              >
                Plus petit
              </button>
              <button
                type="button"
                className="chip-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  resizeSelectedInlineChip(getDefaultInlineWidth(selectedInlineChip.block.type))
                }
              >
                Taille normale
              </button>
              <button
                type="button"
                className="chip-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => resizeSelectedInlineChip(selectedInlineChip.width + INLINE_WIDTH_STEP)}
              >
                Plus grand
              </button>
              <button
                type="button"
                className="chip-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const chip = findInlineChip(selectedInlineChip.blockId, selectedInlineChip.chipId);

                  if (chip) {
                    openInlineChipEditor(selectedInlineChip.blockId, chip);
                  }
                }}
              >
                Modifier
              </button>
            </div>
          </section>
        ) : null}

        {toolbarPanel === "text" ? (
          <section className="toolbar-panel" aria-label="Outils de texte">
            <div className="panel-block">
              <h2>Texte</h2>
              <div className="panel-chip-row">
                <button
                  type="button"
                  className="chip-button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runCommand("bold")}
                >
                  Gras
                </button>
                <button
                  type="button"
                  className="chip-button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runCommand("removeFormat")}
                >
                  Effacer le style
                </button>
              </div>
            </div>

            <div className="panel-block">
              <h2>Taille</h2>
              <div className="panel-chip-row">
                {FONT_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="chip-button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runCommand("fontSize", option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="panel-block">
              <h2>Couleur</h2>
              <div className="color-row">
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
            </div>
          </section>
        ) : (
          <section className="toolbar-panel toolbar-panel-compact" aria-label="Outils de maths">
            <div className="panel-block">
              <h2>Blocs posés</h2>
              <div className="shortcut-row">
                {activeStructuredTools.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className="shortcut-chip"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertStructuredBlock(tool.id)}
                  >
                    <span>{tool.label}</span>
                    <small>{tool.hint}</small>
                  </button>
                ))}
              </div>
            </div>

            {activeInlineShortcuts.map((group) => (
              <div key={group.name} className="panel-block">
                <h2>{group.name}</h2>
                <div className="shortcut-row">
                  {group.items.map((shortcut) => (
                    <button
                      key={shortcut.id}
                      type="button"
                      className="shortcut-chip"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertTextAtCursor(shortcut.content)}
                    >
                      <span>{shortcut.label}</span>
                      <small>{shortcut.hint}</small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </header>

      <section className="editor-stage">
        <div className="editor-sheet">
          <div className="editor-sheet-head">
            <div>
              <p className="editor-sheet-badge">
                {state.mode === "college" ? "Mode collège" : "Mode lycée"}
              </p>
              <h1>{state.title || "Document sans titre"}</h1>
            </div>
            <p className="editor-sheet-note">
              Clique dans une zone de texte pour écrire librement. Les blocs maths s&apos;ajoutent au document et restent bien posés à l&apos;impression.
            </p>
          </div>

          <div className="document-stack">
            {state.blocks.map((block) => renderBlock(block, false))}
          </div>
        </div>
      </section>

      {modalBlock ? (
        <div className="modal-backdrop" role="presentation" onClick={closeBlockEditor}>
          <section
            className="block-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="block-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="block-modal-head">
              <div>
                <p className="card-kind">Bloc guidé</p>
                <h2 id="block-modal-title">{getBlockTitle(modalBlock)}</h2>
              </div>
              <div className="card-actions">
                <button type="button" className="small-action" onClick={closeBlockEditor}>
                  Annuler
                </button>
                <button type="button" className="small-action primary-inline-action" onClick={applyModalBlock}>
                  {modalState?.mode === "insert" ? "Insérer" : "Enregistrer"}
                </button>
              </div>
            </div>

            {renderModalFields(modalBlock)}

            <div className="block-modal-preview">{renderBlock(modalBlock, true)}</div>
          </section>
        </div>
      ) : null}

      <div className="export-clone" aria-hidden="true">
        <div className="export-sheet" ref={exportRef}>
          <header className="export-head">
            <p className="editor-sheet-badge">
              {state.mode === "college" ? "Mode collège" : "Mode lycée"}
            </p>
            <h2>{state.title || "Document sans titre"}</h2>
          </header>

          <div className="export-stack">
            {state.blocks.map((block) => (
              <div key={`export-${block.id}`}>{renderBlock(block, true)}</div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
