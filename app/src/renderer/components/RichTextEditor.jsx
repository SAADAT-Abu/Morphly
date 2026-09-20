/**
 * Editing formatted text in place on the canvas.
 *
 * The box is a contentEditable, which is the only way to get a caret, a
 * selection and the usual keys for free, laid over the canvas at the text's
 * own position and scaled to the zoom, so what you type looks like what you
 * get. Marks are applied to the selection by the browser's own editing
 * commands, and after every change the box is read back into Morphly's runs
 * (lib/richTextHtml.js), which stay the thing that is saved and drawn.
 *
 * A small toolbar floats above it, because Ctrl+B is not discoverable and
 * superscript, subscript and colour have no obvious keys at all.
 */

import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { htmlFromRuns, runsFromNode } from "../lib/richTextHtml";
import { runsOf, withBase, baseMarks, plainText } from "../lib/richText";
import { fontString } from "../lib/textMeasure";

/** Toolbar buttons: the editing command each one runs. */
const TOOLS = [
  ["bold", "B", "Bold (Ctrl+B)", { fontWeight: 700 }],
  ["italic", "I", "Italic (Ctrl+I)", { fontStyle: "italic" }],
  ["underline", "U", "Underline (Ctrl+U)", { textDecoration: "underline" }],
  ["strikeThrough", "S", "Strikethrough", { textDecoration: "line-through" }],
  ["superscript", "x²", "Superscript (Ctrl+Shift+=)", {}],
  ["subscript", "x₂", "Subscript (Ctrl+=)", {}],
];

export default function RichTextEditor({ element, field, zoom, stagePos, onClose }) {
  const setRichText = useStore((s) => s.setRichText);
  const boxRef = useRef(null);
  const started = useRef(false);
  const [, forceUpdate] = useState(0);

  const isLabel = field === "label";
  const runsField = isLabel ? "labelRuns" : "runs";
  const base = isLabel ? {} : baseMarks(element.fontStyle);
  const fontSize = (isLabel ? element.labelSize ?? 16 : element.fontSize) * zoom;
  const fontFamily = isLabel ? element.labelFont ?? "Helvetica" : element.fontFamily;

  // The editor is filled once: after that the browser owns the box, and
  // Morphly reads it back on every change.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.innerHTML = htmlFromRuns(withBase(runsOf(element, { text: field, runs: runsField }), base));
    try {
      // Prefer <b> and <i> over style attributes, which read back cleanly.
      document.execCommand("styleWithCSS", false, false);
    } catch {
      /* an old engine without it still edits, just with style attributes */
    }
    box.focus();
    const range = document.createRange();
    range.selectNodeContents(box);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    const box = boxRef.current;
    if (!box) return;
    const runs = runsFromNode(box);
    setRichText(
      element.id,
      { text: plainText(runs), runs, field, resetStyle: base.bold || base.italic },
      { commit: !started.current }
    );
    started.current = true;
  };

  const run = (command, value = null) => {
    boxRef.current?.focus();
    try {
      document.execCommand(command, false, value);
    } catch {
      /* nothing to do: the text is unchanged */
    }
    save();
    forceUpdate((n) => n + 1);
  };

  const active = (command) => {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };

  const style = isLabel
    ? {
        left: stagePos.x + element.x * zoom,
        top: stagePos.y + element.y * zoom,
        width: element.width * zoom,
        height: element.height * zoom,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        color: element.labelColor ?? "#ffffff",
      }
    : {
        left: stagePos.x + element.x * zoom,
        top: stagePos.y + element.y * zoom,
        width: element.width * zoom,
        textAlign: element.align,
        color: element.fill,
      };

  return (
    <>
      <div
        className="rich-toolbar"
        style={{ left: style.left, top: Math.max(4, style.top - 38) }}
        onMouseDown={(e) => e.preventDefault()}
      >
        {TOOLS.map(([command, glyph, title, css]) => (
          <button
            key={command}
            className={`tool${active(command) ? " active" : ""}`}
            title={title}
            aria-label={title}
            aria-pressed={active(command)}
            style={css}
            onClick={() => run(command)}
          >
            {glyph}
          </button>
        ))}
        <label className="rich-colour" title="Colour of the selected text">
          <span aria-hidden="true">A</span>
          <input
            type="color"
            aria-label="Colour of the selected text"
            defaultValue={(isLabel ? element.labelColor : element.fill) ?? "#111111"}
            onChange={(e) => run("foreColor", e.target.value)}
          />
        </label>
      </div>

      <div
        ref={boxRef}
        className="text-overlay rich-overlay"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={isLabel ? "Caption" : "Text"}
        spellCheck={false}
        style={{
          ...style,
          font: fontString(fontSize, { fontFamily }),
          lineHeight: isLabel ? 1.2 : element.lineHeight ?? 1.25,
        }}
        onInput={save}
        onBlur={() => {
          save();
          onClose();
        }}
        onPaste={(e) => {
          // Paste the words, not someone else's fonts and colours.
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          if (mod && e.key === "Enter") {
            e.preventDefault();
            save();
            onClose();
            return;
          }
          if (mod && (e.key === "=" || e.key === "+")) {
            e.preventDefault();
            run(e.shiftKey ? "superscript" : "subscript");
            return;
          }
          // Ctrl+B, Ctrl+I and Ctrl+U are the browser's own in an editable
          // box; they only need to reach the model, which onInput does.
          e.stopPropagation();
        }}
        onKeyUp={() => forceUpdate((n) => n + 1)}
        onMouseUp={() => forceUpdate((n) => n + 1)}
      />
    </>
  );
}
