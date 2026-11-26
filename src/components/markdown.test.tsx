import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import type { Api } from "../api";
import { highlighter } from "../highlight/client";
import { createAppStore } from "../store";
import { changeSet, fakeApi, flush, memoryStorage, summary } from "../test/fixtures";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

const DOC = `# Title

Some **bold** and \`code\` with ~~strike~~ at https://example.com/auto.

- one
- two

> quoted

| Name | Count |
| :--- | ----: |
| a    |     1 |

- [x] done
- [ ] todo

\`\`\`ts
const x = 1;
\`\`\`

\`\`\`nosuchlang
plain block
\`\`\`

## Usage

![Architecture diagram](docs/arch.png) ![](x.png)

[setup](../SETUP.md) [usage](#usage) [web](https://example.com) [mail](mailto:a@b.c)
[js](javascript:alert(1)) [file](file:///etc/passwd) [out](../../outside.md) [changed](a.ts) [gone](gone.md)

<script>alert(1)</script>

Inline <img src=x onerror=alert(1)> html.
`;

function mdApi(files: Record<string, string>, over: Partial<Api> = {}) {
  return fakeApi({
    listChanges: vi.fn(async () => changeSet([summary(0, "docs/a.ts")])),
    listFiles: vi.fn(async () => ["docs/a.ts", ...Object.keys(files)]),
    viewFile: vi.fn(async (_root: string, path: string) =>
      path in files ? { kind: "text" as const, content: files[path] } : { kind: "missing" as const },
    ),
    ...over,
  });
}

async function renderApp(api: Api) {
  const store = createAppStore(api, memoryStorage({ "differential.sidebarTab": "files" }));
  await act(async () => {
    await store.getState().openPath("C:/repo");
    await flush();
  });
  const utils = render(<App store={store} />);
  await act(flush);
  return { store, api, ...utils };
}

async function openFile(store: ReturnType<typeof createAppStore>, path: string) {
  await act(async () => {
    store.getState().openTreePath(path);
    await flush();
  });
}

/** Open `path` and wait for the lazily loaded rendered view. */
async function openRendered(store: ReturnType<typeof createAppStore>, path: string) {
  await openFile(store, path);
  return await screen.findByTestId("markdown-body");
}

beforeEach(() => vi.mocked(openUrl).mockClear());

