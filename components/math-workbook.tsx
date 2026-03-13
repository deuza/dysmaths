"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toBlob, toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";

type StudyMode = "college" | "lycee";
type ToolbarPanel = "text" | "math";

type ShortcutItem = {
  id: string;
  label: string;
  hint: string;
  content: string;
  modes: StudyMode[];
};

type ShortcutGroup = {
  name: string;
  items: ShortcutItem[];
};

type WriterState = {
  title: string;
  mode: StudyMode;
  content: string;
};

const STORAGE_KEY = "maths-facile-rich-writer-v1";

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: "Essentiels",
    items: [
      {
        id: "fraction",
        label: "Fraction",
        hint: "Insère a/b",
        content: "a/b",
        modes: ["college", "lycee"]
      },
      {
        id: "power",
        label: "Puissance",
        hint: "Insère a^n",
        content: "a^n",
        modes: ["college", "lycee"]
      },
      {
        id: "root",
        label: "Racine",
        hint: "Insère √(a)",
        content: "√(a)",
        modes: ["college", "lycee"]
      },
      {
        id: "division",
        label: "Division",
        hint: "Insère ÷",
        content: " ÷ ",
        modes: ["college", "lycee"]
      },
      {
        id: "times",
        label: "Produit",
        hint: "Insère ×",
        content: " × ",
        modes: ["college", "lycee"]
      },
      {
        id: "percent",
        label: "Pourcentage",
        hint: "Insère %",
        content: "%",
        modes: ["college", "lycee"]
      },
      {
        id: "pi",
        label: "Pi",
        hint: "Insère π",
        content: "π",
        modes: ["college", "lycee"]
      },
      {
        id: "degree",
        label: "Degré",
        hint: "Insère °",
        content: "°",
        modes: ["college", "lycee"]
      }
    ]
  },
  {
    name: "Comparer",
    items: [
      {
        id: "equal",
        label: "Égal",
        hint: "Insère =",
        content: " = ",
        modes: ["college", "lycee"]
      },
      {
        id: "neq",
        label: "Différent",
        hint: "Insère ≠",
        content: " ≠ ",
        modes: ["college", "lycee"]
      },
      {
        id: "leq",
        label: "Inférieur ou égal",
        hint: "Insère ≤",
        content: " ≤ ",
        modes: ["college", "lycee"]
      },
      {
        id: "geq",
        label: "Supérieur ou égal",
        hint: "Insère ≥",
        content: " ≥ ",
        modes: ["college", "lycee"]
      },
      {
        id: "approx",
        label: "Approché",
        hint: "Insère ≈",
        content: " ≈ ",
        modes: ["college", "lycee"]
      }
    ]
  },
  {
    name: "Collège",
    items: [
      {
        id: "angle",
        label: "Angle",
        hint: "∠ABC = 40°",
        content: "∠ABC = 40°",
        modes: ["college", "lycee"]
      },
      {
        id: "segment",
        label: "Segment",
        hint: "[AB] = 5 cm",
        content: "[AB] = 5 cm",
        modes: ["college", "lycee"]
      },
      {
        id: "parallel",
        label: "Parallèle",
        hint: "(AB) ∥ (CD)",
        content: "(AB) ∥ (CD)",
        modes: ["college", "lycee"]
      },
      {
        id: "perpendicular",
        label: "Perpendiculaire",
        hint: "(AB) ⟂ (CD)",
        content: "(AB) ⟂ (CD)",
        modes: ["college", "lycee"]
      },
      {
        id: "probability",
        label: "Probabilité",
        hint: "P(A) = 3/10",
        content: "P(A) = 3/10",
        modes: ["college", "lycee"]
      }
    ]
  },
  {
    name: "Lycée",
    items: [
      {
        id: "function",
        label: "Fonction",
        hint: "f(x) =",
        content: "f(x) = ",
        modes: ["lycee"]
      },
      {
        id: "limit",
        label: "Limite",
        hint: "lim(x→a)",
        content: "lim(x→a)",
        modes: ["lycee"]
      },
      {
        id: "sum",
        label: "Somme",
        hint: "Σ(k=1→n)",
        content: "Σ(k=1→n)",
        modes: ["lycee"]
      },
      {
        id: "integral",
        label: "Intégrale",
        hint: "∫[a;b]",
        content: "∫[a;b]",
        modes: ["lycee"]
      },
      {
        id: "trigonometry",
        label: "Trigonométrie",
        hint: "sin(x)",
        content: "sin(x)",
        modes: ["lycee"]
      },
      {
        id: "ln",
        label: "Ln",
        hint: "ln(x)",
        content: "ln(x)",
        modes: ["lycee"]
      }
    ]
  }
];

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

const DEFAULT_CONTENT = [
  "<p><strong>Commence ici :</strong> écris une réponse, une idée ou une formule.</p>",
  "<p>Exemple : aire du disque = π × r^2</p>"
].join("");

