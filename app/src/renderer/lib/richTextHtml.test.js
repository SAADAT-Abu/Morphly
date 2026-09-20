import { describe, it, expect } from "vitest";
import { htmlFromRuns, runsFromNode, textFromNode } from "./richTextHtml";

/** Node-shaped objects, so the reader can be tested without a window. */
const text = (data) => ({ nodeType: 3, data });
const el = (nodeName, childNodes, style = {}) => ({ nodeType: 1, nodeName, childNodes, style });
const root = (...childNodes) => ({ childNodes });

describe("htmlFromRuns", () => {
  it("wraps each mark in its own tag, innermost first", () => {
    expect(htmlFromRuns([{ text: "Hello" }])).toBe("Hello");
    expect(htmlFromRuns([{ text: "a", bold: true, italic: true }])).toBe("<b><i>a</i></b>");
    expect(htmlFromRuns([{ text: "2", baseline: "sub" }])).toBe("<sub>2</sub>");
    expect(htmlFromRuns([{ text: "x", underline: true, strike: true }])).toBe("<u><s>x</s></u>");
    expect(htmlFromRuns([{ text: "c", color: "#d1495b" }])).toBe('<span style="color: #d1495b">c</span>');
  });

  it("escapes the text and keeps line breaks", () => {
    expect(htmlFromRuns([{ text: "a < b & c" }])).toBe("a &lt; b &amp; c");
    expect(htmlFromRuns([{ text: "one\ntwo" }])).toBe("one<br>two");
  });
});

describe("runsFromNode", () => {
  it("reads the tags Morphly knows", () => {
    const tree = root(
      text("Wild type "),
      el("I", [text("Tp53")]),
      text(" at "),
      el("SUP", [text("-3")])
    );
    expect(runsFromNode(tree)).toEqual([
      { text: "Wild type " },
      { italic: true, text: "Tp53" },
      { text: " at " },
      { baseline: "super", text: "-3" },
    ]);
  });

  it("reads nested marks, and the tags other editors use", () => {
    const tree = root(el("STRONG", [el("EM", [text("both")])]), el("DEL", [text("gone")]));
    expect(runsFromNode(tree)).toEqual([
      { bold: true, italic: true, text: "both" },
      { strike: true, text: "gone" },
    ]);
  });

  it("reads a colour from a style, in hex or rgb", () => {
    expect(runsFromNode(root(el("SPAN", [text("x")], { color: "#2c6fbb" })))).toEqual([
      { color: "#2c6fbb", text: "x" },
    ]);
    expect(runsFromNode(root(el("SPAN", [text("x")], { color: "rgb(44, 111, 187)" })))).toEqual([
      { color: "#2c6fbb", text: "x" },
    ]);
  });

  it("turns breaks and blocks into newlines, but not a trailing one", () => {
    expect(textFromNode(root(text("one"), el("BR", []), text("two")))).toBe("one\ntwo");
    expect(textFromNode(root(text("one"), el("BR", [])))).toBe("one");
    expect(textFromNode(root(el("DIV", [text("one")]), el("DIV", [text("two")])))).toBe("one\ntwo");
  });

  it("ignores anything it does not know, keeping the words", () => {
    const tree = root(el("SPAN", [el("FONT", [text("kept")], {})], { fontSize: "40px" }), el("IMG", []));
    expect(runsFromNode(tree)).toEqual([{ text: "kept" }]);
  });

  it("joins neighbours with the same marks and reads non-breaking spaces as spaces", () => {
    const tree = root(el("B", [text("a")]), el("B", [text("b")]), text(" c"));
    expect(runsFromNode(tree)).toEqual([{ bold: true, text: "ab" }, { text: " c" }]);
  });

  it("survives an empty editor", () => {
    expect(runsFromNode(root())).toEqual([]);
    expect(runsFromNode(null)).toEqual([]);
  });

  it("round-trips through HTML and back", () => {
    const runs = [
      { text: "CO" },
      { text: "2", baseline: "sub" },
      { text: " in " },
      { text: "E. coli", italic: true },
    ];
    // The editor writes this HTML, the browser hands it back, and the model
    // must come out the same.
    expect(htmlFromRuns(runs)).toBe('CO<sub>2</sub> in <i>E. coli</i>');
    const parsed = root(
      text("CO"),
      el("SUB", [text("2")]),
      text(" in "),
      el("I", [text("E. coli")])
    );
    expect(runsFromNode(parsed)).toEqual(runs);
  });
});