describe("rendered Markdown", () => {
  it("renders an unchanged README by default, with a Source toggle", async () => {
    const { store } = await renderApp(mdApi({ "README.md": "# Hello\n\ntext\n" }));
    const body = await openRendered(store, "README.md");
    expect(within(body).getByRole("heading", { level: 1 })).toHaveTextContent("Hello");
    expect(screen.queryAllByTestId("file-line")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    await act(flush);
    expect(screen.queryByTestId("markdown-body")).toBeNull();
    expect(screen.getAllByTestId("file-line")[0]).toHaveTextContent("1# Hello");
    expect(screen.getByRole("button", { name: "Rendered" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Rendered" }));
    expect(await screen.findByTestId("markdown-body")).toBeInTheDocument();
  });

  it("renders .markdown in any case, but not .mdx or changed files", async () => {
    const { store } = await renderApp(mdApi({ "NOTES.MARKDOWN": "# N\n", "page.mdx": "# M\n" }));
    expect(await openRendered(store, "NOTES.MARKDOWN")).toHaveTextContent("N");
    await openFile(store, "page.mdx");
    expect(screen.getByLabelText("Contents of page.mdx")).toBeInTheDocument();
    expect(screen.getAllByTestId("file-line")[0]).toHaveTextContent("# M");
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
  });

  it("supports CommonMark and GFM elements", async () => {
    const { store } = await renderApp(mdApi({ "README.md": DOC }));
    const body = await openRendered(store, "README.md");
    const q = within(body);
    expect(q.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(body.querySelector("strong")).toHaveTextContent("bold");
    expect(body.querySelector("p code")).toHaveTextContent("code");
    expect(body.querySelector("del")).toHaveTextContent("strike");
    expect(q.getByRole("link", { name: "https://example.com/auto" })).toBeInTheDocument();
    expect(body.querySelector("blockquote")).toHaveTextContent("quoted");
    expect(q.getAllByRole("listitem").map((li) => li.textContent?.trim())).toEqual(["one", "two", "done", "todo"]);
    // Table, with the right-aligned column, inside a horizontal scroller.
    const table = q.getByRole("table");
    expect(table.parentElement).toHaveClass("md-table-wrap");
    const countCell = within(table).getByRole("cell", { name: "1" });
    expect(countCell.getAttribute("style") ?? countCell.getAttribute("align")).toMatch(/right/);
    // Code blocks.
    const blocks = body.querySelectorAll("pre.md-code");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveTextContent("const x = 1;");
    expect(blocks[0]).toHaveAttribute("data-lang", "typescript");
    expect(blocks[1]).not.toHaveAttribute("data-lang");
  });

  it("renders allowed HTML", async () => {
    const html = `<p align="center"><kbd>Ctrl</kbd></p>\n\n<details><summary>More</summary>Hidden text</details>\n`;
    const { store } = await renderApp(mdApi({ "README.md": html }));
    const body = await openRendered(store, "README.md");
    expect(body.querySelector('p[align="center"] kbd')).toHaveTextContent("Ctrl");
    expect(body.querySelector("details summary")).toHaveTextContent("More");
    expect(body.querySelector("details")).toHaveTextContent("Hidden text");
    expect(body).not.toHaveTextContent("<");
  });

  it("removes dangerous HTML and never creates script, iframe or image elements", async () => {
    const html = [
      "<script>alert(1)</script>",
      "",
      'Inline <img src=x onerror=alert(1)> and <a href="javascript:alert(1)" onclick="alert(2)">x</a>.',
      "",
      '<iframe src="https://example.com"></iframe>',
      "",
      '<div style="position:fixed" onmouseover="alert(3)">styled</div>',
      "",
      '<form action="https://evil"><input name="q"></form>',
      "",
    ].join("\n");
    const { store } = await renderApp(mdApi({ "README.md": html }));
    const body = await openRendered(store, "README.md");
    for (const sel of ["script", "iframe", "img", "form", "input:not([type=checkbox])", "[style]"]) {
      expect(body.querySelector(sel)).toBeNull();
    }
    for (const el of body.querySelectorAll("*")) {
      expect([...el.attributes].filter((a) => a.name.startsWith("on"))).toEqual([]);
    }
    expect(body).not.toHaveTextContent("alert");
    expect(within(body).getByTestId("md-image")).toHaveTextContent("image");
    const x = within(body).getByText("x", { selector: "a" });
    expect(x).not.toHaveAttribute("href");
    fireEvent.click(x);
    expect(openUrl).not.toHaveBeenCalled();
    expect(body).toHaveTextContent("styled");
  });

  it("loads an HTML image in a README header, keeping its size and alignment", async () => {
    const html = '<p align="center"><img src="logo.svg" alt="Project logo" width="128"></p>\n\n# Project\n';
    const { store, api } = await renderApp(mdApi({ "README.md": html }));
    const body = await openRendered(store, "README.md");
    const img = await within(body).findByTestId("md-img");
    expect(api.readImage).toHaveBeenCalledWith("C:/repo", "logo.svg");
    expect(img).toHaveAttribute("alt", "Project logo");
    expect(img).toHaveAttribute("width", "128");
    expect(img.getAttribute("src")).toMatch(/^blob:/);
    expect(img.closest("p")).toHaveAttribute("align", "center");
  });

  it("follows GFM footnote links despite the sanitizer's id prefix", async () => {
    const { store } = await renderApp(mdApi({ "README.md": "Text[^1].\n\n[^1]: The note.\n" }));
    const body = await openRendered(store, "README.md");
    const scroller = screen.getByTestId("markdown-view-scroll");
    const ref = body.querySelector<HTMLAnchorElement>("sup a")!;
    const note = body.querySelector<HTMLElement>(`[id="${ref.getAttribute("href")!.slice(1)}"], [id="user-content-${ref.getAttribute("href")!.slice(1)}"]`)!;
    expect(note).not.toBeNull();
    vi.spyOn(note, "getBoundingClientRect").mockReturnValue({ top: 300 } as DOMRect);
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    fireEvent.click(ref);
    expect(scroller.scrollTop).toBe(192);
  });

  it("loads relative images and never fetches remote, data or unsupported ones", async () => {
    const md = [
      "![Arch](img/arch.png) ![Root](/assets/logo.PNG)",
      "![Badge](https://img.shields.io/badge/x-y-green) ![Data](data:image/png;base64,AAAA)",
      "![Doc](notes.pdf) ![Out](../../outside.png) ![](noalt.gif)",
      "",
    ].join("\n\n");
    const { store, api } = await renderApp(mdApi({ "docs/guide.md": md }));
    const body = await openRendered(store, "docs/guide.md");
    await act(flush);
    expect(vi.mocked(api.readImage).mock.calls.map((c) => c[1]).sort()).toEqual([
      "assets/logo.PNG",
      "docs/img/arch.png",
      "docs/noalt.gif",
    ]);
    expect(within(body).getAllByTestId("md-img").map((i) => i.getAttribute("alt"))).toEqual(["Arch", "Root", ""]);
    const placeholders = within(body).getAllByTestId("md-image");
    expect(placeholders.map((p) => p.textContent)).toEqual(["Badge", "Data", "Doc", "Out"]);
    expect(placeholders[0]).toHaveAttribute("title", "https://img.shields.io/badge/x-y-green");
  });

  it("shows the placeholder when an image cannot be read", async () => {
    const api = mdApi({ "README.md": "![Gone](gone.png)\n" }, { readImage: vi.fn(async () => Promise.reject({ kind: "io" })) });
    const { store } = await renderApp(api);
    const body = await openRendered(store, "README.md");
    await act(flush);
    expect(api.readImage).toHaveBeenCalledWith("C:/repo", "gone.png");
    expect(within(body).getByTestId("md-image")).toHaveTextContent("Gone");
    expect(body.querySelector("img")).toBeNull();
  });

  it("reads images again when repository changes are picked up", async () => {
    const { store, api } = await renderApp(mdApi({ "README.md": "![A](a.png)\n" }));
    const body = await openRendered(store, "README.md");
    const first = (await within(body).findByTestId("md-img")).getAttribute("src");
    await act(async () => {
      await store.getState().refresh();
      await flush();
    });
    expect(vi.mocked(api.readImage).mock.calls.filter((c) => c[1] === "a.png").length).toBeGreaterThanOrEqual(2);
    expect(within(body).getByTestId("md-img").getAttribute("src")).not.toBe(first);
  });

  it("task-list checkboxes cannot be toggled", async () => {
    const { store } = await renderApp(mdApi({ "README.md": DOC }));
    const body = await openRendered(store, "README.md");
    const boxes = within(body).getAllByRole("checkbox");
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false]);
    fireEvent.click(boxes[1]);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
    expect(boxes[1]).toBeDisabled();
  });

  it("highlights known fence languages through the worker", async () => {
    const spy = vi.spyOn(highlighter, "highlightLang");
    const { store } = await renderApp(mdApi({ "README.md": DOC }));
    await openRendered(store, "README.md");
    await act(flush);
    expect(spy).toHaveBeenCalledWith("md:README.md", "typescript", "const x = 1;");
    expect(spy).toHaveBeenCalledWith("md:README.md", null, "plain block");
    spy.mockRestore();
  });

  it("gives headings GitHub-style anchors", async () => {
    const { store } = await renderApp(mdApi({ "README.md": "# Hello, World!\n\n## Hello, World!\n" }));
    const body = await openRendered(store, "README.md");
    expect([...body.querySelectorAll("h1, h2")].map((h) => h.getAttribute("data-anchor"))).toEqual([
      "hello-world",
      "hello-world-1",
    ]);
  });
});

describe("links in rendered Markdown", () => {
  async function setup() {
    const files = { "docs/guide.md": DOC, "SETUP.md": "# Setup\n" };
    const utils = await renderApp(mdApi(files));
    const body = await openRendered(utils.store, "docs/guide.md");
    const link = (name: string) => within(body).getByText(name, { selector: "a" });
    return { ...utils, body, link };
  }

  it("shows each link's target as a tooltip", async () => {
    const { link } = await setup();
    expect(link("setup")).toHaveAttribute("title", "../SETUP.md");
    expect(link("web")).toHaveAttribute("title", "https://example.com");
    // The sanitizer drops unsafe URLs entirely, so nothing is left to show or follow.
    expect(link("js")).not.toHaveAttribute("href");
    expect(link("js")).not.toHaveAttribute("title");
  });

  it("opens a relative link's file, keeping the document open", async () => {
    const { store, link } = await setup();
    await act(async () => {
      fireEvent.click(link("setup"));
      await flush();
    });
    expect(store.getState().activePath).toBe("SETUP.md");
    expect(store.getState().tabs.map((t) => t.path)).toContain("docs/guide.md");
  });

  it("opens a changed file's diff, and a missing file's not-found message", async () => {
    const { store, link } = await setup();
    await act(async () => {
      fireEvent.click(link("changed"));
      await flush();
    });
    expect(store.getState().activePath).toBe("docs/a.ts");
    expect(store.getState().selectedId).toBe(0);
    await act(async () => {
      store.getState().activateTab("docs/guide.md");
      await flush();
    });
    await act(async () => {
      fireEvent.click(link("gone"));
      await flush();
    });
    expect(store.getState().activePath).toBe("docs/gone.md");
    expect(screen.getByTestId("missing-placeholder")).toBeInTheDocument();
  });

  it("opens web and mail links externally and ignores other schemes", async () => {
    const { store, link } = await setup();
    const before = store.getState().tabs;
    fireEvent.click(link("web"));
    fireEvent.click(link("mail"));
    fireEvent.click(link("js"));
    fireEvent.click(link("file"));
    fireEvent.click(link("out"));
    await act(flush);
    expect(vi.mocked(openUrl).mock.calls.map((c) => c[0])).toEqual(["https://example.com", "mailto:a@b.c"]);
    expect(store.getState().tabs).toEqual(before);
    expect(store.getState().activePath).toBe("docs/guide.md");
  });

  it("never lets a click navigate the window", async () => {
    const { link } = await setup();
    for (const name of ["setup", "usage", "web", "js"]) {
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      act(() => {
        link(name).dispatchEvent(ev);
      });
      expect(ev.defaultPrevented).toBe(true);
    }
  });

  it("scrolls to an anchor's heading", async () => {
    const { link } = await setup();
    const scroller = screen.getByTestId("markdown-view-scroll");
    const heading = within(screen.getByTestId("markdown-body")).getByRole("heading", { name: "Usage" });
    vi.spyOn(heading, "getBoundingClientRect").mockReturnValue({ top: 500 } as DOMRect);
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    fireEvent.click(link("usage"));
    expect(scroller.scrollTop).toBe(392);
  });
});

describe("find in rendered Markdown", () => {
  const status = (store: ReturnType<typeof createAppStore>) => store.getState().findStatus;

  async function search(store: ReturnType<typeof createAppStore>, query: string) {
    await act(async () => {
      store.getState().openFind();
      store.getState().setFindQuery(query);
      await flush();
    });
  }

  it("searches the rendered text, not the markup", async () => {
    const { store } = await renderApp(mdApi({ "README.md": "**bold** text and more text\n\n- text\n" }));
    await openRendered(store, "README.md");
    await search(store, "**");
    expect(status(store)).toEqual({ current: 0, total: 0 });
    await search(store, "bold text");
    expect(status(store)).toEqual({ current: 1, total: 1 });
    await search(store, "text");
    expect(status(store)).toEqual({ current: 1, total: 3 });
    await act(async () => {
      store.getState().findNext();
      await flush();
    });
    expect(status(store)).toEqual({ current: 2, total: 3 });
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        store.getState().findPrev();
        await flush();
      });
    }
    expect(status(store)).toEqual({ current: 3, total: 3 });
  });

  it("re-runs the query when switching between rendered and source", async () => {
    const { store } = await renderApp(mdApi({ "README.md": "**x** x\n" }));
    await openRendered(store, "README.md");
    await search(store, "*");
    expect(status(store)).toEqual({ current: 0, total: 0 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Source" }));
      await flush();
    });
    expect(status(store)).toEqual({ current: 1, total: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Rendered" }));
    await screen.findByTestId("markdown-body");
    await act(flush);
    expect(status(store)).toEqual({ current: 0, total: 0 });
  });
});

describe("live updates", () => {
  it("shows the diff while the file is changed, and the rendered view again once it is not", async () => {
    let changed = false;
    const api = mdApi(
      { "README.md": "# Doc\n" },
      {
        listChanges: vi.fn(async () =>
          changeSet(changed ? [summary(0, "docs/a.ts"), summary(1, "README.md")] : [summary(0, "docs/a.ts")]),
        ),
      },
    );
    const { store } = await renderApp(api);
    await openRendered(store, "README.md");
    changed = true;
    await act(async () => {
      await store.getState().refresh();
      await flush();
    });
    expect(screen.getByLabelText("Diff of README.md")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-body")).toBeNull();
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
    changed = false;
    await act(async () => {
      await store.getState().refresh();
      await flush();
    });
    expect(await screen.findByTestId("markdown-body")).toHaveTextContent("Doc");
  });

  it("keeps a tab switched to source across a change and back", async () => {
    let changed = false;
    const api = mdApi(
      { "README.md": "# Doc\n" },
      { listChanges: vi.fn(async () => changeSet(changed ? [summary(0, "README.md")] : [summary(0, "docs/a.ts")])) },
    );
    const { store } = await renderApp(api);
    await openRendered(store, "README.md");
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    for (const c of [true, false]) {
      changed = c;
      await act(async () => {
        await store.getState().refresh();
        await flush();
      });
    }
    expect(screen.getByRole("button", { name: "Rendered" })).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-body")).toBeNull();
  });

  it("re-renders new contents in place", async () => {
    let content = "# One\n";
    const api = mdApi({ "README.md": "" }, { viewFile: vi.fn(async () => ({ kind: "text" as const, content })) });
    const { store } = await renderApp(api);
    await openRendered(store, "README.md");
    const scroller = screen.getByTestId("markdown-view-scroll");
    scroller.scrollTop = 120;
    content = "# Two\n";
    await act(async () => {
      await store.getState().refresh();
      await flush();
    });
    expect(screen.getByTestId("markdown-body")).toHaveTextContent("Two");
    expect(screen.getByTestId("markdown-view-scroll")).toBe(scroller);
    expect(scroller.scrollTop).toBe(120);
  });
});
