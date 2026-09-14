import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { XMLValidator } from "fast-xml-parser";

// Main-process modules are CommonJS; load them the way Electron does.
const require = createRequire(import.meta.url);
const { parsePath, translatePath, mergeMarks, prepareSvg } = require("./svgImport.js");

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${body}</svg>`;
const pathCount = (text) => (text.match(/<path\b/g) ?? []).length;

describe("parsePath", () => {
  it("reads commands and their numbers, including exponents and packed signs", () => {
    expect(parsePath("M1,2L-3.5.5e1Z")).toEqual([
      { cmd: "M", args: [1, 2] },
      { cmd: "L", args: [-3.5, 5] },
      { cmd: "Z", args: [] },
    ]);
    expect(parsePath("M 0 1 C 0.2 1 0.5 0.8 0.7 0.7 z")).toHaveLength(3);
  });

  it("refuses path data it cannot read with certainty", () => {
    expect(parsePath("a1 1 0 011 1")).toBeNull(); // does not start with a moveto
    expect(parsePath("M0 0a1 1 0 011 1")).toBeNull(); // packed arc flags
    expect(parsePath("M0 0 L1")).toBeNull(); // odd number of coordinates
    expect(parsePath("M0 0 Q1 1 2 2 junk")).toBeNull();
    expect(parsePath("")).toBeNull();
    expect(parsePath(undefined)).toBeNull();
  });
});

describe("translatePath", () => {
  it("moves absolute commands and leaves relative ones alone", () => {
    const d = translatePath(parsePath("M0 0H10V5C1 2 3 4 5 6l1 1A2 3 45 0 1 7 8Z"), 100, 200);
    expect(d).toBe("M100 200H110V205C101 202 103 204 105 206l1 1A2 3 45 0 1 107 208Z");
  });

  it("turns an opening relative moveto into an absolute one", () => {
    expect(translatePath(parsePath("m1 2 3 4 5 6"), 10, 20)).toBe("M11 22l3 4 5 6");
  });

  it("keeps a relative moveto after the first as it is", () => {
    expect(translatePath(parsePath("M0 0z m5 5 h1"), 1, 1)).toBe("M1 1zm5 5h1");
  });
});

describe("mergeMarks", () => {
  it("merges a run of identical ggplot2 points into one path", () => {
    const points = Array.from(
      { length: 500 },
      (_, i) => `<circle cx='${i}' cy='${i / 2}' r='0.67' style='stroke-width: 0.71; stroke: #264653; fill: #264653;' />`
    ).join("\n");
    const { text, folded } = mergeMarks(svg(`<g clip-path='url(#c)'>\n${points}\n</g>`));
    expect(folded).toBe(499);
    expect(pathCount(text)).toBe(1);
    expect(text).not.toContain("<circle");
    expect(text).toContain(`style="stroke-width: 0.71; stroke: #264653; fill: #264653;"`);
    expect(text).toContain("<g clip-path='url(#c)'>");
    expect(XMLValidator.validate(text)).toBe(true);
  });

  it("writes a circle as two arcs around the same centre and radius", () => {
    const { text } = mergeMarks(svg('<circle cx="10" cy="20" r="2" fill="#000"/><circle cx="30" cy="40" r="2" fill="#000"/>'));
    expect(text).toContain('d="M8 20A2 2 0 1 0 12 20A2 2 0 1 0 8 20ZM28 40A2 2 0 1 0 32 40A2 2 0 1 0 28 40Z"');
  });

  it("keeps separately styled series apart", () => {
    const { text, folded } = mergeMarks(
      svg('<circle cx="1" cy="1" r="1" fill="#aaaaaa"/><circle cx="2" cy="2" r="1" fill="#aaaaaa"/>' +
        '<circle cx="3" cy="3" r="1" fill="#bbbbbb"/><circle cx="4" cy="4" r="1" fill="#bbbbbb"/>')
    );
    expect(folded).toBe(2);
    expect(pathCount(text)).toBe(2);
  });

  it("only merges direct neighbours, so drawing order is never changed", () => {
    const { folded } = mergeMarks(
      svg('<circle cx="1" cy="1" r="1" fill="#aaaaaa"/><text>label</text><circle cx="2" cy="2" r="1" fill="#aaaaaa"/>')
    );
    expect(folded).toBe(0);
  });

  it("leaves translucent marks, marks with ids and per-element effects alone", () => {
    const pair = (attrs) => svg(`<circle cx="1" cy="1" r="1" ${attrs}/><circle cx="2" cy="2" r="1" ${attrs}/>`);
    expect(mergeMarks(pair('fill="#000" fill-opacity="0.4"')).folded).toBe(0);
    expect(mergeMarks(pair('style="fill: #000; opacity: 50%"')).folded).toBe(0);
    expect(mergeMarks(pair('filter="url(#shadow)"')).folded).toBe(0);
    expect(mergeMarks(pair('style="marker-end: url(#m)"')).folded).toBe(0);
    expect(mergeMarks(svg('<circle id="a" cx="1" cy="1" r="1"/><circle id="b" cx="2" cy="2" r="1"/>')).folded).toBe(0);
    // Declared but fully opaque is fine, as R's Cairo device writes it.
    expect(mergeMarks(pair('fill="#000" fill-opacity="1" stroke-opacity="100%"')).folded).toBe(1);
  });

  it("applies plain translates and refuses any other transform", () => {
    const moved = mergeMarks(svg('<rect x="0" y="0" width="2" height="3" transform="translate(5 6)"/><rect x="1" y="1" width="2" height="3"/>'));
    expect(moved.text).toContain('d="M5 6H7V9H5ZM1 1H3V4H1Z"');
    expect(mergeMarks(svg('<rect width="2" height="3" transform="rotate(45)"/><rect width="2" height="3"/>')).folded).toBe(0);
  });

  it("merges base R points without touching their path data", () => {
    const attrs = 'fill-rule="nonzero" fill="rgb(0%, 0%, 0%)" fill-opacity="1" stroke-width="0.75" stroke="rgb(0%, 0%, 0%)" stroke-opacity="1"';
    const a = "M 225.125 140.53125 C 225.125 141.613281 223.503906 141.613281 223.503906 140.53125 Z";
    const b = "M 207.402344 128.582031 C 207.402344 129.664062 205.78125 129.664062 205.78125 128.582031 Z";
    const { text, folded } = mergeMarks(svg(`<path ${attrs} d="${a}"/>\n<path ${attrs} d="${b}"/>`));
    expect(folded).toBe(1);
    expect(text).toContain(`d="${a}${b}"`);
  });

  it("merges matplotlib markers, letting the marker's own style win", () => {
    const body =
      '<defs><path id="m1" d="M 0 1 L 1 0 L 0 -1 z" style="stroke: #2a9d8f"/></defs>' +
      '<g clip-path="url(#p1)">' +
      '<use xlink:href="#m1" x="10" y="20" style="fill: #2a9d8f; stroke: #ff0000"/>' +
      '<use xlink:href="#m1" x="30" y="40" style="fill: #2a9d8f; stroke: #ff0000"/>' +
      "</g>";
    const { text, folded } = mergeMarks(svg(body));
    expect(folded).toBe(1);
    expect(text).toContain('<path id="m1"'); // the definition stays
    expect(text).toContain('style="fill: #2a9d8f; stroke: #2a9d8f"');
    expect(text).not.toContain("#ff0000");
    expect(text).toContain('d="M10 21L11 20L10 19zM30 41L31 40L30 39z"');
    expect(text).not.toContain("<use");
  });

  it("merges different markers only when they end up styled the same", () => {
    const plain =
      '<defs><path id="a" d="M0 0L1 1"/><path id="b" d="M0 0L2 2"/></defs>' +
      '<use xlink:href="#a" x="1" y="1"/><use xlink:href="#b" x="1" y="1"/>';
    expect(mergeMarks(svg(plain)).text).toContain('d="M1 1L2 2M1 1L3 3"');

    const styled =
      '<defs><path id="a" d="M0 0L1 1" style="stroke: #111111"/><path id="b" d="M0 0L2 2" style="stroke: #222222"/></defs>' +
      '<use xlink:href="#a" x="1" y="1"/><use xlink:href="#b" x="1" y="1"/>';
    expect(mergeMarks(svg(styled)).folded).toBe(0);
  });

  it("keeps a namespace prefix on the merged element", () => {
    const body = '<ns0:rect x="0" y="0" width="1" height="1" fill="#000"/><ns0:rect x="2" y="0" width="1" height="1" fill="#000"/>';
    const { text } = mergeMarks(`<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg">${body}</ns0:svg>`);
    expect(text).toContain("<ns0:path ");
    expect(XMLValidator.validate(text)).toBe(true);
  });

  it("returns the very same text when nothing merges", () => {
    const input = svg('<circle cx="1" cy="1" r="1"/>');
    expect(mergeMarks(input)).toEqual({ text: input, folded: 0 });
  });
});

