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

const { libraryDirFor } = require("./settings");
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
