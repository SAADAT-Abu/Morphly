/**
 * Text with formatting inside it: italic gene names, CO2 and 10^-3, a word
 * coloured to match the thing it labels.
 *
 * Konva draws one style per text node, so Morphly lays text out itself. A text
 * element keeps its plain `text` exactly as before, plus optional `runs`:
 * stretches of characters carrying marks. The concatenation of the runs is
 * always the plain text, so anything that only wants the words (search,
 * measuring, an older Morphly) still works.
 *
 *   { text: "CO", }              plain
 *   { text: "2", baseline: "sub" }
 *
 * Marks: bold, italic, underline, strike, baseline ("super" | "sub") and
 * color. One layout function decides where every piece sits, and the canvas,
 * the SVG exporter and the PDF all draw from it, so they cannot drift apart.
 *
 * Everything here is pure: text widths come from a `measure` function the
 * caller supplies, so it runs under the unit tests without a window.
 */

/** Marks a run can carry. `color` is a hex string; `baseline` sub or super. */
export const MARKS = ["bold", "italic", "underline", "strike", "baseline", "color"];

/** How much smaller a superscript or subscript is, and how far it shifts. */
export const SMALL = 0.72;
export const SUPER_RISE = 0.34;
export const SUB_DROP = 0.16;

const isMarked = (run) => MARKS.some((m) => run[m]);

/** The plain text of a list of runs. */
export const plainText = (runs) => (runs ?? []).map((r) => r.text).join("");

/** Runs for an element, falling back to one plain run for its text. */
export function runsOf(element, { text = "text", runs = "runs" } = {}) {
  const plain = String(element?.[text] ?? "");
  const stored = element?.[runs];
  if (!Array.isArray(stored) || stored.length === 0) return plain === "" ? [] : [{ text: plain }];
  // The plain text wins if the two ever disagree, so nothing can be lost.
  if (plainText(stored) !== plain) return plain === "" ? [] : [{ text: plain }];
  return stored.filter((r) => r.text !== "");
}

/** Only the marks of a run, without its text. */
const marksOf = (run) => {
  const out = {};
  for (const m of MARKS) if (run[m]) out[m] = run[m];
  return out;
};

const sameMarks = (a, b) => MARKS.every((m) => (a[m] ?? false) === (b[m] ?? false));

/** Join neighbouring runs that carry the same marks, and drop empty ones. */
export function mergeRuns(runs) {
  const out = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, run)) last.text += run.text;
    else out.push({ ...marksOf(run), text: run.text });
  }
  return out;
}

/** Split the runs at a character offset, returning [before, after]. */
function splitAt(runs, offset) {
  const before = [];
  const after = [];
  let at = 0;
  for (const run of runs) {
    const end = at + run.text.length;
    if (end <= offset) before.push(run);
    else if (at >= offset) after.push(run);
    else {
      before.push({ ...run, text: run.text.slice(0, offset - at) });
      after.push({ ...run, text: run.text.slice(offset - at) });
    }
    at = end;
  }
  return [before, after];
}

/**
 * Apply marks to the characters from `start` to `end`.
 *
 * `patch` is like { bold: true } or { baseline: "sub" }; a mark set to false
 * or null is removed. Superscript and subscript are the same mark, so setting
 * one clears the other.
 */
export function applyMarks(runs, start, end, patch) {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(plainText(runs).length, Math.max(start, end));
  if (to <= from) return mergeRuns(runs);
  const [head, rest] = splitAt(runs, from);
  const [middle, tail] = splitAt(rest, to - from);
  const changed = middle.map((run) => {
    const next = { ...run };
    for (const [mark, value] of Object.entries(patch)) {
      if (value === false || value === null || value === undefined) delete next[mark];
      else next[mark] = value;
    }
    return next;
  });
  return mergeRuns([...head, ...changed, ...tail]);
}

/**
 * Which marks the characters from `start` to `end` carry: true when every
 * character has it, false when none does, and "mixed" when some do. With no
 * selection (start === end) it reports the marks of the character before the
 * caret, which is what a toolbar should show.
 */
export function marksIn(runs, start, end) {
  const text = plainText(runs);
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(text.length, Math.max(start, end));
  const pieces = [];
  let at = 0;
  for (const run of runs) {
    const runEnd = at + run.text.length;
    const overlaps = from === to ? at < from && runEnd >= from : at < to && runEnd > from;
    if (overlaps) pieces.push(run);
    at = runEnd;
  }
  const out = {};
  for (const mark of MARKS) {
    const values = pieces.map((p) => p[mark] ?? false);
    if (values.length === 0) out[mark] = false;
    else if (values.every((v) => v === values[0])) out[mark] = values[0];
    else out[mark] = "mixed";
  }
  return out;
}

/** The font size a piece is drawn at: smaller for superscript and subscript. */
export const sizeOf = (run, fontSize) => (run.baseline ? fontSize * SMALL : fontSize);

/** How far a piece sits above or below the line. */
export const riseOf = (run, fontSize) =>
  run.baseline === "super" ? -fontSize * SUPER_RISE : run.baseline === "sub" ? fontSize * SUB_DROP : 0;

