import { describe, it, expect } from "vitest";
import { kaplanMeier, compareSurvival, survivalGroups } from "./survival";
import { createDataset, parseNumber } from "./datasets";

/**
 * Expected values come from R's survival package:
 *   fit <- survfit(Surv(time, event) ~ group)
 *   survdiff(Surv(time, event) ~ group)
 */
const close = (actual, expected, rel = 1e-6) => {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * rel + 1e-12);
};

const time = [4, 6, 8, 9, 11, 12, 14, 15, 17, 20, 22, 25, 28, 30, 32, 35, 38, 40, 42, 45];
const event = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0];
const group = [...Array(10).fill("Drug"), ...Array(10).fill("Control")];

const dataset = createDataset({
  kind: "survival",
  columns: [
    { name: "Time (days)", values: time.map(String) },
    { name: "Event", values: event.map(String) },
    { name: "Group", values: group },
  ],
});

describe("Kaplan-Meier", () => {
  const records = time.map((t, i) => ({ time: t, event: event[i] === 1 }));

  it("steps down only when the event happens", () => {
    const curve = kaplanMeier(records.slice(0, 5));
    // Times 4, 6, 9 and 11 are events; 8 is censored, so the curve is flat there.
    const at8 = curve.steps.find((s) => s.time === 8);
    const at6 = curve.steps.find((s) => s.time === 6);
    expect(at8.survival).toBe(at6.survival);
    expect(at8.censored).toBe(1);
    close(at6.survival, (1 - 1 / 5) * (1 - 1 / 4), 1e-12);
  });

  it("counts who is still at risk", () => {
    const curve = kaplanMeier(records);
    expect(curve.steps[1].atRisk).toBe(20);
    expect(curve.n).toBe(20);
    expect(curve.events).toBe(14);
    expect(curve.censored).toBe(6);
  });

  it("finds the median survival R reports for each group", () => {
    const groups = survivalGroups(dataset, parseNumber);
    const drug = groups.find((g) => g.name === "Drug");
    const control = groups.find((g) => g.name === "Control");
    expect(drug.curve.median).toBe(12);
    expect(control.curve.median).toBe(40);
    expect(drug.curve.events).toBe(8);
    expect(control.curve.events).toBe(6);
  });

  it("says there is no median when the curve never falls that far", () => {
    const most = kaplanMeier([
      { time: 5, event: true },
      { time: 10, event: false },
      { time: 12, event: false },
      { time: 20, event: false },
    ]);
    expect(most.median).toBeNull();
    close(most.at(30), 0.75, 1e-12);
  });
});

describe("comparing curves", () => {
  it("log-rank: survdiff()", () => {
    const groups = survivalGroups(dataset, parseNumber);
    const result = compareSurvival(groups);
    close(result.logRank.chi2, 18.3783757507, 1e-6);
    close(result.logRank.p, 1.8110165164e-5, 1e-5);
    expect(result.logRank.df).toBe(1);
  });

  it("counts the events each group had, and how many were expected", () => {
    const groups = survivalGroups(dataset, parseNumber);
    const result = compareSurvival(groups);
    // R lists Control first; Morphly keeps the order the data came in.
    const drug = result.names.indexOf("Drug");
    const control = result.names.indexOf("Control");
    expect(result.observed[drug]).toBe(8);
    expect(result.observed[control]).toBe(6);
    close(result.expected[drug], 2.58212723809, 1e-6);
    close(result.expected[control], 11.4178727619, 1e-6);
  });

  it("reports a hazard ratio with its interval", () => {
    const groups = survivalGroups(dataset, parseNumber);
    const { hazardRatio } = compareSurvival(groups);
    // Drug first: many more events than expected, so its hazard is higher.
    close(hazardRatio.ratio, (8 / 2.58212723809) / (6 / 11.4178727619), 1e-9);
    expect(hazardRatio.low).toBeLessThan(hazardRatio.ratio);
    expect(hazardRatio.high).toBeGreaterThan(hazardRatio.ratio);
    expect(hazardRatio.low).toBeGreaterThan(1);
  });

  it("also gives the Gehan-Breslow-Wilcoxon test, which weighs early times more", () => {
    const groups = survivalGroups(dataset, parseNumber);
    const { gehan, logRank } = compareSurvival(groups);
    expect(gehan.chi2).toBeGreaterThan(0);
    expect(gehan.p).toBeLessThan(0.001);
    // The two tests disagree in size, which is the point of having both.
    expect(gehan.chi2).not.toBeCloseTo(logRank.chi2, 3);
  });

  it("has nothing to compare with one group", () => {
    const one = survivalGroups(
      createDataset({
        kind: "survival",
        columns: [
          { name: "Time", values: ["5", "8"] },
          { name: "Event", values: ["1", "0"] },
        ],
      }),
      parseNumber
    );
    expect(one).toHaveLength(1);
    expect(one[0].name).toBe("All");
    expect(compareSurvival(one)).toBeNull();
  });
});

describe("reading survival data", () => {
  it("takes the words people actually type for an event", () => {
    const mixed = survivalGroups(
      createDataset({
        kind: "survival",
        columns: [
          { name: "Time", values: ["1", "2", "3", "4", "5"] },
          { name: "Event", values: ["1", "yes", "TRUE", "0", ""] },
          { name: "Group", values: ["A", "A", "A", "A", "A"] },
        ],
      }),
      parseNumber
    );
    expect(mixed[0].curve.events).toBe(3);
    expect(mixed[0].curve.censored).toBe(2);
  });

  it("leaves out rows with no time", () => {
    const ragged = survivalGroups(
      createDataset({
        kind: "survival",
        columns: [
          { name: "Time", values: ["1", "", "3"] },
          { name: "Event", values: ["1", "1", "1"] },
        ],
      }),
      parseNumber
    );
    expect(ragged[0].curve.n).toBe(2);
  });
});
