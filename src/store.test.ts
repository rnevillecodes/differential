import { describe, expect, it, vi } from "vitest";
import type { CommitPage } from "./model/CommitPage";
import {
  createAppStore,
  DEFAULT_GRAPH_WIDTH,
  DEFAULT_TERMINAL_HEIGHT,
  GRAPH_PAGE_SIZE,
  MAX_TERMINAL_TITLE,
  MIN_GRAPH_WIDTH,
  MIN_TERMINAL_HEIGHT,
  type AppState,
} from "./store";
import type { TerminalSessionEvents } from "./terminal/sessions";
import { changeSet, commit, ctx, fakeApi, fakeWatcher, fileDiff, flush, hunk, memoryStorage, summary } from "./test/fixtures";

describe("app store", () => {
  it("opens the repo from launch arguments and selects the first file", async () => {
    const api = fakeApi({ initialArgs: vi.fn(async () => ({ path: "C:/repo", base: "HEAD~3" })) });
    const store = createAppStore(api, memoryStorage());
    await store.getState().init();
    expect(api.openRepo).toHaveBeenCalledWith("C:/repo");
    expect(api.listChanges).toHaveBeenCalledWith("C:/repo", "HEAD~3");
    expect(store.getState().selectedId).toBe(0);
    await flush();
    expect(store.getState().files[0].status).toBe("ready");
  });

  it("does not open the folder picker at init without a path", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().init();
    expect(api.pickFolder).not.toHaveBeenCalled();
    expect(api.openRepo).not.toHaveBeenCalled();
    expect(store.getState().repo).toBeNull();
  });

  it("initializes only once when init is called twice (StrictMode)", async () => {
    const api = fakeApi({ initialArgs: vi.fn(async () => ({ path: "C:/repo", base: null })) });
    const store = createAppStore(api, memoryStorage());
    await Promise.all([store.getState().init(), store.getState().init()]);
    expect(api.initialArgs).toHaveBeenCalledTimes(1);
    expect(api.openRepo).toHaveBeenCalledTimes(1);
  });

  it("reports a blocking error when the folder is not a repository", async () => {
    const api = fakeApi({
      openRepo: vi.fn(async () => {
        throw { kind: "notARepo", message: "C:/x is not inside a git repository" };
      }),
    });
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/x");
    expect(store.getState().error?.kind).toBe("notARepo");
    expect(store.getState().repo).toBeNull();
  });

  it("keeps the previous diff and shows an inline error for a bad base", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    const before = store.getState().changes;
    vi.mocked(api.listChanges).mockRejectedValueOnce({ kind: "badRevision", message: "could not resolve revision 'nope'" });
    await store.getState().setBase("nope");
    expect(store.getState().changes).toBe(before);
    expect(store.getState().baseError).toContain("nope");
    expect(store.getState().error).toBeNull();
    expect(store.getState().base).toBe("HEAD");
  });

  it("changes base and clears the inline error on success", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    vi.mocked(api.listChanges).mockResolvedValueOnce(changeSet([summary(0, "z.ts")], { baseRef: "HEAD~3" }));
    await store.getState().setBase("HEAD~3");
    expect(api.listChanges).toHaveBeenLastCalledWith("C:/repo", "HEAD~3");
    expect(store.getState().base).toBe("HEAD~3");
    expect(store.getState().baseError).toBeNull();
  });

  it("refresh keeps the selected file by path", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().select(1); // b.ts
    vi.mocked(api.listChanges).mockResolvedValueOnce(
      changeSet([summary(0, "new.ts"), summary(1, "a.ts"), summary(2, "b.ts")]),
    );
    await store.getState().refresh();
    expect(store.getState().selectedId).toBe(2);
  });

  it("navigates next/previous within bounds", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().selectPrev();
    expect(store.getState().selectedId).toBe(0);
    store.getState().selectNext();
    expect(store.getState().selectedId).toBe(1);
    store.getState().selectNext();
    expect(store.getState().selectedId).toBe(1);
  });

  it("marks binary and large files without loading them, and force-loads large files", async () => {
    const api = fakeApi({
      listChanges: vi.fn(async () =>
        changeSet([summary(0, "img.png", { isBinary: true }), summary(1, "lock.json", { isLarge: true })]),
      ),
    });
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    expect(store.getState().files[0].status).toBe("binary");
    store.getState().select(1);
    expect(store.getState().files[1].status).toBe("large");
    expect(api.fileDiff).not.toHaveBeenCalled();
    store.getState().loadLarge(1);
    await flush();
    expect(api.fileDiff).toHaveBeenCalledWith("C:/repo", "abc123", expect.objectContaining({ id: 1 }), true);
    expect(store.getState().files[1].status).toBe("ready");
  });

  it("fetches only the sides that exist", async () => {
    const api = fakeApi({
      listChanges: vi.fn(async () =>
        changeSet([summary(0, "new.ts", { status: "untracked", oldPath: null })]),
      ),
    });
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    await flush();
    expect(api.fileContent).toHaveBeenCalledTimes(1);
    expect(api.fileContent).toHaveBeenCalledWith("C:/repo", "abc123", "new.ts", "worktree");
  });

  it("persists the view mode", () => {
    const storage = memoryStorage();
    const store = createAppStore(fakeApi(), storage);
    expect(store.getState().viewMode).toBe("unified");
    store.getState().toggleViewMode();
    expect(storage.data["differential.viewMode"]).toBe("split");
    const reopened = createAppStore(fakeApi(), storage);
    expect(reopened.getState().viewMode).toBe("split");
  });

  it("drops responses from superseded loads", async () => {
    let resolveSlow!: (v: ReturnType<typeof changeSet>) => void;
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    vi.mocked(api.listChanges)
      .mockImplementationOnce(() => new Promise((r) => (resolveSlow = r)))
      .mockResolvedValueOnce(changeSet([summary(0, "fast.ts")], { baseRef: "fast" }));
    const slow = store.getState().setBase("slow");
    await store.getState().setBase("fast");
    resolveSlow(changeSet([summary(0, "slow.ts")], { baseRef: "slow" }));
    await slow;
    expect(store.getState().base).toBe("fast");
  });
});

