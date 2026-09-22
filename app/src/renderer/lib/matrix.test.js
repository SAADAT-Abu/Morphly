import { describe, it, expect } from "vitest";
import {
  tableMatrix,
  numericColumns,
  standardise,
  zScoreRows,
  jacobiEigen,
  pca,
  correlationMatrix,
  clusterRows,
  rocCurve,
  classLabels,
  blandAltman,
} from "./matrix";
import { createDataset } from "./datasets";

/**
 * Expected values come from R 4.6.1:
 *   prcomp(m, scale. = TRUE), cor(m), cor(m, method = "spearman"),
 *   hclust(dist(m), method = "average"), pROC::roc() and pROC::ci.auc(),
 *   and Bland and Altman's own 1986 peak flow figures.
 */
const close = (actual, expected, rel = 1e-9) => {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * rel + 1e-12);
};

const values = [
  [5.1, 3.5, 1.4, 0.2],
  [4.9, 3.0, 1.4, 0.2],
  [6.7, 3.1, 4.4, 1.4],
  [6.0, 2.9, 4.5, 1.5],
  [6.3, 3.3, 6.0, 2.5],
  [5.8, 2.7, 5.1, 1.9],
  [5.5, 2.3, 4.0, 1.3],
  [7.1, 3.0, 5.9, 2.1],
];

const dataset = createDataset({
  kind: "table",
  columns: [
    { name: "Sample", values: values.map((_, i) => `S${i + 1}`) },
    ...["A", "B", "C", "D"].map((name, c) => ({ name, values: values.map((row) => String(row[c])) })),
  ],
});

describe("reading a table", () => {
  it("takes every column that holds numbers, and names the rows", () => {
    expect(numericColumns(dataset)).toEqual([1, 2, 3, 4]);
    const m = tableMatrix(dataset);
    expect(m.rowNames[0]).toBe("S1");
    expect(m.colNames).toEqual(["A", "B", "C", "D"]);
    expect(m.rows).toHaveLength(8);
    expect(m.cols[0]).toHaveLength(8);
  });

  it("leaves out a row with a gap in it, and names a row that has no name", () => {
    const ragged = createDataset({
      kind: "table",
      columns: [
        { name: "Gene", values: ["a", "", "c"] },
        { name: "One", values: ["1", "2", ""] },
        { name: "Two", values: ["4", "5", "6"] },
      ],
    });
    const m = tableMatrix(ragged);
    expect(m.rows).toHaveLength(2);
    expect(m.rowNames).toEqual(["a", "Row 2"]);
  });
});

describe("scaling", () => {
  it("centres and scales a column the way a standard deviation does", () => {
    const { rows, centres, scales } = standardise([[1, 10], [2, 20], [3, 30]]);
    close(centres[0], 2);
    close(scales[1], 10);
    close(rows[0][0], -1);
    close(rows[2][1], 1);
  });

  it("leaves a column that never changes alone rather than dividing by nothing", () => {
    const { rows } = standardise([[5, 1], [5, 2]]);
    expect(rows.every((row) => row[0] === 0)).toBe(true);
  });

  it("z scores across a row, which is how a heatmap is read", () => {
    const [row] = zScoreRows([[2, 4, 6]]);
    close(row[0], -1);
    close(row[1], 0);
    close(row[2], 1);
  });
});

describe("eigenvectors", () => {
  it("finds the axes of a matrix whose answer is known", () => {
    const { values: eigen, vectors } = jacobiEigen([
      [2, 1],
      [1, 2],
    ]);
    close(eigen[0], 3, 1e-12);
    close(eigen[1], 1, 1e-12);
    // The first axis runs along the diagonal.
    close(Math.abs(vectors[0][0]), Math.abs(vectors[0][1]), 1e-12);
  });
});

describe("principal components", () => {
  const result = pca(values, { scale: true });

  it("agrees with prcomp() on how much each component explains", () => {
    [1.661391074916, 1.01337355853, 0.460230855633, 0.032268972447].forEach((sdev, i) => {
      close(result.sdev[i], sdev, 1e-9);
    });
    close(result.explained[0], 0.690055075952984, 1e-9);
    close(result.explained[1], 0.256731492282051, 1e-9);
  });

  it("agrees with prcomp() on the loadings, up to the sign of an axis", () => {
    const first = result.loadings[0];
    [0.537243087911, -0.115382729608, 0.597494002391, 0.584001376118].forEach((value, i) => {
      close(Math.abs(first[i]), Math.abs(value), 1e-8);
    });
  });

  it("puts the points where prcomp() puts them", () => {
    const sign = Math.sign(result.scores[0][0]) === Math.sign(-2.473270227291) ? 1 : -1;
    close(sign * result.scores[0][0], -2.473270227291, 1e-8);
    close(sign * result.scores[7][0], 1.922988494309, 1e-8);
  });

  it("turns each component so it is drawn the same way every time", () => {
    // The largest loading of a component is positive, by construction.
    result.loadings.forEach((vector) => {
      const biggest = vector.reduce((best, value, i) => (Math.abs(value) > Math.abs(vector[best]) ? i : best), 0);
      expect(vector[biggest]).toBeGreaterThan(0);
    });
  });

  it("says when there is not enough to work with", () => {
    expect(pca([[1, 2]]).error).toMatch(/at least two/);
  });
});

