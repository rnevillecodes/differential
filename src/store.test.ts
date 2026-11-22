import { describe, expect, it, vi } from "vitest";
import { createAppStore, DEFAULT_TERMINAL_HEIGHT, MIN_TERMINAL_HEIGHT, type AppState } from "./store";
import type { TerminalSessionEvents } from "./terminal/sessions";
import { changeSet, fakeApi, flush, memoryStorage, summary } from "./test/fixtures";

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
