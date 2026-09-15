# Contributing to Morphly

Thank you for wanting to help. Morphly is a free, offline editor for scientific
figures, built as a side project by a researcher, so every bug report, idea,
illustration library and pull request makes a real difference.

This guide covers how to report problems, how to set up the code, and what a
good pull request looks like. If you want to add a new illustration library,
see [How to add an Art Pack](docs/ADDING_ART_PACKS.md).

## Ways to help

- **Report a bug.** Open an [issue](https://github.com/SAADAT-Abu/Morphly/issues)
  and include your operating system, the Morphly version (Help, About Morphly),
  what you did, what you expected and what happened instead. If a particular
  figure misbehaves, attaching the `.morphly` file helps a great deal.
- **Suggest a feature.** Open an issue describing the figure you were trying to
  make and where Morphly got in the way. The problem is more useful than a
  finished design, because there may be a simpler way to solve it.
- **Add illustrations.** New libraries arrive as Art Packs rather than as files
  in this repository. See [How to add an Art Pack](docs/ADDING_ART_PACKS.md).
- **Improve the code or the documentation.** Small fixes are welcome straight
  away. For anything larger, please open an issue first so we can agree on the
  approach before you spend time on it.

## Setting up

You need [Node.js](https://nodejs.org) 20 or newer, and Python 3 if you want to
run the library fetchers or the Art Pack tools.

```bash
git clone https://github.com/SAADAT-Abu/Morphly.git
cd Morphly/app
npm install
npm run dev      # development, with hot reload
```

`npm start` makes a production build and launches it, and `npm run dist`
builds an installer for your own platform into `app/release/`.

### Illustration libraries

The libraries are not in the repository, because together they are well over a
gigabyte. Morphly runs without them, but the sidebar will be empty. Either
fetch one with the scripts in `scraper/` (see the README), or download the NIH
BioArt snapshot that the installer builds use and unpack it at the repository
root:

```bash
curl -L -o bioart_library.tar.gz "https://zenodo.org/records/22764906/files/bioart_library-2026-09-15.tar.gz?download=1"
tar -xzf bioart_library.tar.gz
```

Then choose **File, Add asset library folder** in Morphly and select the folder
that contains `manifest.json`.

## How the code is organised

```
app/
  src/main/          Electron main process: windows, menus, file access,
                     settings, library loading, Art Packs, SVG import and safety
  src/renderer/      the React interface
    App.jsx          layout, keyboard shortcuts, save and open
    store.js         the document state (Zustand) and undo history
    components/      toolbar, canvas, inspector, layers, dialogs
    lib/             pure logic: geometry, snapping, connectors, export,
                     recolouring, the file format, with tests beside each file
scraper/             fetchers that build illustration libraries
tools/               Art Pack builder and Zenodo uploader
.github/workflows/   installer builds for Linux, Windows and macOS
```

A few conventions hold the code together:

- **One implementation per command.** Menu items do not act in the main
  process. They send a named action to the renderer, which runs the same code
  as the keyboard shortcut and the toolbar button.
- **Undo is a snapshot.** Changes that should be undoable go through the
  store's `commit()`. Live updates during a drag do not, and the final state is
  committed once when the drag ends.
- **Logic lives in `lib/`.** Anything that can be tested without a window
  (geometry, layout, export, parsing) belongs there, with a `*.test.js` file
  next to it.
- **The file format is versioned.** `src/renderer/lib/document.js` holds
  `CURRENT_VERSION` and the migrations. If you change what a saved figure
  contains, raise the version and add a migration, so figures made with older
  versions still open.
- **SVG is untrusted input.** Imported files and Art Packs pass through
  `src/main/svgSafety.js`, which removes scripts, event handlers and external
  references. New ways of bringing SVG into Morphly must use it too.

## Tests

```bash
cd app
npm test
```

The tests use [Vitest](https://vitest.dev) and run in a second or two. The
installer workflow runs them before building anything, so a failing test stops
a release. Please add or update tests for any change to the logic in `lib/`,
the store or the main process.

## Style

- **Plain JavaScript**, no TypeScript. Favour explicit, well commented code over
  clever abstractions: many people reading this code are scientists first.
- **Match the code around you**: naming, comment density and structure.
- **British spelling** in interface text and documentation (colour, centre,
  licence), to stay consistent with the rest of the app.
- **No em dashes, en dashes or double hyphens as punctuation**, anywhere: code,
  comments, interface text, documentation or commit messages. Use a comma,
  colon, full stop or parentheses instead.
- **Write interface text from the user's side.** Name things by what people see
  and do ("Edit parts", "Paste in place"), not by how the code works.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request to one topic. Two small pull requests are easier to
   review than one large one.
3. Run `npm test` and try the change in the running app.
4. For interface changes, include a screenshot or a short description of what
   to click.
5. Say in the description if the change affects saved files, export output or
   licensing information.

Commit messages follow the style already in the history: a short summary in
the imperative ("Add panel layouts with automatic panel letters"), then a body
that explains why the change was needed.

Please do not commit illustration libraries, built installers or anything
under `dist/` or `app/release/`. They are ignored by git for a reason.

## Licensing

Morphly's code is released under the [MIT licence](LICENSE). By contributing
code or documentation you agree that your contribution is released under the
same licence.

Illustrations are different: they keep the licences their artists chose, and
they are distributed as Art Packs, never committed here. See
[`NOTICE.md`](NOTICE.md) and [How to add an Art Pack](docs/ADDING_ART_PACKS.md).
