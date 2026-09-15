/**
 * The asset sidebar: browse, search and place assets from one or more scraped
 * libraries.
 *
 * Morphly points at library folders rather than bundling them. Several
 * producers exist, NIH BioArt (scraper/bioart_scraper.py), Bioicons
 * (scraper/bioicons_fetcher.py) and SciDraw (scraper/scidraw_fetcher.py), and
 * all emit the same manifest format, so several can be mounted at once and
 * browsed together.
 *
 * Licence is shown on every tile because it genuinely differs between them:
 * BioArt is mostly Public Domain, while ~83% of Bioicons requires attribution
 * and a few icons are share-alike. That is much easier to respect while
 * choosing an asset than to reconstruct at submission time.
 *
 * Thumbnails load continuously: a batch is mounted whenever the end of the
 * grid comes near, so 2,000 thumbnails never load together and there is no
 * button to press. A counter above the grid says which illustrations are on
 * screen ("Showing 181 to 225 of 2,531"), and a button returns to the top.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { BATCH_SIZE, nextLimit, visibleRange, rangeLabel } from "../lib/libraryScroll";

/** Compact badge text; full detail goes in the tooltip. */
function licenceBadge(asset) {
  if (!asset.license) return null;
  if (asset.shareAlike) return "SA";
  if (!asset.requiresAttribution) return "PD";
  return "BY";
}