describe("tabs", () => {
  const paths = (s: AppState) => s.tabs.map((t) => (t.preview ? `(${t.path})` : t.path));

  it("opens the first changed file in a preview tab", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    expect(paths(store.getState())).toEqual(["(a.ts)"]);
    expect(store.getState().activePath).toBe("a.ts");
  });

  it("replaces the preview tab, and keeps pinned tabs open", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().select(1);
    expect(paths(store.getState())).toEqual(["(b.ts)"]);
    store.getState().pinTab("b.ts");
    store.getState().openTreePath("README.md");
    expect(paths(store.getState())).toEqual(["b.ts", "(README.md)"]);
    store.getState().select(0, true);
    expect(paths(store.getState())).toEqual(["b.ts", "a.ts"]);
    expect(store.getState().selectedId).toBe(0);
    // Opening an already-open file just switches to it.
    store.getState().select(1);
    expect(paths(store.getState())).toEqual(["b.ts", "a.ts"]);
    expect(store.getState().activePath).toBe("b.ts");
  });

  it("inserts new tabs after the active one", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().select(0, true);
    store.getState().select(1, true);
    store.getState().activateTab("a.ts");
    store.getState().openTreePath("README.md", true);
    expect(paths(store.getState())).toEqual(["a.ts", "README.md", "b.ts"]);
  });

  it("closing the active tab activates its neighbour, then nothing", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().select(0, true);
    store.getState().select(1, true);
    store.getState().openTreePath("README.md", true);
    store.getState().activateTab("b.ts");
    store.getState().closeTab("b.ts");
    expect(store.getState().activePath).toBe("README.md");
    expect(store.getState().selectedId).toBeNull();
    store.getState().closeTab("README.md");
    expect(store.getState().activePath).toBe("a.ts");
    expect(store.getState().selectedId).toBe(0);
    store.getState().closeTab("a.ts");
    expect(store.getState().tabs).toEqual([]);
    expect(store.getState().activePath).toBeNull();
    expect(store.getState().selectedId).toBeNull();
  });

  it("keeps a Markdown tab's rendered/source mode per tab until the tab closes", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    const mode = (path: string) => store.getState().tabs.find((t) => t.path === path)?.markdownMode ?? "rendered";
    store.getState().openTreePath("README.md");
    expect(mode("README.md")).toBe("rendered");
    store.getState().toggleMarkdownMode("README.md");
    expect(mode("README.md")).toBe("source");
    // Pinning keeps the mode; other tabs are unaffected.
    store.getState().pinTab("README.md");
    expect(mode("README.md")).toBe("source");
    store.getState().openTreePath("docs/guide.md", true);
    expect(mode("docs/guide.md")).toBe("rendered");
    store.getState().activateTab("README.md");
    expect(mode("README.md")).toBe("source");
    store.getState().toggleMarkdownMode("README.md");
    expect(mode("README.md")).toBe("rendered");
    store.getState().toggleMarkdownMode("README.md");
    // Closing and reopening starts rendered again.
    store.getState().closeTab("README.md");
    store.getState().openTreePath("README.md");
    expect(mode("README.md")).toBe("rendered");
  });

  it("reads images from the open repository", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await expect(store.getState().readImage("a.png")).rejects.toThrow();
    await store.getState().openPath("C:/repo");
    await store.getState().readImage("docs/a.png");
    expect(api.readImage).toHaveBeenCalledWith("C:/repo", "docs/a.png");
  });

  it("a preview tab replaced by another Markdown file starts rendered", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().openTreePath("README.md");
    store.getState().toggleMarkdownMode("README.md");
    store.getState().openTreePath("docs/guide.md");
    expect(store.getState().tabs.map((t) => t.path)).not.toContain("README.md");
    expect(store.getState().tabs.find((t) => t.path === "docs/guide.md")?.markdownMode).toBeUndefined();
  });

  it("cycles through tabs, wrapping around", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().select(0, true);
    store.getState().select(1, true);
    store.getState().cycleTab(1);
    expect(store.getState().activePath).toBe("a.ts");
    store.getState().cycleTab(-1);
    expect(store.getState().activePath).toBe("b.ts");
  });

  it("drops contents of closed files and ignores their late responses", async () => {
    let resolve!: (v: { kind: "text"; content: string }) => void;
    const api = fakeApi({ viewFile: vi.fn(() => new Promise<{ kind: "text"; content: string }>((r) => (resolve = r))) });
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().openTreePath("README.md", true);
    store.getState().closeTab("README.md");
    resolve({ kind: "text", content: "late\n" });
    await flush();
    expect(store.getState().views).toEqual({});
  });

  it("refresh keeps open tabs and reloads only the active one", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().select(0, true);
    store.getState().select(1, true);
    await flush();
    vi.mocked(api.fileDiff).mockClear();
    await store.getState().refresh();
    await flush();
    expect(paths(store.getState())).toEqual(["a.ts", "b.ts"]);
    expect(api.fileDiff).toHaveBeenCalledTimes(1);
    expect(store.getState().files[0]).toBeUndefined();
    store.getState().activateTab("a.ts");
    expect(api.fileDiff).toHaveBeenCalledTimes(2);
  });

  it("opening another repository closes every tab", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().select(1, true);
    await store.getState().openPath("C:/other");
    expect(paths(store.getState())).toEqual(["(a.ts)"]);
  });
});

describe("branch and tag list", () => {
  it("loads on open and reloads on refresh, but not on a base change", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    expect(api.listRefs).toHaveBeenCalledWith("C:/repo");
    expect(store.getState().refs?.map((r) => r.name)).toEqual(["feature", "main", "origin/main", "v1.0"]);
    await store.getState().setBase("main");
    expect(api.listRefs).toHaveBeenCalledTimes(1);
    await store.getState().refresh();
    expect(api.listRefs).toHaveBeenCalledTimes(2);
  });

  it("drops a stale response and resets for a new repository", async () => {
    let resolveSlow!: (v: Awaited<ReturnType<typeof api.listRefs>>) => void;
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    vi.mocked(api.listRefs)
      .mockImplementationOnce(() => new Promise((r) => (resolveSlow = r)))
      .mockResolvedValueOnce([{ name: "fresh", rev: "fresh", kind: "local", current: true }]);
    const slow = store.getState().refresh();
    await store.getState().refresh();
    resolveSlow([{ name: "stale", rev: "stale", kind: "local", current: true }]);
    await slow;
    expect(store.getState().refs?.map((r) => r.name)).toEqual(["fresh"]);

    vi.mocked(api.openRepo).mockImplementationOnce(() => new Promise(() => {})); // never opens
    void store.getState().openPath("C:/other");
    expect(store.getState().refs).toBeNull();
  });

  it("reports a listing failure without blocking the diff", async () => {
    const api = fakeApi({ listRefs: vi.fn(async () => Promise.reject({ kind: "git", message: "boom" })) });
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    expect(store.getState().refsError?.message).toBe("boom");
    expect(store.getState().refs).toBeNull();
    expect(store.getState().error).toBeNull();
    expect(store.getState().changes).not.toBeNull();
  });
});

