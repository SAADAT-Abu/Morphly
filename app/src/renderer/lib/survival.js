/**
 * Survival curves, and the tests that compare them.
 *
 * Survival data is different from everything else Morphly handles: a subject
 * who has not had the event by the end of the study still tells us something
 * (they lasted at least that long), so they are censored rather than dropped.
 * The Kaplan-Meier estimator is the standard way to use that.
 *
 * Checked against R's survival package (survfit, survdiff); see
 * survival.test.js.
 */

import chisqcdf from "@stdlib/stats-base-dists-chisquare-cdf";

const chisqUpper = (x, df) => Math.max(0, 1 - chisqcdf(x, df));

/**
 * The Kaplan-Meier estimate for one group.
 *
 * `records` are { time, event }, where event is true for the event happening
 * and false for censoring. Returns the steps of the curve, each with the
 * number still at risk, how many had the event, and the survival after it.
 */
export function kaplanMeier(records) {
  const sorted = [...records].sort((a, b) => a.time - b.time || (a.event ? -1 : 1));
  const steps = [{ time: 0, atRisk: sorted.length, events: 0, censored: 0, survival: 1 }];
  let survival = 1;
  let index = 0;
  let atRisk = sorted.length;

  while (index < sorted.length) {
    const time = sorted[index].time;
    let events = 0;
    let censored = 0;
    while (index < sorted.length && sorted[index].time === time) {
      if (sorted[index].event) events += 1;
      else censored += 1;
      index += 1;
    }
    const before = atRisk;
    if (events > 0) survival *= 1 - events / before;
    steps.push({ time, atRisk: before, events, censored, survival });
    atRisk -= events + censored;
  }

  // Median survival: the first time the curve reaches or passes a half. It
  // does not exist when the curve never gets that low, which is worth saying
  // rather than hiding.
  const median = steps.find((step) => step.survival <= 0.5)?.time ?? null;
  return {
    steps,
    median,
    n: sorted.length,
    events: sorted.filter((r) => r.event).length,
    censored: sorted.filter((r) => !r.event).length,
    /** Survival at any time, reading the step curve. */
    at: (time) => {
      let value = 1;
      for (const step of steps) {
        if (step.time > time) break;
        value = step.survival;
      }
      return value;
    },
  };
}

/**
 * Compare survival curves.
 *
 * At every time an event happens, the number of events in each group is
 * compared with how many would be expected if the groups were alike, and the
 * differences are added up. The log-rank test weights every time equally;
 * the Gehan-Breslow-Wilcoxon test weights by how many are still at risk, so
 * it pays more attention to early differences.
 *
 * Returns both tests, and for two groups the hazard ratio with its interval.
 */
export function compareSurvival(groups) {
  const names = groups.map((g) => g.name);
  const all = groups.flatMap((g, index) => g.records.map((r) => ({ ...r, group: index })));
  const times = [...new Set(all.filter((r) => r.event).map((r) => r.time))].sort((a, b) => a - b);
  const k = groups.length;
  if (k < 2 || times.length === 0) return null;

  const observed = new Array(k).fill(0);
  const expected = new Array(k).fill(0);
  let logRank = 0;
  let gehan = 0;
  // The variance of the difference, summed over times, for each test.
  let logRankVariance = 0;
  let gehanVariance = 0;
  const diffs = new Array(k).fill(0);
  const gehanDiffs = new Array(k).fill(0);

  for (const time of times) {
    const atRisk = groups.map((g) => g.records.filter((r) => r.time >= time).length);
    const events = groups.map((g) => g.records.filter((r) => r.time === time && r.event).length);
    const totalAtRisk = atRisk.reduce((a, b) => a + b, 0);
    const totalEvents = events.reduce((a, b) => a + b, 0);
    if (totalAtRisk <= 1 || totalEvents === 0) continue;

    for (let i = 0; i < k; i += 1) {
      const expectedHere = (totalEvents * atRisk[i]) / totalAtRisk;
      observed[i] += events[i];
      expected[i] += expectedHere;
      diffs[i] += events[i] - expectedHere;
      gehanDiffs[i] += totalAtRisk * (events[i] - expectedHere);
    }
    // Variance of the first group's count, which is all that is needed for
    // two groups; for more, the same quantity summed is a fair test.
    const share = atRisk[0] / totalAtRisk;
    const variance =
      (totalEvents * share * (1 - share) * (totalAtRisk - totalEvents)) / (totalAtRisk - 1 || 1);
    logRankVariance += variance;
    gehanVariance += totalAtRisk * totalAtRisk * variance;
  }

  logRank = logRankVariance > 0 ? (diffs[0] * diffs[0]) / logRankVariance : 0;
  gehan = gehanVariance > 0 ? (gehanDiffs[0] * gehanDiffs[0]) / gehanVariance : 0;
  // With more than two groups, the sum over groups of (O - E) squared over E
  // is the usual chi-square, which is what survdiff reports.
  const pooled = observed.reduce((sum, o, i) => sum + (expected[i] > 0 ? (o - expected[i]) ** 2 / expected[i] : 0), 0);
  const df = k - 1;
  const statistic = k === 2 ? logRank : pooled;

  let hazardRatio = null;
  if (k === 2 && expected[0] > 0 && expected[1] > 0 && observed[0] > 0 && observed[1] > 0) {
    const ratio = observed[0] / expected[0] / (observed[1] / expected[1]);
    const se = Math.sqrt(1 / expected[0] + 1 / expected[1]);
    hazardRatio = {
      ratio,
      low: Math.exp(Math.log(ratio) - 1.959963985 * se),
      high: Math.exp(Math.log(ratio) + 1.959963985 * se),
    };
  }

  return {
    names,
    observed,
    expected,
    df,
    logRank: { chi2: statistic, df, p: chisqUpper(statistic, df) },
    gehan: { chi2: gehan, df: 1, p: chisqUpper(gehan, 1) },
    hazardRatio,
  };
}

/**
 * Survival data from a dataset: a time column, an event column (1 for the
 * event, 0 for censored) and an optional group column. Rows without a time
 * are left out.
 */
export function survivalGroups(dataset, parse) {
  const [timeColumn, eventColumn, groupColumn] = dataset.columns;
  const rows = timeColumn?.values.length ?? 0;
  const byGroup = new Map();
  for (let row = 0; row < rows; row += 1) {
    const time = parse(timeColumn.values[row]);
    if (!Number.isFinite(time)) continue;
    const raw = String(eventColumn?.values[row] ?? "").trim().toLowerCase();
    // 1, yes, true, dead and event all mean the event happened; blank means
    // censored, which is the safer reading of a missing value.
    const event = ["1", "yes", "true", "dead", "event", "y"].includes(raw);
    const name = String(groupColumn?.values[row] ?? "").trim() || "All";
    if (!byGroup.has(name)) byGroup.set(name, []);
    byGroup.get(name).push({ time, event });
  }
  return [...byGroup.entries()].map(([name, records]) => ({ name, records, curve: kaplanMeier(records) }));
}