export default function AssetLibrary({ onPlaceAsset, onOpenStore, onNotice }) {
  const library = useStore((s) => s.library);
  const libraryError = useStore((s) => s.libraryError);
  const setLibrary = useStore((s) => s.setLibrary);
  const setLibraryError = useStore((s) => s.setLibraryError);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [collection, setCollection] = useState("All");
  const [limit, setLimit] = useState(BATCH_SIZE);
  const [shown, setShown] = useState(null);
  const [scrolledDown, setScrolledDown] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [managing, setManaging] = useState(false);
  const gridRef = useRef(null);
  const sentinelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await window.morphly.loadLibrary();
      if (cancelled) return;
      if (res.ok) setLibrary(res.library);
      else if (res.error && res.error !== "no-library-configured") setLibraryError(res.error);

      // An upgrade can leave a library pointing at a folder that no longer
      // exists, most obviously Bioicons, which used to ship inside the app and
      // is now an Art Pack. The main process unmounts those; say so once,
      // rather than leaving someone to wonder where their icons went.
      if (res.dropped?.length > 0) {
        const names = res.dropped.map((d) => d.dir.split(/[/\\]/).pop()).join(", ");
        onNotice?.(`${names} is no longer on disk and was unmounted. The Art Store can add it back.`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setLibrary, setLibraryError, onNotice]);

  const addLibraryAction = useStore((s) => s.addLibrary);

  const addLibrary = async () => {
    setLoading(true);
    await addLibraryAction();
    setLoading(false);
  };

  const removeLibrary = async (key) => {
    const res = await window.morphly.removeLibrary(key);
    if (res.ok) setLibrary(res.library);
    else useStore.setState({ library: null });
  };

  const filtered = useMemo(() => {
    if (!library) return [];
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

    return library.assets.filter((asset) => {
      if (category !== "All" && asset.category !== category) return false;
      if (collection !== "All" && asset.collection !== collection) return false;
      if (terms.length === 0) return true;
      // Every term must appear somewhere, so "green virus" narrows rather
      // than widens.
      const haystack =
        `${asset.title} ${asset.category} ${asset.creator ?? ""} ${asset.keywords.join(" ")}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [library, query, category, collection]);

  const mounted = Math.min(limit, filtered.length);

  // A new search starts again from the top with the first batch.
  useEffect(() => {
    setLimit(BATCH_SIZE);
    if (gridRef.current) gridRef.current.scrollTop = 0;
  }, [query, category, collection]);

  /**
   * Work out which tiles are on screen from their positions, for the counter
   * and the back-to-top button. Reading positions is cheap once the grid has
   * been laid out, and the search in visibleRange touches only a few tiles.
   */
  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const tiles = grid.getElementsByClassName("asset-tile");
    const next = visibleRange(
      tiles.length,
      (i) => tiles[i].offsetTop,
      (i) => tiles[i].offsetTop + tiles[i].offsetHeight,
      grid.scrollTop,
      grid.clientHeight
    );
    setShown((prev) =>
      prev && next && prev.first === next.first && prev.last === next.last ? prev : next
    );
    setScrolledDown(grid.scrollTop > grid.clientHeight);
  }, []);

  // Measure on scroll (once per frame at most), when the sidebar is resized,
  // and whenever the tiles themselves change.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    grid.addEventListener("scroll", onScroll, { passive: true });
    const resize = new ResizeObserver(onScroll);
    resize.observe(grid);
    return () => {
      grid.removeEventListener("scroll", onScroll);
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measure, library]);

  useEffect(() => {
    measure();
  }, [measure, mounted, filtered, expandedId]);

  // Load the next batch when the end of the grid comes within reach. The
  // margin starts loading about two screens early, so scrolling rarely meets
  // an empty gap.
  useEffect(() => {
    const grid = gridRef.current;
    const sentinel = sentinelRef.current;
    if (!grid || !sentinel || mounted >= filtered.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((current) => nextLimit(current, filtered.length));
        }
      },
      { root: grid, rootMargin: "0px 0px 1200px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [mounted, filtered.length]);

  const backToTop = () => {
    if (gridRef.current) gridRef.current.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!library) {
    return (
      <div className="panel library">
        <div className="panel-header">Asset library</div>
        <div className="library-empty">
          <p>
            Morphly reads an asset library folder, such as one built with the scripts
            in <code>scraper/</code>. Point it at a folder containing{" "}
            <code>manifest.json</code>.
          </p>
          {libraryError && <p className="error">{libraryError}</p>}
          <button className="primary" onClick={onOpenStore}>
            Open the Art Store
          </button>
          <button className="ghost" onClick={addLibrary} disabled={loading}>
            {loading ? "Loading…" : "Add a library folder…"}
          </button>
        </div>
      </div>
    );
  }

  const narrowed = query.trim() !== "" || category !== "All" || collection !== "All";

  return (
    <div className="panel library">
      <div className="panel-header">
        Asset library
        <span className="header-actions">
          <button className="link" onClick={onOpenStore}>
            Art Store
          </button>
          <button className="link" onClick={() => setManaging((v) => !v)}>
            {managing ? "done" : "sources"}
          </button>
        </span>
      </div>

      {managing && (
        <div className="source-manager">
          {library.libraries.map((lib) => (
            <div className="source-row" key={lib.key}>
              <div className="source-info" title={lib.dir}>
                <strong>{lib.collection}</strong>
                <span>{lib.count.toLocaleString()} assets · {lib.label}</span>
              </div>
              <button className="link" onClick={() => removeLibrary(lib.key)}>
                remove
              </button>
            </div>
          ))}
          {library.errors?.map((e) => (
            <p className="error" key={e.dir}>{e.dir}: {e.error}</p>
          ))}
          <button className="ghost small" onClick={addLibrary} disabled={loading}>
            {loading ? "Loading…" : "Add another folder…"}
          </button>
        </div>
      )}

      <div className="library-controls">
        <input
          type="search"
          placeholder="Search title, keywords, creator…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="control-row">
          {library.collections.length > 1 && (
            <select value={collection} onChange={(e) => setCollection(e.target.value)}>
              <option>All</option>
              {library.collections.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>All</option>
            {library.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="library-count" aria-live="polite">
        {rangeLabel(filtered.length > 0 ? shown : null, filtered.length, narrowed)}
        {narrowed && filtered.length > 0 && (
          <span className="muted"> in {library.stats.assets.toLocaleString()}</span>
        )}
        {library.stats.shareAlike > 0 && (
          <span title="Share-alike icons can oblige your whole figure to carry the same licence">
            {" · "}
            {library.stats.shareAlike} share-alike
          </span>
        )}
      </div>

      <div className="asset-grid" ref={gridRef}>
        {filtered.slice(0, mounted).map((asset) => (
          <AssetTile
            key={asset.id}
            asset={asset}
            expanded={expandedId === asset.id}
            onToggle={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
            onPlace={onPlaceAsset}
          />
        ))}
        {mounted < filtered.length && <div className="asset-grid-sentinel" ref={sentinelRef} aria-hidden="true" />}
      </div>

      {scrolledDown && (
        <button className="back-to-top" onClick={backToTop} title="Back to the top of the library">
          ↑ Top
        </button>
      )}

      {filtered.length === 0 && (
        <div className="library-empty small">No assets match that search.</div>
      )}
    </div>
  );
}

function AssetTile({ asset, expanded, onToggle, onPlace }) {
  const primary = asset.variants[0];
  const hasVariants = asset.variants.length > 1;
  const badge = licenceBadge(asset);

  const startDrag = (event, variant) => {
    event.dataTransfer.setData(
      "application/x-morphly-asset",
      JSON.stringify({ assetId: asset.id, groupId: variant.groupId })
    );
    event.dataTransfer.effectAllowed = "copy";
  };

  const tooltip =
    `${asset.title}\n${asset.collection}` +
    (asset.creator ? ` · ${asset.creator}` : "") +
    (asset.license ? `\n${asset.license}` : "") +
    (asset.shareAlike ? " (SHARE-ALIKE)" : "") +
    (hasVariants ? `\n${asset.variants.length} variants` : "") +
    "\nClick to add, drag onto the canvas to place";

  return (
    <div className={`asset-tile${expanded ? " expanded" : ""}`}>
      <button
        className="asset-thumb"
        title={tooltip}
        draggable
        onDragStart={(e) => startDrag(e, primary)}
        onClick={() => onPlace(asset, primary)}
      >
        <img
          src={window.morphly.assetUrl(asset.source, primary.svgPath)}
          alt={asset.title}
          loading="lazy"
        />
        {badge && (
          <span className={`licence-badge ${badge.toLowerCase()}`} title={asset.license}>
            {badge}
          </span>
        )}
      </button>

      <div className="asset-label" title={asset.title}>
        {asset.title}
      </div>

      {hasVariants && (
        <button className="variant-toggle" onClick={onToggle}>
          {expanded ? "hide" : `${asset.variants.length} variants`}
        </button>
      )}

      {expanded && (
        <div className="variant-strip">
          {asset.variants.map((variant) => (
            <button
              key={variant.groupId}
              className="variant-thumb"
              title={variant.caption}
              draggable
              onDragStart={(e) => startDrag(e, variant)}
              onClick={() => onPlace(asset, variant)}
            >
              <img
                src={window.morphly.assetUrl(asset.source, variant.svgPath)}
                alt={variant.caption}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
