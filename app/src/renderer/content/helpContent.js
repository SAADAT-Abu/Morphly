/**
 * Help text, in one place.
 *
 * The licensing section is the reason this file exists. It is written in plain
 * language on purpose: the people using Morphly are scientists preparing
 * figures, not lawyers, and the practical question is only ever "can I put this
 * in my paper, and what do I have to write underneath it?"
 *
 * Counts are shown live from the loaded library where possible, so this text
 * never goes stale against what is actually mounted.
 */

export const LICENCE_TIERS = [
  {
    badge: "PD",
    tone: "pd",
    title: "Public domain — nothing required",
    covers: "All of NIH BioArt, plus the CC0 icons in Bioicons.",
    meaning:
      "Use it for anything at all: papers, posters, slides, teaching, commercial work. " +
      "No permission needed, no credit line required.",
    todo: "Nothing. A citation is appreciated but never obligatory.",
  },
  {
    badge: "BY",
    tone: "by",
    title: "Credit required — the common case",
    covers: "Most of Bioicons (CC BY 3.0 and 4.0), plus a few MIT/BSD icons.",
    meaning:
      "Use it for anything, including commercial work, on one condition: say who made it. " +
      "That is the entire obligation.",
    todo:
      "Keep a credit line with the figure. Morphly writes these for you — tick " +
      "“Append asset citations” when you export.",
  },
  {
    badge: "SA",
    tone: "sa",
    title: "Share-alike — the one to think about",
    covers: "A small number of Bioicons icons (CC BY-SA 3.0 and 4.0).",
    meaning:
      "Credit is required, and there is a catch: whatever you make with it must be shared " +
      "under the same open licence. Put one in a figure and the argument can be made that " +
      "the whole figure now carries CC BY-SA too — meaning anyone may reuse and modify it, " +
      "and you cannot restrict that.",
    todo:
      "For an open-access paper this is usually fine. It can matter if a publisher wants " +
      "exclusive rights to your figures. Morphly warns you before you export, and there is " +
      "almost always an equivalent icon under a simpler licence.",
  },
];

export const SOURCES = [
  {
    name: "NIH BioArt Source",
    url: "https://bioart.niaid.nih.gov",
    blurb:
      "~2,000 vetted scientific and medical illustrations from NIAID. Public domain — the " +
      "easy library. Many entries come in several colour variants of the same drawing.",
  },
  {
    name: "Bioicons",
    url: "https://bioicons.com",
    blurb:
      "2,830 science icons contributed by ~130 authors. Mostly CC BY, so most need a credit " +
      "line. Strong on lab equipment, anatomy, animals and chemistry.",
  },
];

export const SHORTCUTS = [
  {
    group: "Tools",
    items: [
      ["V", "Select"],
      ["R", "Rectangle"],
      ["O", "Ellipse"],
      ["L", "Line"],
      ["A", "Arrow"],
      ["T", "Text"],
    ],
  },
  {
    group: "Editing",
    items: [
      ["Ctrl + Z", "Undo"],
      ["Ctrl + Shift + Z", "Redo"],
      ["Ctrl + D", "Duplicate"],
      ["Ctrl + A", "Select all"],
      ["Delete", "Delete selection"],
      ["Arrow keys", "Nudge 2 px"],
      ["Shift + arrows", "Nudge 20 px"],
      ["Double-click text", "Edit in place"],
      ["Shift + click", "Add to selection"],
      ["Esc", "Deselect / back to Select tool"],
    ],
  },
  {
    group: "View",
    items: [
      ["Ctrl + wheel", "Zoom"],
      ["Hold space + drag", "Pan"],
      ["Ctrl + 0", "Fit to screen"],
      ["Wheel / trackpad", "Scroll canvas"],
    ],
  },
  {
    group: "File",
    items: [
      ["Ctrl + N", "New figure"],
      ["Ctrl + O", "Open"],
      ["Ctrl + S", "Save"],
      ["Ctrl + E", "Export"],
      ["F1", "This help"],
    ],
  },
];

export const GETTING_STARTED = [
  {
    title: "1. Point Morphly at a library",
    body:
      "Morphly does not ship the artwork — it reads folders you generate with the two " +
      "scripts in scraper/. That keeps the app small and lets you refresh either library " +
      "independently. Use File → Add asset library folder, and pick the folder that " +
      "contains manifest.json. You can mount both libraries at once; they are browsed " +
      "together with a collection filter.",
  },
  {
    title: "2. Place artwork",
    body:
      "Search by title, keyword or creator in the left sidebar. Click a thumbnail to drop it " +
      "in the middle of the page, or drag it onto the canvas to place it exactly where you " +
      "want. Entries showing “N variants” are the same drawing in different colour " +
      "schemes — expand the tile to pick one.",
  },
  {
    title: "3. Recolour it",
    body:
      "Select a placed illustration and the Colours panel lists every distinct colour in it. " +
      "Change one swatch and every shape using that colour updates together — that is why " +
      "recolouring a 500-shape illustration takes one click rather than five hundred. " +
      "Nothing is destructive: the original file is untouched and every swatch has a reset.",
  },
  {
    title: "4. Build the figure",
    body:
      "Add rectangles, ellipses, triangles, lines, arrows and text from the toolbar. Drag to " +
      "move, use the handles to resize and rotate. Pink guides appear as edges line up with " +
      "the page centre or with other elements. The Layers panel handles stacking order, " +
      "renaming, hiding and locking.",
  },
  {
    title: "5. Export",
    body:
      "PNG for a quick look, SVG if you want to keep editing in Illustrator or Inkscape, PDF " +
      "for submission. SVG and PDF stay true vector, so they scale to any size without going " +
      "blurry. Leave “Append asset citations” ticked and your credits are written into " +
      "the file automatically.",
  },
];
