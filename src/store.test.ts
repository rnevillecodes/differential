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

  it("prompts for a folder at init without a path", async () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    await store.getState().init();
    expect(api.pickFolder).toHaveBeenCalled();
    expect(api.openRepo).not.toHaveBeenCalled();
    expect(store.getState().repo).toBeNull();
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
