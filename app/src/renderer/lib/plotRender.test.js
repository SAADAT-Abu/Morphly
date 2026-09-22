import { describe, it, expect } from "vitest";
import { renderPlotSvg, defaultPlot, beeswarm, stackBrackets, textWidth, makeScale, logLabels } from "./plotRender";
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

describe("the plot types added for distributions and parts of a whole", () => {
  const spread = createDataset({
    columns: [
      { name: "Control", values: Array.from({ length: 30 }, (_, i) => String(5 + Math.sin(i) * 1.2)) },
      { name: "Treated", values: Array.from({ length: 30 }, (_, i) => String(7 + Math.cos(i) * 1.4)) },
    ],
  });
  const el = (kind, patch = {}) => ({ type: "plot", width: 600, height: 450, plot: { ...defaultPlot(kind, { fontSize: 16 }), ...patch } });

  it("draws a violin per group, with its median", () => {
    const svg = renderPlotSvg(el("violin"), spread);
    expect(count(svg, /<polygon /g)).toBe(2);
    expect(count(part(svg, "errors"), /<line /g)).toBe(2);
  });

  it("joins each row across the groups for before and after", () => {
    const paired = createDataset({
      columns: [
        { name: "Before", values: ["1", "2", "3"] },
        { name: "After", values: ["2", "4", "5"] },
      ],
    });
    const svg = renderPlotSvg(el("beforeafter"), paired);
    expect(count(part(svg, "lines"), /<path /g)).toBe(3);
    // Points sit on their lines rather than being spread sideways.
    const xs = [...part(svg, "points").matchAll(/cx="([\d.]+)"/g)].map((m) => m[1]);
    expect(new Set(xs).size).toBe(2);
  });

  it("leaves out a row that has only one of the pair", () => {
    const ragged = createDataset({
      columns: [
        { name: "Before", values: ["1", "2"] },
        { name: "After", values: ["2", ""] },
      ],
    });
    expect(count(part(renderPlotSvg(el("beforeafter"), ragged), "lines"), /<path /g)).toBe(1);
  });

  it("draws a histogram, and a density curve when asked", () => {
    const plain = renderPlotSvg(el("histogram"), spread);
    expect(plain).toContain(">Count</text>");
    expect(count(plain, /data-part="density"/g)).toBe(0);
    const withCurve = renderPlotSvg(el("histogram", { curve: true }), spread);
    expect(count(withCurve, /data-part="density"/g)).toBe(2);
  });

  it("takes a bin width when one is given", () => {
    const wide = renderPlotSvg(el("histogram", { binWidth: "2" }), spread);
    const narrow = renderPlotSvg(el("histogram", { binWidth: "0.5" }), spread);
    expect(count(part(narrow, "bars"), /<rect /g)).toBeGreaterThan(count(part(wide, "bars"), /<rect /g));
  });

  const parts = createDataset({
    columns: [
      { name: "T cells", values: ["42"] },
      { name: "B cells", values: ["23"] },
      { name: "Myeloid", values: ["19"] },
      { name: "Other", values: ["16"] },
    ],
  });

  it("draws a pie with a slice each and their percentages", () => {
    const svg = renderPlotSvg(el("pie"), parts);
    expect(count(part(svg, "slices"), /<path /g)).toBe(4);
    expect(svg).toContain(">42%</text>");
    expect(svg).toContain('data-part="legend"');
  });

  it("draws a donut as rings rather than wedges", () => {
    const donut = renderPlotSvg(el("donut"), parts);
    // A ring is two arcs; a wedge starts at the centre with a move and a line.
    expect(count(part(donut, "slices"), /A/g)).toBeGreaterThan(count(part(renderPlotSvg(el("pie"), parts), "slices"), /A/g));
  });

  it("says so when a pie has nothing to divide", () => {
    const nothing = createDataset({ columns: [{ name: "A", values: ["0"] }] });
    expect(renderPlotSvg(el("pie"), nothing)).toContain("positive numbers");
  });
});

describe("axis scales", () => {
  it("runs a logarithmic axis between whole powers of ten", () => {
    const scale = makeScale({ lo: 0.012, hi: 87, log: true });
    expect(scale.min).toBe(0.01);
    expect(scale.max).toBe(100);
    expect(scale.ticks).toEqual([0.01, 0.1, 1, 10, 100]);
    expect(scale.at(0.01)).toBeCloseTo(0, 12);
    expect(scale.at(1)).toBeCloseTo(0.5, 12);
    expect(scale.at(100)).toBeCloseTo(1, 12);
  });

  it("keeps a linear axis as it was", () => {
    const scale = makeScale({ lo: 0, hi: 103 });
    expect(scale.log).toBe(false);
    expect(scale.at(scale.max)).toBeCloseTo(1, 12);
  });

  it("writes readable tick labels, falling back to powers for the extremes", () => {
    expect(logLabels([0.01, 1, 1000])).toEqual(["0.01", "1", "1000"]);
    expect(logLabels([1e-6, 1e7])).toEqual(["10^-6", "10^7"]);
  });

  it("draws an X and Y graph on a log X axis", () => {
    const ds = createDataset({
      kind: "xy",
      columns: [
        { name: "Dose", values: ["0.01", "0.1", "1", "10", "100"] },
        { name: "Response", values: ["2", "9", "48", "88", "97"] },
      ],
    });
    const svg = renderPlotSvg(
      { type: "plot", width: 600, height: 450, plot: { ...defaultPlot("line", { fontSize: 16 }), xScale: "log" } },
      ds
    );
    expect(svg).toContain(">0.01</text>");
    expect(svg).toContain(">100</text>");
  });
});

