import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { createAppStore } from "../store";
import { fakeApi, flush, memoryStorage } from "../test/fixtures";
import { FakeTerminal } from "../test/xtermMock";

async function renderApp({ open = true, saved = {} as Record<string, string> } = {}) {
  const api = fakeApi({ terminalSpawn: vi.fn(async () => 42) });
  const storage = memoryStorage(saved);
  const store = createAppStore(api, storage);
  if (open) {
    await act(async () => {
      await store.getState().openPath("C:/repo");
      await flush();
    });
  }
  const utils = render(<App store={store} />);
  await act(flush);
  return { store, api, storage, ...utils };
}

const toggleKey = (target: Window | Element = window) =>
  act(() => {
    fireEvent.keyDown(target, { key: "`", code: "Backquote", ctrlKey: true });
  });

const terminalTabs = () => screen.queryAllByTestId("terminal-tab");
const panel = () => document.querySelector<HTMLElement>(".terminal-panel");

describe("terminal panel", () => {
  it("is shown with Ctrl+` and starts a shell in the repository root", async () => {
    const { api } = await renderApp();
    expect(panel()).toBeNull();
    await toggleKey();
    await act(flush);
    expect(panel()).toBeVisible();
    expect(terminalTabs()).toHaveLength(1);
    expect(terminalTabs()[0]).toHaveTextContent("Terminal 1");
    expect(api.terminalSpawn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.terminalSpawn).mock.calls[0][0]).toBe("C:/repo");
    expect(FakeTerminal.instances[0].focused).toBe(true);
  });

  it("hides with Ctrl+` from inside a terminal and keeps the shell", async () => {
    const { api } = await renderApp();
    await toggleKey();
    const body = document.querySelector("[data-terminal]")!;
    await toggleKey(body);
    expect(panel()).not.toBeVisible();
    expect(api.terminalClose).not.toHaveBeenCalled();
    await toggleKey();
    expect(panel()).toBeVisible();
    expect(api.terminalSpawn).toHaveBeenCalledTimes(1);
  });

  it("creates, switches and closes terminals; closing the last hides the panel", async () => {
    const { api } = await renderApp();
    await toggleKey();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
      await flush();
    });
    expect(terminalTabs()).toHaveLength(2);
    const hosts = screen.getAllByTestId("terminal-host");
    expect(hosts[0]).not.toBeVisible();
    expect(hosts[1]).toBeVisible();

    fireEvent.click(within(terminalTabs()[0]).getByRole("tab"));
    expect(screen.getAllByTestId("terminal-host")[0]).toBeVisible();
    expect(within(terminalTabs()[0]).getByRole("tab")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Close Terminal 1" }));
    expect(terminalTabs()).toHaveLength(1);
    expect(api.terminalClose).toHaveBeenCalledWith(42);

    act(() => {
      fireEvent(terminalTabs()[0], new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    });
    expect(panel()).toBeNull();
    expect(api.terminalClose).toHaveBeenCalledTimes(2);
  });

  it("hides with its own hide button", async () => {
    await renderApp();
    await toggleKey();
    fireEvent.click(screen.getByRole("button", { name: "Hide terminal panel" }));
    expect(panel()).not.toBeVisible();
  });

  it("closes a tab when its shell exits, hiding the panel after the last", async () => {
    let exits: ((e: { code: number | null }) => void)[] = [];
    const api = fakeApi({
      terminalSpawn: vi.fn(async (_cwd, _c, _r, _d, onExit) => {
        exits.push(onExit);
        return exits.length;
      }),
    });
    const store = createAppStore(api, memoryStorage());
    await act(async () => {
      await store.getState().openPath("C:/repo");
    });
    render(<App store={store} />);
    await toggleKey();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
      await flush();
    });
    expect(terminalTabs()).toHaveLength(2);
    act(() => exits[0]({ code: 0 }));
    expect(terminalTabs()).toHaveLength(1);
    expect(terminalTabs()[0]).toHaveTextContent("Terminal 2");
    act(() => exits[1]({ code: 1 }));
    expect(panel()).toBeNull();
    exits = [];
  });

  it("marks terminals whose shell failed to start", async () => {
    const { store } = await renderApp();
    await toggleKey();
    act(() => {
      store.setState({
        terminals: store.getState().terminals.map((t) => ({ ...t, status: { kind: "failed", message: "nope" } })),
      });
    });
    expect(terminalTabs()[0]).toHaveTextContent("(failed)");
  });

  it("maximizes over the file pane and restores to its height", async () => {
    await renderApp({ saved: { "differential.terminalOpen": "true", "differential.terminalHeight": "260" } });
    const workspace = document.querySelector(".workspace")!;
    expect(workspace).not.toHaveClass("terminal-maximized");
    expect(screen.getByRole("separator", { name: "Resize terminal panel" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Maximize terminal panel" }));
    expect(workspace).toHaveClass("terminal-maximized");
    expect(panel()!.style.height).toBe("");
    expect(screen.queryByRole("separator", { name: "Resize terminal panel" })).toBeNull();
    // The file pane stays mounted, only hidden by the class.
    expect(workspace.querySelector(".diff-pane")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restore terminal panel" }));
    expect(workspace).not.toHaveClass("terminal-maximized");
    expect(panel()!.style.height).toContain("260px");
  });

  it("shows the file pane while a maximized panel is hidden, and stays maximized when shown", async () => {
    await renderApp();
    await toggleKey();
    fireEvent.click(screen.getByRole("button", { name: "Maximize terminal panel" }));
    const workspace = document.querySelector(".workspace")!;
    await toggleKey();
    expect(panel()).not.toBeVisible();
    expect(workspace).not.toHaveClass("terminal-maximized");
    await toggleKey();
    expect(workspace).toHaveClass("terminal-maximized");
    expect(screen.getByRole("button", { name: "Restore terminal panel" })).toHaveAttribute("aria-pressed", "true");
  });

  it("uses the persisted height", async () => {
    await renderApp({ saved: { "differential.terminalOpen": "true", "differential.terminalHeight": "333" } });
    expect(panel()).toBeVisible();
    expect(panel()!.style.height).toContain("333px");
    expect(terminalTabs()).toHaveLength(1);
  });

  it("offers copy and paste in the context menu", async () => {
    const { store } = await renderApp();
    await toggleKey();
    const sessions = store.getState().terminalSessions;
    const paste = vi.spyOn(sessions, "paste");
    fireEvent.contextMenu(document.querySelector("[data-terminal]")!);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Copy/ })).toBeDisabled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Paste/ }));
    expect(paste).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("terminal toggle in the toolbar", () => {
  it("is disabled without a repository", async () => {
    await renderApp({ open: false });
    expect(screen.getByRole("button", { name: "Terminal" })).toBeDisabled();
    await toggleKey();
    expect(panel()).toBeNull();
  });

  it("shows and hides the panel and reflects its state", async () => {
    await renderApp();
    const button = screen.getByRole("button", { name: "Terminal" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.click(button);
      await flush();
    });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(panel()).toBeVisible();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });
});

describe("keyboard while a terminal has focus", () => {
  it("leaves app shortcuts to the shell", async () => {
    const { store } = await renderApp();
    await toggleKey();
    const refresh = vi.fn(async () => {});
    const toggleSidebar = vi.fn();
    const selectNext = vi.fn();
    const closeTab = vi.fn();
    store.setState({ refresh, toggleSidebar, selectNext, closeTab, activePath: "a.ts" });
    const body = document.querySelector("[data-terminal]")!;
    for (const init of [
      { key: "r", ctrlKey: true },
      { key: "b", ctrlKey: true },
      { key: "w", ctrlKey: true },
      { key: "]" },
    ]) {
      const ev = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      body.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(refresh).not.toHaveBeenCalled();
    expect(toggleSidebar).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
    expect(selectNext).not.toHaveBeenCalled();

    // Outside the terminal the shortcuts work again.
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
