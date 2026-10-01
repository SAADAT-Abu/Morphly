import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectNotices } = require("./notices.js");

const notice = (over = {}) => ({ id: "n1", title: "Something happened", body: "Details.", ...over });
const pick = (notices, over = {}) =>
  selectNotices({ notices, version: "0.5.2", platform: "linux", dismissed: [], ...over });

describe("selectNotices", () => {
  it("shows a notice with no conditions to everyone", () => {
    expect(pick([notice()]).map((n) => n.id)).toEqual(["n1"]);
    expect(pick([notice()], { version: "0.1.0", platform: "win32" })).toHaveLength(1);
  });

  it("reaches only the versions a notice is about", () => {
    // The case this exists for: 0.5.1 on Linux loses its library, and the
    // people running it are exactly the ones who cannot be told any other way.
    const broken = [notice({ maxVersion: "0.5.1", platforms: ["linux"] })];
    expect(pick(broken, { version: "0.5.1" })).toHaveLength(1);
    expect(pick(broken, { version: "0.5.0" })).toHaveLength(1);
    expect(pick(broken, { version: "0.5.2" })).toHaveLength(0);
    expect(pick(broken, { version: "0.5.1", platform: "darwin" })).toHaveLength(0);
  });

  it("honours a lower bound, for a notice about something only new builds have", () => {
    const recent = [notice({ minVersion: "0.6.0" })];
    expect(pick(recent, { version: "0.6.0" })).toHaveLength(1);
    expect(pick(recent, { version: "0.5.2" })).toHaveLength(0);
  });

  it("does not bring back what was dismissed", () => {
    expect(pick([notice()], { dismissed: ["n1"] })).toHaveLength(0);
  });

  it("refuses a link that is not https, rather than handing it to the button", () => {
    expect(pick([notice({ url: "javascript:alert(1)" })])[0].url).toBeNull();
    expect(pick([notice({ url: "http://example.com" })])[0].url).toBeNull();
    expect(pick([notice({ url: "https://example.com" })])[0].url).toBe("https://example.com");
  });

  it("keeps a careless or hostile file from taking over the screen", () => {
    const many = Array.from({ length: 9 }, (_, i) => notice({ id: `n${i}` }));
    expect(pick(many)).toHaveLength(3);
    const huge = pick([notice({ title: "T".repeat(500), body: "B".repeat(5000) })])[0];
    expect(huge.title.length).toBeLessThanOrEqual(120);
    expect(huge.body.length).toBeLessThanOrEqual(600);
  });

  it("skips entries that are not notices at all", () => {
    expect(pick([null, {}, { id: "x" }, { title: "no id" }, 42])).toEqual([]);
    expect(selectNotices({ notices: undefined, version: "0.5.2", platform: "linux" })).toEqual([]);
  });

  it("marks only an explicit important level as important", () => {
    expect(pick([notice({ level: "important" })])[0].level).toBe("important");
    expect(pick([notice({ level: "shouty" })])[0].level).toBe("info");
    expect(pick([notice()])[0].level).toBe("info");
  });
});
