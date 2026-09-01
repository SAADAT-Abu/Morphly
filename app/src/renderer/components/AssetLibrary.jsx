/**
 * The BioArt sidebar: browse, search and place assets from a scraped library.
 *
 * Morphly points at a library folder rather than bundling one. ~2,000 SVGs
 * would bloat the installer, and the library is reproducible from the scraper
 * at any time, so the folder path is a setting instead.
 *
 * Entries with several file groups (colour/style variants of one illustration)
 * collapse into a single tile with a variant strip, rather than filling the
 * grid with near-identical thumbnails.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";

const PAGE_SIZE = 90;

export default function AssetLibrary({ onPlaceAsset }) {
  const library = useStore((s) => s.library);
  const libraryError = useStore((s) => s.libraryError);
  const setLibrary = useStore((s) => s.setLibrary);
  const setLibraryError = useStore((s) => s.setLibraryError);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(false);

  // Try the remembered library folder on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await window.morphly.loadSavedLibrary();
      if (cancelled) return;
      if (res.ok) setLibrary(res.library);
      else if (res.error && res.error !== "no-library-configured") setLibraryError(res.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [setLibrary, setLibraryError]);

  const pickFolder = async () => {
    setLoading(true);
    const res = await window.morphly.pickLibraryFolder();
    setLoading(false);
    if (res.ok) {
      setLibrary(res.library);
      setLibraryError(null);
    } else if (!res.canceled) {
      setLibraryError(res.error);
    }
  };

  const filtered = useMemo(() => {
    if (!library) return [];
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);

    return library.assets.filter((asset) => {
      if (category !== "All" && asset.category !== category) return false;
      if (terms.length === 0) return true;
      // Match against title + keywords, requiring every term to appear
      // somewhere -- so "green virus" narrows rather than widens.
      const haystack = `${asset.title} ${asset.category} ${asset.keywords.join(" ")}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [library, query, category]);

  useEffect(() => setLimit(PAGE_SIZE), [query, category]);

  // -- empty / error states -------------------------------------------------

  if (!library) {
    return (
      <div className="panel library">
        <div className="panel-header">BioArt library</div>
        <div className="library-empty">
          <p>
            Morphly reads the asset library produced by <code>bioart_scraper.py</code>.
            Point it at the folder that contains <code>manifest.json</code>.
          </p>
          {libraryError && <p className="error">{libraryError}</p>}
          <button className="primary" onClick={pickFolder} disabled={loading}>
            {loading ? "Loading…" : "Choose library folder…"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel library">
      <div className="panel-header">
        BioArt library
        <button className="link" onClick={pickFolder} title={library.dir}>
          change
        </button>
      </div>

      <div className="library-controls">
        <input
          type="search"
          placeholder="Search title and keywords…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option>All</option>
          {library.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="library-count">
        {filtered.length.toLocaleString()} of {library.stats.assets.toLocaleString()} assets
        {" · "}
        {library.stats.variants.toLocaleString()} variants
      </div>

      <div className="asset-grid">
        {filtered.slice(0, limit).map((asset) => (
          <AssetTile
            key={asset.id}
            asset={asset}
            expanded={expandedId === asset.id}
            onToggle={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
            onPlace={onPlaceAsset}
          />
        ))}
      </div>

      {filtered.length > limit && (
        <button className="load-more" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
          Show {Math.min(PAGE_SIZE, filtered.length - limit)} more
        </button>
      )}

      {filtered.length === 0 && <div className="library-empty small">No assets match that search.</div>}
    </div>
  );
}

function AssetTile({ asset, expanded, onToggle, onPlace }) {
  const primary = asset.variants[0];
  const hasVariants = asset.variants.length > 1;

  const startDrag = (event, variant) => {
    // The canvas reads this on drop to place the asset where it landed.
    event.dataTransfer.setData(
      "application/x-morphly-asset",
      JSON.stringify({ assetId: asset.id, groupId: variant.groupId })
    );
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className={`asset-tile${expanded ? " expanded" : ""}`}>
      <button
        className="asset-thumb"
        title={`${asset.title}${hasVariants ? ` · ${asset.variants.length} variants` : ""}\nClick to add, drag onto the canvas to place`}
        draggable
        onDragStart={(e) => startDrag(e, primary)}
        onClick={() => onPlace(asset, primary)}
      >
        <img src={window.morphly.assetUrl(primary.svgPath)} alt={asset.title} loading="lazy" />
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
              <img src={window.morphly.assetUrl(variant.svgPath)} alt={variant.caption} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
