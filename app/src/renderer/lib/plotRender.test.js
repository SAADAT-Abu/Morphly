import { describe, it, expect } from "vitest";
import { renderPlotSvg, defaultPlot, beeswarm, stackBrackets, textWidth } from "./plotRender";
import { graphSvg, graphAnalysis } from "./graphs";
import { createDataset, sampleDataset } from "./datasets";

const element = (kind, patch = {}) => ({
  type: "plot",
  width: 600,
  height: 450,
  plot: { ...defaultPlot(kind, { fontSize: 20 }), ...patch },
});

const count = (svg, pattern) => (svg.match(pattern) ?? []).length;
/** Just one part of the drawing, so legend swatches are not counted as bars. */
const part = (svg, name) => new RegExp(`<g data-part="${name}">([\\s\\S]*?)</g>`).exec(svg)?.[1] ?? "";

describe("renderPlotSvg: groups", () => {
  const ds = sampleDataset("groups");

  it("draws one bar per group and every point", () => {
    const svg = renderPlotSvg(element("bar"), ds);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="600" height="450"/);
    expect(count(svg, /<rect /g)).toBe(4);
    expect(count(svg, /<circle /g)).toBe(24);
    for (const name of ["Control", "Vehicle", "Drug A", "Drug B"]) expect(svg).toContain(`>${name}</text>`);
  });

  it("leaves the points off when asked, except on a dot plot", () => {
    expect(count(renderPlotSvg(element("bar", { points: false }), ds), /<circle /g)).toBe(0);
    expect(count(renderPlotSvg(element("dots", { points: false }), ds), /<circle /g)).toBe(24);
  });

  it("draws boxes with whiskers", () => {
    const svg = renderPlotSvg(element("box", { points: false }), ds);
    expect(count(svg, /<rect /g)).toBe(4);
    expect(svg).toContain('data-part="errors"');
  });

  it("starts bars at zero and honours limits typed by hand", () => {
    const svg = renderPlotSvg(element("bar"), ds);
    expect(svg).toContain(">0</text>");
    // A maximum of 150 with ticks every 20: the axis runs to 150, the last tick is 140.
    const fixed = renderPlotSvg(element("bar", { yMax: "150" }), ds);
    expect(fixed).toContain(">140</text>");
    expect(fixed).not.toContain(">160</text>");
  });

  it("writes axis titles and escapes text", () => {
    const svg = renderPlotSvg(element("bar", { yTitle: "Viability <%>" }), ds);
    expect(svg).toContain("Viability &lt;%&gt;");
  });

  it("draws the brackets it is given, with stars", () => {
    const svg = renderPlotSvg(element("bar"), ds, {
      brackets: [
        { i: 0, j: 2, stars: "****" },
        { i: 2, j: 3, stars: "**" },
      ],
    });
    expect(svg).toContain('data-part="brackets"');
    expect(count(svg, /<path d="M/g)).toBe(2);
    expect(svg).toContain(">****</text>");
  });

  it("says so when there is nothing to draw", () => {
    const empty = createDataset({ columns: [{ name: "A", values: ["", "x"] }] });
    expect(renderPlotSvg(element("bar"), empty)).toContain("Add numbers");
    expect(renderPlotSvg(element("bar"), null)).toContain("data for this graph is missing");
  });

  it("rotates group names that do not fit under their bars", () => {
    const long = createDataset({
      columns: Array.from({ length: 6 }, (_, i) => ({ name: `A rather long condition name ${i}`, values: ["1", "2"] })),
    });
    expect(renderPlotSvg(element("bar"), long)).toContain("rotate(-45");
  });
});

describe("renderPlotSvg: X and Y", () => {
  it("draws every point, a legend for two series, and the X column as the axis title", () => {
    const svg = renderPlotSvg(element("scatter"), sampleDataset("xy"));
    expect(count(svg, /<circle /g)).toBe(14 + 2);
    expect(svg).toContain('data-part="legend"');
    expect(svg).toContain(">Time (h)</text>");
  });

  it("keeps the X axis title clear of the tick labels", () => {
    const svg = renderPlotSvg(element("scatter"), sampleDataset("xy"));
    const title = Number(/y="([\d.]+)"[^>]*>Time \(h\)</.exec(svg)[1]);
    const ticks = [...svg.matchAll(/y="([\d.]+)"[^>]*text-anchor="middle">\d+<\/text>/g)].map((m) => Number(m[1]));
    expect(ticks.length).toBeGreaterThan(2);
    expect(title - Math.max(...ticks)).toBeGreaterThan(20);
  });

  it("joins points in X order for a line graph and draws fitted lines when asked", () => {
    const ds = sampleDataset("xy");
    const el = element("line", { fit: true });
    const svg = graphSvg(el, ds);
    expect(count(svg, /<polyline /g)).toBe(2);
    expect(count(svg, /data-part="fit"/g)).toBe(2);
  });
});

describe("graphSvg", () => {
  it("draws the significant comparisons by default", () => {
    const el = element("bar");
    const ds = sampleDataset("groups");
    const svg = graphSvg(el, ds, graphAnalysis(el, ds));
    // Five of the six sample comparisons are significant; Control vs Vehicle is not.
    expect(count(svg, /<path d="M/g)).toBe(5);
    const withNs = graphSvg({ ...el, plot: { ...el.plot, brackets: { "0-1": true } } }, ds);
    expect(count(withNs, /<path d="M/g)).toBe(6);
    expect(withNs).toContain(">ns</text>");
  });
});

describe("helpers", () => {
  it("spreads points that would overlap, and never beyond the bar", () => {
    const offsets = beeswarm([100, 100, 100, 100, 300], 4, 20);
    expect(new Set(offsets.slice(0, 4)).size).toBe(4);
    expect(offsets[4]).toBe(0);
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(20);
  });

  it("stacks brackets so no two on a level overlap", () => {
    const levels = stackBrackets(
      [
        { i: 0, j: 3 },
        { i: 0, j: 1 },
        { i: 1, j: 2 },
        { i: 2, j: 3 },
      ],
      [0, 1, 2, 3]
    );
    const byKey = Object.fromEntries(levels.map((b) => [`${b.i}-${b.j}`, b.level]));
    expect(byKey["0-1"]).toBe(0);
    expect(byKey["2-3"]).toBe(0);
    expect(byKey["1-2"]).toBe(1);
    expect(byKey["0-3"]).toBe(2);
  });

  it("estimates label widths", () => {
    expect(textWidth("MW", 10)).toBeGreaterThan(textWidth("il", 10));
  });
});

describe("renderPlotSvg: groups by condition", () => {
  const ds = sampleDataset("grouped");
  const grouped = (kind, patch = {}) => ({
    type: "plot",
    width: 600,
    height: 450,
    plot: { ...defaultPlot(kind, { fontSize: 16 }), ...patch },
  });

  it("draws one bar per group and condition, with a legend beside the graph", () => {
    const svg = renderPlotSvg(grouped("bar"), ds);
    expect(count(part(svg, "bars"), /<rect /g)).toBe(4);
    expect(count(part(svg, "points"), /<circle /g)).toBe(16);
    expect(svg).toContain('data-part="legend"');
    expect(svg).toContain(">Wild type</text>");
    expect(svg).toContain(">Vehicle</text>");
    // The group names go under the clusters and the factor names the axis.
    expect(svg).toContain(">Genotype</text>");
  });

  it("stacks, and scales each cluster to the same height for 100%", () => {
    expect(count(part(renderPlotSvg(grouped("stacked"), ds), "bars"), /<rect /g)).toBe(4);
    const hundred = renderPlotSvg(grouped("stacked100"), ds);
    expect(hundred).toContain(">100</text>");
    expect(hundred).toContain(">Percent of total</text>");
  });

  it("draws brackets between any two cells", () => {
    const svg = renderPlotSvg(grouped("bar"), ds, {
      brackets: [
        { a: { row: 0, col: 0 }, b: { row: 0, col: 1 }, stars: "****" },
        { a: { row: 0, col: 1 }, b: { row: 1, col: 1 }, stars: "**" },
      ],
    });
    expect(count(svg, /<path d="M/g)).toBe(2);
    expect(svg).toContain(">****</text>");
  });

  it("says what is missing rather than drawing nothing", () => {
    const empty = createDataset({ kind: "grouped", columns: [{ name: "Genotype", values: [""] }, { name: "A", values: [""] }] });
    expect(renderPlotSvg(grouped("bar"), empty)).toContain("Name the groups");
  });
});
