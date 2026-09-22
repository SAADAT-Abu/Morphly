/**
 * How big each pane of the workspace is.
 *
 * Every boundary between panes can be dragged, as in RStudio: the sidebar and
 * the properties rail get wider or narrower, the layers list and the data
 * table get taller or shorter. Sizes are in pixels, kept in the app's
 * settings, so the workspace opens the way it was left.
 *
 * The rules live here, away from the components, so the limits can be tested:
 * a pane never disappears, and never squeezes its neighbour out of the window.
 */

/** Each pane: where it starts, how small it may get, and what it leaves behind. */
export const PANES = {
  sidebar: { setting: "sidebarWidth", size: 280, min: 200, leave: 420 },
  rail: { setting: "railWidth", size: 300, min: 240, leave: 420 },
  layers: { setting: "layersHeight", size: 240, min: 120, leave: 160 },
  data: { setting: "dataHeight", size: 270, min: 140, leave: 180 },
};

export const defaultSizes = () =>
  Object.fromEntries(Object.entries(PANES).map(([name, pane]) => [name, pane.size]));

/**
 * A size inside that pane's limits. `available` is how much room the pane and
 * its neighbour share; the neighbour always keeps `leave` pixels.
 */
export function clampPane(name, size, available) {
  const pane = PANES[name];
  if (!pane) return size;
  const largest = Math.max(pane.min, (available || 0) - pane.leave);
  return Math.round(Math.max(pane.min, Math.min(largest, size)));
}

/** Sizes read back from settings, ignoring anything that is not a number. */
export function sizesFromSettings(settings = {}) {
  const sizes = defaultSizes();
  for (const [name, pane] of Object.entries(PANES)) {
    const value = Number(settings[pane.setting]);
    if (Number.isFinite(value) && value >= pane.min) sizes[name] = Math.round(value);
  }
  return sizes;
}

/** The settings patch for one pane, for remembering where it was left. */
export const settingFor = (name, size) => ({ [PANES[name].setting]: size });
