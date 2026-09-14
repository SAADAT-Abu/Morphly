/**
 * Morphly - Electron main process
 *
 * Responsibilities:
 *   1. Create the application window.
 *   2. Serve BioArt SVG files to the renderer over a custom `morphly-asset://`
 *      protocol, so <img src> works without giving the renderer filesystem
 *      access.
 *   3. Expose a small IPC surface (library loading, project save/open, export)
 *      that the preload script bridges into the renderer.
 *
 * Security posture: the renderer runs with contextIsolation on and node
 * integration off. It never touches `fs` directly -- every filesystem
 * operation goes through a handler here, and every path is checked to make
 * sure it stays inside the configured library folder.
 */

const { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { libraryDirFor, readSettings } = require("./settings");
const { safeResolve } = require("./library");
const { registerIpc } = require("./ipc");
const { createRecovery } = require("./recovery");
const { buildMenu } = require("./menu");

const isDev = !app.isPackaged;
const DEV_SERVER_URL = "http://localhost:5173";

// ---------------------------------------------------------------------------
// Custom protocol: morphly-asset://<url-encoded relative path>
// ---------------------------------------------------------------------------

// Must be called before `app.ready`. Marking the scheme standard + secure lets
// the renderer load these URLs from an https/http origin without mixed-content
// or CORS complaints.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "morphly-asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true },
  },
]);

function registerAssetProtocol() {
  protocol.handle("morphly-asset", async (request) => {
    try {
      // morphly-asset://asset/<libraryKey>/<relative path>
      // The library key indirects through settings, so the renderer never
      // learns or supplies an absolute filesystem path.
      const url = new URL(request.url);
      const segments = decodeURIComponent(url.pathname).replace(/^\/+/, "").split("/");
      const key = segments.shift();
      const relPath = segments.join("/");

      const dir = await libraryDirFor(key);
      if (!dir) return new Response("Unknown library", { status: 404 });

      const abs = safeResolve(dir, relPath);
      return net.fetch(pathToFileURL(abs).toString());
    } catch (err) {
      return new Response(String(err.message ?? err), { status: 403 });
    }
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow = null;

/** Spare copy of the open figure; see recovery.js. Created once the app is
 *  ready, because userData is only known then. */
let recovery = null;

/**
 * Unsaved-changes state, mirrored from the renderer.
 *
 * The obvious way to guard a close is the renderer's `beforeunload` event, and
 * that is what Morphly did. It does not work in Electron: returning a value
 * from the handler cancels the close silently, with no prompt and no way for
 * the user to proceed, so a figure with unsaved edits made the window refuse
 * to close at all. The guard belongs in the main process, where a real dialog
 * can be shown and the answer acted on.
 */
let documentDirty = false;
/** Set once the user has answered the prompt, so the second close goes through. */
let closeConfirmed = false;

function registerCloseGuard(win) {
  ipcMain.removeAllListeners("app:dirty");
  ipcMain.on("app:dirty", (_event, dirty) => {
    documentDirty = Boolean(dirty);
  });

  // The renderer calls this once it has finished saving, or when the user
  // chose to discard, to let the close it interrupted go ahead.
  ipcMain.removeHandler("app:close");
  ipcMain.handle("app:close", () => {
    closeConfirmed = true;
    win.destroy();
    return { ok: true };
  });

  win.on("close", (event) => {
    if (closeConfirmed || !documentDirty) return;
    event.preventDefault();

    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Save", "Discard", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Unsaved changes",
      message: "Save changes to this figure before closing?",
      detail: "Your figure has changes that have not been written to a file yet.",
    });

    if (choice === 0) {
      // The renderer owns the document, so it does the saving and closes the
      // window itself once the file is written. A cancelled save dialog simply
      // leaves the window open.
      win.webContents.send("menu:action", "saveAndClose");
    } else if (choice === 1) {
      closeConfirmed = true;
      win.destroy();
    }
  });
}

/**
 * Keep the recovery copy exactly as long as it is useful.
 *
 * A window that closes normally has either saved or been told to discard, so
 * its copy goes. If the page itself crashes the copy is the whole point, so
 * the window reloads instead and the fresh page offers to restore it. Reloads
 * are limited, so a page that crashes on load cannot spin forever.
 */
function registerRecovery(win) {
  recovery.open();
  let lastReload = 0;

  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    if (Date.now() - lastReload < 60_000) return;
    lastReload = Date.now();
    // The new page starts with nothing unsaved; it reports otherwise if the
    // user restores their figure.
    documentDirty = false;
    win.reload();
  });

  win.on("closed", () => recovery.close());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#1e1f24",
    title: "Morphly",
    icon: path.join(__dirname, "../../build/icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  registerCloseGuard(mainWindow);
  registerRecovery(mainWindow);

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(() => {
  registerAssetProtocol();
  recovery = createRecovery(path.join(app.getPath("userData"), "recovery"));
  registerIpc({ recovery });
  createWindow();
  buildMenu(() => mainWindow);
  readSettings().then((settings) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById("autosave");
    if (item) item.checked = settings.autosave !== false;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