describe("prepareSvg", () => {
  it("lightens a 100,000 point scatter plot to a handful of elements", () => {
    const points = Array.from(
      { length: 100000 },
      (_, i) => `<circle cx="${(i * 7919) % 1000}" cy="${(i * 104729) % 800}" r="1.5" fill="#2a9d8f"/>`
    ).join("");
    const started = Date.now();
    const result = prepareSvg(svg(`<rect width="100" height="100" fill="#ffffff"/>${points}`));
    expect(result).toMatchObject({ ok: true, marks: 100001, drawn: 2, heavy: false });
    expect(Date.now() - started).toBeLessThan(10000);
  });

  it("warns when a drawing is still heavy after merging", () => {
    const shapes = Array.from({ length: 30 }, (_, i) => `<circle cx="1" cy="1" r="1" fill="#${String(i).padStart(6, "0")}"/>`).join("");
    expect(prepareSvg(svg(shapes), { heavyMarks: 20 })).toMatchObject({ ok: true, drawn: 30, heavy: true });
  });

  it("removes script and event handlers", () => {
    const result = prepareSvg(svg('<script>alert(1)</script><rect width="5" height="5" fill="#000" onclick="alert(2)"/>'));
    expect(result.ok).toBe(true);
    expect(result.svg).not.toMatch(/script|onclick|alert/);
  });

  it("explains files it cannot import", () => {
    expect(prepareSvg("<svg><path d='M0 0'></svg>")).toMatchObject({ ok: false, error: expect.stringMatching(/not well-formed/) });
    expect(prepareSvg("   ")).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to draw/) });
    expect(prepareSvg(svg('<rect width="100" height="100" fill="#ffffff"/>'))).toMatchObject({ ok: false });
    expect(prepareSvg("<html><body><path d='M0 0'/></body></html>")).toMatchObject({ ok: false, error: expect.stringMatching(/not an SVG/) });
    expect(prepareSvg(null)).toMatchObject({ ok: false });
  });
});

describe("merging never bloats a file", () => {
  it("leaves markers alone when writing out their shape would be longer than the <use>", () => {
    const curve = Array.from({ length: 40 }, (_, i) => `L ${i}.123456 ${i}.654321`).join(" ");
    const body =
      `<defs><path id="m" d="M 0 0 ${curve} z"/></defs>` +
      '<use xlink:href="#m" x="1" y="1" style="fill: #000000"/><use xlink:href="#m" x="2" y="2" style="fill: #000000"/>';
    expect(mergeMarks(svg(body)).folded).toBe(0);
  });
});
