import { describe, expect, it, vi } from "vitest";
import { createAppStore } from "./store";
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

describe("project explorer state", () => {
  const exclusive = (s: { selectedId: number | null; viewed: unknown }) =>
    expect(s.selectedId !== null && s.viewed !== null).toBe(false);

  it("persists the sidebar tab and switching tabs keeps the main pane", async () => {
    const storage = memoryStorage();
    const store = createAppStore(fakeApi(), storage);
    expect(store.getState().sidebarTab).toBe("changes");
    await store.getState().openPath("C:/repo");
    store.getState().select(1);
    store.getState().setSidebarTab("files");
    expect(storage.data["differential.sidebarTab"]).toBe("files");
    expect(store.getState().selectedId).toBe(1);
    expect(store.getState().viewed).toBeNull();
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
    expect(store.getState().viewed?.load.status).toBe("loading");
    await flush();
    expect(api.viewFile).toHaveBeenCalledWith("C:/repo", "README.md", false);
    expect(store.getState().viewed).toEqual({ path: "README.md", load: { status: "ready", content: "x\n" } });
    store.getState().openTreePath("b.ts");
    exclusive(store.getState());
    expect(store.getState().selectedId).toBe(1);
    expect(store.getState().viewed).toBeNull();
  });

  it("next-file from a viewed file selects the first changed file", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    store.getState().openTreePath("README.md");
    store.getState().selectNext();
    exclusive(store.getState());
    expect(store.getState().selectedId).toBe(0);
    expect(store.getState().viewed).toBeNull();
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
    expect(store.getState().viewed?.load).toEqual({ status: "large", size: 3_000_000 });
    store.getState().loadViewedAnyway();
    await flush();
    expect(api.viewFile).toHaveBeenLastCalledWith("C:/repo", "big.log", true);
    expect(store.getState().viewed?.load).toEqual({ status: "ready", content: "big\n" });
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
    expect(store.getState().viewed?.path).toBe("README.md");
    expect(api.viewFile).toHaveBeenCalledTimes(2);
    vi.mocked(api.listFiles).mockResolvedValueOnce(["a.ts", "b.ts"]);
    await store.getState().refresh();
    expect(store.getState().viewed).toBeNull();
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
    expect(store.getState().viewed).toBeNull();
  });
});
