/**
 * Between formatted runs and the HTML the in-place editor uses.
 *
 * Editing happens in a contentEditable box, because that is the only way to
 * get a caret, selection and a keyboard for free. The model stays the runs
 * (lib/richText.js): the editor is drawn from them, and whatever the browser
 * leaves in the box is read back into them, keeping only the marks Morphly
 * knows. Anything else pasted in (fonts, sizes, classes, images) is dropped.
 */

import { mergeRuns } from "./richText";

const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** The marks a tag stands for, when reading HTML back. */
const TAG_MARKS = {
  B: { bold: true },
  STRONG: { bold: true },
  I: { italic: true },
  EM: { italic: true },
  U: { underline: true },
  S: { strike: true },
  STRIKE: { strike: true },
  DEL: { strike: true },
  SUB: { baseline: "sub" },
  SUP: { baseline: "super" },
};

/** Tags that start a new line when read back. */
const BLOCK_TAGS = new Set(["DIV", "P", "LI"]);

/** HTML for the editor: one tag per mark, innermost first. */
export function htmlFromRuns(runs) {
  if (!runs.length) return "";
  return runs
    .map((run) => {
      let html = escapeHtml(run.text).replace(/\n/g, "<br>");
      if (run.baseline === "sub") html = `<sub>${html}</sub>`;
      if (run.baseline === "super") html = `<sup>${html}</sup>`;
      if (run.strike) html = `<s>${html}</s>`;
      if (run.underline) html = `<u>${html}</u>`;
      if (run.italic) html = `<i>${html}</i>`;
      if (run.bold) html = `<b>${html}</b>`;
      if (run.color) html = `<span style="color: ${run.color}">${html}</span>`;
      return html;
    })
    .join("");
}

/** A colour from a style attribute or a font tag, as a hex string or null. */
function colourOf(node) {
  const value = node.style?.color || node.getAttribute?.("color") || "";
  const text = String(value).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(text);
  if (!rgb) return null;
  const hex = (n) => Number(n).toString(16).padStart(2, "0");
  return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
}

/**
 * Read a node tree (the editor's contents) back into runs.
 *
 * Works on anything shaped like a DOM node, so it can be tested without a
 * window: text nodes are { nodeType: 3, data }, elements are
 * { nodeType: 1, nodeName, childNodes, style }.
 */
export function runsFromNode(root) {
  const runs = [];
  let pendingBreak = false;

  const walk = (node, marks) => {
    if (node.nodeType === 3) {
      const text = String(node.data ?? node.nodeValue ?? "").replace(/ /g, " ");
      if (text === "") return;
      runs.push({ ...marks, text: (pendingBreak ? "\n" : "") + text });
      pendingBreak = false;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = String(node.nodeName ?? "").toUpperCase();
    if (tag === "BR") {
      // A <br> as the last thing in the box is how browsers keep an empty
      // line editable; a real newline only counts when text follows.
      pendingBreak = true;
      return;
    }
    const next = { ...marks, ...(TAG_MARKS[tag] ?? {}) };
    const colour = colourOf(node);
    if (colour) next.color = colour;
    if (BLOCK_TAGS.has(tag) && runs.length) pendingBreak = true;
    for (const child of node.childNodes ?? []) walk(child, next);
  };

  for (const child of root?.childNodes ?? []) walk(child, {});
  return mergeRuns(runs);
}

/** Plain text of a node tree, matching what runsFromNode reads. */
export const textFromNode = (root) => runsFromNode(root).map((r) => r.text).join("");
