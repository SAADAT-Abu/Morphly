import { describe, it, expect } from "vitest";
import { buildRaster, RASTER_FORMATS } from "./exporters";

/**
 * A stand-in for a Konva stage that records what toDataURL was asked for and
 * whether the page background and the selection handles were showing at that
 * moment, which is what decides what ends up in the exported image.
 */
function fakeStage() {
  const node = () => ({
    shown: true,
    visible(value) {
      if (value === undefined) return this.shown;
      this.shown = value;
      return this;
    },
  });
  const background = node();
  const handles = node();
  const renders = [];
  return {
    background,
    handles,
    renders,
    findOne: (selector) => (selector === ".canvas-bg" ? background : undefined),
    find: (selector) => (selector === "Transformer" ? [handles] : []),
    batchDraw() {},
    toDataURL(options) {
      renders.push({ ...options, backgroundShown: background.shown, handlesShown: handles.shown });
      return `data:${options.mimeType};base64,AAAA`;
    },
  };
}

const canvas = { width: 400, height: 300, background: "#ffffff" };
const view = { canvas, zoom: 0.5, stagePos: { x: 30, y: 12 } };

describe("buildRaster", () => {
  it("renders exactly the page, at the chosen scale whatever the zoom", () => {
    const stage = fakeStage();
    buildRaster({ stage, ...view, scale: 4 });
    const [render] = stage.renders;
    expect(render).toMatchObject({ x: 30, y: 12, width: 200, height: 150, pixelRatio: 8, mimeType: "image/png" });
    // 200 on-screen pixels at a pixel ratio of 8 is the 1,600 px a 4x export of a 400 px page needs.
    expect(render.width * render.pixelRatio).toBe(canvas.width * 4);
  });

  it("hides the selection handles while rendering and shows them again after", () => {
    const stage = fakeStage();
    buildRaster({ stage, ...view });
    expect(stage.renders[0].handlesShown).toBe(false);
    expect(stage.handles.shown).toBe(true);
  });

  it("leaves out the page background for a transparent PNG, then restores it", () => {
    const stage = fakeStage();
    buildRaster({ stage, ...view, transparent: true, format: "png" });
    expect(stage.renders[0].backgroundShown).toBe(false);
    expect(stage.background.shown).toBe(true);
  });

  it("always draws the page background for JPEG, which has no transparency", () => {
    const stage = fakeStage();
    buildRaster({ stage, ...view, transparent: true, format: "jpeg", quality: 0.8 });
    const [render] = stage.renders;
    expect(render.backgroundShown).toBe(true);
    expect(render.mimeType).toBe("image/jpeg");
    expect(render.quality).toBe(0.8);
  });

  it("does not pass a quality for PNG", () => {
    const stage = fakeStage();
    buildRaster({ stage, ...view, format: "png", quality: 0.5 });
    expect(stage.renders[0]).not.toHaveProperty("quality");
  });

  it("names the file extension for each format", () => {
    expect(RASTER_FORMATS.png.extension).toBe("png");
    expect(RASTER_FORMATS.jpeg.extension).toBe("jpg");
  });

  it("refuses a format it does not know", () => {
    expect(() => buildRaster({ stage: fakeStage(), ...view, format: "gif" })).toThrow(/Unknown raster format/);
  });
});
