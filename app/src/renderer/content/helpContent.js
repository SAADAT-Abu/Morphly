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
    title: "Public domain: nothing required",
    covers: "All of NIH BioArt, plus the CC0 icons in Bioicons.",
    meaning:
      "Use it for anything at all: papers, posters, slides, teaching, commercial work. " +
      "No permission needed, no credit line required.",
    todo: "Nothing. A citation is appreciated but never obligatory.",
  },
  {
    badge: "BY",
    tone: "by",
    title: "Credit required: the common case",
    covers: "Most of Bioicons (CC BY 3.0 and 4.0), plus a few MIT/BSD icons.",
    meaning:
      "Use it for anything, including commercial work, on one condition: say who made it. " +
      "That is the entire obligation.",
    todo:
      "Keep a credit line with the figure. Morphly writes these for you: tick " +
      "“Append asset citations” when you export.",
  },
  {
    badge: "SA",
    tone: "sa",
    title: "Share-alike: the one to think about",
    covers: "A small number of Bioicons icons (CC BY-SA 3.0 and 4.0).",
    meaning:
      "Credit is required, and there is a catch: whatever you make with it must be shared " +
      "under the same open licence. Put one in a figure and the argument can be made that " +
      "the whole figure now carries CC BY-SA too, meaning anyone may reuse and modify it, " +
      "and you cannot restrict that.",
    todo:
      "For an open-access paper this is usually fine. It can matter if a publisher wants " +
      "exclusive rights to your figures. Morphly warns you before you export, and there is " +
      "almost always an equivalent icon under a simpler licence.",
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
      ["Ctrl + Shift + T", "Insert a table"],
      ["Ctrl + Shift + L", "Insert a panel layout"],
      ["Ctrl + Shift + M", "Insert an image"],
      ["Ctrl + Shift + P", "New figure page"],
      ["F2", "Rename the current page"],
    ],
  },
  {
    group: "Editing",
    items: [
      ["Ctrl + Z", "Undo"],
      ["Ctrl + Shift + Z", "Redo"],
      ["Ctrl + D", "Duplicate"],
      ["Ctrl + A", "Select all"],
      ["Ctrl + G", "Group selection"],
      ["Ctrl + Shift + G", "Ungroup"],
      ["Delete", "Delete selection"],
      ["Arrow keys", "Nudge 2 px"],
      ["Shift + arrows", "Nudge 20 px"],
      ["Double-click text", "Edit in place"],
      ["Double-click a cell", "Edit that table cell"],
      ["Shift + click", "Add to selection"],
      ["Drag on empty space", "Select everything the band touches"],
      ["Shift + drag", "Add the band to the selection"],
      ["Esc", "Deselect / back to Select tool"],
    ],
  },
  {
    group: "View",
    items: [
      ["Ctrl + wheel", "Zoom"],
      ["Wheel / trackpad", "Scroll up and down"],
      ["Shift + wheel", "Scroll left and right"],
      ["Hold space + drag", "Pan"],
      ["Middle-button drag", "Pan"],
      ["Ctrl + 0", "Fit to screen"],
      ["Ctrl + apostrophe", "Show or hide the grid"],
      ["Ctrl + PageDown", "Next figure page"],
      ["Ctrl + PageUp", "Previous figure page"],
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
      "Morphly ships with NIH BioArt inside it and mounts it on first launch, so there is " +
      "nothing to set up: the sidebar is already full. More libraries are available as Art " +
      "Packs, downloaded from the Art Store in the sidebar header when you want them, which " +
      "keeps the installer small and lets new packs appear without reinstalling Morphly. " +
      "You can also point Morphly at any folder containing a manifest.json, with File → Add " +
      "asset library folder. Everything mounted is browsed together with a collection " +
      "filter, and anything can be removed again, including what came with the app.",
  },
  {
    title: "2. Place artwork",
    body:
      "Search by title, keyword or creator in the left sidebar. Click a thumbnail to drop it " +
      "in the middle of the page, or drag it onto the canvas to place it exactly where you " +
      "want. Entries showing “N variants” are the same drawing in different colour " +
      "schemes. Expand the tile to pick one.",
  },
  {
    title: "3. Recolour it",
    body:
      "Select a placed illustration and the Colours panel lists every distinct colour in it. " +
      "Hover a swatch and Morphly highlights exactly which parts of the drawing it " +
      "controls, so you do not have to guess. Change it and every shape using that colour " +
      "updates together, which is why recolouring a 500-shape illustration takes one click " +
      "rather than five hundred. The cross beside a swatch removes those parts from the " +
      "figure entirely. Nothing is destructive: the original file is untouched and " +
      "everything can be restored.",
  },
  {
    title: "4. Build the figure",
    body:
      "Add rectangles, ellipses, triangles, lines, arrows and text from the toolbar. Drag to " +
      "move, use the handles to resize and rotate. Zoom with Ctrl and the wheel; when the " +
      "figure is larger than the window, use the scrollbars, shift plus wheel for sideways, " +
      "or hold space and drag. Pink guides appear as edges line up with " +
      "the page centre or with other elements. Select several things and press Ctrl+G to " +
      "group them, so they move and scale as one piece. To select several at once, drag a "
      + "band across empty space and everything it touches is caught; hold shift to add to "
      + "what is already selected. A selected line or arrow shows a handle on each end: drag "
      + "an end onto a shape, image, table or icon and it glues to the nearest glue point, "
      + "so it follows when that element moves (hold Ctrl to place it without gluing). The "
      + "properties panel makes a line straight, curved or elbowed; a curve has a handle to "
      + "bend it, and an elbow one to slide its middle leg. The Layers panel handles stacking " +
      "order, renaming, hiding and locking.",
  },
  {
    title: "5. Add tables, plots and a grid",
    body:
      "The table button in the toolbar, or Insert → Table, draws a table you can size by "
      + "pointing at the grid in the dialog. " +
      "Double-click any cell on the canvas to type in it. The properties panel adds and " +
      "removes rows and columns, sets column width and row height, and controls headers, " +
      "shading, borders and rounded corners. The image button, or Insert → Image, brings in a plot, a " +
      "micrograph or a photo as PNG, JPEG, GIF, WebP or BMP, and you can also drag image " +
      "files straight onto the canvas from your file manager. An SVG comes in as editable " +
      "artwork rather than a flat picture: you can recolour it and hide parts of it like any " +
      "library icon, and large plots have their identical points combined so they stay " +
      "lighter. Imported images are stored " +
      "inside the .morphly file, so a saved figure still opens after the original file has " +
      "moved. The grid button in the toolbar shows a grid at any spacing, with an option " +
      "to snap elements to it. The grid is a guide only and never appears in an export. " +
      "The panel button, or Insert → Panel layout, divides the page into lettered panels " +
      "with even spacing, including wide and tall panels for a main result. Letters follow " +
      "reading order and update by themselves when a panel is moved or deleted.",
  },
  {
    title: "6. Keep several figures in one document",
    body:
      "The tabs above the canvas are pages, one per figure. A paper's figures are " +
      "usually built together, so they live in a single .morphly file: add a page with " +
      "the + button, double-click a tab to rename it, drag tabs to reorder them, and use " +
      "the pencil button, a double-click or F2 to rename a tab, and the copy button on a " +
      "tab to start a new figure from an existing one. Each page has " +
      "its own canvas size and its own undo history, so undo always means what you just " +
      "did on the figure in front of you. Export works on the page you are looking at, so " +
      "each figure is exported as its own file. Figures saved before pages existed open " +
      "as a single-page document. While you have unsaved changes, Morphly keeps a spare " +
      "copy in its own data folder, never in your file. If it ever stops without closing " +
      "properly, it offers that copy back the next time it starts.",
  },
  {
    title: "7. Art Packs",
    body:
      "The Art Store, in the sidebar header, lists illustration libraries you can add. Each " +
      "card says how many illustrations the pack holds, which subjects it covers, how large " +
      "the download is, and what its licences oblige: how many icons need a credit, and how " +
      "many are share-alike, which can require the whole figure to be shared under the same " +
      "licence. Packs are downloaded from Zenodo, checked against a published checksum, and " +
      "can be removed again at any time. Figures you have already made keep working after a " +
      "pack is removed, because each element carries its own copy of the artwork.",
  },
  {
    title: "8. Export",
    body:
      "PNG for a quick look, SVG if you want to keep editing in Illustrator or Inkscape, PDF " +
      "for submission. SVG and PDF stay true vector, so they scale to any size without going " +
      "blurry. Leave “Append asset citations” ticked and your credits are written into " +
      "the file automatically.",
  },
];

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

