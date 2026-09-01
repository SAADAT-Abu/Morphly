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

  // asset library
  pickLibraryFolder: () => ipcRenderer.invoke("library:pickFolder"),
  loadSavedLibrary: () => ipcRenderer.invoke("library:loadSaved"),
  getSvg: (relPath) => ipcRenderer.invoke("library:getSvg", relPath),

  /** URL the <img> tags in the sidebar point at, served by the custom
   *  protocol registered in main.js. */
  assetUrl: (relPath) =>
    "morphly-asset://asset/" + relPath.split("/").map(encodeURIComponent).join("/"),

  // projects
  saveProject: (json, filePath) => ipcRenderer.invoke("project:save", { json, filePath }),
  openProject: () => ipcRenderer.invoke("project:open"),

  // export
  exportFile: (opts) => ipcRenderer.invoke("export:file", opts),
  exportPdf: (opts) => ipcRenderer.invoke("export:pdf", opts),
});