describe("recent repositories", () => {
  it("records opened repositories most recent first, without duplicates, and persists them", async () => {
    const storage = memoryStorage();
    const store = createAppStore(fakeApi(), storage);
    await store.getState().openPath("C:/one");
    await store.getState().openPath("C:/two");
    await store.getState().openPath("c:\\ONE\\");
    expect(store.getState().recentRepos).toEqual(["c:\\ONE\\", "C:/two"]);
    expect(createAppStore(fakeApi(), storage).getState().recentRepos).toEqual(["c:\\ONE\\", "C:/two"]);
  });

  it("does not record a folder that failed to open", async () => {
    const api = fakeApi({ openRepo: vi.fn(async () => Promise.reject({ kind: "notARepo", message: "no" })) });
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/x");
    expect(store.getState().recentRepos).toEqual([]);
  });

  it("caps the list and lets entries be removed", async () => {
    const storage = memoryStorage({
      "differential.recentRepos": JSON.stringify(Array.from({ length: 20 }, (_, i) => `C:/r${i}`)),
    });
    const store = createAppStore(fakeApi(), storage);
    await store.getState().openPath("C:/new");
    expect(store.getState().recentRepos).toHaveLength(20);
    expect(store.getState().recentRepos[0]).toBe("C:/new");
    expect(store.getState().recentRepos).not.toContain("C:/r19");
    store.getState().removeRecentRepo("C:/r0");
    expect(JSON.parse(storage.data["differential.recentRepos"])).not.toContain("C:/r0");
  });

  it("ignores a corrupt stored list", () => {
    const store = createAppStore(fakeApi(), memoryStorage({ "differential.recentRepos": "{nope" }));
    expect(store.getState().recentRepos).toEqual([]);
  });
});

/** The unchanged file shown in the main pane, if any. */
const viewed = (s: AppState) =>
  s.activePath !== null && s.selectedId === null ? { path: s.activePath, load: s.views[s.activePath] } : null;

describe("project explorer state", () => {
  const exclusive = (s: AppState) => expect(s.selectedId !== null && viewed(s) !== null).toBe(false);

  it("persists the sidebar tab and switching tabs keeps the main pane", async () => {
    const storage = memoryStorage();
    const store = createAppStore(fakeApi(), storage);
    expect(store.getState().sidebarTab).toBe("changes");
    await store.getState().openPath("C:/repo");
    store.getState().select(1);
    store.getState().setSidebarTab("files");
    expect(storage.data["differential.sidebarTab"]).toBe("files");
    expect(store.getState().selectedId).toBe(1);
    expect(viewed(store.getState())).toBeNull();
    expect(createAppStore(fakeApi(), storage).getState().sidebarTab).toBe("files");
  });

  it("loads the project listing lazily, then again on refresh", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    expect(api.listFiles).not.toHaveBeenCalled();
    store.getState().setSidebarTab("files");
    await flush();
    expect(api.listFiles).toHaveBeenCalledWith("C:/repo");
    expect(store.getState().projectFiles).toEqual(["a.ts", "b.ts", "README.md"]);
    store.getState().setSidebarTab("changes");
    await store.getState().refresh();
    expect(api.listFiles).toHaveBeenCalledTimes(2);
  });

  it("loads the listing with the change set when opening on the Files tab", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage({ "differential.sidebarTab": "files" }));
    await store.getState().openPath("C:/repo");
    expect(store.getState().projectFiles).toEqual(["a.ts", "b.ts", "README.md"]);
  });

  it("reports a listing failure without blocking the diff", async () => {
    const api = fakeApi({ listFiles: vi.fn(async () => Promise.reject({ kind: "git", message: "boom" })) });
    const store = createAppStore(api, memoryStorage({ "differential.sidebarTab": "files" }));
    await store.getState().openPath("C:/repo");
    expect(store.getState().filesError?.message).toBe("boom");
    expect(store.getState().error).toBeNull();
    expect(store.getState().changes).not.toBeNull();
  });

  it("drops a stale listing from a superseded load", async () => {
    let resolveSlow!: (v: string[]) => void;
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage({ "differential.sidebarTab": "files" }));
    await store.getState().openPath("C:/repo");
    vi.mocked(api.listFiles)
      .mockImplementationOnce(() => new Promise((r) => (resolveSlow = r)))
      .mockResolvedValueOnce(["fresh.ts"]);
    const slow = store.getState().refresh();
    await store.getState().refresh();
    resolveSlow(["stale.ts"]);
    await slow;
    expect(store.getState().projectFiles).toEqual(["fresh.ts"]);
  });

  it("prunes vanished folders on refresh and resets them for a new repository", async () => {
    const api = fakeApi({ listFiles: vi.fn(async () => ["src/ui/a.ts", "docs/x.md"]) });
    const store = createAppStore(api, memoryStorage({ "differential.sidebarTab": "files" }));
    await store.getState().openPath("C:/repo");
    store.getState().reveal("src/ui/a.ts");
    store.getState().toggleFolder("docs");
    expect([...store.getState().expanded].sort()).toEqual(["docs", "src", "src/ui"]);
    vi.mocked(api.listFiles).mockResolvedValueOnce(["src/ui/a.ts"]);
    await store.getState().refresh();
    expect([...store.getState().expanded].sort()).toEqual(["src", "src/ui"]);
    await store.getState().openPath("C:/other");
    expect(store.getState().expanded.size).toBe(0);
  });

  it("collapses a folder together with every expanded folder below it", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    for (const p of ["src", "src/ui", "src/ui/widgets", "src2", "lib", "lib/core"]) {
      store.getState().setFolderExpanded(p, true);
    }
    // A remembered entry under a collapsed child is cleared too.
    store.getState().setFolderExpanded("src/ui", false);
    store.getState().collapseSubtree("src");
    expect([...store.getState().expanded].sort()).toEqual(["lib", "lib/core", "src2"]);
    const before = store.getState().expanded;
    store.getState().collapseSubtree("src");
    store.getState().collapseSubtree("docs");
    expect(store.getState().expanded).toBe(before);
  });

  it("opens a changed path as a diff and an unchanged path as contents", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().openTreePath("README.md");
    exclusive(store.getState());
    expect(store.getState().selectedId).toBeNull();
    expect(viewed(store.getState())?.load.status).toBe("loading");
    await flush();
    expect(api.viewFile).toHaveBeenCalledWith("C:/repo", "README.md", false);
    expect(viewed(store.getState())).toEqual({ path: "README.md", load: { status: "ready", content: "x\n" } });
    store.getState().openTreePath("b.ts");
    exclusive(store.getState());
    expect(store.getState().selectedId).toBe(1);
    expect(viewed(store.getState())).toBeNull();
  });

  it("next-file from a viewed file selects the first changed file", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().openTreePath("README.md");
    store.getState().selectNext();
    exclusive(store.getState());
    expect(store.getState().selectedId).toBe(0);
    expect(viewed(store.getState())).toBeNull();
  });

  it("loads a large viewed file on request", async () => {
    const api = fakeApi({
      viewFile: vi.fn(async (_r: string, _p: string, force: boolean) =>
        force ? { kind: "text" as const, content: "big\n" } : { kind: "large" as const, size: 3_000_000 },
      ),
    });
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().openTreePath("big.log");
    await flush();
    expect(viewed(store.getState())?.load).toEqual({ status: "large", size: 3_000_000 });
    store.getState().loadViewAnyway("big.log");
    await flush();
    expect(api.viewFile).toHaveBeenLastCalledWith("C:/repo", "big.log", true);
    expect(viewed(store.getState())?.load).toEqual({ status: "ready", content: "big\n" });
  });

  it("refresh keeps a viewed file, re-reads it, and clears it once gone", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage({ "differential.sidebarTab": "files" }));
    await store.getState().openPath("C:/repo");
    store.getState().openTreePath("README.md");
    await flush();
    await store.getState().refresh();
    await flush();
    exclusive(store.getState());
    expect(viewed(store.getState())?.path).toBe("README.md");
    expect(api.viewFile).toHaveBeenCalledTimes(2);
    vi.mocked(api.listFiles).mockResolvedValueOnce(["a.ts", "b.ts"]);
    await store.getState().refresh();
    expect(viewed(store.getState())).toBeNull();
  });

  it("refresh switches a viewed file to its diff once it has changes", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().openTreePath("README.md");
    vi.mocked(api.listChanges).mockResolvedValueOnce(changeSet([summary(0, "a.ts"), summary(1, "README.md")]));
    await store.getState().refresh();
    exclusive(store.getState());
    expect(store.getState().selectedId).toBe(1);
    expect(viewed(store.getState())).toBeNull();
  });
});

