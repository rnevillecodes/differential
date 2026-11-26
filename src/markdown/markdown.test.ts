import { describe, expect, it } from "vitest";
import { blockRange, textUnits } from "./find";
import { linkTarget } from "./links";
import { slug, slugger } from "./plugins";

describe("linkTarget", () => {
  const from = "docs/guide.md";

  it("resolves relative paths against the document's folder", () => {
    expect(linkTarget("../SETUP.md", from)).toEqual({ kind: "file", path: "SETUP.md" });
    expect(linkTarget("img/a.png", from)).toEqual({ kind: "file", path: "docs/img/a.png" });
    expect(linkTarget("./other.md#part", from)).toEqual({ kind: "file", path: "docs/other.md" });
    expect(linkTarget("other.md?raw=1", from)).toEqual({ kind: "file", path: "docs/other.md" });
    expect(linkTarget("my%20notes.md", from)).toEqual({ kind: "file", path: "docs/my notes.md" });
    expect(linkTarget("/src/main.ts", from)).toEqual({ kind: "file", path: "src/main.ts" });
  });

  it("rejects paths that leave the repository", () => {
    expect(linkTarget("../../outside.md", from)).toEqual({ kind: "none" });
    expect(linkTarget("../", from)).toEqual({ kind: "none" });
    expect(linkTarget("//host/share", from)).toEqual({ kind: "none" });
  });

  it("classifies anchors and schemes", () => {
    expect(linkTarget("#usage", from)).toEqual({ kind: "anchor", id: "usage" });
    expect(linkTarget("https://example.com", from)).toEqual({ kind: "external", url: "https://example.com" });
    expect(linkTarget("HTTP://x.y", from)).toEqual({ kind: "external", url: "HTTP://x.y" });
    expect(linkTarget("mailto:a@b.c", from)).toEqual({ kind: "external", url: "mailto:a@b.c" });
    for (const href of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "C:/x.md", "", undefined]) {
      expect(linkTarget(href, from)).toEqual({ kind: "none" });
    }
  });
});

describe("heading slugs", () => {
  it("lower-cases, drops punctuation and dashes spaces", () => {
    expect(slug("Hello, World!")).toBe("hello-world");
    expect(slug("Use `npm run dev`")).toBe("use-npm-run-dev");
    expect(slug("Ünïcode & snake_case")).toBe("ünïcode--snake_case");
  });

  it("dedupes repeats like GitHub", () => {
    const next = slugger();
    expect(["Intro", "Intro", "Intro", "Intro 1"].map(next)).toEqual(["intro", "intro-1", "intro-2", "intro-1-1"]);
  });
});

describe("find units", () => {
  it("makes one unit per block, across inline formatting", () => {
    const root = document.createElement("article");
    root.innerHTML = "<p><strong>bold</strong> text</p><ul><li>one</li><li><p>two</p></li></ul>";
    const { units, blocks } = textUnits(root);
    expect(units.map((u) => u.text)).toEqual(["bold text", "one", "two"]);
    const r = blockRange(blocks[0], 2, 7)!;
    expect(r.toString()).toBe("ld te");
    expect(blockRange(blocks[0], 4, 5)!.toString()).toBe(" ");
    expect(blockRange(blocks[0], 0, 4)!.toString()).toBe("bold");
  });
});
