/**
 * Application menu.
 *
 * Menu items don't act directly -- they send a named action to the renderer,
 * which already owns the editor state and the keyboard shortcuts. That keeps
 * one implementation per command instead of a menu copy and a shortcut copy
 * that can drift apart.
 */

const { Menu, shell, app } = require("electron");

const LINKS = {
  bioart: "https://bioart.niaid.nih.gov",
  bioicons: "https://bioicons.com",
  repo: "https://github.com/SAADAT-Abu/Morphly",
  issues: "https://github.com/SAADAT-Abu/Morphly/issues",
  ccby: "https://creativecommons.org/licenses/by/4.0/",
  ccbysa: "https://creativecommons.org/licenses/by-sa/4.0/",
};

function buildMenu(getWindow) {
  const send = (action) => () => getWindow()?.webContents.send("menu:action", action);
  const isMac = process.platform === "darwin";

  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "&File",
      submenu: [
        { label: "New figure", accelerator: "CmdOrCtrl+N", click: send("new") },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: send("open") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: send("save") },
        { label: "Save as…", accelerator: "CmdOrCtrl+Shift+S", click: send("saveAs") },
        { type: "separator" },
        { label: "Export…", accelerator: "CmdOrCtrl+E", click: send("export") },
        { type: "separator" },
        { label: "Add asset library folder…", click: send("addLibrary") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "&Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: send("undo") },
        { label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", click: send("redo") },
        { type: "separator" },
        { label: "Duplicate", accelerator: "CmdOrCtrl+D", click: send("duplicate") },
        { label: "Delete", accelerator: "Delete", click: send("delete") },
        { label: "Select all", accelerator: "CmdOrCtrl+A", click: send("selectAll") },
        { type: "separator" },
        { label: "Group", accelerator: "CmdOrCtrl+G", click: send("group") },
        { label: "Ungroup", accelerator: "CmdOrCtrl+Shift+G", click: send("ungroup") },
      ],
    },
    {
      label: "&Page",
      submenu: [
        { label: "New figure page", accelerator: "CmdOrCtrl+Shift+P", click: send("pageNew") },
        { label: "Duplicate this page", click: send("pageDuplicate") },
        { type: "separator" },
        // No accelerator here: the renderer owns F2, and a menu accelerator
        // would swallow the key before the window ever sees it.
        { label: "Rename this page", click: send("pageRename") },
        { type: "separator" },
        { label: "Next page", accelerator: "CmdOrCtrl+PageDown", click: send("pageNext") },
        { label: "Previous page", accelerator: "CmdOrCtrl+PageUp", click: send("pagePrev") },
      ],
    },
    {
      label: "&Insert",
      submenu: [
        { label: "Table…", accelerator: "CmdOrCtrl+Shift+T", click: send("insertTable") },
        // Not Ctrl+Shift+I: Chromium claims that one for the developer tools,
        // and it wins over an application accelerator.
        { label: "Image…", accelerator: "CmdOrCtrl+Shift+M", click: send("insertImage") },
      ],
    },
    {
      label: "&View",
      submenu: [
        { label: "Zoom in", accelerator: "CmdOrCtrl+Plus", click: send("zoomIn") },
        { label: "Zoom out", accelerator: "CmdOrCtrl+-", click: send("zoomOut") },
        { label: "Fit to screen", accelerator: "CmdOrCtrl+0", click: send("fit") },
        { type: "separator" },
        { label: "Show grid", accelerator: "CmdOrCtrl+'", click: send("toggleGrid") },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "&Help",
      submenu: [
        { label: "Morphly help", accelerator: "F1", click: send("help") },
        {
          label: "Licensing & attribution",
          click: send("help:licensing"),
        },
        { label: "Keyboard shortcuts", click: send("help:shortcuts") },
        { type: "separator" },
        { label: "Show welcome screen", click: send("welcome") },
        { label: "Check for updates…", click: send("checkUpdates") },
        { type: "separator" },
        {
          label: "NIH BioArt Source website",
          click: () => shell.openExternal(LINKS.bioart),
        },
        { label: "Bioicons website", click: () => shell.openExternal(LINKS.bioicons) },
        { type: "separator" },
        { label: "Morphly on GitHub", click: () => shell.openExternal(LINKS.repo) },
        {
          label: "Report a bug or request a feature…",
          click: () => shell.openExternal(LINKS.issues),
        },
        { type: "separator" },
        { label: "About Morphly", click: send("help:about") },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu, LINKS };
