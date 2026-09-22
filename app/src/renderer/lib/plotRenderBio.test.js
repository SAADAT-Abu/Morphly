import { describe, it, expect } from "vitest";
import { sampleDataset, createDataset } from "./datasets";
import { defaultPlot } from "./plotRender";
import { graphSvg, graphAnalysis } from "./graphs";

/**
 * The graphs built for bioinformatics, drawn without a window. These check
 * that what the numbers say is what the picture shows: a cell per value, a
 * dot per membership, a line per limit of agreement.
 */
const draw = (shape, kind, settings = {}, size = { width: 520, height: 400 }) => {
  const dataset = shape.kind ? shape : sampleDataset(shape);
  const element = { ...size, plot: { ...defaultPlot(kind, { fontSize: 13 }), ...settings } };
  const analysis = graphAnalysis(element, dataset);
  return { svg: graphSvg(element, dataset, analysis), analysis };
};

const count = (svg, pattern) => (svg.match(pattern) ?? []).length;
const part = (svg, name) => {
  const match = svg.match(new RegExp(`<g data-part="${name}">([\\s\\S]*?)</g>`));
  return match ? match[1] : "";
};

describe("heatmap", () => {
  it("draws one cell for every number, with names and a key", () => {
    const { svg } = draw("table", "heatmap");
    // Twelve patients by four numeric columns; the class column is not one.
    expect(count(part(svg, "cells"), /<rect /g)).toBe(48);
    expect(svg).toContain('data-part="row-labels"');
    expect(svg).toContain(">P01</text>");
    expect(svg).toContain('data-part="key"');
    expect(svg).toContain(">CD44</text>");
  });

  it("puts the two columns that agree next to each other", () => {
    const { analysis } = draw("table", "heatmap");
    const order = analysis.columnOrder.map((c) => analysis.matrix.colNames[c]);
    const gap = Math.abs(order.indexOf("CD44") - order.indexOf("CD44 by qPCR"));
    expect(gap).toBe(1);
  });

  it("leaves the order alone and hides the key when asked", () => {
    const { svg, analysis } = draw("table", "heatmap", { clusterRows: false, clusterColumns: false, key: false, rowNames: false });
    expect(analysis.rowOrder).toEqual([...Array(12).keys()]);
    expect(svg).not.toContain('data-part="key"');
    expect(svg).not.toContain('data-part="row-labels"');
  });
});

describe("correlation matrix", () => {
  it("draws a square for every pair and writes the numbers in", () => {
    const { svg } = draw("table", "correlation");
    expect(count(part(svg, "cells"), /<rect /g)).toBe(16);
    expect(part(svg, "values")).toContain(">1.00</text>");
  });

  it("can leave the numbers out", () => {
    const { svg } = draw("table", "correlation", { showValues: false });
    expect(part(svg, "values")).toBe("");
  });

  it("changes when Spearman is asked for", () => {
    const pearson = draw("table", "correlation").analysis.correlation.r[0][1];
    const spearman = draw("table", "correlation", { corrMethod: "spearman" }).analysis.correlation.r[0][1];
    expect(pearson).not.toBeCloseTo(spearman, 6);
  });
});

describe("PCA", () => {
  it("draws a point per row, coloured by the group, with the variance on the axes", () => {
    const { svg } = draw("table", "pca");
    expect(count(part(svg, "points"), /<circle /g)).toBe(12);
    expect(svg).toMatch(/PC1 \(\d+\.\d%\)/);
    expect(svg).toContain(">Tumour</text>");
    expect(svg).toContain(">Normal</text>");
  });

  it("names the points only when asked", () => {
    expect(draw("table", "pca").svg).not.toContain(">P01</text>");
    expect(draw("table", "pca", { pointNames: true }).svg).toContain(">P01</text>");
  });
});

describe("ROC curve", () => {
  it("draws a staircase, the area, the diagonal and the best cut", () => {
    const { svg, analysis } = draw("table", "roc");
    expect(svg).toContain('data-part="curve"');
    expect(svg).toContain('data-part="area"');
    expect(svg).toContain('data-part="chance"');
    expect(svg).toContain('data-part="best"');
    expect(svg).toContain(`AUC ${analysis.summary.slice(4, 9)}`);
  });

  it("only ever steps up or across", () => {
    const { analysis } = draw("table", "roc");
    analysis.roc.curve.forEach((point, i) => {
      if (i === 0) return;
      expect(point.fpr).toBeGreaterThanOrEqual(analysis.roc.curve[i - 1].fpr);
      expect(point.tpr).toBeGreaterThanOrEqual(analysis.roc.curve[i - 1].tpr);
    });
  });

  it("turns over when the other class is called positive", () => {
    const up = draw("table", "roc").analysis.roc.auc;
    const down = draw("table", "roc", { positive: "Normal" }).analysis.roc.auc;
    expect(down).toBeCloseTo(1 - up, 12);
  });
});

describe("Bland-Altman", () => {
  it("draws the bias, both limits and a point per pair", () => {
    const { svg } = draw("table", "bland", { methodA: 1, methodB: 4 });
    const limits = part(svg, "limits");
    expect(count(limits, /<line /g)).toBe(3);
    expect(limits).toContain("Bias");
    expect(limits).toContain("+1.96 SD");
    expect(count(part(svg, "points"), /<circle /g)).toBe(12);
  });
});

