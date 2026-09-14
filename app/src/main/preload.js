/**
 * The only bridge between the renderer and the main process.
 *
 * Everything is an explicit, named function -- the renderer never gets a
 * general-purpose "run this in main" escape hatch, and never sees ipcRenderer
 * itself. Adding a capability means adding a line here and a handler in ipc.js.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("morphly", {
  // settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),

  /** Opens http(s) links in the user's browser. */
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  /** Menu items are routed to the renderer, which owns the editor state.
   *  Returns an unsubscribe function. */
  onMenuAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on("menu:action", handler);
    return () => ipcRenderer.removeListener("menu:action", handler);
  },

  // asset libraries (several can be mounted at once)
  loadLibrary: () => ipcRenderer.invoke("library:load"),
  addLibrary: () => ipcRenderer.invoke("library:add"),
  removeLibrary: (key) => ipcRenderer.invoke("library:remove", key),
  getSvg: (source, relPath) => ipcRenderer.invoke("library:getSvg", { source, relPath }),

  /** URL the <img> tags in the sidebar point at, served by the custom
   *  protocol registered in main.js. The library key indirects through
   *  settings so no absolute path is ever exposed to the renderer. */
  assetUrl: (source, relPath) =>
    "morphly-asset://asset/" +
    [source, ...relPath.split("/")].map(encodeURIComponent).join("/"),

  /** Pick image files. Bitmaps come back as data URLs, SVGs as checked and
   *  sanitised markup ready to place as artwork. */
  importImage: () => ipcRenderer.invoke("image:import"),
  /** Check and sanitise the text of an SVG dropped onto the canvas. */
  prepareSvg: (text) => ipcRenderer.invoke("svg:prepare", text),

  /** Tell the main process whether the figure has unsaved changes, so it can
   *  prompt before the window closes. */
  setDirty: (dirty) => ipcRenderer.send("app:dirty", dirty),
  /** Is a newer release on Zenodo? Reads a public record, sends nothing. */
  checkForUpdate: (opts) => ipcRenderer.invoke("updates:check", opts),
  /** Ask, in a native dialog, whether unsaved changes may be thrown away. */
  confirmDiscard: (options) => ipcRenderer.invoke("app:confirmDiscard", options),
  /** Close the window for real, after saving or discarding. */
  closeWindow: () => ipcRenderer.invoke("app:close"),

  // art packs
  artPackCatalogue: () => ipcRenderer.invoke("artpacks:catalogue"),
  installArtPack: (entry) => ipcRenderer.invoke("artpacks:install", entry),
  removeArtPack: (id) => ipcRenderer.invoke("artpacks:remove", id),
  /** Progress while a pack downloads and unpacks. Returns an unsubscribe. */
  onArtPackProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("artpacks:progress", handler);
    return () => ipcRenderer.removeListener("artpacks:progress", handler);
  },

  // projects
  saveProject: (json, filePath) => ipcRenderer.invoke("project:save", { json, filePath }),
  openProject: () => ipcRenderer.invoke("project:open"),

  // export
  exportFile: (opts) => ipcRenderer.invoke("export:file", opts),
  exportPdf: (opts) => ipcRenderer.invoke("export:pdf", opts),
});
