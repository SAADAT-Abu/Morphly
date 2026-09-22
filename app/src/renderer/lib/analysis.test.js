import { describe, it, expect } from "vitest";
import {
  analyseGroups,
  analyseGrouped,
  analyseCounts,
  countsMethodsSentence,
  analyseXY,
  availableTests,
  bracketsToDraw,
  correctPValues,
  groupedMethodsSentence,
  methodsSentence,
  plottedGroups,
} from "./analysis";
import { createDataset, sampleDataset } from "./datasets";

const groups = (...cols) =>
  createDataset({ columns: cols.map((values, i) => ({ name: `G${i + 1}`, values: values.map(String) })) });

describe("availableTests", () => {
  it("offers tests by the number of groups and pairing", () => {
    expect(availableTests(2, false).map((t) => t.id)).toEqual(["student", "welch", "mannwhitney"]);
    expect(availableTests(2, true).map((t) => t.id)).toEqual(["pairedt", "wilcoxon"]);
    expect(availableTests(4, false).map((t) => t.id)).toEqual(["anova", "welchanova", "dunnett", "kruskal"]);
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
    expect(analyseGroups(groups([1, 2], [3])).error).toMatch(/two groups need 2 or more values/);
  });

  it("leaves a group too small to test out of it, and says so", () => {
    const ds = groups([1, 2, 3, 4], [6, 7, 8, 9], [5]);
    const a = analyseGroups(ds);
    expect(a.groups).toEqual([0, 1]);
    expect(a.comparisons).toHaveLength(1);
    expect(a.warnings[0]).toMatch(/G3 has fewer than 2 values/);
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

describe("analyseGrouped", () => {
  const ds = sampleDataset("grouped");

  it("reports the two factors and their interaction", () => {
    const a = analyseGrouped(ds);
    expect(a.summary.map((s) => s.name)).toEqual(["Genotype", "Condition", "Interaction"]);
    // The same numbers R gives for this table.
    expect(a.summary[1].text).toMatch(/^F\(1, 12\) = /);
    expect(a.anova.balanced).toBe(true);
    expect(a.levels).toEqual(["Wild type", "Knockout"]);
    expect(a.conditions.map((c) => c.name)).toEqual(["Vehicle", "LPS"]);
  });

  it("compares conditions within each group by default", () => {
    const a = analyseGrouped(ds);
    expect(a.comparisons.map((c) => c.label)).toEqual([
      "Wild type Vehicle vs Wild type LPS",
      "Knockout Vehicle vs Knockout LPS",
    ]);
    expect(a.comparisons.every((c) => c.p < 0.0001)).toBe(true);
    expect(a.comparisons[0].key).toBe("0.0-0.1");
  });

  it("can compare groups within each condition instead", () => {
    const a = analyseGrouped(ds, { within: "groups" });
    expect(a.comparisons.map((c) => c.label)).toEqual([
      "Wild type Vehicle vs Knockout Vehicle",
      "Wild type LPS vs Knockout LPS",
    ]);
  });

  it("can compare every condition with a chosen one", () => {
    const a = analyseGrouped(ds, { within: "control", control: 1 });
    expect(a.comparisons.map((c) => c.label)).toEqual([
      "Wild type LPS vs Wild type Vehicle",
      "Knockout LPS vs Knockout Vehicle",
    ]);
  });

  it("corrects the p-values, and says which way", () => {
    const sidak = analyseGrouped(ds, { correction: "sidak" }).comparisons[0];
    const none = analyseGrouped(ds, { correction: "none" }).comparisons[0];
    const bonferroni = analyseGrouped(ds, { correction: "bonferroni" }).comparisons[0];
    expect(none.p).toBeLessThan(sidak.p);
    expect(sidak.p).toBeLessThanOrEqual(bonferroni.p);
    expect(none.p).toBe(none.pUnadjusted);
  });

  it("asks for what it needs instead of guessing", () => {
    const missing = createDataset({
      kind: "grouped",
      columns: [
        { name: "Genotype", values: ["WT", "KO"] },
        { name: "Vehicle", values: ["1", ""] },
      ],
    });
    expect(analyseGrouped(missing).error).toMatch(/every condition/);
  });

  it("writes a methods sentence naming the correction", () => {
    const a = analyseGrouped(ds);
    const s = groupedMethodsSentence(a, { kind: "bar", error: "sd" }, { version: "0.5.0" });
    expect(s).toMatch(/two-way ANOVA \(Morphly 0\.5\.0\)/);
    expect(s).toMatch(/conditions were compared within each group with Šídák's correction/);
    expect(s).toMatch(/n = 4 per group/);
  });
});

describe("correctPValues", () => {
  it("matches the usual formulas", () => {
    const ps = [0.01, 0.04];
    expect(correctPValues(ps, "bonferroni")).toEqual([0.02, 0.08]);
    expect(correctPValues(ps, "sidak")[0]).toBeCloseTo(1 - 0.99 ** 2, 12);
    expect(correctPValues(ps, "none")).toEqual(ps);
  });
});

describe("the tests added for counts and for judging size", () => {
  const table = createDataset({
    kind: "contingency",
    columns: [
      { name: "Treatment", values: ["Drug", "Placebo"] },
      { name: "Responded", values: ["9", "2"] },
      { name: "Did not respond", values: ["3", "10"] },
    ],
  });

  it("suggests Fisher for a 2 by 2 table and reports the odds ratio", () => {
    const a = analyseCounts(table);
    expect(a.suggested).toBe("fisher");
    expect(a.label).toBe("Fisher's exact test");
    expect(a.summary).toMatch(/^p = 0\.0123, odds ratio 15/);
    expect(a.extra[0]).toMatch(/95% confidence interval for the odds ratio/);
    expect(a.n).toBe(24);
  });

  it("offers the other tests a 2 by 2 table allows", () => {
    expect(analyseCounts(table).available.map((t) => t.id)).toEqual([
      "fisher",
      "chisq",
      "chisqPlain",
      "mcnemar",
      "trend",
    ]);
    expect(analyseCounts(table, { test: "chisq" }).summary).toMatch(/^χ²\(1\) = 6\.04/);
  });

  it("suggests chi-square for a bigger table, and warns on thin counts", () => {
    const bigger = createDataset({
      kind: "contingency",
      columns: [
        { name: "Site", values: ["A", "B", "C"] },
        { name: "Mild", values: ["12", "7", "3"] },
        { name: "Moderate", values: ["5", "14", "8"] },
        { name: "Severe", values: ["9", "6", "15"] },
      ],
    });
    const a = analyseCounts(bigger);
    expect(a.suggested).toBe("chisq");
    expect(a.summary).toMatch(/^χ²\(4\) = 14\.4/);
    expect(a.available.map((t) => t.id)).toEqual(["chisq", "chisqPlain"]);

    const thin = createDataset({
      kind: "contingency",
      columns: [
        { name: "Arm", values: ["A", "B"] },
        { name: "Yes", values: ["1", "8"] },
        { name: "No", values: ["9", "2"] },
      ],
    });
    expect(analyseCounts(thin, { test: "chisq" }).warnings[0]).toMatch(/smallest expected count/);
  });

  it("asks for a real table before testing one", () => {
    const thin = createDataset({ kind: "contingency", columns: [{ name: "Arm", values: ["A"] }, { name: "Yes", values: ["3"] }] });
    expect(analyseCounts(thin).error).toMatch(/two rows and two categories/);
  });

  it("writes a methods sentence for counts", () => {
    const s = countsMethodsSentence(analyseCounts(table), { version: "0.5.0" });
    expect(s).toBe("Counts were compared by Fisher's exact test (Morphly 0.5.0), on 24 observations in a 2 by 2 table.");
  });

  it("reports an effect size beside a t test and an ANOVA", () => {
    const two = analyseGroups(groups([98, 101, 95, 103, 99, 97], [84, 78, 90, 81, 88, 83]));
    expect(two.effect).toMatch(/Cohen's d = 3\.98 \(large\); Hedges' g/);
    const many = analyseGroups(sampleDataset("groups"));
    expect(many.effect).toMatch(/^ω² = 0\.9/);
  });

  it("notes a value that stands out, without removing it", () => {
    const withOutlier = groups([5.1, 4.9, 5.0, 5.2, 4.8, 12.4], [5.0, 5.1, 4.9, 5.2, 5.0, 4.9]);
    const a = analyseGroups(withOutlier);
    expect(a.warnings.join(" ")).toMatch(/stands out from the rest \(Grubbs p/);
    expect(a.warnings.join(" ")).toMatch(/Morphly keeps it/);
  });

  it("can check normality another way, and says which it used", () => {
    const values = [1, 1.2, 1.3, 1.5, 1.9, 2.4, 3.1, 4.2, 6.0, 8.5, 12.1, 17.3, 25.0, 38.2, 55.1];
    const other = [2, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 4.2, 4.4, 4.6, 4.8];
    const a = analyseGroups(groups(values, other), { normality: "dagostino" });
    expect(a.suggestion.reason).toMatch(/D'Agostino-Pearson/);
    expect(a.test).toBe("mannwhitney");
  });

  it("corrects by false discovery rate when asked", () => {
    const ps = [0.01, 0.04, 0.03, 0.2];
    expect(correctPValues(ps, "bh").map((p) => Number(p.toFixed(6)))).toEqual([0.04, 0.053333, 0.053333, 0.2]);
  });
});