/** A rough width when no real measurer is available (tests, and node). */
export function estimateWidth(text, size, { bold = false } = {}) {
  let units = 0;
  for (const ch of String(text ?? "")) {
    if (/[ilIj.,:;'|!]/.test(ch)) units += 0.28;
    else if (/[mwMW]/.test(ch)) units += 0.85;
    else if (/[A-Z]/.test(ch)) units += 0.68;
    else if (ch === " ") units += 0.28;
    else units += 0.56;
  }
  return units * size * (bold ? 1.05 : 1);
}

/** Split into words, keeping each trailing space with its word. */
function words(text) {
  return text.match(/[^ ]+ *| +/g) ?? [];
}

/**
 * Lay formatted text out inside a box of the given width.
 *
 * Returns { lines, height, width }, where each line is
 * { y, width, pieces: [{ text, x, width, size, rise, run }] }. `y` is the
 * line's baseline offset from the top of the box, so both renderers place
 * text the same way. Line breaking is greedy on word boundaries, as Konva's
 * own wrapping is, and explicit newlines always break.
 */
export function layoutRichText({
  runs,
  width,
  fontSize = 16,
  fontFamily = "Helvetica",
  lineHeight = 1.25,
  align = "left",
  measure = (text, size, style) => estimateWidth(text, size, style),
}) {
  const step = fontSize * lineHeight;
  const widthOf = (text, run) =>
    text === "" ? 0 : measure(text, sizeOf(run, fontSize), { bold: !!run.bold, italic: !!run.italic, fontFamily });

  // A word is a word whether or not its formatting changes part way through:
  // "10" plus a superscript "-3" must never break between the two. So the
  // text is split into words first, and each word then carries the pieces of
  // every run it spans.
  const text = plainText(runs);
  const owner = [];
  runs.forEach((run, index) => {
    for (let i = 0; i < run.text.length; i += 1) owner.push(index);
  });

  const piecesOf = (from, to) => {
    const out = [];
    let at = from;
    while (at < to) {
      const index = owner[at];
      let end = at;
      while (end < to && owner[end] === index) end += 1;
      out.push({ run: runs[index] ?? { text: "" }, text: text.slice(at, end) });
      at = end;
    }
    return out;
  };

  const lines = [];
  let current = [];
  let x = 0;
  const endLine = () => {
    lines.push({ pieces: current, width: x });
    current = [];
    x = 0;
  };

  let at = 0;
  for (const [lineIndex, chunk] of text.split("\n").entries()) {
    if (lineIndex > 0) {
      endLine();
      at += 1; // the newline itself
    }
    for (const word of words(chunk)) {
      const from = at;
      const to = at + word.length;
      at = to;
      const pieces = piecesOf(from, to);
      const full = pieces.reduce((sum, piece) => sum + widthOf(piece.text, piece.run), 0);
      const trimmed = pieces.reduce((sum, piece) => sum + widthOf(piece.text.trimEnd(), piece.run), 0);
      // A word that does not fit starts a new line, unless the line is empty,
      // in which case it has to overflow: breaking inside a word would hide
      // characters.
      if (width && x > 0 && x + trimmed > width) endLine();
      for (const piece of pieces) {
        const pieceWidth = widthOf(piece.text, piece.run);
        current.push({
          text: piece.text,
          x,
          width: pieceWidth,
          size: sizeOf(piece.run, fontSize),
          rise: riseOf(piece.run, fontSize),
          run: piece.run,
        });
        x += pieceWidth;
      }
    }
  }
  endLine();

  // Trailing spaces do not count towards a line's width, so centred and right
  // aligned lines sit where the eye expects.
  for (const line of lines) {
    const last = line.pieces[line.pieces.length - 1];
    if (last && /\s$/.test(last.text)) {
      line.width -= widthOf(last.text.slice(last.text.trimEnd().length), last.run);
    }
    const slack = Math.max(0, (width || line.width) - line.width);
    const offset = align === "center" ? slack / 2 : align === "right" ? slack : 0;
    if (offset) for (const piece of line.pieces) piece.x += offset;
  }

  lines.forEach((line, i) => {
    line.y = (i + 0.8) * step;
  });

  return {
    lines,
    height: lines.length * step,
    width: width || Math.max(0, ...lines.map((l) => l.width)),
  };
}

/**
 * Fold an element-wide style into the runs.
 *
 * A text element keeps a `fontStyle` for the whole of it, as it always has.
 * Marks on runs sit on top of that, so text that is bold as a whole stays bold
 * where a run says nothing about it.
 */
export function withBase(runs, { bold = false, italic = false } = {}) {
  if (!bold && !italic) return runs;
  return runs.map((run) => ({
    ...run,
    ...(bold ? { bold: true } : {}),
    ...(italic ? { italic: true } : {}),
  }));
}

/** The base marks an element-wide fontStyle stands for. */
export const baseMarks = (fontStyle) => ({
  bold: String(fontStyle ?? "").includes("bold"),
  italic: String(fontStyle ?? "").includes("italic"),
});

/** Does this element need the formatted path, or is one style enough? */
export const hasFormatting = (runs) => runs.length > 1 || (runs.length === 1 && isMarked(runs[0]));
