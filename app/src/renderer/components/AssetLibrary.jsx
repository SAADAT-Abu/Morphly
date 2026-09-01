/**
 * The asset sidebar: browse, search and place assets from one or more scraped
 * libraries.
 *
 * Morphly points at library folders rather than bundling them. Two producers
 * exist -- NIH BioArt (scraper/bioart_scraper.py) and Bioicons
 * (scraper/bioicons_fetcher.py) -- and both emit the same manifest format, so
 * several can be mounted at once and browsed together.
 *
 * Licence is shown on every tile because it genuinely differs between the two:
 * BioArt is mostly Public Domain, while ~83% of Bioicons requires attribution
 * and a few icons are share-alike. That is much easier to respect while
 * choosing an asset than to reconstruct at submission time.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";

const PAGE_SIZE = 90;

/** Compact badge text; full detail goes in the tooltip. */
function licenceBadge(asset) {
  if (!asset.license) return null;
  if (asset.shareAlike) return "SA";
  if (!asset.requiresAttribution) return "PD";
  return "BY";
}

export default function AssetLibrary({ onPlaceAsset }) {
  const library = useStore((s) => s.library);
  const libraryError = useStore((s) => s.libraryError);
  const setLibrary = useStore((s) => s.setLibrary);
  const setLibraryError = useStore((s) => s.setLibraryError);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [collection, setCollection] = useState("All");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await window.morphly.loadLibrary();
      if (cancelled) return;
      if (res.ok) setLibrary(res.library);
      else if (res.error && res.error !== "no-library-configured") setLibraryError(res.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [setLibrary, setLibraryError]);

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

  useEffect(() => setLimit(PAGE_SIZE), [query, category, collection]);

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
          <button className="primary" onClick={addLibrary} disabled={loading}>
            {loading ? "Loading…" : "Add library folder…"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel library">
      <div className="panel-header">
        Asset library
        <button className="link" onClick={() => setManaging((v) => !v)}>
          {managing ? "done" : "sources"}
        </button>
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
        {library.stats.shareAlike > 0 && (
          <span title="Share-alike icons can oblige your whole figure to carry the same licence">
            {" · "}
            {library.stats.shareAlike} share-alike
          </span>
        )}
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
