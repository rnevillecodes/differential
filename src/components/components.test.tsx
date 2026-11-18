import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { createAppStore } from "../store";
import { add, changeSet, ctx, fakeApi, fileDiff, flush, hunk, memoryStorage, rem, summary } from "../test/fixtures";

async function renderApp(api = fakeApi()) {
  const store = createAppStore(api, memoryStorage());
  await act(async () => {
    await store.getState().openPath("C:/repo");
    await flush();
  });
  const utils = render(<App store={store} />);
  await act(flush);
  return { store, api, ...utils };
}

describe("file list", () => {
  it("renders every status with its counts, and old → new for renames", async () => {
    const api = fakeApi({
      listChanges: vi.fn(async () =>
        changeSet([
          summary(0, "src/mod.ts", { additions: 3, deletions: 2 }),
          summary(1, "src/new.ts", { status: "untracked", oldPath: null, additions: 7, deletions: 0 }),
          summary(2, "lib/moved.ts", { status: "renamed", oldPath: "src/old.ts" }),
          summary(3, "gone.ts", { status: "deleted", newPath: null }),
          summary(4, "added.ts", { status: "added", oldPath: null }),
          summary(5, "img.png", { isBinary: true }),
          summary(6, "lock.json", { isLarge: true }),
        ]),
      ),
    });
    await renderApp(api);
    const rows = screen.getAllByTestId("file-row");
    expect(rows).toHaveLength(7);
    expect(within(rows[0]).getByLabelText("modified")).toHaveTextContent("M");
    expect(rows[0]).toHaveTextContent("+3");
    expect(rows[0]).toHaveTextContent("−2");
    expect(within(rows[1]).getByLabelText("untracked")).toHaveTextContent("U");
    expect(rows[2]).toHaveTextContent("src/old.ts → lib/moved.ts");
    expect(within(rows[3]).getByLabelText("deleted")).toHaveTextContent("D");
    expect(within(rows[4]).getByLabelText("added")).toHaveTextContent("A");
    expect(rows[5]).toHaveTextContent("binary");
    expect(rows[6]).toHaveTextContent("large");
    expect(screen.getByText("7 files")).toBeInTheDocument();
  });

  it("selects files by click and with ] / [", async () => {
    const { store } = await renderApp();
    const rows = screen.getAllByTestId("file-row");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(rows[1]);
    expect(store.getState().selectedId).toBe(1);
    fireEvent.keyDown(window, { key: "[" });
    expect(store.getState().selectedId).toBe(0);
    fireEvent.keyDown(window, { key: "]" });
    expect(store.getState().selectedId).toBe(1);
    expect(screen.getAllByTestId("file-row")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("does not navigate while typing in the base search", async () => {
    const { store } = await renderApp();
    fireEvent.click(screen.getByRole("button", { name: /^Base/ }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search branches and tags" }), { key: "]" });
    expect(store.getState().selectedId).toBe(0);
  });

  it("toggles the view with Ctrl+\\ and refreshes with Ctrl+R", async () => {
    const { store, api } = await renderApp();
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(store.getState().viewMode).toBe("split");
    await act(async () => {
      fireEvent.keyDown(window, { key: "r", ctrlKey: true });
      await flush();
    });
    expect(api.listChanges).toHaveBeenCalledTimes(2);
  });
});

describe("diff view", () => {
  const diffApi = () =>
    fakeApi({
      listChanges: vi.fn(async () => changeSet([summary(0, "a.ts")])),
      fileDiff: vi.fn(async () =>
        fileDiff([
          hunk(1, 2, 1, 2, [
            rem("const timeout = 30;", 1, [{ start: 16, end: 18 }]),
            add("const timeout = 60;", 1, [{ start: 16, end: 18 }]),
            ctx("keep", 2, 2),
          ]),
        ]),
      ),
      fileContent: vi.fn(async (_r, _s, _p, side) =>
        side === "base" ? "const timeout = 30;\nkeep\nmore\n" : "const timeout = 60;\nkeep\nmore\n",
      ),
    });

  it("highlights only the changed word", async () => {
    await renderApp(diffApi());
    const rows = screen.getAllByTestId("diff-row");
    const removed = rows.find((r) => r.classList.contains("removed"))!;
    const added = rows.find((r) => r.classList.contains("added"))!;
    expect([...removed.querySelectorAll(".ix")].map((e) => e.textContent)).toEqual(["30"]);
    expect([...added.querySelectorAll(".ix")].map((e) => e.textContent)).toEqual(["60"]);
    expect(added).toHaveTextContent("const timeout = 60;");
  });

  it("shows a trailing gap that expands", async () => {
    await renderApp(diffApi());
    const gap = screen.getByTestId("gap-row");
    expect(gap).toHaveTextContent("1 hidden line");
    fireEvent.click(within(gap).getByText("Expand all"));
    expect(screen.queryByTestId("gap-row")).toBeNull();
    expect(screen.getAllByTestId("diff-row").at(-1)).toHaveTextContent("more");
  });

  it("renders paired rows in split view", async () => {
    const { store } = await renderApp(diffApi());
    act(() => store.getState().setViewMode("split"));
    const first = screen.getAllByTestId("diff-row")[0];
    expect(first.querySelector(".cell.left")).toHaveTextContent("const timeout = 30;");
    expect(first.querySelector(".cell.right")).toHaveTextContent("const timeout = 60;");
  });

  it("shows binary and large placeholders, and loads large files on request", async () => {
    const api = fakeApi({
      listChanges: vi.fn(async () =>
        changeSet([summary(0, "img.png", { isBinary: true }), summary(1, "big.json", { isLarge: true })]),
      ),
      fileDiff: vi.fn(async () => fileDiff([hunk(1, 1, 1, 1, [rem("a", 1), add("b", 1)])])),
    });
    const { store } = await renderApp(api);
    expect(screen.getByTestId("binary-placeholder")).toHaveTextContent("binary");
    act(() => store.getState().select(1));
    fireEvent.click(screen.getByText("Load diff anyway"));
    await act(flush);
    expect(api.fileDiff).toHaveBeenCalledWith("C:/repo", "abc123", expect.objectContaining({ id: 1 }), true);
    expect(screen.getAllByTestId("diff-row")).toHaveLength(2);
  });

  it("shows the empty state for a clean tree", async () => {
    await renderApp(fakeApi({ listChanges: vi.fn(async () => changeSet([])) }));
    expect(screen.getByText("No changes")).toBeInTheDocument();
  });

  it("offers no controls that modify the repository", async () => {
    await renderApp(diffApi());
    const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    for (const label of labels) {
      expect(label).not.toMatch(/stage|commit|discard|revert|save|edit|delete/i);
    }
  });
});