describe("terminal panel state", () => {
  function setup(saved: Record<string, string> = {}) {
    const storage = memoryStorage(saved);
    const sessions = {
      attach: vi.fn(),
      focus: vi.fn(),
      hasSelection: vi.fn(() => false),
      copy: vi.fn(),
      paste: vi.fn(),
      close: vi.fn(),
      has: vi.fn(() => false),
    };
    let events!: TerminalSessionEvents;
    const store = createAppStore(fakeApi(), storage, (_api, ev) => {
      events = ev;
      return sessions;
    });
    return { store, storage, sessions, events: () => events };
  }

  it("is hidden by default and cannot be shown without a repository", () => {
    const { store } = setup();
    expect(store.getState().terminalOpen).toBe(false);
    store.getState().toggleTerminal();
    store.getState().newTerminal();
    expect(store.getState().terminalOpen).toBe(false);
    expect(store.getState().terminals).toEqual([]);
  });

  it("starts a terminal in the repository root the first time it is shown", async () => {
    const { store, storage } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().toggleTerminal();
    const s = store.getState();
    expect(s.terminalOpen).toBe(true);
    expect(storage.data["differential.terminalOpen"]).toBe("true");
    expect(s.terminals).toEqual([{ id: 1, title: "Terminal 1", cwd: "C:/repo", status: { kind: "starting" } }]);
    expect(s.activeTerminal).toBe(1);
  });

  it("hides and shows without touching running terminals", async () => {
    const { store, sessions } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().toggleTerminal();
    store.getState().toggleTerminal();
    expect(store.getState().terminalOpen).toBe(false);
    expect(store.getState().terminals).toHaveLength(1);
    store.getState().toggleTerminal();
    expect(store.getState().terminals).toHaveLength(1);
    expect(sessions.close).not.toHaveBeenCalled();
  });

  it("adds, switches and closes terminals; closing the last hides the panel", async () => {
    const { store, sessions, storage } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().newTerminal();
    store.getState().newTerminal();
    store.getState().newTerminal();
    expect(store.getState().terminals.map((t) => t.title)).toEqual(["Terminal 1", "Terminal 2", "Terminal 3"]);
    expect(store.getState().activeTerminal).toBe(3);

    store.getState().setActiveTerminal(2);
    store.getState().closeTerminal(2);
    expect(sessions.close).toHaveBeenCalledWith(2);
    expect(store.getState().activeTerminal).toBe(3);

    store.getState().closeTerminal(3);
    expect(store.getState().activeTerminal).toBe(1);
    expect(store.getState().terminalOpen).toBe(true);

    store.getState().closeTerminal(1);
    expect(store.getState().terminals).toEqual([]);
    expect(store.getState().activeTerminal).toBeNull();
    expect(store.getState().terminalOpen).toBe(false);
    expect(storage.data["differential.terminalOpen"]).toBe("false");

    store.getState().newTerminal();
    expect(store.getState().terminals[0].title).toBe("Terminal 4");
  });

  it("renames terminals, trimming and capping the title; blank restores the default", async () => {
    const { store } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().newTerminal();
    store.getState().newTerminal();
    store.getState().renameTerminal(2, "  build  ");
    expect(store.getState().terminals.map((t) => t.title)).toEqual(["Terminal 1", "build"]);
    store.getState().renameTerminal(2, "x".repeat(MAX_TERMINAL_TITLE + 10));
    expect(store.getState().terminals[1].title).toHaveLength(MAX_TERMINAL_TITLE);
    store.getState().renameTerminal(2, " ");
    expect(store.getState().terminals[1].title).toBe("Terminal 2");
    store.getState().renameTerminal(99, "nope");
    expect(store.getState().terminals.map((t) => t.title)).toEqual(["Terminal 1", "Terminal 2"]);
  });

  it("tracks session status from the session events; a start failure keeps its tab", async () => {
    const { store, events } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().newTerminal();
    store.getState().newTerminal();
    events().onRunning(1);
    events().onFailed(2, "no shell");
    expect(store.getState().terminals.map((t) => t.status)).toEqual([
      { kind: "running" },
      { kind: "failed", message: "no shell" },
    ]);
  });

  it("closes a terminal's tab when its shell exits, whatever the code", async () => {
    const { store, events, sessions } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().newTerminal();
    store.getState().newTerminal();
    events().onExit(2, 1);
    expect(store.getState().terminals.map((t) => t.id)).toEqual([1]);
    expect(store.getState().activeTerminal).toBe(1);
    expect(sessions.close).toHaveBeenCalledWith(2);
    events().onExit(99, 0);
    expect(store.getState().terminals).toHaveLength(1);

    events().onExit(1, 0);
    expect(store.getState().terminals).toEqual([]);
    expect(store.getState().terminalOpen).toBe(false);
  });

  it("keeps terminals when switching repositories; new ones start in the new root", async () => {
    const { store, sessions } = setup();
    await store.getState().openPath("C:/one");
    store.getState().toggleTerminal();
    await store.getState().openPath("C:/two");
    expect(store.getState().terminals.map((t) => t.cwd)).toEqual(["C:/one"]);
    store.getState().newTerminal();
    expect(store.getState().terminals.map((t) => t.cwd)).toEqual(["C:/one", "C:/two"]);
    expect(sessions.close).not.toHaveBeenCalled();
  });

  it("restores an open panel with one new terminal when a repository opens", async () => {
    const { store } = setup({ "differential.terminalOpen": "true", "differential.terminalHeight": "333" });
    expect(store.getState().terminalHeight).toBe(333);
    await store.getState().openPath("C:/repo");
    expect(store.getState().terminalOpen).toBe(true);
    expect(store.getState().terminals).toHaveLength(1);
  });

  /** Group invariants: no empty group, every tab in exactly one group, sizes add up, active ids consistent. */
  function expectGroupsConsistent(s: AppState) {
    const grouped = s.terminalGroups.flatMap((g) => g.tabs);
    expect([...grouped].sort((a, b) => a - b)).toEqual(s.terminals.map((t) => t.id).sort((a, b) => a - b));
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const g of s.terminalGroups) {
      expect(g.tabs.length).toBeGreaterThan(0);
      expect(g.tabs).toContain(g.active);
    }
    if (s.terminalGroups.length === 0) {
      expect(s.activeTerminalGroup).toBeNull();
      expect(s.activeTerminal).toBeNull();
    } else {
      expect(s.terminalGroups.reduce((a, g) => a + g.size, 0)).toBeCloseTo(1);
      const active = s.terminalGroups.find((g) => g.id === s.activeTerminalGroup);
      expect(active).toBeDefined();
      expect(s.activeTerminal).toBe(active!.active);
    }
  }

  const groupTabs = (s: AppState) => s.terminalGroups.map((g) => g.tabs);
  const groupSizes = (s: AppState) => s.terminalGroups.map((g) => g.size);

  it("puts the first terminal in one full-width group", async () => {
    const { store } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().toggleTerminal();
    const s = store.getState();
    expect(s.terminalGroups).toEqual([{ id: 1, tabs: [1], active: 1, size: 1 }]);
    expect(s.activeTerminalGroup).toBe(1);
    expectGroupsConsistent(s);
  });

  it("adds a new terminal to the given group, or the active one", async () => {
    const { store } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().newTerminal();
    store.getState().splitTerminal(1);
    const [a, b] = store.getState().terminalGroups.map((g) => g.id);
    store.getState().newTerminal(a);
    expect(groupTabs(store.getState())).toEqual([[1, 3], [2]]);
    expect(store.getState().activeTerminalGroup).toBe(a);
    expect(store.getState().activeTerminal).toBe(3);
    store.getState().setActiveTerminalGroup(b);
    store.getState().newTerminal();
    expect(groupTabs(store.getState())).toEqual([[1, 3], [2, 4]]);
    expect(store.getState().activeTerminal).toBe(4);
    expectGroupsConsistent(store.getState());
  });

  it("splits a group to its right, halving its width, up to the group limit", async () => {
    const { store, storage } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().splitTerminal(1);
    expect(store.getState().terminals).toEqual([]); // no group to split yet
    store.getState().newTerminal();
    store.getState().toggleTerminal(); // hide
    store.getState().splitTerminal(1);
    expect(store.getState().terminalOpen).toBe(true);
    expect(storage.data["differential.terminalOpen"]).toBe("true");
    expect(groupTabs(store.getState())).toEqual([[1], [2]]);
    expect(groupSizes(store.getState())).toEqual([0.5, 0.5]);
    expect(store.getState().activeTerminal).toBe(2);

    // Splitting the left group puts the new one between the two; splitting the right one halves only it.
    store.getState().splitTerminal(1);
    expect(groupTabs(store.getState())).toEqual([[1], [3], [2]]);
    expect(groupSizes(store.getState())).toEqual([0.25, 0.25, 0.5]);
    const right = store.getState().terminalGroups[2].id;
    store.getState().splitTerminal(right);
    expect(groupTabs(store.getState())).toEqual([[1], [3], [2], [4]]);
    expect(groupSizes(store.getState())).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(store.getState().activeTerminal).toBe(4);
    expect(store.getState().activeTerminalGroup).toBe(store.getState().terminalGroups[3].id);
    expectGroupsConsistent(store.getState());

    store.getState().splitTerminal(1);
    expect(store.getState().terminalGroups).toHaveLength(4);
    expect(store.getState().terminals).toHaveLength(4);
  });

  it("closes tabs within their group, removing emptied groups and moving their width", async () => {
    const { store, sessions } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().newTerminal(); // 1 in A
    store.getState().newTerminal(); // 2 in A
    store.getState().splitTerminal(1); // 3 in B
    store.getState().splitTerminal(store.getState().terminalGroups[1].id); // 4 in C
    const [a, b, c] = store.getState().terminalGroups.map((g) => g.id);
    store.getState().setActiveTerminal(1);
    expect(store.getState().activeTerminalGroup).toBe(a);
    expect(store.getState().terminalGroups[0].active).toBe(1);

    // A neighbor tab in the same group takes over; other groups keep their tab.
    store.getState().closeTerminal(1);
    expect(groupTabs(store.getState())).toEqual([[2], [3], [4]]);
    expect(store.getState().activeTerminal).toBe(2);
    expectGroupsConsistent(store.getState());

    // Closing the middle group's only tab gives its width to the left neighbor; C stays active.
    store.getState().setActiveTerminalGroup(c);
    store.getState().closeTerminal(3);
    expect(sessions.close).toHaveBeenCalledWith(3);
    expect(store.getState().terminalGroups.map((g) => g.id)).toEqual([a, c]);
    expect(groupSizes(store.getState())).toEqual([0.75, 0.25]);
    expect(store.getState().activeTerminalGroup).toBe(c);
    expectGroupsConsistent(store.getState());
    expect(b).not.toBe(c);

    // The leftmost active group gives its width to the right neighbor, which becomes active.
    store.getState().setActiveTerminalGroup(a);
    store.getState().closeTerminal(2);
    expect(store.getState().terminalGroups).toEqual([{ id: c, tabs: [4], active: 4, size: 1 }]);
    expect(store.getState().activeTerminalGroup).toBe(c);
    expect(store.getState().activeTerminal).toBe(4);
    expect(store.getState().terminalOpen).toBe(true);

    store.getState().closeTerminal(4);
    expect(store.getState().terminalGroups).toEqual([]);
    expect(store.getState().terminalOpen).toBe(false);
    expectGroupsConsistent(store.getState());

    // Showing the panel again starts over with one full-width group.
    store.getState().toggleTerminal();
    expect(store.getState().terminalGroups).toHaveLength(1);
    expect(store.getState().terminalGroups[0].size).toBe(1);
    expectGroupsConsistent(store.getState());
  });

  it("removes a group whose only shell exits", async () => {
    const { store, events } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().newTerminal();
    store.getState().splitTerminal(1);
    events().onExit(1, 0);
    expect(groupTabs(store.getState())).toEqual([[2]]);
    expect(groupSizes(store.getState())).toEqual([1]);
    expect(store.getState().activeTerminal).toBe(2);
    expectGroupsConsistent(store.getState());
  });

  it("activates a tab's group when the tab is selected; ignores unknown ids", async () => {
    const { store } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().newTerminal();
    store.getState().splitTerminal(1);
    store.getState().newTerminal(); // 3 joins B
    store.getState().setActiveTerminal(1);
    expect(store.getState().activeTerminalGroup).toBe(1);
    expect(store.getState().activeTerminal).toBe(1);
    // B still shows tab 3.
    expect(store.getState().terminalGroups[1].active).toBe(3);
    store.getState().setActiveTerminalGroup(store.getState().terminalGroups[1].id);
    expect(store.getState().activeTerminal).toBe(3);
    store.getState().setActiveTerminal(99);
    store.getState().setActiveTerminalGroup(99);
    expect(store.getState().activeTerminal).toBe(3);
    expectGroupsConsistent(store.getState());
  });

  it("normalizes group sizes and rejects a mismatched or invalid list", async () => {
    const { store } = setup();
    await store.getState().openPath("C:/repo");
    store.getState().newTerminal();
    store.getState().splitTerminal(1);
    store.getState().setTerminalGroupSizes([3, 1]);
    expect(groupSizes(store.getState())).toEqual([0.75, 0.25]);
    store.getState().setTerminalGroupSizes([1]);
    store.getState().setTerminalGroupSizes([1, 0]);
    store.getState().setTerminalGroupSizes([1, NaN]);
    expect(groupSizes(store.getState())).toEqual([0.75, 0.25]);
  });

  it("restores an open panel with a single group when a repository opens", async () => {
    const { store } = setup({ "differential.terminalOpen": "true" });
    await store.getState().openPath("C:/repo");
    expect(store.getState().terminalGroups).toHaveLength(1);
    expectGroupsConsistent(store.getState());
  });

  it("persists the height with a lower bound", () => {
    const { store, storage } = setup({ "differential.terminalHeight": "nonsense" });
    expect(store.getState().terminalHeight).toBe(DEFAULT_TERMINAL_HEIGHT);
    store.getState().setTerminalHeight(400.4);
    expect(store.getState().terminalHeight).toBe(400);
    expect(storage.data["differential.terminalHeight"]).toBe("400");
    store.getState().setTerminalHeight(10);
    expect(store.getState().terminalHeight).toBe(MIN_TERMINAL_HEIGHT);
  });
});

