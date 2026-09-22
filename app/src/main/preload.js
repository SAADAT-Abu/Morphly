/**
 * The only bridge between the renderer and the main process.
 *
 * Everything is an explicit, named function -- the renderer never gets a
 * general-purpose "run this in main" escape hatch, and never sees ipcRenderer
 * itself. Adding a capability means adding a line here and a handler in ipc.js.
 */

const { contextBridge, ipcRenderer } = require("electron");

/** Subscribe to one channel; returns the unsubscribe function. */
function listen(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("morphly", {
  // settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),

  /** The running app version, for the About tab. */
  appVersion: () => ipcRenderer.invoke("app:version"),

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

  // clipboard and right-click menu
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:writeText", text),
  /** Show a native context menu; chosen items arrive through onMenuAction. */
  showContextMenu: (items) => ipcRenderer.invoke("contextMenu:show", items),

  // crash recovery: a spare copy in Morphly's data folder, never the user's file
  writeRecovery: (json) => ipcRenderer.invoke("recovery:write", json),
  clearRecovery: () => ipcRenderer.invoke("recovery:clear"),
  /** Offers a copy left by a crash back to the user; resolves to
   *  { found, snapshot }. */
  checkRecovery: () => ipcRenderer.invoke("recovery:check"),

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
  saveProject: (json, filePath, title) => ipcRenderer.invoke("project:save", { json, filePath, title }),
  /** Save without a dialog: to the figure's file, or new into the default folder. */
  autosaveProject: (opts) => ipcRenderer.invoke("project:autosave", opts),
  /** Rename a saved figure's file to match its new title. */
  renameProject: (opts) => ipcRenderer.invoke("project:rename", opts),
  /** { saveFolder, isDefaultFolder, autosave } */
  fileSettings: () => ipcRenderer.invoke("files:settings"),
  chooseSaveFolder: () => ipcRenderer.invoke("files:chooseSaveFolder"),
  setAutosave: (enabled) => ipcRenderer.invoke("files:setAutosave", enabled),
  openProject: () => ipcRenderer.invoke("project:open"),

  /** Pick a CSV or TSV file of numbers; resolves to { ok, text, name }. */
  importTable: () => ipcRenderer.invoke("data:importTable"),

  /**
   * The data window. The editor opens and closes it, sends it the dataset and
   * hears its edits; the data window asks for the dataset, sends edits and
   * can ask to be put back under the canvas.
   */
  dataWindow: {
    open: () => ipcRenderer.invoke("dataWindow:open"),
    close: () => ipcRenderer.invoke("dataWindow:close"),
    push: (payload) => ipcRenderer.send("dataWindow:push", payload),
    ready: () => ipcRenderer.send("dataWindow:ready"),
    op: (payload) => ipcRenderer.send("dataWindow:op", payload),
    dock: () => ipcRenderer.send("dataWindow:dock"),
    onDataset: (callback) => listen("dataWindow:dataset", callback),
    onOp: (callback) => listen("dataWindow:op", callback),
    onWantDataset: (callback) => listen("dataWindow:wantDataset", callback),
    onClosed: (callback) => listen("dataWindow:closed", callback),
    onDocked: (callback) => listen("dataWindow:docked", callback),
  },

  // export
  exportFile: (opts) => ipcRenderer.invoke("export:file", opts),
  exportPdf: (opts) => ipcRenderer.invoke("export:pdf", opts),
});
