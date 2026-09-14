import { describe, it, expect } from "vitest";
import { XMLValidator } from "fast-xml-parser";
import {
  scanSvg,
  normalisePaint,
  analyseSvg,
  leavesUnder,
  topContainer,
  partForLeaf,
  parentKey,
  partPalette,
  partLabel,
  parseTransform,
  userDeltaToPart,
  elementToUserScale,
  canvasDeltaToUser,
  applyPartEdits,
  artworkText,
  cleanEdit,
  buildHitSvg,
  hitColour,
  hitIndex,
} from "./svgParts";

/** A BioArt-like drawing: CSS classes, a layer group, ns0 prefixes. */
const BIOART =
  '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">' +
  '<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">' +
  "<ns0:defs><ns0:style><![CDATA[ .cls-1 { fill: #c5f8f6; } .cls-2, .cls-3 { fill: #465b5a; stroke: #111111; } ]]></ns0:style>" +
  '<ns0:clipPath id="c"><ns0:rect width="5" height="5"/></ns0:clipPath></ns0:defs>' +
  '<ns0:g id="Layer_1">' +
  '<ns0:g id="nucleus"><ns0:circle class="cls-1" cx="50" cy="50" r="20"/><ns0:circle class="cls-2" cx="50" cy="50" r="5"/></ns0:g>' +
  '<ns0:path class="cls-3" d="M100 10h50v50z"/>' +
  '<ns0:g transform="scale(2)"><ns0:rect x="80" y="10" width="5" height="5" fill="red"/></ns0:g>' +
  "</ns0:g></ns0:svg>";

const wellFormed = (svg) => expect(XMLValidator.validate(svg)).toBe(true);

describe("scanSvg", () => {
  it("finds elements past comments, CDATA, doctypes and quoted angle brackets", () => {
    const nodes = scanSvg('<!DOCTYPE svg [ <!ENTITY a "b"> ]><svg><!-- <g> --><text title="a > b">x<![CDATA[<p>]]></text><path d="M0 0"/></svg>');
    expect(nodes.map((n) => n.name)).toEqual(["svg", "text", "path"]);
    expect(nodes[1].attrs.get("title").value).toBe("a > b");
    expect(nodes[2].selfClosing).toBe(true);
  });

  it("refuses text that does not close its tags", () => {
    expect(scanSvg("<svg><g>")).toBeNull();
    expect(scanSvg(null)).toBeNull();
  });
});

describe("normalisePaint", () => {
  it("reads hex, rgb, percentages, names and keywords without a browser", () => {
    expect(normalisePaint("#ABC")).toBe("#aabbcc");
    expect(normalisePaint("rgb(0%, 50%, 100%)")).toBe("#0080ff");
    expect(normalisePaint("rgba(255, 0, 0, 0)")).toBe("none");
    expect(normalisePaint("steelblue")).toBe("#4682b4");
    expect(normalisePaint("currentColor", "#123456")).toBe("#123456");
    expect(normalisePaint("url(#gradient)")).toBe("other");
    expect(normalisePaint("none")).toBe("none");
  });
});

describe("analyseSvg", () => {
  const a = analyseSvg(BIOART);

  it("works out each shape's real colours from classes, attributes and inheritance", () => {
    const paints = a.leaves.map((i) => a.nodes[i].paint);
    expect(paints).toEqual([
      { fill: "#c5f8f6", stroke: "none" },
      { fill: "#465b5a", stroke: "#111111" },
      { fill: "#465b5a", stroke: "#111111" },
      { fill: "#ff0000", stroke: "none" },
    ]);
  });

  it("leaves out shapes that are only definitions", () => {
    expect(a.leaves.every((i) => a.nodes[i].name !== "rect" || a.nodes[i].attrs.has("fill"))).toBe(true);
    expect(a.leaves).toHaveLength(4);
  });

  it("gives parts keys by position, and knows what is inside each", () => {
    expect(a.byKey.get("1.0").attrs.get("id").value).toBe("nucleus");
    expect(leavesUnder(a, "1.0")).toHaveLength(2);
    expect(leavesUnder(a, "1")).toHaveLength(4);
  });

  it("inherits a group's fill and honours inline style over classes", () => {
    const b = analyseSvg('<svg><g fill="blue"><path d="M0 0"/><path class="k" style="fill:#010203" d="M0 0"/></g><style>.k{fill:red}</style></svg>');
    expect(b.leaves.map((i) => b.nodes[i].paint.fill)).toEqual(["#0000ff", "#010203"]);
  });

  it("marks shapes under display:none as hidden", () => {
    const b = analyseSvg('<svg><g style="display:none"><path d="M0 0"/></g><path d="M0 0"/></svg>');
    expect(b.leaves.map((i) => b.nodes[i].hidden)).toEqual([true, false]);
  });
});

