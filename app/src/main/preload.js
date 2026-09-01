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

  /** Pick image files and read them back as data URLs. */
  importImage: () => ipcRenderer.invoke("image:import"),

  // projects
  saveProject: (json, filePath) => ipcRenderer.invoke("project:save", { json, filePath }),
  openProject: () => ipcRenderer.invoke("project:open"),

  // export
  exportFile: (opts) => ipcRenderer.invoke("export:file", opts),
  exportPdf: (opts) => ipcRenderer.invoke("export:pdf", opts),
});
