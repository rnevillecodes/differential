import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import type { Api } from "../api";
import { createAppStore } from "../store";
import { changeSet, fakeApi, fakeWatcher, flush, memoryStorage, summary } from "../test/fixtures";

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
    expect(store.getState().activePath).toBe("src/ui/b.tsx");
    fireEvent.click(row("src"));
    expect(within(screen.getByRole("tree")).queryByText("a.ts")).toBeNull();
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

  it("collapses every folder from the root header", async () => {
    await renderApp();
    fireEvent.click(row("ui"));
    expect(row("ui")).toHaveAttribute("aria-expanded", "true");
    const button = screen.getByRole("button", { name: "Collapse all folders" });
    fireEvent.click(button);
    expect(treeRows().map((r) => r.querySelector(".tree-name")!.textContent)).toEqual([
      "assets",
      "src",
      "big.log",
      "README.md",
    ]);
    expect(button).toBeDisabled();
    // Re-expanding a folder shows its children collapsed too.
    fireEvent.click(row("src"));
    expect(row("ui")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows folder icons instead of carets, and no icon on files", async () => {
    await renderApp();
    const icon = (name: string) => row(name).querySelector(".tree-icon svg")?.getAttribute("data-icon") ?? null;
    expect(icon("src")).toBe("folder-open");
    expect(icon("assets")).toBe("folder-closed");
    expect(icon("ui")).toBe("folder-closed");
    expect(icon("a.ts")).toBeNull();
    expect(row("a.ts").querySelector(".tree-icon")).not.toBeNull();
    for (const r of treeRows()) expect(r.textContent).not.toMatch(/[▸▾]/);
    fireEvent.click(row("ui"));
    expect(icon("ui")).toBe("folder-open");
  });

  it("offers a collapse-subtree toggle only on open folders with open folders below", async () => {
    const { store } = await renderApp();
    const toggle = (name: string) => within(row(name)).queryByRole("button", { name: "Collapse folder and subfolders" });
    // `src` is open but nothing below it is.
    expect(toggle("src")).toBeNull();
    fireEvent.click(row("ui"));
    expect(toggle("src")).not.toBeNull();
    expect(toggle("ui")).toBeNull();
    expect(toggle("assets")).toBeNull();
    expect(toggle("README.md")).toBeNull();
    // Every row keeps the slot, so badges stay aligned.
    for (const r of treeRows()) expect(r.querySelector(".subtree-slot")).not.toBeNull();

    fireEvent.click(toggle("src")!);
    expect(row("src")).toHaveAttribute("aria-expanded", "false");
    expect(store.getState().activePath).toBe("src/a.ts");
    fireEvent.click(row("src"));
    expect(row("ui")).toHaveAttribute("aria-expanded", "false");
  });

  it("collapses a subtree with Shift+Left, and plain Left still remembers subfolders", async () => {
    const { store } = await renderApp();
    const tree = screen.getByRole("tree");
    fireEvent.click(row("ui")); // expands ui, cursor on ui
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    expect(row("src")).toHaveClass("active");

    // Plain Left collapses only `src`; reopening shows `ui` still open.
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(row("ui")).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(tree, { key: "ArrowLeft", shiftKey: true });
    expect(row("src")).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(row("ui")).toHaveAttribute("aria-expanded", "false");

    // On a file, Shift+Left does nothing.
    fireEvent.click(row("ui"));
    fireEvent.click(row("b.tsx"));
    const expanded = store.getState().expanded;
    fireEvent.keyDown(tree, { key: "ArrowLeft", shiftKey: true });
    expect(store.getState().expanded).toBe(expanded);
    expect(row("b.tsx")).toHaveClass("active");
  });

  it("marks the tree as focused only while it holds focus", async () => {
    await renderApp();
    const tree = screen.getByRole("tree");
    expect(tree).not.toHaveClass("tree-focused");
    fireEvent.focus(tree);
    expect(tree).toHaveClass("tree-focused");
    // Focus moving within the tree is not a blur.
    fireEvent.blur(tree, { relatedTarget: row("a.ts") });
    expect(tree).toHaveClass("tree-focused");
    fireEvent.blur(tree, { relatedTarget: document.body });
    expect(tree).not.toHaveClass("tree-focused");
    // The cursor position survives the blur.
    expect(row("a.ts")).toHaveClass("active");
    expect(row("a.ts")).toHaveAttribute("aria-selected", "true");
  });

  it("offers no controls that modify files", async () => {
    await renderApp();
    const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    for (const word of ["Delete", "Rename", "New", "Stage", "Commit", "Discard", "Revert", "Save"]) {
      expect(labels.some((l) => l.includes(word))).toBe(false);
    }
  });
});

