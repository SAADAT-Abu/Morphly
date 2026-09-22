import { describe, it, expect } from "vitest";
import { readSets, universe, membership, vennRegions, upsetIntersections, overlapTest } from "./sets";
import { createDataset } from "./datasets";

const dataset = createDataset({
  kind: "sets",
  columns: [
    { name: "Drug A", values: ["TP53", "MYC", "EGFR", "KRAS", "", "MYC"] },
    { name: "Drug B", values: ["MYC", "EGFR", "BRAF", "  ", "PTEN"] },
    { name: "Drug C", values: ["EGFR", "PTEN", "AKT1"] },
  ],
});

describe("reading lists of names", () => {
  const sets = readSets(dataset);

  it("takes a column as a set, ignoring blanks and repeats", () => {
    expect(sets.map((s) => s.name)).toEqual(["Drug A", "Drug B", "Drug C"]);
    // MYC is typed twice in the first column and is one member.
    expect(sets[0].size).toBe(4);
    expect(sets[1].size).toBe(4);
  });

  it("collects everything that is in at least one list", () => {
    expect(universe(sets)).toEqual(["TP53", "MYC", "EGFR", "KRAS", "BRAF", "PTEN", "AKT1"]);
  });

  it("says which lists each name is in", () => {
    const rows = membership(sets);
    expect(rows.find((r) => r.member === "EGFR").pattern).toEqual([true, true, true]);
    expect(rows.find((r) => r.member === "TP53").pattern).toEqual([true, false, false]);
  });
});

describe("Venn regions", () => {
  const regions = vennRegions(readSets(dataset));
  const at = (key) => regions.find((r) => r.key === key)?.count ?? 0;

  it("counts each region once, so the regions add up to the total", () => {
    expect(regions.reduce((sum, r) => sum + r.count, 0)).toBe(7);
    expect(at("111")).toBe(1); // EGFR
    expect(at("110")).toBe(1); // MYC
    expect(at("011")).toBe(1); // PTEN
    expect(at("100")).toBe(2); // TP53, KRAS
    expect(at("001")).toBe(1); // AKT1
    expect(at("010")).toBe(1); // BRAF
  });

  it("leaves out a region with nothing in it", () => {
    expect(regions.some((r) => r.key === "101")).toBe(false);
  });

  it("works for two lists as well as three", () => {
    const two = vennRegions(readSets(dataset).slice(0, 2));
    expect(two.find((r) => r.key === "11").members.sort()).toEqual(["EGFR", "MYC"]);
  });
});

describe("UpSet intersections", () => {
  const sets = readSets(dataset);

  it("counts each name once in the combination it really belongs to", () => {
    const { intersections } = upsetIntersections(sets);
    expect(intersections.reduce((sum, i) => sum + i.count, 0)).toBe(7);
    const biggest = intersections[0];
    expect(biggest.sets).toEqual([0]);
    expect(biggest.count).toBe(2);
  });

  it("counts a name in every combination it satisfies when asked to", () => {
    const { intersections } = upsetIntersections(sets, { mode: "inclusive" });
    const aAndB = intersections.find((i) => i.key === "0,1");
    // MYC and EGFR are in both, and EGFR is also in the third list.
    expect(aAndB.count).toBe(2);
  });

  it("shows the biggest bars and says how many were left out", () => {
    const { intersections, hidden } = upsetIntersections(sets, { limit: 2 });
    expect(intersections).toHaveLength(2);
    expect(hidden).toBe(4);
    expect(intersections[0].count).toBeGreaterThanOrEqual(intersections[1].count);
  });

  it("can put the single lists before the overlaps instead", () => {
    const { intersections } = upsetIntersections(sets, { sort: "sets" });
    expect(intersections[0].sets).toHaveLength(1);
  });
});

describe("is an overlap more than chance", () => {
  const a = { name: "A", members: new Set(Array.from({ length: 300 }, (_, i) => `g${i}`)), size: 300 };
  const b = {
    name: "B",
    // 40 of B's 200 are also in A.
    members: new Set([...Array.from({ length: 40 }, (_, i) => `g${i}`), ...Array.from({ length: 160 }, (_, i) => `h${i}`)]),
    size: 200,
  };

  it("agrees with fisher.test()", () => {
    const result = overlapTest(a, b, 20000);
    expect(result.both).toBe(40);
    expect(result.onlyA).toBe(260);
    expect(result.onlyB).toBe(160);
    expect(result.neither).toBe(19540);
    expect(Math.abs(result.p - 1.98824082782e-33)).toBeLessThan(1e-40);
    expect(result.expected).toBe(3);
    expect(result.enrichment).toBeCloseTo(40 / 3, 10);
  });

  it("gives the Jaccard index, which needs no background", () => {
    const result = overlapTest(a, b, 0);
    expect(result.jaccard).toBeCloseTo(40 / 460, 12);
    expect(result.error).toMatch(/how many things were tested/);
  });

  it("refuses a background smaller than the lists themselves", () => {
    expect(overlapTest(a, b, 100).error).toMatch(/smaller than/);
  });
});
