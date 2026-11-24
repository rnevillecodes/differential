import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App, { handleShortcut } from "./App";
import { createAppStore, currentBranch, MAX_ZOOM, MIN_ZOOM } from "./store";
import { fakeApi, fakeWatcher, flush, memoryStorage } from "./test/fixtures";

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent("keydown", { key: k, ctrlKey: true, ...mods });

describe("zoom", () => {
  it("starts at 100% without touching the webview", () => {
    const api = fakeApi();
    const store = createAppStore(api, memoryStorage());
    expect(store.getState().zoom).toBe(1);
    expect(api.setZoom).not.toHaveBeenCalled();
  });

  it("restores and applies a saved zoom, ignoring out-of-range values", () => {
    const api = fakeApi();
    expect(createAppStore(api, memoryStorage({ "differential.zoom": "1.25" })).getState().zoom).toBe(1.25);
    expect(api.setZoom).toHaveBeenCalledWith(1.25);
    expect(createAppStore(fakeApi(), memoryStorage({ "differential.zoom": "9" })).getState().zoom).toBe(1);
    expect(createAppStore(fakeApi(), memoryStorage({ "differential.zoom": "x" })).getState().zoom).toBe(1);
  });

  it("steps through levels, clamps at the ends, persists and resets", () => {
    const api = fakeApi();
    const storage = memoryStorage();
    const store = createAppStore(api, storage);
    store.getState().zoomIn();
    expect(store.getState().zoom).toBe(1.1);
    expect(api.setZoom).toHaveBeenLastCalledWith(1.1);
    expect(storage.data["differential.zoom"]).toBe("1.1");
    for (let i = 0; i < 20; i++) store.getState().zoomIn();
    expect(store.getState().zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 20; i++) store.getState().zoomOut();
    expect(store.getState().zoom).toBe(MIN_ZOOM);
    store.getState().resetZoom();
    expect(store.getState().zoom).toBe(1);
    expect(storage.data["differential.zoom"]).toBe("1");
  });

  it("snaps an off-grid saved zoom to the neighbouring level", () => {
    const store = createAppStore(fakeApi(), memoryStorage({ "differential.zoom": "1.2" }));
    store.getState().zoomIn();
    expect(store.getState().zoom).toBe(1.25);
    const off = createAppStore(fakeApi(), memoryStorage({ "differential.zoom": "1.2" }));
    off.getState().zoomOut();
    expect(off.getState().zoom).toBe(1.1);
  });

  it("handles Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0", () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    expect(handleShortcut(key("="), store.getState())).toBe(true);
    expect(store.getState().zoom).toBe(1.1);
    expect(handleShortcut(key("+", { shiftKey: true }), store.getState())).toBe(true);
    expect(store.getState().zoom).toBe(1.25);
    expect(handleShortcut(key("-"), store.getState())).toBe(true);
    expect(store.getState().zoom).toBe(1.1);
    expect(handleShortcut(key("0"), store.getState())).toBe(true);
    expect(store.getState().zoom).toBe(1);
  });

  it("zooms from the toolbar control", () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    render(<App store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: /Zoom 110%/ })).toHaveTextContent("110%");
    fireEvent.click(screen.getByRole("button", { name: /Zoom 110%/ }));
    expect(store.getState().zoom).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(store.getState().zoom).toBe(0.9);
  });
});

describe("current branch", () => {
  it("derives the branch from the refs", () => {
    expect(currentBranch(null)).toBeNull();
    expect(currentBranch([])).toBe("");
    expect(currentBranch([{ name: "dev", rev: "dev", kind: "local", current: true }])).toBe("dev");
  });

  it("shows the checked-out branch in the toolbar", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    render(<App store={store} />);
    expect(screen.queryByRole("status", { name: /Current branch/ })).toBeNull();
    await act(() => store.getState().openPath("/repo"));
    expect(screen.getByRole("status", { name: "Current branch: feature" })).toHaveTextContent("feature");
  });

  it("shows detached HEAD and updates on refresh", async () => {
    const api = fakeApi({ listRefs: async () => [{ name: "main", rev: "main", kind: "local", current: false }] });
    const store = createAppStore(api, memoryStorage());
    render(<App store={store} />);
    await act(() => store.getState().openPath("/repo"));
    expect(screen.getByRole("status", { name: "HEAD is detached" })).toHaveTextContent("detached HEAD");
    api.listRefs = async () => [{ name: "main", rev: "main", kind: "local", current: true }];
    await act(() => store.getState().refresh());
    expect(screen.getByRole("status", { name: "Current branch: main" })).toBeInTheDocument();
  });
});

describe("automatic updates notice", () => {
  async function renderWith(api = fakeApi()) {
    const store = createAppStore(api, memoryStorage());
    await act(async () => {
      await store.getState().openPath("C:/repo");
      await flush();
    });
    render(<App store={store} />);
    return store;
  }

  it("is not shown while the repository is watched", async () => {
    await renderWith();
    expect(screen.queryByText("Automatic updates unavailable")).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("shows the reason when watching is unavailable, and Refresh still works", async () => {
    const watcher = fakeWatcher();
    const api = fakeApi({ ...watcher.api });
    await renderWith(api);
    act(() => watcher.emit({ kind: "unavailable", message: "The repository folder no longer exists." }));
    const notice = screen.getByText("Automatic updates unavailable");
    expect(notice).toHaveAttribute("title", expect.stringContaining("The repository folder no longer exists."));
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).toBeEnabled();
    vi.mocked(api.listChanges).mockClear();
    await act(async () => {
      fireEvent.click(refresh);
      await flush();
    });
    expect(api.listChanges).toHaveBeenCalledTimes(1);
  });

  it("shows when watching could not start", async () => {
    await renderWith(
      fakeApi({
        watchRepo: vi.fn(async () => {
          throw { kind: "io", message: "File changes on this drive can't be watched." };
        }),
      }),
    );
    expect(screen.getByText("Automatic updates unavailable")).toHaveAttribute(
      "title",
      expect.stringContaining("File changes on this drive can't be watched."),
    );
  });
});
