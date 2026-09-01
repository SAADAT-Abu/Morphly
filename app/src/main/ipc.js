/**
 * Every filesystem / dialog operation the renderer can trigger, in one place.
 * The renderer calls these through the `window.morphly` bridge defined in
 * preload.js.
 *
 * Convention: handlers return plain serialisable objects. Anything that can
 * fail returns { ok: false, error: "<message>" } rather than throwing across
 * the IPC boundary, so the UI can show a message instead of a dead promise.
 */

const { ipcMain, dialog, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const { readSettings, writeSettings } = require("./settings");
const { loadLibrary, readSvg } = require("./library");

const ok = (data) => ({ ok: true, ...data });
const fail = (err) => ({ ok: false, error: String(err?.message ?? err) });

function registerIpc() {
  // -- settings ------------------------------------------------------------
  ipcMain.handle("settings:get", async () => ok({ settings: await readSettings() }));

  // -- library -------------------------------------------------------------

  ipcMain.handle("library:pickFolder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: "Select your BioArt library folder",
      message: "Choose the folder containing manifest.json",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

    const dir = result.filePaths[0];
    try {
      const library = await loadLibrary(dir);
      await writeSettings({ libraryDir: dir });
      return ok({ library });
    } catch (err) {
      return fail(err);
    }
  });

  /** Load the library remembered from last time, if it is still readable. */
  ipcMain.handle("library:loadSaved", async () => {
    const { libraryDir } = await readSettings();
    if (!libraryDir) return { ok: false, error: "no-library-configured" };
    try {
      return ok({ library: await loadLibrary(libraryDir) });
    } catch (err) {
      return fail(err);
    }
  });

  /** Fetch one asset's SVG source. The renderer needs the text (not just an
   *  <img> URL) because recolouring rewrites the markup. */
  ipcMain.handle("library:getSvg", async (_event, relPath) => {
    const { libraryDir } = await readSettings();
    if (!libraryDir) return fail("No library configured");
    try {
      return ok({ svg: await readSvg(libraryDir, relPath) });
    } catch (err) {
      return fail(err);
    }
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
