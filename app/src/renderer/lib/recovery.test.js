import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { watchForRecovery, buildSnapshot, RECOVERY_FORMAT } from "./recovery";
import { migrate } from "./document";

/** Just enough of a Zustand store: getState, setState and subscribe. */
function fakeStore() {
  const listeners = new Set();
  let state = {
    elements: [],
    canvas: { width: 100, height: 100 },
    pages: [{ id: "p1", name: "Figure 1", canvas: {}, elements: [] }],
    activePageId: "p1",
    projectPath: null,
    dirty: false,
    selectedIds: [],
    zoom: 1,
    allPages: () => state.pages.map((p) => (p.id === state.activePageId ? { ...p, elements: state.elements, canvas: state.canvas } : p)),
  };
  return {
    getState: () => state,
    setState(patch) {
      const previous = state;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const edit = (store, label) =>
  store.setState({ elements: [...store.getState().elements, { id: label, type: "rect" }], dirty: true });

let store;
let bridge;
let stop;

beforeEach(() => {
  vi.useFakeTimers();
  store = fakeStore();
  bridge = { writeRecovery: vi.fn(), clearRecovery: vi.fn() };
  stop = watchForRecovery(store, bridge, { interval: 20000, minDelay: 3000 });
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

const written = (call = -1) => JSON.parse(bridge.writeRecovery.mock.calls.at(call)[0]);

describe("watchForRecovery", () => {
  it("takes no copy of a figure with nothing unsaved", () => {
    store.setState({ selectedIds: ["a"], zoom: 2 });
    vi.advanceTimersByTime(60000);
    expect(bridge.writeRecovery).not.toHaveBeenCalled();
  });

  it("takes the first copy a few seconds after the first change", () => {
    edit(store, "a");
    vi.advanceTimersByTime(2999);
    expect(bridge.writeRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(bridge.writeRecovery).toHaveBeenCalledTimes(1);
  });

  it("folds a burst of edits into one copy holding the latest state", () => {
    edit(store, "a");
    vi.advanceTimersByTime(1000);
    edit(store, "b");
    edit(store, "c");
    vi.advanceTimersByTime(2000);
    expect(bridge.writeRecovery).toHaveBeenCalledTimes(1);
    expect(written().document.pages[0].elements.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("copies at most once per interval while the user keeps working", () => {
    for (let second = 0; second < 60; second += 1) {
      edit(store, `e${second}`);
      vi.advanceTimersByTime(1000);
    }
    // First copy at 3 s, then at 23 s, 43 s: never more often than every 20 s.
    expect(bridge.writeRecovery).toHaveBeenCalledTimes(3);
  });

  it("ignores view changes once a copy is up to date", () => {
    edit(store, "a");
    vi.advanceTimersByTime(3000);
    store.setState({ selectedIds: ["a"], zoom: 3 });
    vi.advanceTimersByTime(60000);
    expect(bridge.writeRecovery).toHaveBeenCalledTimes(1);
  });

  it("removes the copy and cancels a pending one when the figure is saved", () => {
    edit(store, "a");
    store.setState({ dirty: false, projectPath: "/figures/a.morphly" });
    expect(bridge.clearRecovery).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(bridge.writeRecovery).not.toHaveBeenCalled();
  });

  it("stops watching when asked", () => {
    stop();
    edit(store, "a");
    vi.advanceTimersByTime(60000);
    expect(bridge.writeRecovery).not.toHaveBeenCalled();
  });

  it("writes a copy that opens like a saved figure and remembers its file", () => {
    store.setState({ projectPath: "/figures/cells.morphly" });
    edit(store, "a");
    vi.advanceTimersByTime(3000);
    const snapshot = written();
    expect(snapshot).toMatchObject({ format: RECOVERY_FORMAT, projectPath: "/figures/cells.morphly" });
    expect(migrate(snapshot.document).pages[0].elements).toEqual([{ id: "a", type: "rect" }]);
  });
});

describe("buildSnapshot", () => {
  it("stamps the time the copy was taken", () => {
    const state = fakeStore().getState();
    expect(buildSnapshot(state, new Date("2026-09-14T10:00:00Z")).savedAt).toBe("2026-09-14T10:00:00.000Z");
  });
});
