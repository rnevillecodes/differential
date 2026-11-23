import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App, { handleShortcut } from "../App";
import type { Api } from "../api";
import { createAppStore, GRAPH_PAGE_SIZE } from "../store";
import { changeSet, commit, fakeApi, flush, memoryStorage, summary } from "../test/fixtures";

async function renderApp({ api = fakeApi(), saved = {} as Record<string, string>, open = true } = {}) {
  const store = createAppStore(api, memoryStorage(saved));
  if (open) {
    await act(async () => {
      await store.getState().openPath("C:/repo");
      await flush();
    });
  }
  const utils = render(<App store={store} />);
  await act(flush);
  return { store, api, ...utils };
}

const pane = () => document.querySelector<HTMLElement>(".graph-pane");
const rows = () => screen.queryAllByTestId("commit-row");
const toggleButton = () => screen.getByRole("button", { name: "Commit graph" });
const ctrlG = (target: Window | Element = window) =>
  act(() => {
    fireEvent.keyDown(target, { key: "g", code: "KeyG", ctrlKey: true });
  });

describe("commit graph pane", () => {
  it("is toggled by the toolbar button, which shows whether it is open", async () => {
    await renderApp();
    expect(pane()).toBeNull();
    expect(toggleButton()).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.click(toggleButton());
      await flush();
    });
    expect(pane()).not.toBeNull();
    expect(toggleButton()).toHaveAttribute("aria-pressed", "true");
    await act(async () => fireEvent.click(toggleButton()));
    expect(pane()).toBeNull();
  });

  it("is toggled with Ctrl+G outside a terminal only", async () => {
    const { store } = await renderApp();
    await ctrlG();
    await act(flush);
    expect(pane()).not.toBeNull();
    await ctrlG();
    expect(pane()).toBeNull();

    const terminal = document.createElement("div");
    terminal.setAttribute("data-terminal", "");
    const input = document.createElement("textarea");
    terminal.appendChild(input);
    const event = new KeyboardEvent("keydown", { key: "g", code: "KeyG", ctrlKey: true });
    Object.defineProperty(event, "target", { value: input });
    expect(handleShortcut(event, store.getState())).toBe(false);
    expect(store.getState().graphOpen).toBe(false);
  });

  it("cannot be shown without a repository", async () => {
    await renderApp({ open: false });
    expect(toggleButton()).toBeDisabled();
    await ctrlG();
    expect(pane()).toBeNull();
  });

  it("shows one row per commit with short SHA, labels, subject and details on hover", async () => {
    await renderApp({ saved: { "differential.graphOpen": "true" } });
    expect(rows()).toHaveLength(2);
    const top = rows()[0];
    expect(top).toHaveTextContent("abc123");
    expect(top).toHaveTextContent("commit abc123");
    const chip = within(top).getByRole("button", { name: "main" });
    expect(chip).toHaveClass("ref-chip", "local");
    expect(top.title).toContain("Ada");
    expect(top.querySelector("circle")).not.toBeNull();
  });

  it("highlights the base commit and follows base changes", async () => {
    const api = fakeApi();
    const { store } = await renderApp({ api, saved: { "differential.graphOpen": "true" } });
    // The default change set's baseSha is abc123.
    expect(rows()[0]).toHaveAttribute("aria-selected", "true");
    expect(rows()[1]).toHaveAttribute("aria-selected", "false");
    vi.mocked(api.listChanges).mockResolvedValueOnce(changeSet([summary(0, "a.ts")], { baseRef: "main", baseSha: "def456" }));
    await act(async () => {
      await store.getState().setBase("main");
    });
    expect(rows()[0]).toHaveAttribute("aria-selected", "false");
    expect(rows()[1]).toHaveAttribute("aria-selected", "true");
  });

  it("sets the clicked commit as the base, or the clicked label's ref", async () => {
    const api = fakeApi();
    await renderApp({ api, saved: { "differential.graphOpen": "true" } });
    await act(async () => {
      fireEvent.click(rows()[1]);
      await flush();
    });
    expect(api.listChanges).toHaveBeenLastCalledWith("C:/repo", "def456");

    await act(async () => {
      fireEvent.keyDown(rows()[0], { key: "Enter" });
      await flush();
    });
    expect(api.listChanges).toHaveBeenLastCalledWith("C:/repo", "abc123");

    const calls = vi.mocked(api.listChanges).mock.calls.length;
    await act(async () => {
      fireEvent.click(within(rows()[0]).getByRole("button", { name: "main" }));
      await flush();
    });
    // Only the label's ref: the click does not also pick the row.
    expect(vi.mocked(api.listChanges).mock.calls.length).toBe(calls + 1);
    expect(api.listChanges).toHaveBeenLastCalledWith("C:/repo", "main");
  });

  it("says so when the repository has no commits", async () => {
    const api = fakeApi({ listCommits: vi.fn(async () => ({ commits: [], hasMore: false })) });
    await renderApp({ api, saved: { "differential.graphOpen": "true" } });
    expect(pane()).toHaveTextContent("No commits yet.");
  });

  it("shows a listing error in the pane", async () => {
    const api = fakeApi({
      listCommits: vi.fn(async () => {
        throw { kind: "git", message: "fatal: bad object" };
      }),
    });
    await renderApp({ api, saved: { "differential.graphOpen": "true" } });
    expect(within(pane()!).getByRole("alert")).toHaveTextContent("fatal: bad object");
    expect(screen.getAllByTestId("file-row")).toHaveLength(2);
  });

  it("loads the next page when scrolled near the end", async () => {
    const first = Array.from({ length: 60 }, (_, i) => commit(`c${i}`, [`c${i + 1}`]));
    const listCommits = vi.fn<Api["listCommits"]>(async (_root, offset) =>
      offset === 0 ? { commits: first, hasMore: true } : { commits: [commit("c60")], hasMore: false },
    );
    const { store } = await renderApp({ api: fakeApi({ listCommits }), saved: { "differential.graphOpen": "true" } });
    await act(flush);
    expect(listCommits).toHaveBeenCalledWith("C:/repo", 60, GRAPH_PAGE_SIZE);
    expect(store.getState().graph.rows).toHaveLength(61);
    // The lane continues across the page boundary.
    const boundary = store.getState().graph.rows[60];
    expect(boundary.lines).toEqual([{ kind: "in", from: 0, to: 0, color: 0 }]);
  });
});
