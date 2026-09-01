/**
 * First-run welcome screen.
 *
 * Shows until the user opts out (persisted in app settings), and is always
 * reachable again from Help → Show welcome screen.
 *
 * It adapts to whether a library is mounted: with no artwork available the
 * only useful next step is choosing a folder, so that becomes the primary
 * action instead of a dead "Get started" button that leaves an empty sidebar.
 */

import React, { useState } from "react";
import { useStore } from "../store";
import iconUrl from "../assets/icon.png";
import { AUTHOR } from "../content/helpContent";

export default function WelcomeDialog({ onClose, onOpenHelp, onAddLibrary }) {
  const library = useStore((s) => s.library);
  const [dontShow, setDontShow] = useState(false);

  const hasLibrary = Boolean(library && library.stats.assets > 0);

  const close = async () => {
    if (dontShow) {
      // Best-effort: failing to persist the preference should not block the
      // user from getting into the app.
      try {
        await window.morphly.setSettings({ showWelcome: false });
      } catch {
        /* ignore */
      }
    }
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal welcome-modal">
        <div className="welcome-head">
          <img className="welcome-logo" src={iconUrl} alt="" width="64" height="64" />
          <div>
            <h2>Welcome to Morphly</h2>
            <p className="lede">
              Build scientific figures from free, openly licensed illustration libraries.
            </p>
            <p className="byline">
              Developed by {AUTHOR.name} · {AUTHOR.role}, {AUTHOR.affiliation}
            </p>
          </div>
        </div>

        <div className="welcome-points">
          <Point icon="🔍" title="Browse thousands of illustrations">
            Search NIH BioArt and Bioicons side by side — viruses, cells, anatomy, lab
            equipment, animals, chemistry. Click to place, or drag onto the canvas.
          </Point>
          <Point icon="🎨" title="Recolour any vector in one click">
            Every illustration is a real vector. Change one swatch and every shape using
            that colour follows — no need to touch hundreds of paths by hand.
          </Point>
          <Point icon="📄" title="Export figures that stay sharp">
            PNG, SVG and PDF. Vector output scales to any size, and asset credits can be
            written into the file for you.
          </Point>
        </div>

        <div className="welcome-licence">
          <strong>A word on licensing.</strong> Everything here is free to use, including
          commercially. Most assets simply ask that you credit the artist, which Morphly
          writes for you at export. A small number are “share-alike”, which can require
          your figure to be shared openly too — those are flagged with an orange{" "}
          <span className="licence-badge sa inline">SA</span> badge and a warning before you
          export.{" "}
          <button className="link" onClick={onOpenHelp}>
            Read the full explanation
          </button>
        </div>

        {!hasLibrary && (
          <div className="welcome-setup">
            <strong>One setup step:</strong> Morphly doesn’t ship the artwork. Generate a
            library with the scripts in <code>scraper/</code>, then point Morphly at the
            folder containing <code>manifest.json</code>.
          </div>
        )}

        <label className="check">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
          />
          Don’t show this again
        </label>

        <div className="modal-actions">
          <button className="ghost" onClick={onOpenHelp}>
            Open help
          </button>
          {hasLibrary ? (
            <button className="primary" onClick={close}>
              Start designing
            </button>
          ) : (
            <button
              className="primary"
              onClick={async () => {
                await onAddLibrary();
              }}
            >
              Add library folder…
            </button>
          )}
        </div>

        {!hasLibrary && (
          <button className="link centred" onClick={close}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

function Point({ icon, title, children }) {
  return (
    <div className="welcome-point">
      <span className="welcome-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}
