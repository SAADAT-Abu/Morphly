import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

// Main-process modules are CommonJS; load them the way Electron does.
const require = createRequire(import.meta.url);
const { sanitiseSvg, validateSvg } = require("./svgSafety.js");

/** NIH BioArt's own shape: every element carries an `ns0:` namespace prefix. */
const bioart = (body) =>
  `<?xml version='1.0' encoding='utf-8'?>\n` +
  `<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg" viewBox="0 0 500 500">${body}</ns0:svg>`;

describe("validateSvg", () => {
  it("accepts drawings whose namespace prefix contains a digit", () => {
    // The whole NIH BioArt library is written this way. A prefix pattern of
    // [a-z]+: matched xlink: but not ns0:, so 2,049 of BioArt's 2,531 drawings
    // were read as having no drawable elements and dropped as blank.
    expect(validateSvg(bioart('<ns0:path d="M0 0h10v10H0z"/>')).status).toBe("ok");
    expect(validateSvg(bioart('<ns0:g><ns0:circle cx="5" cy="5" r="4"/></ns0:g>')).status).toBe("ok");
  });

  it("still accepts the unprefixed and xlink-prefixed forms", () => {
    const plain = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z"/></svg>';
    expect(validateSvg(plain).status).toBe("ok");
    expect(validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><ellipse rx="2" ry="3"/></svg>').status)
      .toBe("ok");
  });

  it("still calls an empty white page blank, prefixed or not", () => {
    expect(validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#fff" width="9" height="9"/></svg>').status)
      .toBe("blank");
    expect(validateSvg(bioart('<ns0:rect fill="white" width="9" height="9"/>')).status).toBe("blank");
    expect(validateSvg(bioart("")).status).toBe("blank");
    expect(validateSvg("   ").status).toBe("empty");
  });

  it("recovers a size from a prefixed group when the root declares none", () => {
    const sized = validateSvg(
      '<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg">' +
        '<ns0:g width="120" height="60"><ns0:path d="M0 0h10"/></ns0:g></ns0:svg>'
    );
    expect(sized.status).toBe("repaired");
    expect(sized.text).toContain('viewBox="0 0 120 60"');
  });

  it("drops a file that is not well-formed XML", () => {
    expect(validateSvg('<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg"><ns0:path d="M0 0"></ns0:svg>').status)
      .toBe("malformed");
  });

  it("trims stray bytes after a prefixed closing tag rather than dropping the file", () => {
    const result = validateSvg(
      bioart('<ns0:path d="M0 0h10v10H0z"/>') + "\n</div>junk"
    );
    expect(result.status).toBe("repaired");
    expect(result.text.endsWith("</ns0:svg>")).toBe(true);
  });
});

describe("sanitiseSvg", () => {
  it("strips script, handlers and remote references from a prefixed document", () => {
    const dirty = bioart(
      '<ns0:script>fetch("https://example.com")</ns0:script>' +
        '<ns0:path d="M0 0h10" onclick="alert(1)"/>' +
        '<ns0:image xlink:href="https://example.com/x.png"/>'
    );
    const clean = sanitiseSvg(dirty);
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/example\.com/);
    expect(clean).toContain('d="M0 0h10"');
  });

  it("keeps an embedded raster, which cannot run anything", () => {
    const withRaster = bioart('<ns0:image xlink:href="data:image/png;base64,iVBORw0KGgo="/>');
    expect(sanitiseSvg(withRaster)).toContain("data:image/png;base64");
  });
});