describe("choosing parts", () => {
  const a = analyseSvg(BIOART);

  it("starts inside a drawing's single layer group", () => {
    expect(topContainer(a)).toBe("1");
  });

  it("picks the piece inside the current container, or the single shape", () => {
    const innerCircle = a.leaves[1];
    expect(partForLeaf(a, innerCircle, "1")).toBe("1.0");
    expect(partForLeaf(a, innerCircle, "1.0")).toBe("1.0.1");
    expect(partForLeaf(a, innerCircle, "1", { single: true })).toBe("1.0.1");
    expect(partForLeaf(a, a.leaves[2], "1.0")).toBeNull();
  });

  it("walks back up through containers", () => {
    expect([parentKey("1.0.1"), parentKey("1"), parentKey("")]).toEqual(["1.0", "", null]);
  });

  it("lists the colours inside parts", () => {
    expect(partPalette(a, ["1.0"])).toEqual([
      { hex: "#111111", count: 1 },
      { hex: "#465b5a", count: 1 },
      { hex: "#c5f8f6", count: 1 },
    ]);
  });

  it("names parts after meaningful ids, or by what they hold", () => {
    expect(partLabel(a, "1.0")).toBe("nucleus");
    expect(partLabel(a, "1.2")).toBe("Group of 1 shape");
    expect(partLabel(a, "1.1")).toBe("Shape");
  });
});

describe("transforms", () => {
  it("reads transform lists as one matrix", () => {
    expect(parseTransform("translate(10 20) scale(2)")).toEqual([2, 0, 0, 2, 10, 20]);
    const r = parseTransform("rotate(90)");
    expect(r.map((v) => Math.round(v))).toEqual([0, 1, -1, 0, 0, 0]);
  });

  it("converts a move into the coordinates of a scaled parent", () => {
    const a = analyseSvg(BIOART);
    expect(userDeltaToPart(a, "1.2.0", 10, 4)).toEqual({ x: 5, y: 2 });
    expect(userDeltaToPart(a, "1.1", 10, 4)).toEqual({ x: 10, y: 4 });
  });

  it("scales element units to drawing units, keeping aspect", () => {
    const element = { svgSource: BIOART, width: 100, height: 50, rotation: 0 };
    expect(elementToUserScale(element)).toEqual({ x: 2, y: 2 });
    // Turned a quarter, a move right on the page is a move up in the drawing.
    const turned = canvasDeltaToUser({ ...element, rotation: 90 }, 10, 0);
    expect(turned.x).toBeCloseTo(0, 6);
    expect(turned.y).toBeCloseTo(-20, 6);
  });
});

describe("applyPartEdits", () => {
  const a = analyseSvg(BIOART);

  it("recolours only the shapes inside a part, over their CSS classes", () => {
    const out = applyPartEdits(BIOART, a, { "1.0": { colors: { "#465b5a": "#ff8800" } } });
    wellFormed(out);
    const b = analyseSvg(out);
    expect(b.leaves.map((i) => b.nodes[i].paint.fill)).toEqual(["#c5f8f6", "#ff8800", "#465b5a", "#ff0000"]);
    expect(out).toContain("<ns0:circle class=\"cls-2\" cx=\"50\" cy=\"50\" r=\"5\" style=\"fill:#ff8800\"/>");
  });

  it("hides a part", () => {
    const out = applyPartEdits(BIOART, a, { "1.1": { hidden: true } });
    const b = analyseSvg(out);
    expect(b.nodes[b.leaves[2]].hidden).toBe(true);
  });

  it("moves a part in drawing units, through a scaled parent and in front of its own transform", () => {
    const out = applyPartEdits(BIOART, a, { "1.2": { dx: 10, dy: 0 }, "1.2.0": { dx: 10, dy: 4 } });
    wellFormed(out);
    expect(out).toContain('<ns0:g transform="translate(10 0) scale(2)">');
    expect(out).toContain('fill="red" transform="translate(5 2)"/>');
  });

  it("lets a shape's own colour win over its group's", () => {
    const out = applyPartEdits(BIOART, a, {
      "1.0.1": { colors: { "#465b5a": "#00ff00" } },
      "1.0": { colors: { "#465b5a": "#ff8800" } },
    });
    const b = analyseSvg(out);
    expect(b.nodes[b.leaves[1]].paint.fill).toBe("#00ff00");
  });

  it("works on a drawing already recoloured as a whole", () => {
    const element = { svgSource: BIOART, colorMap: { "#c5f8f6": "#000000" }, partEdits: { "1.1": { colors: { "#465b5a": "#abcdef" } } } };
    const b = analyseSvg(artworkText(element));
    expect(b.leaves.map((i) => b.nodes[i].paint.fill)).toEqual(["#000000", "#465b5a", "#abcdef", "#ff0000"]);
  });

  it("changes nothing when there is nothing to change, or the structure does not match", () => {
    expect(applyPartEdits(BIOART, a, {})).toBe(BIOART);
    expect(applyPartEdits("<svg><path d='M0 0'/></svg>", a, { "1.1": { hidden: true } })).toBe("<svg><path d='M0 0'/></svg>");
  });
});

