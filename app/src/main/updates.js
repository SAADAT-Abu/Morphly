/**
 * "Is there a newer Morphly?"
 *
 * Morphly is distributed through Zenodo, and a concept DOI there always
 * resolves to the newest version of a record, so one unauthenticated GET is
 * enough to learn what the current release is. Nothing is sent: no identifiers,
 * no usage data, no version of the running app. The request is a plain read of
 * a public record, and it can be turned off entirely in settings.
 *
 * The check is deliberately advisory. Morphly never downloads or installs
 * anything by itself: it says a newer version exists and offers to open the
 * page in a browser, which keeps a 450 MB download an explicit choice.
 */

const { net, app } = require("electron");

/** Concept record id: Zenodo redirects this to the latest version. */
const CONCEPT_RECORD = "22238248";
const API_URL = `https://zenodo.org/api/records/${CONCEPT_RECORD}`;

/** Don't ask Zenodo more than once a day. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Give up rather than hang a startup on a slow or captive network. */
const TIMEOUT_MS = 8000;

/**
 * Pull a version out of a Zenodo record.
 *
 * The record's own `version` metadata field is authoritative when it is set,
 * but it is optional and often left blank, so the filenames are the fallback:
 * every release ships files named like `Morphly-0.2.0.AppImage`.
 */
function versionFromRecord(record) {
  const declared = String(record?.metadata?.version ?? "").trim().replace(/^v/i, "");
  if (/^\d+\.\d+/.test(declared)) return declared;
  for (const file of record?.files ?? []) {
    const match = /(\d+\.\d+\.\d+)/.exec(file.key ?? "");
    if (match) return match[1];
  }
  return null;
}

/** Compare two dotted versions. Returns true when `candidate` is newer. */
function isNewer(candidate, current) {
  const parse = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

async function fetchLatestRecord() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await net.fetch(API_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Zenodo replied ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check for a newer release.
 *
 * `force` skips the once-a-day throttle, for the Help menu item where the user
 * has asked directly and expects an answer now.
 */
async function checkForUpdate({ settings, writeSettings, force = false }) {
  if (!force && settings.checkForUpdates === false) {
    return { ok: true, skipped: "disabled" };
  }
  const last = settings.lastUpdateCheck ?? 0;
  if (!force && Date.now() - last < CHECK_INTERVAL_MS) {
    return { ok: true, skipped: "checked-recently" };
  }

  try {
    const record = await fetchLatestRecord();
    const latest = versionFromRecord(record);
    const current = app.getVersion();
    await writeSettings({ lastUpdateCheck: Date.now() });

    if (!latest) return { ok: true, unknown: true };
    return {
      ok: true,
      current,
      latest,
      available: isNewer(latest, current),
      url: record.links?.self_html ?? `https://doi.org/10.5281/zenodo.${CONCEPT_RECORD}`,
    };
  } catch (err) {
    // Being offline is the normal case for this app, not an error worth
    // interrupting anyone over.
    return { ok: false, error: String(err?.message ?? err) };
  }
}

module.exports = { checkForUpdate, versionFromRecord, isNewer };