describe("SuperPlot", () => {
  const ds = createDataset({
    kind: "grouped",
    columns: [
      { name: "Replicate", values: ["R1", "R1", "R1", "R2", "R2", "R2", "R3", "R3", "R3"] },
      { name: "Control", values: ["5.1", "4.8", "5.4", "6.0", "5.7", "6.3", "4.4", "4.9", "4.1"] },
      { name: "Treated", values: ["7.1", "7.8", "7.4", "8.0", "8.7", "8.3", "6.4", "6.9", "6.1"] },
    ],
  });

  it("draws every measurement, plus a marker for each replicate mean", () => {
    const svg = renderPlotSvg(
      { type: "plot", width: 600, height: 450, plot: defaultPlot("super", { fontSize: 16 }) },
      ds
    );
    expect(count(part(svg, "points"), /<circle /g)).toBe(18);
    expect(count(part(svg, "replicate-means"), /<circle /g)).toBe(6);
    // The legend names the replicates, since colour is what tells them apart.
    expect(svg).toContain(">R1</text>");
  });

  it("judges it on the replicate means, not on every measurement", () => {
    const el = { type: "plot", width: 600, height: 450, plot: defaultPlot("super", { fontSize: 16 }) };
    const analysis = graphAnalysis(el, ds);
    expect(analysis.label).toBe("Paired t test");
    expect(analysis.n).toEqual([3, 3]);
  });
});

describe("renderPlotSvg: survival", () => {
  const ds = sampleDataset("survival");
  const el = element("survival");

  it("draws one step curve per group, with a tick for every censored subject", () => {
    const svg = graphSvg(el, ds);
    const curves = part(svg, "curves");
    // Two groups, so two step paths; the sample has six censored subjects.
    expect(count(curves, /<path /g)).toBe(2);
    expect(count(curves, /data-part="censored"/g)).toBe(6);
    expect(svg).toContain('data-part="legend"');
  });

  it("leaves the ticks off when they are not wanted", () => {
    const svg = graphSvg({ ...el, plot: { ...el.plot, points: false } }, ds);
    expect(count(svg, /data-part="censored"/g)).toBe(0);
  });

  it("only ever steps downwards, since survival cannot go back up", () => {
    const svg = graphSvg(el, ds);
    const d = /<path d="([^"]+)"/.exec(part(svg, "curves"))[1];
    // Y grows downwards in SVG, so a curve that only falls never moves up.
    const ys = [...d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThan(4);
    ys.slice(1).forEach((y, i) => expect(y).toBeGreaterThanOrEqual(ys[i]));
  });

  it("counts survival from 0 to 1, or as a percentage, as asked", () => {
    expect(graphSvg(el, ds)).toContain(">1.0</text>");
    expect(graphSvg({ ...el, plot: { ...el.plot, kind: "survivalPercent" } }, ds)).toContain(">100</text>");
  });
});

describe("renderPlotSvg: fitted curves", () => {
  const ds = createDataset({
    kind: "xy",
    columns: [
      { name: "Dose (uM)", values: ["0.01", "0.03", "0.1", "0.3", "1", "3", "10", "30", "100"] },
      { name: "Viability", values: ["2.1", "3.4", "8.9", "21.5", "48.7", "76.2", "91.3", "96.8", "98.4"] },
    ],
  });

  it("draws the fitted curve and its confidence band", () => {
    const el = element("scatter", { fitModel: "4pl", xScale: "log" });
    const svg = graphSvg(el, ds);
    expect(count(svg, /data-part="fit"/g)).toBe(1);
    expect(count(svg, /data-part="band"/g)).toBe(1);
    // The curve is drawn as a path of many segments, not a straight line.
    expect(/<path data-part="fit" d="([^"]+)"/.exec(svg)[1].split("L").length).toBeGreaterThan(20);
  });

  it("drops the band when it is turned off, and both when no model is chosen", () => {
    const noBand = graphSvg(element("scatter", { fitModel: "4pl", band: false }), ds);
    expect(count(noBand, /data-part="fit"/g)).toBe(1);
    expect(count(noBand, /data-part="band"/g)).toBe(0);
    const none = graphSvg(element("scatter"), ds);
    expect(count(none, /data-part="fit"/g)).toBe(0);
  });
});
