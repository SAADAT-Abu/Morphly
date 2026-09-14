import { describe, it, expect } from "vitest";
import { XMLValidator } from "fast-xml-parser";
import { buildSvg } from "./exporters";

const canvas = { width: 400, height: 300, background: "#ffffff" };
let n = 0;
const el = (over) => ({
  id: `el_${++n}`,
  x: 10,
  y: 20,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  ...over,
});
const exportOf = (elements, options = {}) => buildSvg({ elements, canvas, stage: null, ...options });
const wellFormed = (svg) => expect(XMLValidator.validate(svg)).toBe(true);

describe("buildSvg document", () => {
  it("exports an empty figure as a well-formed SVG of the page size", () => {
    const svg = exportOf([]);
    wellFormed(svg);
    expect(svg).toContain('width="400" height="300" viewBox="0 0 400 300"');
    expect(svg).toContain('<rect x="0" y="0" width="400" height="300" fill="#ffffff"/>');
  });

  it("drops the page background when exporting transparently", () => {
    expect(exportOf([], { transparent: true })).not.toContain('width="400" height="300" fill="#ffffff"');
  });

  it("leaves hidden elements out", () => {
    const svg = exportOf([el({ type: "rect", width: 5, height: 5, fill: "#123456", stroke: "#000000", strokeWidth: 1, visible: false })]);
    expect(svg).not.toContain("#123456");
  });

  it("appends citations below the figure and grows the page to fit", () => {
    const svg = exportOf([], { citationText: "First credit\nSecond & third" });
    wellFormed(svg);
    const height = Number(/<svg[^>]*\sheight="([\d.]+)"/.exec(svg)[1]);
    expect(height).toBeGreaterThan(300);
    expect(svg).toContain("Second &amp; third");
    expect(svg.match(/fill="#555555"/g)).toHaveLength(2);
  });
});

