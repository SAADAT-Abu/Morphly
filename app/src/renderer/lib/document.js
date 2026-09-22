/**
 * The Morphly figure file format, in one place.
 *
 * Every version change goes through `migrate`, one small step at a time, so a
 * figure saved by any earlier Morphly opens in the current one and no feature
 * has to special-case old files on its own. Migration only ever happens in
 * memory: opening an old figure never rewrites it, and the file on disk changes
 * only when you choose to save.
 *
 * Version history:
 *   1  a single canvas and element list at the top level (Morphly 0.1)
 *   2  several pages, one per figure tab (Morphly 0.2 and 0.3)
 *   3  Morphly 0.4. Nothing is transformed: 0.4 adds optional element fields
 *      (glue points, curves, elbow connectors) that older elements simply lack,
 *      and a 0.3 Morphly opening a version 3 file still draws every arrow from
 *      its stored points.
 *   4  Morphly 0.5: graphs. A `datasets` list sits beside the pages, and graph
 *      elements point into it. Older files simply have no datasets. The
 *      version goes up because a 0.4 Morphly would open such a file and
 *      quietly lose every graph in it; refusing is kinder.
 */

export const FORMAT = "morphly-figure";
export const CURRENT_VERSION = 4;

/** A file that cannot be opened, with a message fit to show the user. */
export class DocumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "DocumentError";
  }
}

/** One step per version: each takes a document at version N to N + 1. */
const STEPS = {
  1: (doc) => ({
    format: FORMAT,
    version: 2,
    pages: [
      {
        id: null, // the store assigns a fresh id
        name: "Figure 1",
        canvas: doc.canvas ?? {},
        elements: Array.isArray(doc.elements) ? doc.elements : [],
      },
    ],
    activePageId: null,
  }),
  2: (doc) => ({ ...doc, version: 3 }),
  3: (doc) => ({ ...doc, version: 4, datasets: Array.isArray(doc.datasets) ? doc.datasets : [] }),
};

/**
 * Bring a parsed figure up to the current format.
 *
 * Refuses, with a clear message, anything that is not a Morphly figure and any
 * figure saved by a newer Morphly than this one. Guessing at a future format
 * could quietly drop parts of someone's work, which is worse than saying no.
 */
export function migrate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DocumentError("That file is not a Morphly figure.");
  }
  if (input.format !== undefined && input.format !== FORMAT) {
    throw new DocumentError("That file is not a Morphly figure.");
  }

  // Files from before pages existed may lack a version; their shape says which.
  let version = input.version ?? (Array.isArray(input.pages) ? 2 : 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new DocumentError(`This figure has an unknown file format version (${input.version}).`);
  }
  if (version > CURRENT_VERSION) {
    throw new DocumentError(
      `This figure was saved by a newer version of Morphly (file format ${version}). ` +
        "Update Morphly to open it."
    );
  }

  let doc = { ...input };
  while (version < CURRENT_VERSION) {
    doc = STEPS[version](doc);
    version = doc.version;
  }

  if (!Array.isArray(doc.pages) || doc.pages.length === 0) {
    throw new DocumentError("This figure has no pages to open.");
  }
  return doc;
}

/** The document written to disk, always at the current version. */
export function serialise({ pages, activePageId, datasets = [] }) {
  return { format: FORMAT, version: CURRENT_VERSION, pages, activePageId, datasets };
}
