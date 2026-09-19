/**
 * Deciding when to take a crash recovery copy of the figure.
 *
 * The copy itself is stored by the main process (main/recovery.js), in
 * Morphly's own data folder and never in the user's file. This module only
 * watches the store and decides when a copy is due:
 *
 *   - only while there are unsaved changes, and only when the document itself
 *     changed (selecting, zooming and panning do not count)
 *   - a few seconds after the first change, so a burst of edits is one copy
 *   - then at most once per interval, however busy the user is
 *   - once the figure is saved, or replaced by a new or opened one, the copy
 *     is removed, because there is nothing left to recover
 */

import { serialise } from "./document";

export const RECOVERY_FORMAT = "morphly-recovery";
export const RECOVERY_INTERVAL_MS = 20000;
export const RECOVERY_MIN_DELAY_MS = 3000;

/** Store fields that belong to the figure, as opposed to the view. */
const DOCUMENT_KEYS = ["elements", "canvas", "pages", "activePageId", "datasets", "projectPath", "title"];

/** The copy as written: the figure in the normal file format, plus where it
 *  was last saved so a restored figure saves back to the same file. */
export function buildSnapshot(state, now = new Date()) {
  return {
    format: RECOVERY_FORMAT,
    savedAt: now.toISOString(),
    projectPath: state.projectPath ?? null,
    title: state.title ?? null,
    document: serialise({ pages: state.allPages(), activePageId: state.activePageId, datasets: state.datasets }),
  };
}

/**
 * Start watching. `bridge` provides writeRecovery(json) and clearRecovery().
 * Returns a function that stops watching.
 */
export function watchForRecovery(
  store,
  bridge,
  { interval = RECOVERY_INTERVAL_MS, minDelay = RECOVERY_MIN_DELAY_MS } = {}
) {
  let timer = null;
  let lastWrite = -Infinity;

  const write = () => {
    timer = null;
    const state = store.getState();
    if (!state.dirty) return;
    lastWrite = Date.now();
    bridge.writeRecovery(JSON.stringify(buildSnapshot(state)));
  };

  const unsubscribe = store.subscribe((state, previous) => {
    if (!state.dirty) {
      if (previous.dirty) {
        clearTimeout(timer);
        timer = null;
        bridge.clearRecovery();
      }
      return;
    }

    const changed = !previous.dirty || DOCUMENT_KEYS.some((key) => state[key] !== previous[key]);
    // A copy already scheduled will pick this change up when it runs.
    if (!changed || timer) return;
    timer = setTimeout(write, Math.max(minDelay, interval - (Date.now() - lastWrite)));
  });

  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
