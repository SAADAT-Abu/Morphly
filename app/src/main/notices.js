/**
 * Messages from the project to the people running it.
 *
 * The update check next door answers one question only, "is there a newer
 * version", and it cannot say anything else: not that a release has a fault
 * worth updating for today, not that a new Art Pack exists, not that a library
 * changed its licence. 0.5.1 is the case that made this necessary. Its Linux
 * build loses the bundled library after the first launch, and the only way to
 * tell the people running it was to hope they looked at GitHub.
 *
 * So notices are fetched from a small file in the repository, the same way the
 * Art Store catalogue is, which means a notice can be published without
 * releasing a new Morphly and reaches versions that already exist.
 *
 * What is sent: nothing. This is a plain GET of a public file, with no query
 * string, no identifier and no version of the running app, so which notices
 * apply is decided here rather than by a server that would have to be told.
 * The same settings switch that turns off update checks turns this off too:
 * one switch for "does Morphly talk to the network on its own", because two
 * would invite the belief that turning one off was enough.
 */

const { net, app } = require("electron");

const NOTICES_URL = "https://raw.githubusercontent.com/SAADAT-Abu/Morphly/main/notices.json";

/** Once a day is plenty: a notice is news, not a heartbeat. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

/** Keep a hostile or careless file from filling the screen. */
const MAX_NOTICES = 3;
const MAX_TITLE = 120;
const MAX_BODY = 600;

const { isNewer } = require("./updates");

/** Lower or equal. `isNewer` is the only comparison the project has. */
const atMost = (version, bound) => !isNewer(version, bound);
const atLeast = (version, bound) => !isNewer(bound, version);

/**
 * Which notices this copy of Morphly should show.
 *
 * Pure, and the only place the rules live, so the filtering can be tested
 * without a network or an Electron app. A notice with no bounds goes to
 * everyone; `maxVersion` is how a notice about a broken release reaches only
 * the people still running it.
 */
function selectNotices({ notices, version, platform, dismissed = [] }) {
  const seen = new Set(dismissed);
  const chosen = [];

  for (const notice of Array.isArray(notices) ? notices : []) {
    if (!notice || typeof notice.id !== "string" || !notice.title) continue;
    if (seen.has(notice.id)) continue;
    if (Array.isArray(notice.platforms) && !notice.platforms.includes(platform)) continue;
    if (notice.minVersion && !atLeast(version, notice.minVersion)) continue;
    if (notice.maxVersion && !atMost(version, notice.maxVersion)) continue;

    chosen.push({
      id: notice.id,
      level: notice.level === "important" ? "important" : "info",
      title: String(notice.title).slice(0, MAX_TITLE),
      body: String(notice.body ?? "").slice(0, MAX_BODY),
      // Only https, and only opened when the person clicks: the main process
      // link handler refuses anything else anyway, but a bad URL should not
      // reach the button in the first place.
      url: /^https:\/\//.test(notice.url ?? "") ? notice.url : null,
      linkText: String(notice.linkText ?? "Read more").slice(0, 40),
    });
    if (chosen.length >= MAX_NOTICES) break;
  }

  return chosen;
}

async function fetchNotices(url = NOTICES_URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`GitHub replied ${response.status}`);
    const payload = await response.json();
    return payload?.notices ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and filter, honouring the same switch and throttle as the update check.
 *
 * Failure is silent by design: this app is meant to work on a train.
 */
async function checkNotices({ settings, writeSettings, force = false, fetchImpl = fetchNotices }) {
  if (!force && settings.checkForUpdates === false) return { ok: true, notices: [], skipped: "disabled" };
  const last = settings.lastNoticeCheck ?? 0;
  if (!force && Date.now() - last < CHECK_INTERVAL_MS) {
    return { ok: true, notices: [], skipped: "checked-recently" };
  }

  try {
    const notices = await fetchImpl(settings.noticesUrl ?? NOTICES_URL);
    await writeSettings({ lastNoticeCheck: Date.now() });
    return {
      ok: true,
      notices: selectNotices({
        notices,
        version: app.getVersion(),
        platform: process.platform,
        dismissed: settings.dismissedNotices ?? [],
      }),
    };
  } catch (err) {
    return { ok: false, notices: [], error: String(err?.message ?? err) };
  }
}

module.exports = { checkNotices, selectNotices, fetchNotices, NOTICES_URL };
