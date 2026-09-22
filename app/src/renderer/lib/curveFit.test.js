import { describe, it, expect } from "vitest";
import { fitCurve, fitModel, compareFits, MODELS } from "./curveFit";

/**
 * Expected values come from R's nls(). A curve fit is a search rather than a
 * formula, so the tolerances here are looser than for a closed-form test:
 * agreement to five or six figures on the parameters, and to about a percent
 * on their standard errors, which are themselves approximations.
 */
const close = (actual, expected, rel = 1e-5) => {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * rel + 1e-12);
};

const dose = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100];
const response = [2.1, 3.4, 8.9, 21.5, 48.7, 76.2, 91.3, 96.8, 98.4];

describe("dose response", () => {
  it("finds the same curve as nls()", () => {
    const fit = fitModel("4pl", dose, response);
    const [bottom, top, ic50, hill] = fit.parameters;
    close(bottom, 1.63288826726, 1e-4);
    close(top, 99.1185917499, 1e-5);
    close(ic50, 1.0474575582, 1e-5);
    close(hill, 1.09577478556, 1e-5);
    close(fit.rss, 0.67232726879, 1e-4);
    expect(fit.r2).toBeGreaterThan(0.999);
  });

  it("reports standard errors and intervals for every parameter", () => {
    const fit = fitModel("4pl", dose, response);
    [0.289431384589, 0.296682210547, 0.0142877665867, 0.0154468262701].forEach((se, i) => {
      close(fit.errors[i], se, 2e-2);
    });
    const [low, high] = fit.intervals[2];
    expect(low).toBeLessThan(fit.parameters[2]);
    expect(high).toBeGreaterThan(fit.parameters[2]);
    // The IC50 is pinned down to a few percent here, so the interval is tight.
    expect((high - low) / fit.parameters[2]).toBeLessThan(0.1);
  });

  it("gives the curve and its uncertainty at any dose", () => {
    const fit = fitModel("4pl", dose, response);
    const middle = fit.predict(fit.parameters[2]);
    // Half way up, by definition of the IC50.
    close(middle.value, (fit.parameters[0] + fit.parameters[1]) / 2, 1e-6);
    expect(middle.se).toBeGreaterThan(0);
    // The band is wider where there are no points to hold it down.
    expect(fit.predict(1000).se).toBeGreaterThan(middle.se);
  });

  it("finds the curve from a poor starting guess", () => {
    const fit = fitCurve({
      x: dose,
      y: response,
      model: MODELS["4pl"].fn,
      start: [50, 50, 100, 5],
    });
    close(fit.parameters[2], 1.0474575582, 1e-3);
  });
});

describe("the other models", () => {
  it("exponential decay, with its half life", () => {
    const time = [0, 1, 2, 4, 8, 12, 24];
    const y = [100, 74, 55, 31, 10, 4.2, 0.9];
    const fit = fitModel("exp-decay", time, y);
    close(fit.parameters[0], 99.8272374283, 1e-5);
    close(fit.parameters[1], 1.16769867485, 1e-4);
    close(fit.parameters[2], 0.300994841043, 1e-5);
    close(fit.errors[2], 0.00274383618108, 2e-2);
    close(fit.derived["Half life"], Math.log(2) / 0.300994841043, 1e-5);
  });

  it("Michaelis-Menten", () => {
    const s = [0.5, 1, 2, 4, 8, 16, 32];
    const v = [2.1, 3.6, 5.8, 8.0, 9.6, 10.7, 11.3];
    const fit = fitModel("michaelis-menten", s, v);
    close(fit.parameters[0], 12.2071586845, 1e-5);
    close(fit.parameters[1], 2.24065749047, 1e-5);
    close(fit.errors[0], 0.124461256627, 2e-2);
  });

  it("one-phase association reaches its plateau", () => {
    const time = [0, 1, 2, 4, 8, 12, 24];
    const y = [0, 26, 45, 69, 90, 96, 99.5];
    const fit = fitModel("association", time, y);
    close(fit.parameters[1], 100, 5e-2);
    expect(fit.derived["Half time"]).toBeGreaterThan(0);
  });
});

describe("what a fit refuses to do", () => {
  it("says when there are too few points", () => {
    expect(fitModel("4pl", [1, 2], [1, 2]).error).toMatch(/at least 5 points/);
    expect(fitCurve({ x: [1, 2], y: [1, 2], model: (x, [a, b, c]) => a + b + c, start: [1, 1, 1] }).error).toMatch(
      /more than 3 points/
    );
  });

  it("says when the model is not one it knows", () => {
    expect(fitModel("magic", dose, response).error).toMatch(/Unknown model/);
  });

  it("leaves out points that are not numbers", () => {
    const fit = fitModel("michaelis-menten", [0.5, 1, NaN, 4, 8, 16, 32], [2.1, 3.6, 5.8, NaN, 9.6, 10.7, 11.3]);
    expect(fit.n).toBe(5);
  });
});

describe("comparing two fits", () => {
  it("asks whether the extra parameters earn their place", () => {
    // The same points fitted with four parameters and with two: the richer
    // model wins easily here.
    const four = fitModel("4pl", dose, response);
    const two = fitModel("michaelis-menten", dose, response);
    const comparison = compareFits(two, four);
    expect(comparison.df1).toBe(2);
    expect(comparison.p).toBeLessThan(0.01);
    expect(compareFits(four, four)).toBeNull();
  });
});