describe("sidebar empty states", () => {
  it("prompts to open a repository on both tabs when none is open", async () => {
    const store = createAppStore(explorerApi(), memoryStorage());
    render(<App store={store} />);
    const nav = screen.getByRole("navigation", { name: "Changed files" });
    expect(within(nav).getByText("No repository open")).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole("button", { name: "Open a repository…" }));
    expect(store.getState().repoPickerOpen).toBe(true);
    act(() => store.getState().setRepoPickerOpen(false));
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(
      within(screen.getByRole("navigation", { name: "Project files" })).getByText("No repository open"),
    ).toBeInTheDocument();
  });

  it("says when there are no changes", async () => {
    await renderApp(explorerApi({ listChanges: vi.fn(async () => changeSet([])) }), "changes");
    const nav = screen.getByRole("navigation", { name: "Changed files" });
    expect(within(nav).getByText("No changed files")).toBeInTheDocument();
    expect(nav).toHaveTextContent("Nothing differs from HEAD.");
  });

  it("says when the repository has no files", async () => {
    await renderApp(
      explorerApi({ listChanges: vi.fn(async () => changeSet([])), listFiles: vi.fn(async () => []) }),
    );
    expect(within(screen.getByRole("navigation", { name: "Project files" })).getByText("No files")).toBeInTheDocument();
  });

  it("offers a retry when the listing fails", async () => {
    const api = explorerApi({ listFiles: vi.fn(async () => Promise.reject({ kind: "git", message: "boom" })) });
    await renderApp(api);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not list files");
    vi.mocked(api.listFiles).mockResolvedValueOnce(PROJECT);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await flush();
    });
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });
});

