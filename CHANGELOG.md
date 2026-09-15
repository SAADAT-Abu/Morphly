# Changelog

All notable changes to Morphly are listed here, newest first. Installers for
every release are archived on Zenodo under the concept DOI
[10.5281/zenodo.22238248](https://doi.org/10.5281/zenodo.22238248).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

Planned work is described in the [roadmap](README.md#roadmap).

### Added

- **Continuous loading in the asset library.** Thumbnails load as you scroll,
  replacing the "Show 90 more" button, and a counter above the grid says which
  illustrations are on screen ("Showing 181 to 225 of 2,531", or "of 1,204
  matches" after a search). A button returns to the top. Prompted by
  [issue #1](https://github.com/SAADAT-Abu/Morphly/issues/1).
- **JPEG export** at 1×, 2× or 4×, with a choice of quality, alongside PNG,
  SVG and PDF. Also from issue #1.

## [0.4.0] - 2026-09-15

Diagrams, editing and a safety net.

### Added

- **Glue points.** Line and arrow ends attach to connection points on shapes,
  illustrations, images and tables, and follow them when they move. Hold Ctrl,
  Cmd or Alt while dragging an end to place it without gluing.
- **Curved and elbow connectors**, with a draggable bend handle for curves and
  a draggable middle leg for elbows. Both export as true vectors.
- **One line tool with end styles.** Triangle, open, square, dot or bar ends on
  either side, or none, and solid, dashed or dotted lines, chosen from a
  dropdown with previews. The A key still draws an arrow.
- **Rotation angle.** While rotating, a small label shows the angle from the
  vertical, the cursor changes to a rotation cursor, and rotation snaps at 45°
  steps.
- **Edit parts of an illustration.** Double-click an illustration to select,
  recolour, move or hide its individual pieces. Click again on a selected part
  to reach the shape behind it, double-click a group to open it. Every change
  can be reset and carries through to SVG and PDF export.
- **Smart guides.** Dotted guides appear while moving and resizing when objects
  line up with each other, the page centre or the centre of their panel, and
  equal gaps are marked.
- **Align and distribute** from the toolbar and the Arrange menu, relative to
  the page, the selection, a panel, the first selected or the biggest object.
- **Cut, copy and paste**, including paste in place, pasting across pages, and
  pasting pictures or SVG markup copied from other programs.
- **Right-click menu** for objects, the page and illustration parts: editing,
  grouping, alignment, stacking order and locking.
- **Stacking order shortcuts**: Ctrl+] and Ctrl+[ to bring forward and send
  backward, with Shift for front and back.
- **Panel layouts.** Split a page into a grid or a preset arrangement of panels
  with automatic letters (A, B, C), set spacing, margins and letter style.
- **SVG import as editable artwork.** Plots from R (svglite, ggplot2) and Python
  (matplotlib) arrive recolourable and stay vector on export. Imported files are
  checked and cleaned, heavy plots are simplified where that does not enlarge
  the file, and Morphly warns when a file is still heavy.
- **Editable figure name** in the top-left corner, with a save status.
- **Autosave** into a default folder (Pictures/Morphly unless you choose
  another in File, Default save folder), which can be switched off. Renaming a
  figure renames its file.
- **Crash recovery.** A recovery copy of unsaved work is kept and offered back
  after a crash, and the window reloads itself if its renderer fails.
- **Automated tests** (284) covering geometry, snapping, alignment, connectors,
  panel layouts, clipboard, part editing, SVG import and export, run before
  every installer build.

### Changed

- File format version 3. Older figures are migrated when opened.
- The toolbar is organised into two rows: document actions on top, and tools,
  Insert, Edit, Arrange, View and Zoom groups below.
- The separate line and arrow buttons are merged into the one line tool.
- Open, save and export dialogs start in the default save folder.

### Fixed

- SVG export no longer writes an invalid opacity for elements saved without
  one.
- Unfilled shapes export as `fill="none"` rather than an empty fill.

## [0.3.0] - 2026-09-13

Art Packs and smaller installers.

### Added

- **Art Store and Art Packs.** Illustration libraries download on demand, are
  checked against a published sha256, and can be removed again. Bioicons and
  SciDraw are available as packs.
- **SciDraw** library support, 609 drawings each with its own DOI.
- **Hex colour entry** on every recolour swatch.
- **Update check** against the Zenodo record, from Help, Check for updates.
- A pencil button, F2 and a Page menu item for renaming a page.

### Changed

- Installers ship with NIH BioArt only, so they are about 40% smaller than
  0.2.0. Bioicons moved to an optional Art Pack.
- Artwork downloaded as a pack is validated and sanitised on install, keeping
  embedded raster images.
- Drawings without a declared size are framed tightly to their content.

### Fixed

- Empty SVG files in a library are skipped instead of breaking the load.

## [0.2.0] - 2026-09-02

### Added

- **Several figures in one document**, as tabs above the canvas, each with its
  own canvas size and undo history. Pages can be renamed, reordered and
  duplicated.
- macOS builds for Apple Silicon and Intel.

### Fixed

- The app no longer freezes when a new figure discards unsaved work.

## [0.1.0] - 2026-09-01

First release.

### Added

- Canvas editor built on Electron, React and Konva.
- Searchable asset sidebar for NIH BioArt and Bioicons, with collection and
  category filters, variant grouping and licence badges (PD, BY, SA).
- Non-destructive vector recolouring by palette, with part highlighting and
  removable colour parts.
- Rectangles, ellipses, triangles, lines, arrows, text, shape labels, tables and
  image import.
- Grouping, band selection, snapping, alignment, layers with lock and hide,
  undo and redo, a canvas grid, scrollbars and panning.
- Export to PNG, SVG and PDF as true vectors, with optional asset citations.
- Save and open `.morphly` project files, and a prompt to save before closing.
- Help window, application menu, keyboard shortcuts and a welcome screen.
- Linux AppImage, and CI builds for Windows and macOS.

[Unreleased]: https://github.com/SAADAT-Abu/Morphly/compare/v0.4.0...HEAD
[0.4.0]: https://doi.org/10.5281/zenodo.22761841
[0.3.0]: https://doi.org/10.5281/zenodo.22737155
[0.2.0]: https://doi.org/10.5281/zenodo.22251152
[0.1.0]: https://doi.org/10.5281/zenodo.22238249
