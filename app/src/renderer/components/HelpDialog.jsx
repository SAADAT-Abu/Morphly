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
  SHORTCUTS,
  GETTING_STARTED,
  AUTHOR,
  LINKS,
  MORPHLY_LICENSE,
  ASSET_CREDITS,
  SOFTWARE_CREDITS,
} from "../content/helpContent";
import iconUrl from "../assets/icon.png";

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
        libraries, a self-hosted alternative to the paid tools.
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
        that varies is whether you have to credit the artist and, for a small
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
          PNG export does not draw the citation footer. Copy the credit lines from the
          properties panel instead, or export SVG/PDF.
        </p>
      </section>

      <section>
        <h3>Rule of thumb</h3>
        <p>
          Use anything. Leave the citation checkbox ticked. If you see an orange
          share-alike warning, decide whether you are happy for that figure to be openly
          reusable, and if not, swap in a different icon.
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

/** Opens in the user's browser rather than navigating the app window. */
function ExternalLink({ href, children }) {
  return (
    <button className="link" onClick={() => window.morphly.openExternal(href)}>
      {children ?? href}
    </button>
  );
}

function About() {
  return (
    <>
      <div className="about-head">
        <img src={iconUrl} alt="" width="72" height="72" />
        <div>
          <h3 className="about-title">Morphly v0.1</h3>
          <p className="about-sub">
            A free, offline editor for scientific figures, built on openly licensed
            illustration libraries.
          </p>
          <p className="about-sub">
            Released under the {MORPHLY_LICENSE} licence.
          </p>
        </div>
      </div>

      <section>
        <h3>Author</h3>
        <p>
          <strong>{AUTHOR.name}</strong>
          <br />
          {AUTHOR.role}, {AUTHOR.affiliationFull}
        </p>
      </section>

      <section>
        <h3>Source code & feedback</h3>
        <p>
          Morphly is open source. Bug reports and feature requests are welcome. Please
          open an issue rather than emailing, so other users can see it too.
        </p>
        <div className="link-row">
          <button className="ghost small" onClick={() => window.morphly.openExternal(LINKS.repo)}>
            Source on GitHub
          </button>
          <button
            className="ghost small"
            onClick={() => window.morphly.openExternal(LINKS.issues)}
          >
            Report a bug / request a feature
          </button>
          <button className="ghost small" onClick={() => window.morphly.openExternal(LINKS.zenodo)}>
            Cite Morphly (Zenodo)
          </button>
        </div>
      </section>

      <section>
        <h3>Illustration libraries</h3>
        <p className="hint">
          Morphly reads these libraries from a folder on your machine. It does not host,
          bundle or redistribute any of the artwork, and it is not affiliated with or
          endorsed by the projects below. All credit for the illustrations belongs to
          their creators.
        </p>
        {ASSET_CREDITS.map((source) => (
          <div className="credit" key={source.name}>
            <strong>{source.name}</strong>
            <p className="credit-who">{source.who}</p>
            <p className="credit-licence">{source.licenses}</p>
            <p>{source.note}</p>
            <ExternalLink href={source.url} />
          </div>
        ))}
      </section>

      <section>
        <h3>Built with</h3>
        <p className="hint">
          Morphly stands on these open-source projects, with thanks to their maintainers.
        </p>
        <table className="credits-table">
          <tbody>
            {SOFTWARE_CREDITS.map((s) => (
              <tr key={s.name}>
                <td><strong>{s.name}</strong></td>
                <td className="muted">{s.what}</td>
                <td className="muted">{s.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Figure files</h3>
        <p>
          Figures are saved as <code>.morphly</code> JSON and export to PNG, SVG and PDF.
          The format is plain text and documented in the repository, so your work is not
          locked inside this app.
        </p>
      </section>
    </>
  );
}