describe("sidebar toggle", () => {
  it("hides and shows the sidebar from the toolbar and Ctrl+B, and remembers it", async () => {
    const storage = memoryStorage();
    const store = createAppStore(explorerApi(), storage);
    render(<App store={store} />);
    const toggle = screen.getByRole("button", { name: "Sidebar" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(createAppStore(explorerApi(), storage).getState().sidebarOpen).toBe(false);
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });
});

describe("editor tabs", () => {
  const tabNames = () => screen.getAllByTestId("editor-tab").map((t) => t.querySelector(".editor-tab-name")!.textContent);

  it("keeps several files open and switches between them", async () => {
    const { store } = await renderApp();
    fireEvent.doubleClick(row("a.ts"));
    fireEvent.click(row("README.md"));
    await act(flush);
    expect(tabNames()).toEqual(["a.ts", "README.md"]);
    expect(screen.getByRole("tab", { name: "README.md" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "README.md" }).parentElement).toHaveClass("preview");
    // Both panels stay mounted; only the active one is interactive.
    const diff = screen.getByLabelText("Diff of src/a.ts");
    expect(diff.closest("[role=tabpanel]")).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("tab", { name: /a\.ts/ }));
    expect(store.getState().selectedId).toBe(0);
    expect(screen.getByLabelText("Diff of src/a.ts")).toBe(diff);
    expect(diff.closest("[role=tabpanel]")).not.toHaveAttribute("inert");
  });

  it("closes tabs with the close button, middle-click and Ctrl+W", async () => {
    const { store } = await renderApp();
    fireEvent.doubleClick(row("a.ts"));
    fireEvent.doubleClick(row("README.md"));
    fireEvent.doubleClick(row("big.log"));
    await act(flush);
    fireEvent.click(screen.getByRole("button", { name: "Close README.md" }));
    expect(tabNames()).toEqual(["a.ts", "big.log"]);
    fireEvent(screen.getAllByTestId("editor-tab")[0], new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(tabNames()).toEqual(["big.log"]);
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(screen.queryAllByTestId("editor-tab")).toHaveLength(0);
    expect(store.getState().activePath).toBeNull();
    expect(screen.getByText("No file open")).toBeInTheDocument();
  });

  it("moves between tabs with the keyboard", async () => {
    const { store } = await renderApp();
    fireEvent.doubleClick(row("a.ts"));
    fireEvent.doubleClick(row("README.md"));
    await act(flush);
    fireEvent.keyDown(screen.getByRole("tab", { name: "README.md" }), { key: "ArrowLeft" });
    expect(store.getState().activePath).toBe("src/a.ts");
    expect(screen.getByRole("tab", { name: /a\.ts/ })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    expect(store.getState().activePath).toBe("README.md");
    fireEvent.keyDown(screen.getByRole("tab", { name: "README.md" }), { key: "Delete" });
    expect(tabNames()).toEqual(["a.ts"]);
  });

  it("shows the folder for tabs with the same name", async () => {
    const { store } = await renderApp(explorerApi({ listFiles: vi.fn(async () => [...PROJECT, "lib/a.ts"]) }));
    act(() => {
      store.getState().select(0, true);
      store.getState().openTreePath("lib/a.ts", true);
      store.getState().openTreePath("README.md", true);
    });
    await act(flush);
    const dirs = screen.getAllByTestId("editor-tab").map((t) => t.querySelector(".editor-tab-dir")?.textContent ?? "");
    expect(dirs).toEqual(["src", "lib", ""]);
  });
});

describe("unchanged file view", () => {
  it("shows contents with line numbers", async () => {
    const { store } = await renderApp();
    fireEvent.click(row("ui"));
    await act(async () => {
      fireEvent.click(row("c.tsx"));
      await flush();
    });
    expect(store.getState().selectedId).toBeNull();
    expect(screen.getByLabelText("Contents of src/ui/c.tsx")).toHaveTextContent("unchanged");
    const lines = screen.getAllByTestId("file-line");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent("1first src/ui/c.tsx");
    expect(lines[1]).toHaveTextContent("2second");
    expect(row("c.tsx")).toHaveAttribute("aria-selected", "true");
    // Only Markdown files offer a rendered view.
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
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

describe("automatic updates in the tree", () => {
  it("shows a new file without the user acting, keeping open folders and scroll", async () => {
    const watcher = fakeWatcher();
    const api = explorerApi(watcher.api);
    const { store } = await renderApp(api);
    act(() => {
      store.getState().setFolderExpanded("src", true);
      store.getState().setFolderExpanded("src/ui", true);
    });
    const tree = screen.getByRole("tree");
    tree.scrollTop = 24;
    const expandedBefore = store.getState().expanded;

    vi.mocked(api.listFiles).mockResolvedValue([...PROJECT, "src/ui/d.tsx"]);
    vi.mocked(api.listChanges).mockResolvedValue(
      changeSet([
        summary(0, "src/a.ts"),
        summary(1, "src/ui/b.tsx", { status: "untracked", oldPath: null }),
        summary(2, "src/ui/d.tsx", { status: "untracked", oldPath: null }),
      ]),
    );
    await act(async () => {
      watcher.changed();
      await flush();
      await flush();
    });

    expect(within(row("d.tsx")).getByLabelText("untracked")).toBeInTheDocument();
    expect([...store.getState().expanded].sort()).toEqual([...expandedBefore].sort());
    expect(screen.getByRole("tree")).toBe(tree);
    expect(tree.scrollTop).toBe(24);
  });
});
