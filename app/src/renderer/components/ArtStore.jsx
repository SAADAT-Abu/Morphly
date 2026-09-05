/**
 * The Art Store: illustration libraries you can add without reinstalling.
 *
 * Morphly ships with NIH BioArt and nothing else, because bundling every
 * library made a 465 MB installer most of which many users never touch. The
 * rest are Art Packs, published on Zenodo and listed here.
 *
 * A card leads with what the pack contains and what it obliges you to do,
 * rather than with its name and size. Share-alike artwork can oblige a whole
 * figure to be shared openly, and that is the kind of thing better known
 * before installing than at submission.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";

const formatBytes = (bytes) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

export default function ArtStore({ onClose, onLibraryChange, flash }) {
  const [packs, setPacks] = useState(null);
  const [offline, setOffline] = useState(false);
  const [root, setRoot] = useState("");
  const [error, setError] = useState(null);
  /** { id, phase, received, total } while something is installing. */
  const [progress, setProgress] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const res = await window.morphly.artPackCatalogue();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPacks(res.packs);
    setOffline(res.offline);
    setRoot(res.root);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => window.morphly.onArtPackProgress(setProgress), []);

  const install = async (pack) => {
    setBusyId(pack.id);
    setProgress(null);
    const res = await window.morphly.installArtPack(pack);
    setBusyId(null);
    setProgress(null);
    if (res.ok) {
      onLibraryChange(res.library);
      flash(`${pack.name} added to your library.`);
      load();
    } else {
      flash(`Could not install ${pack.name}: ${res.error}`);
    }
  };

  const remove = async (pack) => {
    setBusyId(pack.id);
    const res = await window.morphly.removeArtPack(pack.id);
    setBusyId(null);
    if (res.ok) {
      onLibraryChange(res.library);
      flash(`${pack.name} removed.`);
      load();
    } else {
      flash(`Could not remove ${pack.name}: ${res.error}`);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal store-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>Art Store</h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="help-body">
          <p className="lede">
            Extra illustration libraries, downloaded when you want them. Morphly comes
            with NIH BioArt; everything here is optional and can be removed again.
          </p>

          {offline && (
            <p className="hint">
              Showing the list that came with the app: Morphly could not reach the
              catalogue. Downloads need a connection.
            </p>
          )}
          {error && <p className="error">{error}</p>}
          {!packs && !error && <p className="hint">Loading…</p>}

          {packs?.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              busy={busyId === pack.id}
              progress={progress?.id === pack.id ? progress : null}
              disabled={Boolean(busyId) && busyId !== pack.id}
              onInstall={() => install(pack)}
              onRemove={() => remove(pack)}
            />
          ))}

          {root && (
            <p className="hint">
              Packs are stored in <code>{root}</code>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PackCard({ pack, busy, progress, disabled, onInstall, onRemove }) {
  const categories = Object.entries(pack.categories ?? {});
  const shown = categories.slice(0, 6);
  const rest = categories.length - shown.length;

  return (
    <div className="pack-card">
      {pack.thumbnail && <img className="pack-thumb" src={pack.thumbnail} alt="" />}

      <div className="pack-body">
        <div className="pack-title">
          <strong>{pack.name}</strong>
          <span className="pack-meta">
            {pack.entries?.toLocaleString()} illustrations
            {pack.bytes ? ` · ${formatBytes(pack.bytes)} download` : ""}
          </span>
        </div>

        <p className="pack-summary">{pack.summary}</p>

        {shown.length > 0 && (
          <p className="pack-categories">
            {shown.map(([name, count]) => `${name} (${count})`).join(", ")}
            {rest > 0 ? `, and ${rest} more categories` : ""}
          </p>
        )}

        <div className="pack-licences">
          {pack.entries - (pack.requiresAttribution ?? 0) > 0 && (
            <span className="licence-badge inline pd">
              {(pack.entries - (pack.requiresAttribution ?? 0)).toLocaleString()} no attribution
            </span>
          )}
          {pack.requiresAttribution > 0 && (
            <span className="licence-badge inline by">
              {pack.requiresAttribution.toLocaleString()} need credit
            </span>
          )}
          {pack.shareAlike > 0 && (
            <span className="licence-badge inline sa">{pack.shareAlike} share-alike</span>
          )}
        </div>

        {pack.shareAlike > 0 && (
          <p className="hint">
            Share-alike artwork can require the whole figure to carry the same licence.
            Morphly flags those icons in the sidebar and warns before export.
          </p>
        )}

        {busy && progress && (
          <div className="pack-progress">
            <div
              className="pack-progress-bar"
              style={{
                width: progress.total
                  ? `${Math.round((progress.received / progress.total) * 100)}%`
                  : "40%",
              }}
            />
            <span>
              {progress.phase === "download"
                ? `Downloading ${formatBytes(progress.received)}${
                    progress.total ? ` of ${formatBytes(progress.total)}` : ""
                  }`
                : `Unpacking ${progress.received} of ${progress.total} files`}
            </span>
          </div>
        )}
      </div>

      <div className="pack-actions">
        {pack.installed ? (
          <>
            <span className="pack-installed">Installed</span>
            <button className="ghost small" onClick={onRemove} disabled={busy || disabled}>
              {busy ? "Removing…" : "Remove"}
            </button>
          </>
        ) : (
          <button className="primary small" onClick={onInstall} disabled={busy || disabled}>
            {busy ? "Installing…" : "Download"}
          </button>
        )}
        {pack.homepage && (
          <button
            className="ghost small"
            onClick={() => window.morphly.openExternal(pack.homepage)}
          >
            About
          </button>
        )}
      </div>
    </div>
  );
}
