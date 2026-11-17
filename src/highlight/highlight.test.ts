import { describe, expect, it, vi } from "vitest";
import { HighlightClient, MAX_HIGHLIGHT_LINES, type WorkerLike } from "./client";
import { languageFor } from "./languages";
import { hashString, segments, type LineTokens } from "./tokens";
import type { HighlightRequest } from "./worker";

describe("languageFor", () => {
  it("maps known extensions and file names", () => {
    expect(languageFor("src/app.ts")).toBe("typescript");
    expect(languageFor("C:\\x\\View.TSX")).toBe("tsx");
    expect(languageFor("lib.rs")).toBe("rust");
    expect(languageFor("deploy/Dockerfile")).toBe("docker");
    expect(languageFor("Dockerfile.prod")).toBe("docker");
    expect(languageFor("Makefile")).toBe("make");
    expect(languageFor(".gitignore")).toBe("ini");
  });

  it("returns null for unknown or missing extensions", () => {
    expect(languageFor("notes.xyz123")).toBeNull();
    expect(languageFor("LICENSE")).toBeNull();
  });
});

describe("segments", () => {
  const tokens: LineTokens = [
    ["const", "#d73a49", "#f97583"],
    [" timeout = ", "#24292e", "#e1e4e8"],
    ["30", "#005cc5", "#79b8ff"],
    [";", "#24292e", "#e1e4e8"],
  ];

  it("uses tokens when they spell the line", () => {
    const s = segments("const timeout = 30;", tokens, null);
    expect(s.map((x) => x.text)).toEqual(["const", " timeout = ", "30", ";"]);
    expect(s[0].light).toBe("#d73a49");
  });

  it("falls back to plain text when tokens do not match", () => {
    expect(segments("something else", tokens, null)).toEqual([{ text: "something else", changed: false }]);
    expect(segments("plain", undefined, null)).toEqual([{ text: "plain", changed: false }]);
  });

  it("ignores a trailing carriage return", () => {
    expect(segments("const timeout = 30;\r", tokens, null)).toHaveLength(4);
  });

  it("flags only the intraline range, splitting tokens at its edges", () => {
    const s = segments("const timeout = 30;", tokens, [{ start: 16, end: 18 }]);
    expect(s.filter((x) => x.changed).map((x) => x.text)).toEqual(["30"]);
    expect(s.map((x) => x.text).join("")).toBe("const timeout = 30;");

    const cut = segments("const timeout = 30;", tokens, [{ start: 2, end: 8 }]);
    expect(cut.map((x) => [x.text, x.changed])).toEqual([
      ["co", false],
      ["nst", true],
      [" ti", true],
      ["meout = ", false],
      ["30", false],
      [";", false],
    ]);
    expect(cut[1].light).toBe("#d73a49");
  });
});

describe("HighlightClient", () => {
  function fakeWorker() {
    const w: WorkerLike & { sent: HighlightRequest[] } = {
      sent: [],
      onmessage: null,
      postMessage(msg) {
        this.sent.push(msg);
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: msg.id, tokens: [[[msg.code, "#000", "#fff"]]] } } as MessageEvent),
        );
      },
    };
    return w;
  }

  it("caches by version, path and content", async () => {
    const w = fakeWorker();
    const create = vi.fn(() => w);
    const c = new HighlightClient(create);
    const a = await c.highlight("base", "a.ts", "let x = 1;");
    const b = await c.highlight("base", "a.ts", "let x = 1;");
    expect(a).toBe(b);
    expect(w.sent).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
    await c.highlight("worktree", "a.ts", "let x = 1;");
    await c.highlight("base", "a.ts", "let x = 2;");
    expect(w.sent).toHaveLength(3);
    expect(c.cacheSize).toBe(3);
  });

  it("de-duplicates in-flight requests", async () => {
    const w = fakeWorker();
    const c = new HighlightClient(() => w);
    const [x, y] = await Promise.all([c.highlight("v", "a.ts", "x"), c.highlight("v", "a.ts", "x")]);
    expect(x).toBe(y);
    expect(w.sent).toHaveLength(1);
  });

  it("skips unknown languages and oversized files without a worker", async () => {
    const create = vi.fn(fakeWorker);
    const c = new HighlightClient(create);
    expect(await c.highlight("v", "notes.unknownext", "x")).toBeNull();
    expect(await c.highlight("v", "big.ts", "x\n".repeat(MAX_HIGHLIGHT_LINES + 1))).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("resolves null when the worker reports an error", async () => {
    const w: WorkerLike = {
      onmessage: null,
      postMessage(msg) {
        queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, error: "boom" } } as MessageEvent));
      },
    };
    expect(await new HighlightClient(() => w).highlight("v", "a.ts", "x")).toBeNull();
  });
});

describe("hashString", () => {
  it("differs for different content", () => {
    expect(hashString("a")).not.toBe(hashString("b"));
    expect(hashString("same")).toBe(hashString("same"));
  });
});