describe("cleanEdit", () => {
  it("drops what does nothing", () => {
    expect(cleanEdit({ hidden: false, dx: 0, dy: 3, colors: { "#111111": "#111111", "#222222": "#333333" } })).toEqual({
      dy: 3,
      colors: { "#222222": "#333333" },
    });
    expect(cleanEdit({ hidden: false, colors: {} })).toBeNull();
  });
});

describe("buildHitSvg", () => {
  it("paints each shape its own flat colour, keeping unpainted parts unpainted", () => {
    const hit = buildHitSvg(BIOART);
    wellFormed(hit);
    const b = analyseSvg(hit);
    expect(b.leaves.map((i) => b.nodes[i].paint)).toEqual([
      { fill: hitColour(0), stroke: "none" },
      { fill: hitColour(1), stroke: hitColour(1) },
      { fill: hitColour(2), stroke: hitColour(2) },
      { fill: hitColour(3), stroke: "none" },
    ]);
    expect(hit).toContain("shape-rendering:crispEdges");
  });

  it("puts see-through and masked shapes in the back layer only", () => {
    const drawing =
      '<svg><path d="M0 0" fill="#111111"/><g opacity="0.5"><path d="M1 1" fill="#222222"/></g>' +
      '<path d="M2 2" fill="#333333" fill-opacity="40%"/><g mask="url(#m)"><path d="M3 3" fill="#444444"/></g>' +
      '<path d="M4 4" fill="none" stroke="#555555" fill-opacity="0"/></svg>';
    const a = analyseSvg(drawing);
    expect(a.leaves.map((i) => a.nodes[i].translucent)).toEqual([false, true, true, true, false]);

    const paintsOf = (svg) => {
      const b = analyseSvg(svg);
      return b.leaves.map((i) => (b.nodes[i].hidden ? "off" : b.nodes[i].paint.fill === "none" ? b.nodes[i].paint.stroke : b.nodes[i].paint.fill));
    };
    const front = buildHitSvg(drawing);
    const back = buildHitSvg(drawing, { layer: "back" });
    wellFormed(front);
    wellFormed(back);
    expect(paintsOf(front)).toEqual([hitColour(0), "off", "off", "off", hitColour(4)]);
    expect(paintsOf(back)).toEqual(["off", hitColour(1), hitColour(2), hitColour(3), "off"]);
    expect(back).toContain("mask:none!important");
    expect(front).not.toContain("opacity:1!important");
  });

  it("treats shapes drawn with their own blend mode as see-through, like the tints over many BioArt drawings", () => {
    const drawing =
      '<svg><style>.tint{fill:#009447;mix-blend-mode:color}</style><path d="M0 0" fill="#111111"/>' +
      '<g style="mix-blend-mode:multiply"><path d="M1 1"/></g><path class="tint" d="M2 2"/>' +
      '<path d="M3 3" style="mix-blend-mode:normal"/></svg>';
    const a = analyseSvg(drawing);
    // A blended group's shapes paint normally among themselves, so they stay solid.
    expect(a.leaves.map((i) => a.nodes[i].translucent)).toEqual([false, false, true, false]);
  });

  it("stands a box in for an embedded picture", () => {
    const hit = buildHitSvg('<svg><image x="1" y="2" width="3" height="4" href="data:image/png;base64,AA=="/></svg>');
    wellFormed(hit);
    expect(hit).toContain('<rect x="1" y="2" width="3" height="4" style="fill:#000001"/>');
  });

  it("round-trips shape numbers through pixel colours", () => {
    for (const i of [0, 254, 65535, 1000000]) {
      const hex = hitColour(i);
      const [r, g, b] = [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16));
      expect(hitIndex(r, g, b)).toBe(i);
    }
    expect(hitIndex(0, 0, 0)).toBe(-1);
  });
});