describe("volcano and MA", () => {
  it("colours what passed both cuts and names the most significant of them", () => {
    const { svg, analysis } = draw("results", "volcano");
    expect(analysis.counts.up + analysis.counts.down).toBeGreaterThan(5);
    const points = part(svg, "points");
    expect(count(points, /<circle /g)).toBe(40);
    expect(count(points, /#c0392b/g)).toBe(analysis.counts.up);
    expect(count(points, /#2c6fbb/g)).toBe(analysis.counts.down);
    expect(count(part(svg, "labels"), /<text /g)).toBe(10);
    expect(svg).toContain("-log10 adjusted p");
  });

  it("draws the lines that say what counts, and takes them from the settings", () => {
    const loose = draw("results", "volcano", { fcCutoff: 0.5, pCutoff: 0.2 }).analysis;
    const strict = draw("results", "volcano", { fcCutoff: 3, pCutoff: 0.001 }).analysis;
    expect(strict.counts.up).toBeLessThan(loose.counts.up);
    expect(draw("results", "volcano").svg).toContain('data-part="thresholds"');
  });

  it("finds fewer once the p values are corrected", () => {
    const raw = draw("results", "volcano", { adjust: "none" }).analysis.counts;
    const bh = draw("results", "volcano", { adjust: "bh" }).analysis.counts;
    const bonferroni = draw("results", "volcano", { adjust: "bonferroni" }).analysis.counts;
    expect(bh.up + bh.down).toBeLessThanOrEqual(raw.up + raw.down);
    expect(bonferroni.up + bonferroni.down).toBeLessThanOrEqual(bh.up + bh.down);
  });

  it("names nothing when asked to name nothing", () => {
    expect(draw("results", "volcano", { labelTop: 0 }).svg).not.toContain('data-part="labels"');
  });

  it("an MA plot puts abundance across and the fold change up, with a line at zero", () => {
    const { svg } = draw("results", "ma");
    expect(svg).toContain("Mean expression");
    expect(count(part(svg, "thresholds"), /<line /g)).toBe(1);
  });
});

describe("forest", () => {
  it("draws a marker and an interval for every row, with a line of no effect", () => {
    const { svg } = draw("results", "forest");
    const rows = part(svg, "rows");
    expect(count(rows, /<rect /g)).toBe(40);
    expect(svg).toContain('data-part="reference"');
  });

  it("writes the names only while they can be read", () => {
    expect(draw("results", "forest", {}, { width: 520, height: 200 }).svg).not.toContain(">TP53</text>");
    expect(draw("results", "forest", {}, { width: 520, height: 1200 }).svg).toContain(">TP53</text>");
  });

  it("takes an interval from two columns when there are two", () => {
    const dataset = createDataset({
      kind: "results",
      columns: [
        { name: "Study", values: ["One", "Two"] },
        { name: "Hazard ratio", values: ["1.4", "0.8"] },
        { name: "Lower", values: ["1.1", "0.5"] },
        { name: "Upper", values: ["1.8", "1.3"] },
      ],
    });
    const { analysis } = draw(dataset, "forest");
    expect(analysis.intervals).toEqual([[1.1, 1.8], [0.5, 1.3]]);
    expect(analysis.intervalFrom).toContain("Lower");
  });
});

describe("Venn and UpSet", () => {
  it("draws a circle per list, with a count in every region", () => {
    const { svg } = draw("sets", "venn");
    expect(count(part(svg, "circles"), /<circle /g)).toBe(3);
    expect(count(part(svg, "counts"), /<text /g)).toBe(7);
    expect(svg).toContain(">Drug A</text>");
  });

  it("counts the same names an UpSet plot counts", () => {
    const venn = draw("sets", "venn").analysis;
    const upset = draw("sets", "upset").analysis;
    const total = (rows) => rows.reduce((sum, r) => sum + r.count, 0);
    expect(total(upset.upset.intersections)).toBe(total(venn.regions));
  });

  it("draws a bar and a column of dots for each combination", () => {
    const { svg, analysis } = draw("sets", "upset");
    const bars = count(part(svg, "bars"), /<rect /g);
    expect(bars).toBe(analysis.upset.intersections.length);
    // One dot per list per combination, filled or empty.
    expect(count(part(svg, "matrix"), /<circle /g)).toBe(bars * 3);
    expect(svg).toContain('data-part="set-sizes"');
  });

  it("says so rather than drawing a Venn diagram of five lists", () => {
    const five = createDataset({
      kind: "sets",
      columns: ["A", "B", "C", "D", "E"].map((name, i) => ({ name, values: [`g${i}`, "shared"] })),
    });
    const { analysis } = draw(five, "venn");
    expect(analysis.warnings[0]).toMatch(/cannot be drawn honestly/);
  });
});

describe("when the data is not ready", () => {
  it("says what is missing instead of failing", () => {
    const empty = createDataset({ kind: "table", columns: [{ name: "Name", values: [""] }, { name: "One", values: [""] }] });
    expect(draw(empty, "heatmap").svg).toContain("at least two rows");
    const one = createDataset({ kind: "sets", columns: [{ name: "A", values: ["x"] }] });
    expect(draw(one, "venn").svg).toContain("Two lists at least");
  });
});