describe("buildSvg elements", () => {
  it("places, rotates and fades an element", () => {
    const svg = exportOf([el({ type: "rect", width: 50, height: 40, cornerRadius: 4, fill: "#4d7fd6", stroke: "#1f3a63", strokeWidth: 2, rotation: 15, opacity: 0.5 })]);
    wellFormed(svg);
    expect(svg).toContain('transform="translate(10 20) rotate(15)"');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('rx="4"');
  });

  it("does not write an invalid opacity for elements saved without one", () => {
    const element = el({ type: "rect", width: 5, height: 5, fill: "#000000", stroke: "#000000", strokeWidth: 1 });
    delete element.opacity;
    const svg = exportOf([element]);
    expect(svg).not.toContain("undefined");
  });

  it("centres an ellipse in its box", () => {
    const svg = exportOf([el({ type: "ellipse", width: 60, height: 40, fill: "#000000", stroke: "#000000", strokeWidth: 1 })]);
    expect(svg).toContain('cx="30" cy="20" rx="30" ry="20"');
  });

  it.each([
    ["none", 0],
    ["end", 1],
    ["both", 2],
  ])("draws %s arrow heads as %i polygon(s)", (heads, count) => {
    const svg = exportOf([el({ type: "arrow", points: [0, 0, 100, 0], fill: "#000000", strokeWidth: 4, heads })]);
    wellFormed(svg);
    expect(svg.match(/<polygon/g) ?? []).toHaveLength(count);
  });

  it("stops the arrow shaft at the base of its head", () => {
    const svg = exportOf([el({ type: "arrow", points: [0, 0, 100, 0], fill: "#000000", strokeWidth: 4, heads: "end" })]);
    expect(svg).toContain('d="M0 0L88 0"');
  });

  it("draws curved and elbow connectors from the same geometry as the canvas", () => {
    const box = el({ id: "box", type: "rect", x: 200, y: 100, width: 100, height: 50, fill: "#ffffff", stroke: "#000000", strokeWidth: 1 });
    const elbow = el({
      type: "arrow", x: 0, y: 0, points: [0, 0, 200, 125], fill: "#000000", strokeWidth: 2, heads: "end",
      route: "elbow", start: null, end: { elementId: "box", anchor: "left" },
    });
    const curve = el({ type: "line", x: 0, y: 0, points: [0, 0, 100, 0], fill: "#000000", strokeWidth: 2, route: "curved", bend: { along: 0.5, offset: 40 } });
    const svg = exportOf([box, elbow, curve]);
    wellFormed(svg);
    // Into the box's left side horizontally, stopped at the head's base. The
    // glued end runs out a 16 unit stub, so the middle leg sits halfway
    // between 0 and 184.
    expect(svg).toContain('d="M0 0L92 0L92 125L194 125"');
    expect(svg).toContain('d="M0 0Q50 80 100 0"');
  });

  it("escapes text and writes one line per row", () => {
    const svg = exportOf([el({ type: "text", text: "A & B <C>\nsecond line", width: 200, fontSize: 20, fontFamily: "Helvetica", fontStyle: "bold", align: "left", fill: "#111111" })]);
    wellFormed(svg);
    expect(svg).toContain("A &amp; B &lt;C&gt;");
    expect(svg.match(/<tspan/g)).toHaveLength(2);
    expect(svg).toContain('font-weight="bold"');
  });

  it("writes a shape's caption centred on top of it", () => {
    const svg = exportOf([el({ type: "rect", width: 100, height: 50, fill: "#000000", stroke: "#000000", strokeWidth: 1, label: "Cell & nucleus", labelSize: 12 })]);
    wellFormed(svg);
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain("Cell &amp; nucleus");
  });

  it("exports a table with escaped cells, a header fill and rounded outer corners", () => {
    const table = el({
      type: "table",
      width: 200,
      height: 60,
      rows: 2,
      cols: 2,
      colWidths: [100, 100],
      rowHeights: [30, 30],
      cells: [["Gene", "Cell & type"], ["GFAP", "Astrocyte"]],
      headerRow: true,
      headerCol: false,
      headerFill: "#2f4b7c",
      headerTextColor: "#ffffff",
      fill: "#ffffff",
      stripeFill: "",
      stroke: "#8b93a7",
      strokeWidth: 1,
      cornerRadius: 6,
      showInnerLines: true,
      fontSize: 12,
      fontFamily: "Helvetica",
      textColor: "#111111",
      align: "left",
      padding: 6,
    });
    const svg = exportOf([table]);
    wellFormed(svg);
    expect(svg).toContain("Cell &amp; type");
    expect(svg).toContain('fill="#2f4b7c"');
    expect(svg).toMatch(/\sa6,6 0 0 1/);
    expect(svg.match(/<line /g)).toHaveLength(2);
  });

  it("clips rounded images with a real clipPath, and not otherwise", () => {
    const src = "data:image/png;base64,iVBORw0KGgo=";
    const rounded = exportOf([el({ type: "image", width: 80, height: 60, src, cornerRadius: 8 })]);
    wellFormed(rounded);
    expect(rounded).toContain("<clipPath");
    expect(rounded).toContain(src);
    const square = exportOf([el({ type: "image", width: 80, height: 60, src, cornerRadius: 0 })]);
    expect(square).not.toContain("<clipPath");
  });

  it("inlines an asset at its size with recolouring and hidden parts applied", () => {
    const svgSource =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10">' +
      '<rect fill="#111111" width="5" height="5"/><circle fill="#222222" r="2"/></svg>';
    const svg = exportOf([
      el({ type: "asset", width: 80, height: 60, svgSource, colorMap: { "#111111": "#ff0000" }, hiddenColors: ["#222222"] }),
    ]);
    wellFormed(svg);
    expect(svg).not.toContain("<?xml");
    expect(svg).toMatch(/<svg[^>]*x="0" y="0" width="80" height="60"/);
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill="none"');
    expect(svg).not.toContain("#111111");
    expect(svg).not.toContain("#222222");
  });
});
