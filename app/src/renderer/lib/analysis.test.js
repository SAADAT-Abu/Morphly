import { describe, it, expect } from "vitest";
import { analyseGroups, analyseXY, availableTests, bracketsToDraw, methodsSentence, plottedGroups } from "./analysis";
import { createDataset, sampleDataset } from "./datasets";

const groups = (...cols) =>
  createDataset({ columns: cols.map((values, i) => ({ name: `G${i + 1}`, values: values.map(String) })) });

describe("availableTests", () => {
  it("offers tests by the number of groups and pairing", () => {
    expect(availableTests(2, false).map((t) => t.id)).toEqual(["student", "welch", "mannwhitney"]);
    expect(availableTests(2, true).map((t) => t.id)).toEqual(["pairedt", "wilcoxon"]);
    expect(availableTests(4, false).map((t) => t.id)).toEqual(["anova", "welchanova", "kruskal"]);
    expect(availableTests(3, true).map((t) => t.id)).toEqual(["rmanova", "friedman"]);
  });
});

describe("analyseGroups", () => {
  it("suggests one-way ANOVA with Tukey for the sample data, and says why", () => {
    const a = analyseGroups(sampleDataset("groups"));
    expect(a.test).toBe("anova");
    expect(a.suggestion.reason).toMatch(/normally distributed/);
    expect(a.suggestion.reason).toMatch(/Brown-Forsythe/);
    expect(a.summary).toMatch(/^F\(3, 20\) = 111\.6, p < 0\.0001, η² = 0\.94$/);
    expect(a.comparisons).toHaveLength(6);
    const ctrlVehicle = a.comparisons.find((c) => c.key === "0-1");
    expect(ctrlVehicle.stars).toBe("ns");
    expect(ctrlVehicle.label).toBe("Control vs Vehicle");
  });

  it("suggests a rank test when a group is clearly not normal", () => {
    const skewed = [1, 1.2, 1.3, 1.5, 1.9, 2.4, 3.1, 4.2, 6.0, 8.5, 12.1, 17.3, 25.0, 38.2, 55.1];
    const other = [2, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 4.2, 4.4, 4.6, 4.8];
    expect(analyseGroups(groups(skewed, other)).test).toBe("mannwhitney");
    expect(analyseGroups(groups(skewed, other, other)).test).toBe("kruskal");
  });

  it("suggests Welch's tests when spreads differ", () => {
    const a = [10, 12, 11, 13, 9, 11];
    const b = [15, 25, 8, 30, 20, 12];
    const c = [20, 22, 21, 19, 23, 20];
    expect(analyseGroups(groups(a, b, c)).test).toBe("welchanova");
  });

  it("uses the test chosen by hand when it fits, and the suggestion otherwise", () => {
    const ds = sampleDataset("groups");
    expect(analyseGroups(ds, { test: "kruskal" }).test).toBe("kruskal");
    expect(analyseGroups(ds, { test: "student" }).test).toBe("anova");
  });

  it("pairs rows for paired tests and says when rows are dropped", () => {
    const ds = groups([12.1, 14.3, 11.8, 15.2, 13.9, 12.7, 14.8, 13.1], [13.4, 15.1, 12.2, 16.8, 14.1, 13.9, 15.5, ""]);
    const a = analyseGroups(ds, { paired: true });
    expect(a.test).toBe("pairedt");
    expect(a.n).toEqual([7, 7]);
    expect(a.warnings[0]).toMatch(/1 row is left out/);
  });

  it("uses one comparison for two groups, keyed by dataset columns", () => {
    const ds = createDataset({
      columns: [
        { name: "Empty", values: [] },
        { name: "A", values: ["1", "2", "3", "4"] },
        { name: "B", values: ["6", "7", "8", "9"] },
      ],
    });
    expect(plottedGroups(ds)).toEqual([1, 2]);
    const a = analyseGroups(ds);
    expect(a.comparisons).toHaveLength(1);
    expect(a.comparisons[0]).toMatchObject({ i: 1, j: 2, key: "1-2" });
  });

  it("explains what is missing instead of testing too little data", () => {
    expect(analyseGroups(groups([1, 2])).error).toMatch(/second group/);
    expect(analyseGroups(groups([1, 2], [3])).error).toMatch(/at least 2 values/);
  });
});

describe("bracketsToDraw", () => {
  const analysis = {
    comparisons: [
      { key: "0-1", p: 0.5 },
      { key: "0-2", p: 0.001 },
    ],
  };

  it("shows significant comparisons unless switched off", () => {
    expect(bracketsToDraw(analysis).map((c) => c.key)).toEqual(["0-2"]);
    expect(bracketsToDraw(analysis, { "0-2": false })).toEqual([]);
    expect(bracketsToDraw(analysis, { "0-1": true }).map((c) => c.key)).toEqual(["0-1", "0-2"]);
  });

  it("draws nothing without an analysis", () => {
    expect(bracketsToDraw(null)).toEqual([]);
    expect(bracketsToDraw({ error: "x" })).toEqual([]);
  });
});

describe("methodsSentence", () => {
  it("names the test, the follow-up, what the bars show and n", () => {
    const a = analyseGroups(sampleDataset("groups"));
    const s = methodsSentence(a, { kind: "bar", error: "sem" }, { version: "0.5.0" });
    expect(s).toBe(
      "The 4 groups were compared by one-way ANOVA followed by Tukey's multiple comparisons test (Morphly 0.5.0). " +
        "Bars show the mean ± SEM, with n = 6 per group. ns, not significant; * p < 0.05; ** p < 0.01; *** p < 0.001; **** p < 0.0001."
    );
    expect(s).not.toMatch(/[–—]/);
  });

  it("names rank tests with their article and describes box plots", () => {
    const skewed = [1, 1.2, 1.3, 1.5, 1.9, 2.4, 3.1, 4.2, 6.0, 8.5, 12.1, 17.3, 25.0, 38.2, 55.1];
    const a = analyseGroups(groups(skewed, [2, 3, 4, 5, 6]));
    const s = methodsSentence(a, { kind: "box" });
    expect(s).toMatch(/^The two groups were compared by the Mann-Whitney test\. Boxes show the median/);
    expect(s).toMatch(/n = 5 to 15 per group/);
  });
});

describe("analyseXY", () => {
  it("fits each Y series against X", () => {
    const a = analyseXY(sampleDataset("xy"));
    expect(a.series).toHaveLength(2);
    expect(a.series[0].name).toBe("Wild type");
    expect(a.series[0].regression.slope).toBeGreaterThan(0);
    expect(a.series[0].pearson.r).toBeGreaterThan(0.9);
  });

  it("says when a series is too short or flat to fit", () => {
    const ds = createDataset({
      kind: "xy",
      columns: [
        { name: "X", values: ["1", "2", "3"] },
        { name: "Short", values: ["1", "", ""] },
        { name: "Flat", values: ["2", "2", "2"] },
      ],
    });
    const a = analyseXY(ds);
    expect(a.series[0].error).toMatch(/at least 3/);
    expect(a.series[1].error).toMatch(/equal/);
  });
});