describe("commit graph state", () => {
  /** A listCommits mock whose responses are resolved by hand, in any order. */
  function deferredCommits() {
    const pending: { offset: number; resolve: (p: CommitPage) => void; reject: (e: unknown) => void }[] = [];
    const listCommits = vi.fn(
      (_root: string, offset: number) =>
        new Promise<CommitPage>((resolve, reject) => pending.push({ offset, resolve, reject })),
    );
    return { listCommits, pending };
  }

  const shas = (s: AppState) => s.graph.rows.map((r) => r.commit.sha);

  it("is hidden by default and toggling needs a repository", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    expect(store.getState().graphOpen).toBe(false);
    store.getState().toggleGraph();
    expect(store.getState().graphOpen).toBe(false);
    await store.getState().openPath("C:/repo");
    expect(api.listCommits).not.toHaveBeenCalled();
  });

  it("loads the first page when shown and keeps it when hidden and shown again", async () => {
    const api = fakeApi();
    const storage = memoryStorage();
    const store = createAppStore(api, storage);
    await store.getState().openPath("C:/repo");
    store.getState().toggleGraph();
    expect(storage.data["differential.graphOpen"]).toBe("true");
    expect(api.listCommits).toHaveBeenCalledWith("C:/repo", 0, GRAPH_PAGE_SIZE);
    await flush();
    expect(shas(store.getState())).toEqual(["abc123", "def456"]);
    expect(store.getState().graph.loading).toBe(false);
    store.getState().toggleGraph();
    store.getState().toggleGraph();
    expect(api.listCommits).toHaveBeenCalledTimes(1);
  });

  it("restores an open pane and loads it when a repository opens", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage({ "differential.graphOpen": "true", "differential.graphWidth": "420" }));
    expect(store.getState().graphWidth).toBe(420);
    await store.getState().openPath("C:/repo");
    await flush();
    expect(shas(store.getState())).toEqual(["abc123", "def456"]);
  });

  it("appends later pages, continuing the lanes", async () => {
    const { listCommits, pending } = deferredCommits();
    const store = createAppStore(fakeApi({ listCommits }), memoryStorage({ "differential.graphOpen": "true" }));
    await store.getState().openPath("C:/repo");
    pending[0].resolve({ commits: [commit("c", ["b"])], hasMore: true });
    await flush();
    store.getState().loadMoreCommits();
    store.getState().loadMoreCommits(); // ignored while a page is loading
    expect(listCommits).toHaveBeenCalledTimes(2);
    expect(pending[1].offset).toBe(1);
    pending[1].resolve({ commits: [commit("b", ["a"]), commit("a")], hasMore: false });
    await flush();
    expect(shas(store.getState())).toEqual(["c", "b", "a"]);
    expect(store.getState().graph.rows.map((r) => r.column)).toEqual([0, 0, 0]);
    store.getState().loadMoreCommits(); // nothing left
    expect(listCommits).toHaveBeenCalledTimes(2);
  });

  it("reloads from the first page on refresh, dropping an older response", async () => {
    const { listCommits, pending } = deferredCommits();
    const store = createAppStore(fakeApi({ listCommits }), memoryStorage({ "differential.graphOpen": "true" }));
    await store.getState().openPath("C:/repo");
    pending[0].resolve({ commits: [commit("old")], hasMore: true });
    await flush();
    store.getState().loadMoreCommits();
    const refreshed = store.getState().refresh();
    expect(pending[2].offset).toBe(0);
    pending[2].resolve({ commits: [commit("new", ["old"]), commit("old")], hasMore: false });
    await refreshed;
    await flush();
    pending[1].resolve({ commits: [commit("stale")], hasMore: false });
    await flush();
    expect(shas(store.getState())).toEqual(["new", "old"]);
  });

  it("marks a hidden pane stale on refresh and reloads when shown", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().toggleGraph();
    await flush();
    store.getState().toggleGraph();
    await store.getState().refresh();
    expect(api.listCommits).toHaveBeenCalledTimes(1);
    expect(store.getState().graph.stale).toBe(true);
    store.getState().toggleGraph();
    expect(api.listCommits).toHaveBeenCalledTimes(2);
  });

  it("clears the rows when another repository opens", async () => {
    const { listCommits, pending } = deferredCommits();
    const store = createAppStore(fakeApi({ listCommits }), memoryStorage({ "differential.graphOpen": "true" }));
    await store.getState().openPath("C:/one");
    pending[0].resolve({ commits: [commit("one")], hasMore: false });
    await flush();
    const opening = store.getState().openPath("C:/two");
    expect(store.getState().graph.rows).toEqual([]);
    await opening;
    expect(listCommits).toHaveBeenLastCalledWith("C:/two", 0, GRAPH_PAGE_SIZE);
  });

  it("reports a listing error without affecting the diff", async () => {
    const api = fakeApi({
      listCommits: vi.fn(async () => {
        throw { kind: "git", message: "fatal: bad object" };
      }),
    });
    const store = createAppStore(api, memoryStorage({ "differential.graphOpen": "true" }));
    await store.getState().openPath("C:/repo");
    await flush();
    expect(store.getState().graph.error?.message).toBe("fatal: bad object");
    expect(store.getState().graph.loading).toBe(false);
    expect(store.getState().error).toBeNull();
    expect(store.getState().changes).not.toBeNull();
  });

  it("persists the width with a lower bound", () => {
    const storage = memoryStorage({ "differential.graphWidth": "nonsense" });
    const store = createAppStore(fakeApi(), storage);
    expect(store.getState().graphWidth).toBe(DEFAULT_GRAPH_WIDTH);
    store.getState().setGraphWidth(400.4);
    expect(store.getState().graphWidth).toBe(400);
    expect(storage.data["differential.graphWidth"]).toBe("400");
    store.getState().setGraphWidth(10);
    expect(store.getState().graphWidth).toBe(MIN_GRAPH_WIDTH);
  });
});

