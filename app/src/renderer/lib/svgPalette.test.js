import { describe, it, expect } from "vitest";
import {
  toHex,
  extractPalette,
  applyPalette,
  parseViewBox,
  intrinsicSize,
  ensureIntrinsicSize,
  effectiveColorMap,
  buildIsolationSvg,
} from "./svgPalette";

describe("toHex", () => {
  it("normalises short and long hex to lower-case #rrggbb", () => {
    expect(toHex("#ABC")).toBe("#aabbcc");
    expect(toHex("#1A2b3C")).toBe("#1a2b3c");
    expect(toHex("  #ffffff  ")).toBe("#ffffff");
  });

  it("returns null for values that are not flat colours", () => {
    for (const value of [null, undefined, "", "none", "transparent", "currentColor", "url(#gradient)"]) {
      expect(toHex(value)).toBeNull();
    }
  });

  it("cannot resolve colour names outside a browser, and says so with null", () => {
    expect(toHex("rebeccapurple")).toBeNull();
  });
});

describe("extractPalette", () => {
  it("counts colours in both attributes and CSS rules, most used first", () => {
    const svg =
      "<svg><style>.a { fill: #C5F8F6; } .b { stroke: #465b5a; stroke-width: 2.19px; }</style>" +
      '<path class="a" fill="#c5f8f6"/><rect stroke="#465B5A" fill="none"/><circle fill="#000000"/></svg>';
    expect(extractPalette(svg)).toEqual([
      { hex: "#465b5a", count: 2 },
      { hex: "#c5f8f6", count: 2 },
      { hex: "#000000", count: 1 },
    ]);
  });

  it("ignores colours written inside metadata", () => {
    const svg = '<svg><metadata><title>fill="#ff0000"</title></metadata><path fill="#00ff00"/></svg>';
    expect(extractPalette(svg)).toEqual([{ hex: "#00ff00", count: 1 }]);
  });

  it("returns nothing for empty input", () => {
    expect(extractPalette("")).toEqual([]);
    expect(extractPalette(undefined)).toEqual([]);
  });
});

describe("applyPalette", () => {
  it("recolours attribute and CSS forms, keeping CSS formatting", () => {
    const svg = '<style>.a { fill: #C5F8F6 ; }</style><path fill="#c5f8f6" stroke-width="2"/>';
    const out = applyPalette(svg, { "#c5f8f6": "#2a9d8f" });
    expect(out).toContain('fill="#2a9d8f"');
    expect(out).toContain("fill: #2a9d8f ;");
    expect(out).toContain('stroke-width="2"');
    expect(out).not.toMatch(/c5f8f6/i);
  });

  it("keeps the quote style of the attribute", () => {
    expect(applyPalette("<path fill='#aabbcc'/>", { "#aabbcc": "#000000" })).toBe("<path fill='#000000'/>");
  });

  it("leaves colours that are not in the map untouched", () => {
    const svg = '<path fill="#111111"/><path fill="#222222"/>';
    expect(applyPalette(svg, { "#111111": "#ff0000" })).toBe('<path fill="#ff0000"/><path fill="#222222"/>');
  });

  it("returns the original text when there is nothing to change", () => {
    const svg = '<path fill="#111111"/>';
    expect(applyPalette(svg, {})).toBe(svg);
    expect(applyPalette(svg, null)).toBe(svg);
  });

  it("keeps BioArt's ns0: element prefixes intact", () => {
    const svg = '<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg"><ns0:path fill="#111111"/></ns0:svg>';
    const out = applyPalette(svg, { "#111111": "#ff0000" });
    expect(out).toBe('<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg"><ns0:path fill="#ff0000"/></ns0:svg>');
  });
});

describe("parseViewBox", () => {
  it("reads negative and decimal values", () => {
    expect(parseViewBox('<svg viewBox="-120.5 -155.297 880.8 532.8">')).toEqual({
      x: -120.5,
      y: -155.297,
      width: 880.8,
      height: 532.8,
    });
  });

  it("accepts comma separators", () => {
    expect(parseViewBox('<svg viewBox="0,0,10,20">')).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });

  it("returns null when there is no viewBox", () => {
    expect(parseViewBox("<svg width='10'>")).toBeNull();
  });
});

describe("intrinsicSize", () => {
  it("keeps the author's absolute size even when the viewBox has another shape", () => {
    // The 1000 ml Erlenmeyer flask: drawn from its viewBox it came out cropped.
    const flask = '<svg width="350" height="500" viewBox="-120.5 -155.297 880.8 532.8"><path/></svg>';
    expect(intrinsicSize(flask)).toEqual({ width: 350, height: 500 });
  });

  it("reads units such as px", () => {
    expect(intrinsicSize('<svg width="350px" height="120px">')).toEqual({ width: 350, height: 120 });
  });

  it("falls back to the viewBox for percentage sizes", () => {
    expect(intrinsicSize('<svg width="100%" height="100%" viewBox="0 0 40 20">')).toEqual({ width: 40, height: 20 });
  });

  it("uses a default when a file declares no size at all", () => {
    expect(intrinsicSize("<svg><path/></svg>")).toEqual({ width: 512, height: 512 });
  });
});

describe("ensureIntrinsicSize", () => {
  it("leaves absolute sizes exactly as written", () => {
    const svg = '<svg width="350" height="500" viewBox="0 0 10 10"><path/></svg>';
    expect(ensureIntrinsicSize(svg)).toBe(svg);
  });

  it("adds a size from the viewBox when the file has none", () => {
    const out = ensureIntrinsicSize('<svg viewBox="0 0 40 20"><path/></svg>');
    expect(out).toContain('width="40"');
    expect(out).toContain('height="20"');
  });

  it("replaces percentage sizes rather than adding a second width", () => {
    const out = ensureIntrinsicSize('<svg width="100%" height="100%" viewBox="0 0 40 20"><path/></svg>');
    expect(out).not.toContain("100%");
    expect(out.match(/width=/g)).toHaveLength(1);
  });
});

describe("effectiveColorMap", () => {
  it("adds hidden colour parts as none, on top of recolouring", () => {
    const element = { colorMap: { "#aaaaaa": "#bbbbbb" }, hiddenColors: ["#cccccc"] };
    expect(effectiveColorMap(element)).toEqual({ "#aaaaaa": "#bbbbbb", "#cccccc": "none" });
    expect(element.colorMap).toEqual({ "#aaaaaa": "#bbbbbb" });
  });

  it("handles elements with neither field", () => {
    expect(effectiveColorMap({})).toEqual({});
  });
});

describe("buildIsolationSvg", () => {
  it("paints only the target colour and hides everything else", () => {
    const svg = '<path fill="#111111"/><path fill="#222222"/>';
    const palette = [{ hex: "#111111" }, { hex: "#222222" }];
    expect(buildIsolationSvg(svg, palette, "#222222")).toBe('<path fill="none"/><path fill="#ff2d95"/>');
  });
});
