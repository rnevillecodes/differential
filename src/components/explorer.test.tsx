import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import type { Api } from "../api";
import { createAppStore } from "../store";
import { changeSet, fakeApi, flush, memoryStorage, summary } from "../test/fixtures";

const PROJECT = ["README.md", "src/a.ts", "src/ui/b.tsx", "src/ui/c.tsx", "assets/logo.png", "big.log"];

function explorerApi(over: Partial<Api> = {}) {
  return fakeApi({
    listChanges: vi.fn(async () =>
      changeSet([summary(0, "src/a.ts"), summary(1, "src/ui/b.tsx", { status: "untracked", oldPath: null })]),
    ),
    listFiles: vi.fn(async () => PROJECT),
    viewFile: vi.fn(async (_root: string, path: string, force: boolean) => {
      if (path.endsWith(".png")) return { kind: "binary" as const };
      if (path === "big.log" && !force) return { kind: "large" as const, size: 3 * 1024 * 1024 };
      if (path === "gone.md") return { kind: "missing" as const };
      return { kind: "text" as const, content: `first ${path}\nsecond\n` };
    }),
    ...over,
  });
}

async function renderApp(api = explorerApi(), tab: "changes" | "files" = "files") {
  const store = createAppStore(api, memoryStorage({ "differential.sidebarTab": tab }));
  await act(async () => {
    await store.getState().openPath("C:/repo");
    await flush();
  });
  const utils = render(<App store={store} />);
  await act(flush);
  return { store, api, ...utils };
}

const treeRows = () => screen.getAllByTestId("tree-row");
const row = (name: string) => treeRows().find((r) => within(r).queryByText(name, { selector: ".tree-name" }))!;

describe("sidebar tabs", () => {
  it("switches to the tree without changing the main pane", async () => {
    const { store } = await renderApp(explorerApi(), "changes");
    expect(screen.getAllByTestId("file-row")).toHaveLength(2);
    const header = screen.getByLabelText("Diff of src/a.ts");
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      await flush();
    });
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tree")).toBeInTheDocument();
    expect(screen.getByLabelText("Diff of src/a.ts")).toBe(header);
    expect(store.getState().selectedId).toBe(0);
  });
});

describe("project tree", () => {
  it("shows folders first, change markers, and nested change counts", async () => {
    await renderApp();
    // The selected file (src/a.ts) is revealed, so `src` is expanded.
    expect(treeRows().map((r) => r.querySelector(".tree-name")!.textContent)).toEqual([
      "assets",
      "src",
      "ui",
      "a.ts",
      "big.log",
      "README.md",
    ]);
    expect(within(row("src")).getByTitle("2 changed files")).toHaveTextContent("2");
    expect(within(row("ui")).getByTitle("1 changed file")).toHaveTextContent("1");
    expect(within(row("a.ts")).getByLabelText("modified")).toHaveTextContent("M");
    expect(row("a.ts")).toHaveAttribute("aria-selected", "true");
    expect(row("README.md").querySelector(".status")).toBeNull();
    expect(row("assets").querySelector(".tree-count")).toBeNull();
  });

  it("toggles folders and opens changed files as diffs", async () => {
    const { store } = await renderApp();
    fireEvent.click(row("ui"));
    expect(row("ui")).toHaveAttribute("aria-expanded", "true");
    expect(within(row("b.tsx")).getByLabelText("untracked")).toBeInTheDocument();
    fireEvent.click(row("b.tsx"));
    expect(store.getState().selectedId).toBe(1);
    expect(store.getState().viewed).toBeNull();
    fireEvent.click(row("src"));
    expect(screen.queryByText("a.ts")).toBeNull();
  });

  it("supports keyboard navigation", async () => {
    const { store } = await renderApp();
    const tree = screen.getByRole("tree");
    // Cursor starts on the selected file a.ts; go up to the collapsed `ui` folder.
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    expect(row("ui")).toHaveClass("active");
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(row("ui")).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(row("b.tsx")).toHaveClass("active");
    fireEvent.keyDown(tree, { key: "Enter" });
    expect(store.getState().selectedId).toBe(1);
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(row("c.tsx")).toHaveClass("active");
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(row("ui")).toHaveClass("active");
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(row("ui")).toHaveAttribute("aria-expanded", "false");
    // ] / [ still move through changed files while the tree has focus.
    fireEvent.keyDown(tree, { key: "[" });
    expect(store.getState().selectedId).toBe(0);
  });

  it("reveals a file selected in the Changes list when switching to Files", async () => {
    const { store } = await renderApp(explorerApi(), "changes");
    act(() => store.getState().select(1));
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      await flush();
    });
    expect(row("ui")).toHaveAttribute("aria-expanded", "true");
    expect(row("b.tsx")).toHaveAttribute("aria-selected", "true");
  });

  it("offers no controls that modify files", async () => {
    await renderApp();
    const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    for (const word of ["Delete", "Rename", "New", "Stage", "Commit", "Discard", "Revert", "Save"]) {
      expect(labels.some((l) => l.includes(word))).toBe(false);
    }
  });
});

describe("unchanged file view", () => {
  it("shows contents with line numbers", async () => {
    const { store } = await renderApp();
    await act(async () => {
      fireEvent.click(row("README.md"));
      await flush();
    });
    expect(store.getState().selectedId).toBeNull();
    expect(screen.getByLabelText("Contents of README.md")).toHaveTextContent("unchanged");
    const lines = screen.getAllByTestId("file-line");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent("1first README.md");
    expect(lines[1]).toHaveTextContent("2second");
    expect(row("README.md")).toHaveAttribute("aria-selected", "true");
    // In the Changes list, nothing is selected.
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    for (const r of screen.getAllByTestId("file-row")) expect(r).toHaveAttribute("aria-selected", "false");
  });

  it("shows a binary placeholder", async () => {
    await renderApp();
    fireEvent.click(row("assets"));
    await act(async () => {
      fireEvent.click(row("logo.png"));
      await flush();
    });
    expect(screen.getByTestId("binary-placeholder")).toHaveTextContent("Binary file");
  });

  it("shows a large placeholder and loads on request", async () => {
    const { api } = await renderApp();
    await act(async () => {
      fireEvent.click(row("big.log"));
      await flush();
    });
    expect(screen.getByTestId("large-placeholder")).toHaveTextContent("3.0 MB");
    await act(async () => {
      fireEvent.click(screen.getByText("Load file anyway"));
      await flush();
    });
    expect(api.viewFile).toHaveBeenLastCalledWith("C:/repo", "big.log", true);
    expect(screen.getAllByTestId("file-line")[0]).toHaveTextContent("first big.log");
  });

  it("shows a refresh hint for a file that vanished", async () => {
    const api = explorerApi({ listFiles: vi.fn(async () => [...PROJECT, "gone.md"]) });
    await renderApp(api);
    await act(async () => {
      fireEvent.click(row("gone.md"));
      await flush();
    });
    expect(screen.getByTestId("missing-placeholder")).toHaveTextContent("Refresh");
  });
});