describe("find", () => {
  it("opens with focus, keeps the query and match case, and closes", () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    const s = () => store.getState();
    s().openFind();
    expect(s().findOpen).toBe(true);
    expect(s().findFocusSeq).toBe(1);
    s().setFindQuery("foo");
    s().toggleFindMatchCase();
    s().setFindStatus({ current: 1, total: 3 });
    s().closeFind();
    expect(s().findOpen).toBe(false);
    expect(s().findStatus).toBeNull();

    s().openFind();
    expect(s().findQuery).toBe("foo");
    expect(s().findMatchCase).toBe(true);
    expect(s().findFocusSeq).toBe(2);
    s().openFind("bar");
    expect(s().findQuery).toBe("bar");
  });

  it("requests next and previous only while open", () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    const s = () => store.getState();
    s().findNext();
    expect(s().findNav.seq).toBe(0);
    s().openFind();
    s().findNext();
    expect(s().findNav).toEqual({ seq: 1, dir: 1 });
    s().findPrev();
    expect(s().findNav).toEqual({ seq: 2, dir: -1 });
  });

  it("ignores an unchanged status", () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    store.getState().setFindStatus({ current: 2, total: 5 });
    const first = store.getState().findStatus;
    store.getState().setFindStatus({ current: 2, total: 5 });
    expect(store.getState().findStatus).toBe(first);
  });
});


