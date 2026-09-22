/**
 * A graph element, from settings and data to picture.
 *
 * The canvas, the properties panel and the exporters all go through here, so
 * the statistics shown in the panel are the ones drawn as brackets, and the
 * graph on screen is the graph in the exported file.
 */

import { analyseGroups, analyseGrouped, analyseXY, bracketsToDraw } from "./analysis";
import { renderPlotSvg, defaultPlot } from "./plotRender";

export const isGraph = (el) => el?.type === "plot";

/** The statistics for a graph, or null when its data is missing. */
export function graphAnalysis(element, dataset) {
  if (!dataset) return null;
  const plot = element.plot ?? defaultPlot();
  if (dataset.kind === "xy") return analyseXY(dataset);
  if (dataset.kind === "grouped") {
    return analyseGrouped(dataset, {
      within: plot.within ?? "conditions",
      correction: plot.correction ?? "sidak",
      control: plot.control ?? 0,
    });
  }
  return analyseGroups(dataset, { test: plot.test ?? "auto", paired: Boolean(plot.paired) });
}

/** The SVG markup for a graph element. */
export function graphSvg(element, dataset, analysis = graphAnalysis(element, dataset)) {
  const plot = element.plot ?? defaultPlot();
  return renderPlotSvg({ ...element, plot }, dataset, {
    brackets: analysis && !analysis.error ? bracketsToDraw(analysis, plot.brackets) : [],
    fits: analysis?.series,
  });
}
