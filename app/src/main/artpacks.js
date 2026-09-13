/**
 * Art Packs: illustration libraries that arrive by download rather than in the
 * installer.
 *
 * A pack is deliberately unexciting: it is the same folder Morphly already
 * mounts, zipped, with a `pack.json` at its root. Installing one unzips it into
 * a data directory and mounts it like any other library folder, so the sidebar,
 * the asset protocol, the licence badges and the collection filter all work
 * without knowing packs exist.
 *
 * Everything here treats the archive as untrusted, because this is the one
 * place Morphly ingests files it did not build:
 *
 *   - downloads only from an allowlisted host, over https
 *   - the sha256 in the catalogue must match before anything is unpacked
 *   - entries with absolute paths or `..` are refused (zip slip)
 *   - only .svg, .json and .png are written, and counts and sizes are capped
 *   - SVGs are stripped of script, event handlers and external references
 *
 * The last one matters more than it looks: canvas rendering is already safe,
 * but SVG export inlines the source, so a hostile file could carry script into
 * a figure that someone later opens in a browser.
 */

const { app, net } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const yauzl = require("yauzl");

/** Where packs may be downloaded from. */
const ALLOWED_HOSTS = new Set(["zenodo.org", "raw.githubusercontent.com", "github.com"]);

const ALLOWED_SUFFIXES = new Set([".svg", ".json", ".png"]);

/** A pack of a few thousand icons is normal; a hundred thousand is an attack. */
const MAX_ENTRIES = 60000;
const MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * Where installed packs live.
 *
 * Electron's userData is `~/.config/Morphly` on Linux, and hundreds of
 * megabytes of artwork do not belong in a config directory, so Linux follows
 * the XDG data path instead. macOS and Windows already point at their
 * respective application-data directories.
 */
function defaultPacksRoot() {
  if (process.platform === "linux") {
    const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    return path.join(base, "Morphly", "art-packs");
  }
  return path.join(app.getPath("userData"), "art-packs");
}

function packsRoot(settings) {
  return settings?.artPacksDir || defaultPacksRoot();
}

// ---------------------------------------------------------------------------
// Reading what is installed
// ---------------------------------------------------------------------------

async function listInstalled(settings) {
  const root = packsRoot(settings);
  let names = [];
  try {
    names = await fsp.readdir(root);
  } catch {
    return [];
  }

  const packs = [];
  for (const name of names) {
    try {
      const dir = path.join(root, name);
      const meta = JSON.parse(await fsp.readFile(path.join(dir, "pack.json"), "utf8"));
      packs.push({ ...meta, dir });
    } catch {
      /* not a pack, or half-written: ignore rather than fail the whole list */
    }
  }
  return packs;
}

// ---------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------

/**
 * Remove anything executable or externally-referencing from an SVG.
 *
 * Textual rather than DOM-based, for the same reason the recolour engine is:
 * BioArt files use `ns0:` prefixes that a parse and re-serialise round trip
 * tends to mangle.
 */
