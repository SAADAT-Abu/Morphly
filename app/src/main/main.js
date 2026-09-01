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

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { readSettings } = require("./settings");
const { safeResolve } = require("./library");
const { registerIpc } = require("./ipc");

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
      const settings = await readSettings();
      if (!settings.libraryDir) return new Response("No library configured", { status: 404 });

      // morphly-asset://asset/<relpath> -- the host segment is ignored, the
      // pathname carries the library-relative path.
      const url = new URL(request.url);
      const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const abs = safeResolve(settings.libraryDir, relPath);
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#1e1f24",
    title: "Morphly",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(() => {
  registerAssetProtocol();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
