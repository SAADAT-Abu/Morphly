/**
 * A graph element, from settings and data to picture.
 *
 * The canvas, the properties panel and the exporters all go through here, so
 * the statistics shown in the panel are the ones drawn as brackets, and the
 * graph on screen is the graph in the exported file.
 */

import { analyseGroups, analyseGrouped, analyseCounts, analyseSurvival, analyseXY, bracketsToDraw } from "./analysis";
import { replicateMeans } from "./datasets";
import { renderPlotSvg, defaultPlot } from "./plotRender";

export const isGraph = (el) => el?.type === "plot";

/** The statistics for a graph, or null when its data is missing. */
export function graphAnalysis(element, dataset) {
  if (!dataset) return null;
  const plot = element.plot ?? defaultPlot();
  if (dataset.kind === "xy") return analyseXY(dataset, { model: plot.fitModel ?? "none" });
  if (dataset.kind === "contingency") return analyseCounts(dataset, { test: plot.test ?? "auto" });
  if (dataset.kind === "survival") return analyseSurvival(dataset, { test: plot.test ?? "logrank" });
  if (dataset.kind === "grouped" && plot.kind === "super") {
    // A SuperPlot is judged on the replicate means, not on every cell: that is
    // what makes it a SuperPlot rather than a crowded dot plot.
    return analyseGroups(replicateMeans(dataset), { test: plot.test ?? "auto", paired: true });
  }
  if (dataset.kind === "grouped") {
    return analyseGrouped(dataset, {
      within: plot.within ?? "conditions",
      correction: plot.correction ?? "sidak",
      control: plot.control ?? 0,
    });
  }
  return analyseGroups(dataset, {
    test: plot.test ?? "auto",
    paired: Boolean(plot.paired),
    normality: plot.normality ?? "shapiro",
    control: plot.control ?? 0,
  });
}

/** The SVG markup for a graph element. */
export function graphSvg(element, dataset, analysis = graphAnalysis(element, dataset)) {
  const plot = element.plot ?? defaultPlot();
  return renderPlotSvg({ ...element, plot }, dataset, {
    brackets: analysis && !analysis.error ? bracketsToDraw(analysis, plot.brackets) : [],
    fits: analysis?.series,
    survival: analysis?.kind === "survival" && !analysis.error ? analysis : null,
  });
}