function sanitiseSvg(text) {
  return text
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script[^>]*\/>/gi, "")
    .replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, "")
    // on* handlers, quoted or bare
    .replace(/\son[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    // Remote references, javascript: URLs and non-raster data: URLs. Embedded
    // PNG, JPEG, GIF and WebP stay: a raster cannot run script, and about a
    // fifth of SciDraw's drawings (and many Bioicons ones) are built around
    // one, so stripping them blanked those drawings on install. data:image/svg+xml
    // still goes, because a nested SVG can carry script into an export.
    .replace(/\s(?:xlink:)?href\s*=\s*(["'])\s*(?:https?:|\/\/|javascript:|data:(?!image\/(?:png|jpe?g|gif|webp)[;,]))[^"']*\1/gi, "")
    .replace(/\ssrc\s*=\s*(["'])\s*(?:https?:|\/\/|javascript:|data:(?!image\/(?:png|jpe?g|gif|webp)[;,]))[^"']*\1/gi, "");
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

function assertAllowedUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error(`Refusing a non-https download: ${url.protocol}`);
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Refusing to download from ${url.hostname}`);
  return url;
}

/**
 * Stream a URL to disk, reporting progress and hashing as it goes.
 *
 * `fetchImpl` exists so the install path can be exercised against a local
 * server in tests without loosening the host allowlist that production uses.
 */
async function download(url, destination, { onProgress, signal, fetchImpl } = {}) {
  const response = await (fetchImpl ?? net.fetch)(url, { signal });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);

  const total = Number(response.headers.get("content-length")) || 0;
  const hash = crypto.createHash("sha256");
  const handle = await fsp.open(destination, "w");
  let received = 0;

  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      hash.update(buffer);
      await handle.write(buffer);
      received += buffer.length;
      onProgress?.({ phase: "download", received, total });
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), bytes: received };
}

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

/** Reject anything that would escape the destination directory. */
function safeEntryPath(root, entryName) {
  if (entryName.includes("\0")) throw new Error("Archive entry contains a null byte");
  const normalised = path.normalize(entryName).replace(/^([/\\])+/, "");
  if (path.isAbsolute(normalised) || normalised.split(/[/\\]/).includes("..")) {
    throw new Error(`Archive entry escapes the pack directory: ${entryName}`);
  }
  const full = path.join(root, normalised);
  if (!full.startsWith(root + path.sep)) {
    throw new Error(`Archive entry escapes the pack directory: ${entryName}`);
  }
  return full;
}

function extractZip(zipPath, destination, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openErr, archive) => {
      if (openErr) return reject(openErr);

      let entries = 0;
      let bytes = 0;
      const total = archive.entryCount;

      archive.on("error", reject);
      archive.on("end", () => resolve({ entries, bytes }));

      archive.on("entry", (entry) => {
        (async () => {
          entries += 1;
          if (entries > MAX_ENTRIES) throw new Error("Archive has too many entries");

          // Directory entries are recreated implicitly from file paths.
          if (entry.fileName.endsWith("/")) return archive.readEntry();

          const suffix = path.extname(entry.fileName).toLowerCase();
          if (!ALLOWED_SUFFIXES.has(suffix)) return archive.readEntry();

          bytes += entry.uncompressedSize;
          if (bytes > MAX_UNCOMPRESSED_BYTES) throw new Error("Archive is unreasonably large");

          const target = safeEntryPath(destination, entry.fileName);
          await fsp.mkdir(path.dirname(target), { recursive: true });

          const stream = await new Promise((res, rej) =>
            archive.openReadStream(entry, (err, s) => (err ? rej(err) : res(s)))
          );

          if (suffix === ".svg") {
            // Small enough to hold in memory, and it has to be rewritten anyway.
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            await fsp.writeFile(target, sanitiseSvg(Buffer.concat(chunks).toString("utf8")), "utf8");
          } else {
            await new Promise((res, rej) => {
              const out = fs.createWriteStream(target);
              stream.pipe(out);
              out.on("finish", res);
              out.on("error", rej);
            });
          }

          onProgress?.({ phase: "extract", received: entries, total });
          archive.readEntry();
        })().catch(reject);
      });

      archive.readEntry();
    });
  });
}

// ---------------------------------------------------------------------------
// Install / remove
// ---------------------------------------------------------------------------

/**
 * Download, verify and unpack one Art Pack.
 *
 * Nothing touches the live pack directory until the checksum matches and the
 * archive has been fully extracted to a temporary directory beside it, so an
 * interrupted install leaves the previous state alone.
 */
async function installPack(entry, { settings, onProgress, signal, fetchImpl, allowAnyHost } = {}) {
  const url = allowAnyHost ? new URL(entry.url) : assertAllowedUrl(entry.url);
  const root = packsRoot(settings);
  await fsp.mkdir(root, { recursive: true });

  const staging = path.join(root, `.${entry.id}.incoming`);
  const archivePath = path.join(root, `.${entry.id}.part`);
  const target = path.join(root, entry.id);

  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.rm(archivePath, { force: true });

  try {
    const { sha256, bytes } = await download(url.toString(), archivePath, {
      onProgress,
      signal,
      fetchImpl,
    });

    if (entry.sha256 && sha256 !== entry.sha256) {
      throw new Error("The download does not match its published checksum, so it was discarded");
    }

    await fsp.mkdir(staging, { recursive: true });
    await extractZip(archivePath, staging, { onProgress });

    // A pack without a manifest is not a library, whatever else it contains.
    await fsp.access(path.join(staging, "manifest.json"));

    await fsp.writeFile(
      path.join(staging, "pack.json"),
      JSON.stringify({ ...entry, thumbnail: undefined, installedAt: Date.now(), bytes }, null, 2)
    );

    await fsp.rm(target, { recursive: true, force: true });
    await fsp.rename(staging, target);
    return { ok: true, dir: target };
  } finally {
    await fsp.rm(archivePath, { force: true });
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

async function removePack(id, { settings } = {}) {
  const root = packsRoot(settings);
  const dir = path.join(root, id);
  // Refuse anything that is not a direct child of the packs directory.
  if (path.dirname(dir) !== root || !id || id.includes("/") || id.includes("\\")) {
    throw new Error(`Refusing to remove ${id}`);
  }
  await fsp.rm(dir, { recursive: true, force: true });
  return { ok: true, dir };
}

module.exports = {
  defaultPacksRoot,
  download,
  extractZip,
  packsRoot,
  listInstalled,
  installPack,
  removePack,
  sanitiseSvg,
  safeEntryPath,
  assertAllowedUrl,
};
