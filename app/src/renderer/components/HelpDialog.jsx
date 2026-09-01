/**
 * Help window: getting started, licensing, shortcuts, about.
 *
 * Opens on a specific tab so the Help menu can jump straight to the section
 * the user asked for.
 */

import React, { useState } from "react";
import { useStore } from "../store";
import {
  LICENCE_TIERS,
  SOURCES,
  SHORTCUTS,
  GETTING_STARTED,
} from "../content/helpContent";

const TABS = [
  ["start", "Getting started"],
  ["licensing", "Licensing"],
  ["shortcuts", "Shortcuts"],
  ["about", "About"],
];

export default function HelpDialog({ initialTab = "start", onClose }) {
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>Morphly help</h2>
          <button className="ghost small" onClick={onClose}>Close</button>
        </div>

        <div className="tab-row">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              className={`tab${tab === id ? " active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="help-body">
          {tab === "start" && <GettingStarted />}
          {tab === "licensing" && <Licensing />}
          {tab === "shortcuts" && <Shortcuts />}
          {tab === "about" && <About />}
        </div>
      </div>
    </div>
  );
}

function GettingStarted() {
  return (
    <>
      <p className="lede">
        Morphly builds scientific figures from free, openly licensed illustration
        libraries — a self-hosted alternative to the paid tools.
      </p>
      {GETTING_STARTED.map((step) => (
        <section key={step.title}>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </section>
      ))}
    </>
  );
}

/**
 * The licensing section. Live counts come from the mounted libraries, so this
 * always describes what the user actually has rather than a fixed claim.
 */
function Licensing() {
  const library = useStore((s) => s.library);
  const stats = library?.stats;

  return (
    <>
      <p className="lede">
        Everything in Morphly is free to use, including commercially. The only thing
        that varies is whether you have to credit the artist — and, for a small
        number of icons, whether that obligation passes on to your figure.
      </p>

      {stats && (
        <div className="stat-row">
          <Stat value={stats.assets.toLocaleString()} label="assets mounted" />
          <Stat value={(stats.assets - stats.needingAttribution).toLocaleString()} label="need no credit" />
          <Stat value={stats.needingAttribution.toLocaleString()} label="need a credit line" />
          <Stat value={stats.shareAlike.toLocaleString()} label="share-alike" tone={stats.shareAlike ? "sa" : null} />
        </div>
      )}

      {LICENCE_TIERS.map((tier) => (
        <section key={tier.badge} className="tier">
          <h3>
            <span className={`licence-badge ${tier.tone} inline`}>{tier.badge}</span>
            {tier.title}
          </h3>
          <p className="covers">{tier.covers}</p>
          <p>{tier.meaning}</p>
          <p className="todo"><strong>What you do:</strong> {tier.todo}</p>
        </section>
      ))}

      <section>
        <h3>How Morphly helps</h3>
        <ul>
          <li>Every thumbnail carries a <strong>PD</strong>, <strong>BY</strong> or <strong>SA</strong> badge.</li>
          <li>Selecting an asset shows its full credit line in the properties panel.</li>
          <li>Share-alike assets raise a warning in the properties panel and again before export.</li>
          <li>
            “Append asset citations” writes correctly formatted credits into the footer of
            SVG and PDF exports, grouped by library.
          </li>
        </ul>
        <p className="hint">
          PNG export does not draw the citation footer — copy the credit lines from the
          properties panel instead, or export SVG/PDF.
        </p>
      </section>

      <section>
        <h3>Rule of thumb</h3>
        <p>
          Use anything. Leave the citation checkbox ticked. If you see an orange
          share-alike warning, decide whether you are happy for that figure to be openly
          reusable — and if not, swap in a different icon.
        </p>
        <p className="hint">
          This is a plain-language summary of the licence terms, not legal advice. For
          share-alike specifically, your institution or target journal will have a clearer
          view on how strictly they treat it.
        </p>
      </section>
    </>
  );
}

function Stat({ value, label, tone }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Shortcuts() {
  return (
    <div className="shortcut-grid">
      {SHORTCUTS.map(({ group, items }) => (
        <section key={group}>
          <h3>{group}</h3>
          <table className="shortcuts">
            <tbody>
              {items.map(([keys, what]) => (
                <tr key={keys}>
                  <td><kbd>{keys}</kbd></td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function About() {
  return (
    <>
      <p className="lede">Morphly v0.1 — a free, offline scientific figure editor.</p>
      <section>
        <h3>Asset libraries</h3>
        {SOURCES.map((s) => (
          <p key={s.name}>
            <strong>{s.name}</strong> — {s.blurb}
            <br />
            <span className="hint">{s.url}</span>
          </p>
        ))}
        <p className="hint">
          Morphly is not affiliated with NIAID/NIH or Bioicons. It reads libraries you
          generate yourself with the scripts in <code>scraper/</code>.
        </p>
      </section>
      <section>
        <h3>Built with</h3>
        <p>
          Electron, React and Konva — all open source. Figures are saved as{" "}
          <code>.morphly</code> JSON and export to PNG, SVG and PDF.
        </p>
      </section>
    </>
  );
}
