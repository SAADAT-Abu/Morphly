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
 * Results are paged rather than all mounted at once, so 2,000 thumbnails never
 * load together. A pager under the grid says where you are ("Page 3 of 29")
 * and jumps to the first, previous, next, last or any typed page.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { PAGE_SIZE, clampPage, pageRange } from "../lib/pagination";

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
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [managing, setManaging] = useState(false);
  const gridRef = useRef(null);

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

  // A new search starts from its first page.
  useEffect(() => setPage(1), [query, category, collection]);

  // Each page starts at the top of the grid, not wherever the last one was
  // scrolled to.
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = 0;
  }, [page, query, category, collection]);

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

  const range = pageRange(page, filtered.length);

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

      <div className="library-count">
        {filtered.length.toLocaleString()} of {library.stats.assets.toLocaleString()}
        {filtered.length > PAGE_SIZE && (
          <span>
            {" · showing "}
            {(range.start + 1).toLocaleString()} to {range.end.toLocaleString()}
          </span>
        )}
        {library.stats.shareAlike > 0 && (
          <span title="Share-alike icons can oblige your whole figure to carry the same licence">
            {" · "}
            {library.stats.shareAlike} share-alike
          </span>
        )}
      </div>

      <div className="asset-grid" ref={gridRef}>
        {filtered.slice(range.start, range.end).map((asset) => (
          <AssetTile
            key={asset.id}
            asset={asset}
            expanded={expandedId === asset.id}
            onToggle={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
            onPlace={onPlaceAsset}
          />
        ))}
      </div>

      {range.count > 1 && <Pager page={range.page} count={range.count} onChange={setPage} />}

      {filtered.length === 0 && (
        <div className="library-empty small">No assets match that search.</div>
      )}
    </div>
  );
}

/**
 * First, previous, "Page [n] of N", next, last. The page box takes a typed
 * number and moves there on Enter or when it loses focus; Escape puts the
 * current page back. It sits under the grid, which scrolls on its own, so the
 * pager stays in view at any scroll position.
 */
function Pager({ page, count, onChange }) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);

  const go = (next) => onChange(clampPage(next, count));

  const commitDraft = () => {
    const next = clampPage(draft, count);
    setDraft(String(next));
    if (next !== page) onChange(next);
  };

  const first = page <= 1;
  const last = page >= count;

  return (
    <nav className="pager" aria-label="Library pages">
      <button className="pager-btn" onClick={() => go(1)} disabled={first} title="First page" aria-label="First page">
        «
      </button>
      <button className="pager-btn" onClick={() => go(page - 1)} disabled={first} title="Previous page" aria-label="Previous page">
        ‹
      </button>
      <label className="pager-page" htmlFor="library-page">
        Page
        <input
          id="library-page"
          type="text"
          inputMode="numeric"
          value={draft}
          aria-label={`Page number, 1 to ${count}`}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitDraft();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraft(String(page));
              e.currentTarget.blur();
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
        of {count.toLocaleString()}
      </label>
      <button className="pager-btn" onClick={() => go(page + 1)} disabled={last} title="Next page" aria-label="Next page">
        ›
      </button>
      <button className="pager-btn" onClick={() => go(count)} disabled={last} title="Last page" aria-label="Last page">
        »
      </button>
    </nav>
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