describe("correlation between columns", () => {
  const m = tableMatrix(dataset);

  it("agrees with cor()", () => {
    const { r } = correlationMatrix(m.cols, m.colNames);
    close(r[0][2], 0.834305234990, 1e-9);
    close(r[2][3], 0.989520668085, 1e-9);
    close(r[0][1], 0.0539247405645, 1e-9);
    expect(r[1][1]).toBe(1);
  });

  it("agrees with cor(method = \"spearman\")", () => {
    const { r } = correlationMatrix(m.cols, m.colNames, { method: "spearman" });
    close(r[0][2], 0.7784570702436, 1e-9);
    close(r[1][2], -0.0421686746988, 1e-9);
  });

  it("gives cor.test()'s p value", () => {
    const { p } = correlationMatrix(m.cols, m.colNames);
    close(p[0][2], 0.0100063017997, 1e-8);
  });
});

describe("clustering rows", () => {
  it("merges at the heights hclust(method = \"average\") reports", () => {
    const { heights, order } = clusterRows(values);
    [0.538516480713, 0.741619848710, 0.948683298051, 1.041133176152, 1.265919018125, 1.964494854744, 4.177707778806].forEach(
      (h, i) => close(heights[i], h, 1e-9)
    );
    expect(order).toHaveLength(8);
    expect(new Set(order).size).toBe(8);
  });

  it("puts the two rows that are most alike next to each other", () => {
    const { order } = clusterRows(values);
    const at = (i) => order.indexOf(i);
    // Rows 1 and 2 differ by less than anything else in the table.
    expect(Math.abs(at(0) - at(1))).toBe(1);
  });

  it("has nothing to do with one row", () => {
    expect(clusterRows([[1, 2]]).order).toEqual([0]);
  });
});

describe("ROC curves", () => {
  const score = [0.12, 0.35, 0.22, 0.81, 0.55, 0.44, 0.91, 0.28, 0.67, 0.73, 0.19, 0.60, 0.48, 0.88, 0.31, 0.52, 0.44, 0.60, 0.38, 0.70];
  const truth = [0, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0];
  const positive = truth.map((t) => t === 1);

  it("gives pROC's area, counting a tie as half a win", () => {
    const roc = rocCurve(score, positive);
    close(roc.auc, 0.785, 1e-12);
    expect(roc.cases).toBe(10);
    expect(roc.controls).toBe(10);
  });

  it("gives DeLong's interval, as ci.auc() does", () => {
    const roc = rocCurve(score, positive);
    close(roc.se, 0.107522607442, 1e-9);
    close(roc.low, 0.57425956189, 1e-8);
    close(roc.high, 0.99574043811, 1e-8);
  });

  it("finds the cut that stands furthest from the diagonal", () => {
    const { best } = rocCurve(score, positive);
    close(best.youden, 0.5, 1e-12);
    expect(best.sensitivity + best.specificity).toBeCloseTo(1.5, 12);
  });

  it("draws a curve that only ever goes up and to the right", () => {
    const { curve } = rocCurve(score, positive);
    expect(curve[0]).toMatchObject({ fpr: 0, tpr: 0 });
    expect(curve[curve.length - 1]).toMatchObject({ fpr: 1, tpr: 1 });
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i].fpr).toBeGreaterThanOrEqual(curve[i - 1].fpr);
      expect(curve[i].tpr).toBeGreaterThanOrEqual(curve[i - 1].tpr);
    }
  });

  it("says when one of the two classes is missing", () => {
    expect(rocCurve([1, 2, 3], [true, true, true]).error).toMatch(/both classes/);
  });

  it("works out which cells mean the event happened", () => {
    expect(classLabels(["yes", "no", "yes"]).positive).toBe("yes");
    expect(classLabels(["1", "0"]).flags).toEqual([true, false]);
    // With two words and neither of them familiar, the first one is taken,
    // and naming the other one turns the curve over.
    expect(classLabels(["tumour", "normal"]).positive).toBe("tumour");
    expect(classLabels(["tumour", "normal"], "normal").flags).toEqual([false, true]);
  });
});

describe("agreement between two methods", () => {
  // Bland and Altman 1986: peak expiratory flow by two meters.
  const large = [494, 395, 516, 434, 476, 557, 413, 442, 650, 433, 417, 656, 267, 478, 178, 423, 427];
  const mini = [512, 430, 520, 428, 500, 600, 364, 380, 658, 445, 432, 626, 260, 477, 259, 350, 451];

  it("gives the bias and the limits of agreement", () => {
    const result = blandAltman(large, mini);
    expect(result.n).toBe(17);
    close(result.bias, -2.11764705882, 1e-10);
    close(result.sd, 38.7651298736, 1e-10);
    close(result.lower, -78.0959054849, 1e-10);
    close(result.upper, 73.8606113673, 1e-10);
  });

  it("puts an interval around each of the three lines", () => {
    const result = blandAltman(large, mini);
    // The interval on the bias is the paired t test's interval.
    close(result.biasInterval[0], -22.0488376966, 1e-9);
    close(result.biasInterval[1], 17.8135435790, 1e-9);
    expect(result.lowerInterval[0]).toBeLessThan(result.lower);
    expect(result.upperInterval[1]).toBeGreaterThan(result.upper);
  });

  it("plots each subject's mean against the difference", () => {
    const { points } = blandAltman([10, 20, 30], [12, 18, 30]);
    expect(points[0]).toEqual({ mean: 11, difference: -2 });
    expect(points[1]).toEqual({ mean: 19, difference: 2 });
    expect(points[2]).toEqual({ mean: 30, difference: 0 });
  });

  it("says when there is almost nothing to compare", () => {
    expect(blandAltman([1, 2], [1, 2]).error).toMatch(/three paired/);
  });
});