const DEFAULT_STATE: WriterState = {
  title: "Mon document de maths",
  mode: "college",
  content: DEFAULT_CONTENT
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

function isEditorActuallyEmpty(element: HTMLDivElement | null) {
  if (!element) {
    return true;
  }

  const text = element.textContent?.replace(/\u200B/g, "").trim() ?? "";
  return text.length === 0;
}

export function MathWorkbook() {
  const [state, setState] = useState<WriterState>(DEFAULT_STATE);
  const [toolbarPanel, setToolbarPanel] = useState<ToolbarPanel>("math");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isExporting, setIsExporting] = useState<"pdf" | "word" | null>(null);
  const [isEditorEmpty, setIsEditorEmpty] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<Range | null>(null);

  const activeShortcutGroups = useMemo(
    () =>
      SHORTCUT_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.modes.includes(state.mode))
      })).filter((group) => group.items.length > 0),
    [state.mode]
  );

  useEffect(() => {
    setIsHydrated(true);

    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);

      if (!saved) {
        return;
      }

      const parsed = JSON.parse(saved) as WriterState;

      if (
        typeof parsed.title === "string" &&
        (parsed.mode === "college" || parsed.mode === "lycee") &&
        typeof parsed.content === "string"
      ) {
        setState(parsed);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [isHydrated, state]);

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    if (editor.innerHTML !== state.content) {
      editor.innerHTML = state.content;
    }

    setIsEditorEmpty(isEditorActuallyEmpty(editor));
  }, [state.content]);

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

  function focusEditor(moveToEnd = false) {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    editor.focus();

    if (!moveToEnd) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);

    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    selection.removeAllRanges();
    selection.addRange(range);
    selectionRef.current = range.cloneRange();
  }

  function restoreSelection() {
    const selection = window.getSelection();

    if (!selection || !selectionRef.current) {
      return;
    }

    selection.removeAllRanges();
    selection.addRange(selectionRef.current);
  }

  function syncEditorContent() {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    if (isEditorActuallyEmpty(editor)) {
      editor.innerHTML = "";
      setIsEditorEmpty(true);
      setState((current) => ({
        ...current,
        content: ""
      }));
      return;
    }

    const html = editor.innerHTML;
    setIsEditorEmpty(false);
    setState((current) => ({
      ...current,
      content: html
    }));
  }

  function runCommand(command: string, value?: string) {
    focusEditor();
    restoreSelection();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
    syncEditorContent();
    saveSelection();
  }

  function insertAtCursor(content: string) {
    focusEditor();
    restoreSelection();

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      focusEditor(true);
      insertAtCursor(content);
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

    syncEditorContent();
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const pastedText = event.clipboardData.getData("text/plain");
    insertAtCursor(pastedText);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      event.preventDefault();
      insertAtCursor("    ");
      return;
    }

    window.requestAnimationFrame(() => {
      saveSelection();
      syncEditorContent();
    });
  }

  function handleInput() {
    syncEditorContent();
    saveSelection();
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

  function resetDocument() {
    setState(DEFAULT_STATE);
    setToolbarPanel("math");
    selectionRef.current = null;

    if (editorRef.current) {
      editorRef.current.innerHTML = DEFAULT_STATE.content;
    }

    window.localStorage.removeItem(STORAGE_KEY);
    window.requestAnimationFrame(() => {
      focusEditor(true);
      setIsEditorEmpty(false);
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
                children: [
                  new TextRun({
                    text: state.title,
                    bold: true,
                    size: 34
                  })
                ]
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
                    transformation: {
                      width: maxWidth,
                      height
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
            Sélectionne du texte pour le mettre en gras, changer sa taille ou sa couleur.
          </p>
        </div>

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
          <section className="toolbar-panel" aria-label="Raccourcis de maths">
            {activeShortcutGroups.map((group) => (
              <div key={group.name} className="panel-block">
                <h2>{group.name}</h2>
                <div className="shortcut-row">
                  {group.items.map((shortcut) => (
                    <button
                      key={shortcut.id}
                      type="button"
                      className="shortcut-chip"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertAtCursor(shortcut.content)}
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
              Écris librement. Les boutons du haut insèrent les symboles là où se trouve le curseur.
            </p>
          </div>

          <div
            ref={editorRef}
            className="rich-editor"
            contentEditable
            suppressContentEditableWarning
            data-empty={isEditorEmpty ? "true" : "false"}
            onInput={handleInput}
            onFocus={saveSelection}
            onMouseUp={saveSelection}
            onKeyUp={saveSelection}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
          />
        </div>
      </section>

      <div className="export-clone" aria-hidden="true">
        <div className="export-sheet" ref={exportRef}>
          <header className="export-head">
            <p className="editor-sheet-badge">
              {state.mode === "college" ? "Mode collège" : "Mode lycée"}
            </p>
            <h2>{state.title || "Document sans titre"}</h2>
          </header>

          <div
            className="export-editor-content"
            dangerouslySetInnerHTML={{
              __html: state.content || "<p></p>"
            }}
          />
        </div>
      </div>
    </main>
  );
}