export const AUTHOR = {
  name: "Abu Saadat",
  role: "Postdoctoral Fellow",
  /** Short form for the welcome byline; long form for the About tab. */
  affiliation: "IJC Barcelona",
  affiliationFull: "Josep Carreras Leukaemia Research Institute (IJC), Barcelona",
};

export const LINKS = {
  repo: "https://github.com/SAADAT-Abu/Morphly",
  issues: "https://github.com/SAADAT-Abu/Morphly/issues",
  /** Concept DOI: always resolves to the most recent archived release. */
  zenodo: "https://doi.org/10.5281/zenodo.22238248",
};

export const MORPHLY_LICENSE = "MIT";

/**
 * Asset libraries Morphly reads. Morphly does not host or redistribute any of
 * this artwork -- it reads a library folder on your machine -- but the people
 * who made it deserve naming regardless.
 */
export const ASSET_CREDITS = [
  {
    name: "NIH BioArt Source",
    who: "NIAID Visual & Medical Arts, National Institutes of Health",
    url: "https://bioart.niaid.nih.gov",
    licenses: "Public Domain (some entries CC BY)",
    note:
      "Free for any use. Citation is appreciated but not required for public-domain " +
      "entries.",
  },
  {
    name: "Bioicons",
    who: "Simon Duerr and ~130 contributing artists",
    url: "https://bioicons.com",
    licenses: "Per icon: CC0 1.0, CC BY 3.0/4.0, CC BY-SA 3.0/4.0, MIT, BSD-3-Clause",
    note:
      "The largest contributors are Servier Medical Art and DBCLS. Most icons require " +
      "attribution; a few are share-alike. See the Licensing tab.",
  },
];

/** Open-source projects Morphly is built on. Versions are the ones in use. */
export const SOFTWARE_CREDITS = [
  { name: "Electron", version: "38", license: "MIT", what: "Desktop application shell" },
  { name: "React", version: "19", license: "MIT", what: "User interface" },
  { name: "Konva / react-konva", version: "10 / 19", license: "MIT", what: "Canvas engine" },
  { name: "Zustand", version: "5", license: "MIT", what: "Editor state" },
  { name: "Vite", version: "7", license: "MIT", what: "Build tooling" },
  { name: "electron-builder", version: "26", license: "MIT", what: "Installers" },
  { name: "Requests", version: "2", license: "Apache-2.0", what: "Asset fetching (Python)" },
  { name: "BeautifulSoup", version: "4", license: "MIT", what: "Asset fetching (Python)" },
];
