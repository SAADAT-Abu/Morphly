/**
 * Every filesystem / dialog operation the renderer can trigger, in one place.
 * The renderer calls these through the `window.morphly` bridge defined in
 * preload.js.
 *
 * Convention: handlers return plain serialisable objects. Anything that can
 * fail returns { ok: false, error: "<message>" } rather than throwing across
 * the IPC boundary, so the UI can show a message instead of a dead promise.
 */

const { ipcMain, dialog, BrowserWindow, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const { readSettings, writeSettings, libraryKey, libraryDirFor } = require("./settings");
const { loadLibraries, readSvg } = require("./library");

const ok = (data) => ({ ok: true, ...data });
const fail = (err) => ({ ok: false, error: String(err?.message ?? err) });

function registerIpc() {
  // -- settings ------------------------------------------------------------
  ipcMain.handle("settings:get", async () => ok({ settings: await readSettings() }));
  ipcMain.handle("settings:set", async (_event, patch) =>
    ok({ settings: await writeSettings(patch) })
  );

  /** Open a link in the user's browser. Restricted to http(s) so a malformed
   *  or hostile URL cannot be turned into a file:// or command invocation. */
  ipcMain.handle("shell:openExternal", async (_event, url) => {
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return fail(`Refusing to open ${parsed.protocol} link`);
      }
      await shell.openExternal(parsed.toString());
      return ok({});
    } catch (err) {
      return fail(err);
    }
  });

  // -- library -------------------------------------------------------------

  /** Load every configured library folder and merge them into one index. */
  ipcMain.handle("library:load", async () => {
    const { libraries } = await readSettings();
    if (libraries.length === 0) return { ok: false, error: "no-library-configured" };
    return ok({ library: await loadLibraries(libraries) });
  });

  /** Add a folder to the mounted set. Adding one already present is a no-op
   *  rather than an error, so re-picking the same folder is harmless. */
  ipcMain.handle("library:add", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: "Add an asset library folder",
      message: "Choose a folder containing manifest.json",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

    const dir = result.filePaths[0];
    const settings = await readSettings();
    const next = settings.libraries.some((l) => l.dir === dir)
      ? settings.libraries
      : [...settings.libraries, { key: libraryKey(dir), dir }];

    try {
      // Load before persisting, so a folder without a usable manifest is
      // reported instead of being silently mounted as empty.
      const library = await loadLibraries(next);
      if (library.errors.some((e) => e.dir === dir)) {
        return fail(library.errors.find((e) => e.dir === dir).error);
      }
      await writeSettings({ libraries: next, librariesInitialised: true });
      return ok({ library });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("library:remove", async (_event, key) => {
    const settings = await readSettings();
    const next = settings.libraries.filter((l) => l.key !== key);
    // librariesInitialised stops the next launch from silently re-mounting a
    // bundled library the user has just removed.
    await writeSettings({ libraries: next, librariesInitialised: true });
    if (next.length === 0) return { ok: false, error: "no-library-configured" };
    return ok({ library: await loadLibraries(next) });
  });

  /** Fetch one asset's SVG source. The renderer needs the text (not just an
   *  <img> URL) because recolouring rewrites the markup. */
  ipcMain.handle("library:getSvg", async (_event, { source, relPath }) => {
    const dir = await libraryDirFor(source);
    if (!dir) return fail("That asset's library is no longer configured");
    try {
      return ok({ svg: await readSvg(dir, relPath) });
    } catch (err) {
      return fail(err);
    }
  });

  // -- images --------------------------------------------------------------

  /**
   * Import one or more bitmaps (plots, micrographs, photos).
   *
   * The files come back as data URLs rather than paths, so the renderer never
   * needs filesystem access and a saved figure keeps working after the source
   * file has been moved or renamed. Pixel dimensions are read in the renderer,
   * which already has an image decoder.
   */
  ipcMain.handle("image:import", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: "Import image",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

    const MIME = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
    };

    try {
      const images = [];
      for (const filePath of result.filePaths) {
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME[ext];
        if (!mime) {
          return fail(`${path.basename(filePath)} is not an image type Morphly can read`);
        }
        const data = await fs.readFile(filePath);
        images.push({
          name: path.basename(filePath),
          dataUrl: `data:${mime};base64,${data.toString("base64")}`,
        });
      }
      return ok({ images });
    } catch (err) {
      return fail(err);
    }
  });

  /**
   * Confirm throwing away unsaved changes.
   *
   * This lives here rather than being a `window.confirm` in the renderer
   * because Chromium's dialogs block the renderer thread until answered, and
   * an invisible one leaves the whole window unresponsive to clicks while
   * still repainting, which reads as a hang rather than as a prompt.
   */
  ipcMain.handle("app:confirmDiscard", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Discard", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Unsaved changes",
      message: "Discard unsaved changes to this figure?",
      detail: "The current figure has changes that have not been saved.",
    });
    return ok({ discard: choice === 0 });
  });

  // -- projects ------------------------------------------------------------

  ipcMain.handle("project:save", async (event, { json, filePath }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    let target = filePath;
    if (!target) {
      const result = await dialog.showSaveDialog(win, {
        title: "Save Morphly figure",
        defaultPath: "figure.morphly",
        filters: [{ name: "Morphly figure", extensions: ["morphly"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      target = result.filePath;
    }
    try {
      await fs.writeFile(target, json, "utf8");
      return ok({ filePath: target });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("project:open", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: "Open Morphly figure",
      properties: ["openFile"],
      filters: [{ name: "Morphly figure", extensions: ["morphly"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    try {
      const json = await fs.readFile(result.filePaths[0], "utf8");
      return ok({ json, filePath: result.filePaths[0] });
    } catch (err) {
      return fail(err);
    }
  });

  // -- export --------------------------------------------------------------

  /**
   * PNG and SVG are written straight from renderer-produced content.
   * `content` is a base64 string for PNG, plain text for SVG.
   */
  ipcMain.handle("export:file", async (event, { content, encoding, defaultName, filters }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: "Export figure",
      defaultPath: defaultName,
      filters,
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      await fs.writeFile(result.filePath, content, encoding === "base64" ? "base64" : "utf8");
      return ok({ filePath: result.filePath });
    } catch (err) {
      return fail(err);
    }
  });

  /**
   * PDF export. The renderer hands us a complete SVG document; we load it into
   * an offscreen window and use Chromium's own print-to-PDF. That keeps the
   * output genuinely vector -- rasterising to PNG and wrapping it in a PDF
   * would throw away the whole point of scraping vectors in the first place.
   */
  ipcMain.handle("export:pdf", async (event, { svg, widthPt, heightPt, defaultName }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: "Export PDF",
      defaultPath: defaultName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    const offscreen = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, javascript: false },
    });
    try {
      const html = `<!doctype html><meta charset="utf-8">
<style>
  @page { margin: 0; size: ${widthPt}pt ${heightPt}pt; }
  html, body { margin: 0; padding: 0; }
  svg { display: block; }
</style>
${svg}`;
      await offscreen.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
      const pdf = await offscreen.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
      });
      await fs.writeFile(result.filePath, pdf);
      return ok({ filePath: result.filePath });
    } catch (err) {
      return fail(err);
    } finally {
      offscreen.destroy();
    }
  });
}

module.exports = { registerIpc };