describe("automatic updates", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function opened(over: Parameters<typeof fakeApi>[0] = {}, storage = memoryStorage()) {
    const watcher = fakeWatcher();
    const api = fakeApi({ ...watcher.api, ...over });
    const store = createAppStore(api, storage);
    await store.getState().openPath("C:/repo");
    await flush();
    return { api, store, watcher };
  }

  /** Every status the active file's load passes through while `run` executes. */
  async function activeStatuses(store: ReturnType<typeof createAppStore>, run: () => Promise<unknown>) {
    const seen: string[] = [];
    const unsubscribe = store.subscribe((s) => {
      const load = s.selectedId === null ? undefined : s.files[s.selectedId];
      seen.push(load?.status ?? "none");
    });
    await run();
    await flush();
    unsubscribe();
    return seen;
  }

  it("watches the opened repository", async () => {
    const { api, store } = await opened();
    expect(api.watchRepo).toHaveBeenCalledWith("C:/repo", expect.any(Function));
    expect(store.getState().watchStatus).toEqual({ kind: "active" });
  });

  it("ignores events from a repository that is no longer open", async () => {
    const { api, store, watcher } = await opened();
    await store.getState().openPath("C:/other");
    await flush();
    expect(api.unwatchRepo).toHaveBeenCalledWith(1);
    vi.mocked(api.listChanges).mockClear();
    watcher.changed(true, false, 0);
    await flush();
    expect(api.listChanges).not.toHaveBeenCalled();
    watcher.changed(true, false, 1);
    await flush();
    expect(api.listChanges).toHaveBeenCalledWith("C:/other", "HEAD");
  });

  it("still opens the repository when it can't be watched", async () => {
    const { store } = await opened({
      watchRepo: vi.fn(async () => {
        throw { kind: "io", message: "The system limit on watched folders was reached." };
      }),
    });
    expect(store.getState().changes?.files).toHaveLength(2);
    expect(store.getState().error).toBeNull();
    expect(store.getState().watchStatus).toEqual({
      kind: "unavailable",
      message: "The system limit on watched folders was reached.",
    });
  });

  it("shows when watching stops working", async () => {
    const { store, watcher } = await opened();
    watcher.emit({ kind: "unavailable", message: "The repository folder no longer exists." });
    expect(store.getState().watchStatus).toEqual({
      kind: "unavailable",
      message: "The repository folder no longer exists.",
    });
  });

  it("refreshes in place without a loading state", async () => {
    const { api, store, watcher } = await opened();
    const shown = store.getState().files[0];
    expect(shown.status).toBe("ready");
    const pending = deferred<ReturnType<typeof changeSet>>();
    vi.mocked(api.listChanges).mockReturnValueOnce(pending.promise);
    const seen = await activeStatuses(store, async () => {
      watcher.changed();
      await flush();
      expect(store.getState().loading).toBe(false);
      pending.resolve(changeSet([summary(0, "a.ts", { additions: 5 }), summary(1, "b.ts")]));
      await flush();
    });
    expect(seen).not.toContain("loading");
    expect(store.getState().loading).toBe(false);
    expect(store.getState().changes?.files[0].additions).toBe(5);
  });

  it("keeps the shown diff object unless its content changed", async () => {
    const { api, store, watcher } = await opened();
    const before = store.getState().files[0];
    const changesBefore = store.getState().changes;
    watcher.changed();
    await flush();
    await flush();
    expect(store.getState().files[0]).toBe(before);
    expect(store.getState().changes).toBe(changesBefore);

    vi.mocked(api.fileDiff).mockResolvedValueOnce(fileDiff([hunk(1, 1, 1, 1, [ctx("x", 1, 1)])]));
    watcher.changed();
    await flush();
    await flush();
    const after = store.getState().files[0];
    expect(after).not.toBe(before);
    expect(after.status === "ready" && after.diff.hunks).toHaveLength(1);
  });

  it("merges changes reported during a refresh into one more refresh", async () => {
    const { api, store, watcher } = await opened();
    const first = deferred<ReturnType<typeof changeSet>>();
    vi.mocked(api.listChanges).mockClear();
    vi.mocked(api.listChanges).mockReturnValueOnce(first.promise);
    watcher.changed();
    await flush();
    expect(api.listChanges).toHaveBeenCalledTimes(1);
    watcher.changed();
    watcher.changed(false, true);
    watcher.changed();
    await flush();
    expect(api.listChanges).toHaveBeenCalledTimes(1);
    first.resolve(changeSet([summary(0, "a.ts"), summary(1, "b.ts")]));
    await flush();
    await flush();
    expect(api.listChanges).toHaveBeenCalledTimes(2);
    expect(store.getState().changes?.files).toHaveLength(2);
  });

  it("reloads refs and history only for git changes", async () => {
    const { api, store, watcher } = await opened();
    vi.mocked(api.listRefs).mockClear();
    watcher.changed(true, false);
    await flush();
    expect(api.listRefs).not.toHaveBeenCalled();
    watcher.changed(false, true);
    await flush();
    await flush();
    expect(api.listRefs).toHaveBeenCalledTimes(1);
    expect(store.getState().graph.stale).toBe(true);
  });

  it("reloads the shown history when a commit is made", async () => {
    const { api, store, watcher } = await opened();
    store.getState().toggleGraph();
    await flush();
    vi.mocked(api.listCommits).mockClear();
    watcher.changed(true, true);
    await flush();
    expect(api.listCommits).toHaveBeenCalledWith("C:/repo", 0, GRAPH_PAGE_SIZE);
  });

  it("keeps what is shown when an automatic update fails", async () => {
    const { api, store, watcher } = await opened();
    const before = store.getState().changes;
    vi.mocked(api.listChanges).mockRejectedValueOnce({ kind: "git", message: "index.lock exists" });
    watcher.changed();
    await flush();
    expect(store.getState().changes).toBe(before);
    expect(store.getState().error).toBeNull();
    expect(store.getState().files[0].status).toBe("ready");
  });

  it("shows an inline error when the base no longer resolves", async () => {
    const { api, store, watcher } = await opened();
    vi.mocked(api.listChanges).mockRejectedValueOnce({ kind: "badRevision", message: "could not resolve revision 'gone'" });
    watcher.changed(false, true);
    await flush();
    expect(store.getState().baseError).toBe("could not resolve revision 'gone'");
    expect(store.getState().error).toBeNull();
  });

  it("closes the tab of a deleted file", async () => {
    const { api, store, watcher } = await opened({}, memoryStorage({ "differential.sidebarTab": "files" }));
    store.getState().select(1, true);
    store.getState().select(0, true);
    await flush();
    vi.mocked(api.listChanges).mockResolvedValueOnce(changeSet([summary(0, "b.ts")]));
    vi.mocked(api.listFiles).mockResolvedValueOnce(["b.ts", "README.md"]);
    watcher.changed();
    await flush();
    await flush();
    expect(store.getState().tabs.map((t) => t.path)).toEqual(["b.ts"]);
    expect(store.getState().activePath).toBe("b.ts");
  });

  it("does not change the active tab or open tabs", async () => {
    const { api, store, watcher } = await opened();
    store.getState().select(1);
    await flush();
    vi.mocked(api.listChanges).mockResolvedValueOnce(
      changeSet([summary(0, "new.ts", { status: "untracked" }), summary(1, "a.ts"), summary(2, "b.ts")]),
    );
    watcher.changed();
    await flush();
    await flush();
    expect(store.getState().activePath).toBe("b.ts");
    expect(store.getState().selectedId).toBe(2);
    expect(store.getState().tabs.map((t) => t.path)).toEqual(["b.ts"]);
    // The carried diff moved to the file's new id.
    expect(store.getState().files[2]?.status).toBe("ready");
  });

  it("waits for a visible load before refreshing", async () => {
    const watcher = fakeWatcher();
    const first = deferred<ReturnType<typeof changeSet>>();
    const api = fakeApi({ ...watcher.api, listChanges: vi.fn(() => first.promise) });
    const store = createAppStore(api, memoryStorage());
    const opening = store.getState().openPath("C:/repo");
    await flush();
    watcher.changed();
    await flush();
    expect(api.listChanges).toHaveBeenCalledTimes(1);
    first.resolve(changeSet([summary(0, "a.ts")]));
    await opening;
    await flush();
    expect(api.listChanges).toHaveBeenCalledTimes(2);
    // The opening load still chose the first file.
    expect(store.getState().activePath).toBe("a.ts");
  });

  it("manual refresh keeps the shown diff instead of a loading state", async () => {
    const { store } = await opened();
    const seen = await activeStatuses(store, () => store.getState().refresh());
    expect(seen).not.toContain("loading");
    expect(store.getState().files[0].status).toBe("ready");
  });

  it("keeps a large diff the user loaded", async () => {
    const { api, store, watcher } = await opened({
      listChanges: vi.fn(async () => changeSet([summary(0, "big.lock", { isLarge: true })])),
    });
    expect(store.getState().files[0].status).toBe("large");
    store.getState().loadLarge(0);
    await flush();
    expect(store.getState().files[0].status).toBe("ready");
    watcher.changed();
    await flush();
    await flush();
    expect(store.getState().files[0].status).toBe("ready");
    expect(api.fileDiff).toHaveBeenLastCalledWith("C:/repo", "abc123", expect.anything(), true);
  });

  it("re-reads a viewed unchanged file, keeping its contents meanwhile", async () => {
    const { api, store, watcher } = await opened();
    store.getState().openTreePath("README.md");
    await flush();
    const shown = viewed(store.getState())?.load;
    expect(shown).toEqual({ status: "ready", content: "x\n" });
    const pending = deferred<{ kind: "text"; content: string }>();
    vi.mocked(api.viewFile).mockReturnValueOnce(pending.promise);
    watcher.changed();
    await flush();
    expect(viewed(store.getState())?.load).toBe(shown);
    pending.resolve({ kind: "text", content: "y\n" });
    await flush();
    expect(viewed(store.getState())?.load).toEqual({ status: "ready", content: "y\n" });
  });

  it("shows a viewed file's diff once it changes", async () => {
    const { api, store, watcher } = await opened();
    store.getState().openTreePath("README.md");
    await flush();
    vi.mocked(api.listChanges).mockResolvedValueOnce(changeSet([summary(0, "a.ts"), summary(1, "README.md")]));
    watcher.changed();
    await flush();
    await flush();
    expect(store.getState().activePath).toBe("README.md");
    expect(store.getState().selectedId).toBe(1);
    expect(viewed(store.getState())).toBeNull();
    expect(store.getState().files[1]?.status).toBe("ready");
  });

  it("picks up files created by a terminal command without a refresh", async () => {
    const { api, store, watcher } = await opened();
    store.getState().toggleTerminal();
    await flush();
    vi.mocked(api.listChanges).mockResolvedValueOnce(
      changeSet([summary(0, "a.ts"), summary(1, "b.ts"), summary(2, "made-by-shell.txt", { status: "untracked" })]),
    );
    watcher.changed();
    await flush();
    await flush();
    expect(store.getState().changes?.files.map((f) => f.newPath)).toContain("made-by-shell.txt");
    expect(api.terminalWrite).not.toHaveBeenCalled();
  });
});
