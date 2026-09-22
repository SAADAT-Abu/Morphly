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
      ["Ctrl + Shift + B", "Insert a graph"],
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
      ["Ctrl + C / Ctrl + X", "Copy / cut"],
      ["Ctrl + V", "Paste (also pictures and SVG copied elsewhere)"],
      ["Ctrl + Shift + V", "Paste in place"],
      ["Ctrl + ] / Ctrl + [", "Bring forward / send backward"],
      ["Ctrl + Shift + ] / [", "Bring to front / send to back"],
      ["Right-click", "Menu for the selection or the page"],
      ["Ctrl + D", "Duplicate"],
      ["Ctrl + A", "Select all"],
      ["Ctrl + G", "Group selection"],
      ["Ctrl + Shift + G", "Ungroup"],
      ["Delete", "Delete selection"],
      ["Arrow keys", "Nudge 2 px"],
      ["Shift + arrows", "Nudge 20 px"],
      ["Ctrl + B / Ctrl + I", "Bold / italic"],
      ["Ctrl + U", "Underline (while editing text)"],
      ["Ctrl + = / Ctrl + Shift + =", "Subscript / superscript (while editing text)"],
      ["Double-click text", "Edit in place"],
      ["Double-click a cell", "Edit that table cell"],
      ["Double-click a graph", "Open its data under the canvas"],
      ["Shift + click", "Add to selection"],
      ["Drag on empty space", "Select everything the band touches"],
      ["Shift + drag", "Add the band to the selection"],
      ["Ctrl + drag", "Move or resize without snapping"],
      ["Esc", "Deselect / back to Select tool"],
    ],
  },
  {
    group: "Panels",
    items: [
      ["Drag a boundary", "Resize the sidebar, the properties panel, the layers list or the data table"],
      ["Double-click a boundary", "Back to its usual size"],
      ["Arrow keys on a boundary", "Resize a little at a time (Shift for more)"],
      ["Home / End on a boundary", "Smallest / largest"],
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
    group: "Data table",
    items: [
      ["Enter / Down", "Next row"],
      ["Up", "Previous row"],
      ["Tab", "Next column"],
      ["Ctrl + V", "Paste a block of cells from a spreadsheet"],
      ["Ctrl + Z (data window)", "Undo in the figure"],
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
      "everything can be restored. To change one piece rather than a colour, double-click " +
      "the illustration (or right-click it and choose Edit parts). Click a part to select it, " +
      "Shift to add more, Ctrl for a single shape, and double-click to open a group; then " +
      "recolour it in the properties panel, drag it or nudge it with the arrow keys, or press " +
      "Delete to hide it. Esc steps back out. Part edits are saved with the figure, reach " +
      "the export, and can be reset at any time.",
  },
  {
    title: "4. Build the figure",
    body:
      "Add rectangles, ellipses, triangles, lines and text from the toolbar. The small arrow " +
      "beside the line button chooses how its ends look (arrowheads, open arrows, inhibition " +
      "bars, squares or dots) and whether it is solid, dashed or dotted; with lines selected " +
      "it restyles them. Drag to move, and use the handles to resize and rotate: while " +
      "turning, the angle from upright is shown beside the pointer, and it settles on " +
      "upright, level and the diagonals when close. Zoom with Ctrl and the wheel; when the " +
      "figure is larger than the window, use the scrollbars, shift plus wheel for sideways, " +
      "or hold space and drag. While you move or resize something, dotted pink guides " +
      "show when its edges or centre line up with the page, with other objects, or with " +
      "the panel it sits in (a panel's centre lines win), and marks appear when gaps " +
      "become equal. Hold Ctrl to move freely, or turn snapping off with the magnet " +
      "button. The Arrange buttons in the toolbar align and distribute the selection " +
      "relative to the page, the selection, its panel, the first object selected or the " +
      "biggest one. Right-click an object for cut, copy, paste, grouping, alignment, " +
      "stacking order and locking; right-click the page to paste where you clicked. " +
      "Select several things and press Ctrl+G to " +
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
    title: "5. Formatting inside a text box",
    body:
      "Double-click a text box, or a caption inside a shape, and a small toolbar appears above it: " +
      "bold, italic, underline, strikethrough, superscript, subscript and a colour. " +
      "They apply to whatever you have selected, so a single word can be italic (a gene or species " +
      "name), the 2 in CO2 can sit low and the -3 in 10-3 can sit high, and a term can be coloured " +
      "to match the thing it labels on the canvas. Ctrl+B, Ctrl+I and Ctrl+U work as usual, Ctrl+= " +
      "makes a subscript and Ctrl+Shift+= a superscript. The same buttons in the properties panel " +
      "apply to the whole text box at once, and show half lit when only part of it carries the mark. " +
      "Formatting is kept in the figure file, drawn on the canvas, and exported as real text in SVG " +
      "and PDF, so it stays editable and selectable wherever the figure goes next.",
  },
  {
    title: "6. Add tables, plots and a grid",
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
    title: "7. Make a graph from your data",
    body:
      "The graph button in the toolbar, or Insert → Graph, asks three things. First, what " +
      "your data looks like: groups (control, treated and so on, one column each), X and Y " +
      "(a time course or a dose response, X in the first column), groups by condition, " +
      "counts in categories, survival, a table of numbers (one row per gene, sample or " +
      "subject), results per row (a fold change and a p value for each test), or lists of " +
      "names. Then the numbers: " +
      "sample data to try things with, cells pasted from Excel, LibreOffice, R or Python, " +
      "a CSV file, an empty table, or data already in the figure. Morphly shows how it read " +
      "each column, and understands semicolons and decimal commas. Last, the kind of graph, " +
      "previewed with your numbers: bar and points, dot plot, box and whiskers, violin, " +
      "before and after, histogram, pie or donut for groups; scatter, or points and lines " +
      "with a fitted curve, for X and Y; Kaplan-Meier curves for survival; and, from the " +
      "last three shapes, heatmaps, PCA, correlation matrices, ROC curves, Bland-Altman, " +
      "volcano, MA and forest plots, Venn diagrams and UpSet plots. With a panel selected, the graph " +
      "fills it. The numbers open in a table under the canvas: type, paste a block, and the " +
      "graph redraws as you go. The icon in the table's top right corner moves it into a " +
      "window of its own, for a long table or a second screen. Double-click a graph to get " +
      "its numbers back, and find every table in the figure in the Data tab of the left " +
      "sidebar. The properties panel sets error bars (SD, SEM or 95% CI), axis titles and " +
      "limits, text size and colours. For groups it also suggests a test and says why " +
      "(normality by Shapiro-Wilk, spread by Brown-Forsythe): t tests, Mann-Whitney, " +
      "one-way, Welch's or repeated measures ANOVA with Tukey, Games-Howell or Holm " +
      "follow-up, Kruskal-Wallis with Dunn's test, Wilcoxon and Friedman. Tick a comparison " +
      "to draw it as a bracket with stars; significant ones start ticked. Every p-value is " +
      "checked against R. Copy the methods sentence into your manuscript. How each test is " +
      "calculated, and what it was checked against, is written out in docs/STATISTICAL_TESTS.md; " +
      "the Statistics panel links straight to it. Graphs export as " +
      "true vectors, like everything else.",
  },
  {
    title: "8. Keep several figures in one document",
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
      "properly, it offers that copy back the next time it starts. The figure's name sits in " +
      "the top-left corner: click it to rename the figure, which renames its file too. " +
      "Figures save themselves as you work, into Pictures/Morphly unless you choose another " +
      "folder with File → Default save folder, which is also where exports go. Turn this " +
      "off with File → Autosave if you prefer to save by hand.",
  },
  {
    title: "9. Art Packs",
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
    title: "10. Export",
    body:
      "PNG for a quick look or slides, JPEG where a smaller file matters more than " +
      "transparency, SVG if you want to keep editing in Illustrator or Inkscape, PDF " +
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
  /** How every test is calculated, and what it was checked against. */
  statistics: "https://github.com/SAADAT-Abu/Morphly/blob/main/docs/STATISTICAL_TESTS.md",
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
  { name: "stdlib", version: "0.2", license: "Apache-2.0", what: "Statistical distributions for p-values" },
  { name: "d3-array", version: "3", license: "ISC", what: "Graph axis ticks" },
  { name: "Papa Parse", version: "5", license: "MIT", what: "Reading CSV and pasted tables" },
  { name: "Vite", version: "7", license: "MIT", what: "Build tooling" },
  { name: "electron-builder", version: "26", license: "MIT", what: "Installers" },
  { name: "Requests", version: "2", license: "Apache-2.0", what: "Asset fetching (Python)" },
  { name: "BeautifulSoup", version: "4", license: "MIT", what: "Asset fetching (Python)" },
];
