import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useStore } from "../store";
import Inspector from "./Inspector";

/**
 * The properties panel, rendered to HTML without a window, for the parts that
 * are easy to lose in a refactor: which controls appear for which element, and
 * what the store holds after they are used.
 */
const h = React.createElement;
const state = () => useStore.getState();
const html = (el) => {
  Object.assign(useStore.getInitialState(), useStore.getState());
  return renderToStaticMarkup(el);
};

const selectOnly = (id) => useStore.setState({ selectedIds: [id] });

describe("locking the aspect ratio", () => {
  beforeEach(() => state().newDocument());

  const addImage = () =>
    state().addImage({ src: "data:image/png;base64,iVBORw0KGgo=", naturalWidth: 800, naturalHeight: 400, name: "Blot" });

  it("offers the lock, already ticked, for an image", () => {
    selectOnly(addImage());
    const out = html(h(Inspector));
    expect(out).toContain("Lock the aspect ratio");
    expect(out).toContain('<input type="checkbox" checked=""/>Lock the aspect ratio');
    // The hint tells you the way out, which is the same key every editor uses.
    expect(out).toContain("Hold Shift while dragging");
    expect(out).not.toMatch(/[–—]/);
  });

  it("offers it unticked for a shape, which is meant to be reshaped", () => {
    selectOnly(state().addShape("rect"));
    const out = html(h(Inspector));
    expect(out).toContain('<input type="checkbox"/>Lock the aspect ratio');
    expect(out).toContain("Hold Shift while dragging a corner to keep the proportions.");
  });

  it("does not offer it for text, which is as tall as its lines make it", () => {
    selectOnly(state().addText({ x: 10, y: 10 }, "Hello"));
    expect(html(h(Inspector))).not.toContain("Lock the aspect ratio");
  });

  it("keeps the proportions when a size is typed, and lets go when unticked", () => {
    const id = addImage();
    const width = () => state().elements.find((e) => e.id === id).width;
    const height = () => state().elements.find((e) => e.id === id).height;
    const ratio = width() / height();
    expect(ratio).toBeCloseTo(2, 6);

    state().updateElement(id, { width: 600, height: Math.round(600 / ratio) });
    expect(height()).toBe(300);

    // Unticking is remembered as a choice, not as a missing value.
    state().updateElement(id, { lockAspect: false });
    expect(state().elements.find((e) => e.id === id).lockAspect).toBe(false);
    selectOnly(id);
    expect(html(h(Inspector))).toContain("Drag any handle to stretch it.");
  });
});
