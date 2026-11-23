import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App, { handleShortcut } from "../App";
import type { Api } from "../api";
import { createAppStore } from "../store";
import { add, changeSet, ctx, fakeApi, fileDiff, flush, hunk, memoryStorage, rem, summary } from "../test/fixtures";

async function renderApp(api: Api = fakeApi()) {
  const store = createAppStore(api, memoryStorage());
  await act(async () => {
    await store.getState().openPath("C:/repo");
    await flush();
  });
  const utils = render(<App store={store} />);
  await act(flush);
  return { store, api, ...utils };
}

const press = (init: KeyboardEventInit, target: Window | Element = window) => {
  let ev!: KeyboardEvent;
  act(() => {
    ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
  });
  return ev;
};

/** Select `count` characters of `node`'s text starting at `start`. */
function selectText(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("find shortcuts", () => {
  it("opens the find bar with Ctrl+F and prevents the default", async () => {
    const { store } = await renderApp();
    const ev = press({ key: "f", code: "KeyF", ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(store.getState().findOpen).toBe(true);
  });

  it("does nothing without an open tab, but still keeps the webview's find away", async () => {
    const api = fakeApi({ listChanges: vi.fn(async () => changeSet([])) });
    const { store } = await renderApp(api);
    expect(store.getState().activePath).toBeNull();
    const ev = press({ key: "f", code: "KeyF", ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(store.getState().findOpen).toBe(false);
  });

  it("seeds the query from a single-line selection in the view only", async () => {
    const { store } = await renderApp();
    store.setState({ findQuery: "previous" });
    const panels = document.querySelector(".tab-panels")!;
    const text = document.createTextNode("alpha beta\ngamma");
    panels.appendChild(text);

    selectText(text, 0, 5);
    press({ key: "f", ctrlKey: true });
    expect(store.getState().findQuery).toBe("alpha");

    act(() => store.getState().closeFind());
    selectText(text, 6, 16); // "beta\ngamma"
    press({ key: "f", ctrlKey: true });
    expect(store.getState().findQuery).toBe("alpha");
    text.remove();
  });

  it("moves with F3 and Shift+F3 only while the bar is open", async () => {
    const { store } = await renderApp();
    expect(press({ key: "F3" }).defaultPrevented).toBe(false);
    expect(store.getState().findNav.seq).toBe(0);
    act(() => store.getState().openFind());
    press({ key: "F3" });
    expect(store.getState().findNav).toEqual({ seq: 1, dir: 1 });
    press({ key: "F3", shiftKey: true });
    expect(store.getState().findNav).toEqual({ seq: 2, dir: -1 });
  });

  it("leaves Ctrl+F and F3 to the shell inside a terminal", async () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    await store.getState().openPath("C:/repo");
    await flush();
    store.getState().openFind();
    const term = document.createElement("div");
    term.setAttribute("data-terminal", "");
    document.body.appendChild(term);
    for (const init of [{ key: "f", ctrlKey: true }, { key: "F3" }, { key: "F3", shiftKey: true }]) {
      const ev = new KeyboardEvent("keydown", init);
      Object.defineProperty(ev, "target", { value: term });
      expect(handleShortcut(ev, store.getState())).toBe(false);
    }
    expect(store.getState().findNav.seq).toBe(0);
    expect(store.getState().findFocusSeq).toBe(1);
    term.remove();
  });
});

// ---- find bar and views -------------------------------------------------------

const LONG = " ".repeat(300);
/** Base: 100 lines; line 10 holds "helper", line 80 has "far" at column 300 (both collapsed); line 50 changes. */
function baseLines(): string[] {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
  lines[9] = "line 10 helper";
  lines[79] = `line 80${LONG}far`;
  return lines;
}
const OLD = baseLines().map((l, i) => (i === 49 ? "line 50 oldName" : l)).join("\n") + "\n";
const NEW = baseLines().map((l, i) => (i === 49 ? `line 50 newName${LONG}zed` : l)).join("\n") + "\n";
const DIFF = fileDiff([
  hunk(47, 7, 47, 7, [
    ctx("line 47", 47, 47),
    ctx("line 48", 48, 48),
    ctx("line 49", 49, 49),
    rem("line 50 oldName", 50),
    add(`line 50 newName${LONG}zed`, 50),
    ctx("line 51", 51, 51),
    ctx("line 52", 52, 52),
    ctx("line 53", 53, 53),
  ]),
]);
const notes = (needles: number[]) =>
  Array.from({ length: 3000 }, (_, i) => (needles.includes(i + 1) ? `note ${i + 1} needle` : `note ${i + 1}`)).join("\n") + "\n";

function findApi(notesContent = () => notes([5, 2500])) {
  return fakeApi({
    listChanges: vi.fn(async () => changeSet([summary(0, "a.ts")])),
    fileDiff: vi.fn(async () => DIFF),
    fileContent: vi.fn(async (_r: string, _s: string, _p: string, side: string) => (side === "base" ? OLD : NEW)),
    listFiles: vi.fn(async () => ["a.ts", "notes.txt", "logo.png"]),
    viewFile: vi.fn(async (_r: string, path: string) =>
      path === "logo.png" ? { kind: "binary" as const } : { kind: "text" as const, content: notesContent() },
    ),
  });
}

const input = () => screen.getByRole("textbox", { name: "Find" });
const count = () => screen.getByTestId("find-count").textContent;
const activePanel = () => document.querySelector<HTMLElement>(".tab-panel:not(.inactive)")!;
const current = () => activePanel().querySelector(".find-current");

async function search(text: string) {
  await act(async () => {
    fireEvent.change(input(), { target: { value: text } });
    await flush();
  });
}
async function key(init: KeyboardEventInit, target: Element = input()) {
  await act(async () => {
    fireEvent.keyDown(target, init);
    await flush();
  });
}
async function openBar() {
  press({ key: "f", ctrlKey: true });
  await act(flush);
}

describe("find bar", () => {
  it("searches, steps with Enter / Shift+Enter and the buttons, and closes with Escape", async () => {
    await renderApp(findApi());
    await openBar();
    expect(input()).toHaveFocus();
    await search("line 5");
    // Matches: line 5 (collapsed), 50 removed, 50 added, 51..59. The view opens at the top,
    // where the first shown line is 47, so the first match from there (line 50) is current.
    expect(count()).toBe("2 of 12");
    await key({ key: "Enter" });
    expect(count()).toBe("3 of 12");
    await key({ key: "Enter", shiftKey: true });
    expect(count()).toBe("2 of 12");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next match" }));
      await flush();
    });
    expect(count()).toBe("3 of 12");
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
        await flush();
      });
    }
    expect(count()).toBe("12 of 12"); // wrapped past the first
    expect(activePanel().querySelectorAll(".find-match").length).toBeGreaterThan(0);

    await key({ key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(activePanel().querySelector(".diff-scroll")).toHaveFocus();
    expect(activePanel().querySelector(".find-match")).toBeNull();
  });

  it("matches case only when asked, and shows No results", async () => {
    await renderApp(findApi());
    await openBar();
    await search("LINE 50");
    expect(count()).toBe("1 of 2");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Match case" }));
      await flush();
    });
    expect(screen.getByRole("button", { name: "Match case" })).toHaveAttribute("aria-pressed", "true");
    expect(count()).toBe("No results");
    expect(activePanel().querySelector(".find-match")).toBeNull();
  });

  it("refocuses and selects the query on Ctrl+F", async () => {
    await renderApp(findApi());
    await openBar();
    await search("foo");
    act(() => (activePanel().querySelector(".diff-scroll") as HTMLElement).focus());
    await openBar();
    expect(input()).toHaveFocus();
    expect((input() as HTMLInputElement).selectionStart).toBe(0);
    expect((input() as HTMLInputElement).selectionEnd).toBe(3);
  });

  it("shows No results for a binary file", async () => {
    const { store } = await renderApp(findApi());
    await act(async () => {
      store.getState().openTreePath("logo.png", true);
      await flush();
    });
    await openBar();
    await search("x");
    expect(count()).toBe("No results");
  });
});

describe("find in the diff view", () => {
  it("searches removed and added lines", async () => {
    await renderApp(findApi());
    await openBar();
    await search("Name");
    expect(count()).toBe("1 of 2");
    expect(current()).toHaveTextContent("Name");
    expect(current()!.closest(".row")).toHaveClass("removed");
    await key({ key: "Enter" });
    expect(current()!.closest(".row")).toHaveClass("added");
  });

  it("expands a collapsed region to show a hidden match", async () => {
    await renderApp(findApi());
    expect(screen.queryByText("line 10 helper", { exact: false })).toBeNull();
    await openBar();
    await search("helper");
    expect(count()).toBe("1 of 1");
    expect(current()).toHaveTextContent("helper");
    expect(current()!.closest(".row")).toHaveTextContent("line 10 helper");
    expect(count()).toBe("1 of 1");
  });

  it("highlights the correct side in split view and counts unchanged lines once", async () => {
    const { store } = await renderApp(findApi());
    act(() => store.getState().toggleViewMode());
    await act(flush);
    await openBar();
    await search("Name");
    expect(current()!.closest(".cell")).toHaveClass("left");
    await key({ key: "Enter" });
    expect(current()!.closest(".cell")).toHaveClass("right");

    await search("line 49");
    expect(count()).toBe("1 of 1");
  });

  it("scrolls horizontally to a match far to the right", async () => {
    await renderApp(findApi());
    await openBar();
    await search("far");
    const scroll = activePanel().querySelector<HTMLElement>(".diff-scroll")!;
    // fallback layout: 7.2px characters, 122px gutter, 1000px wide → visible 878px
    expect(scroll.scrollLeft).toBeCloseTo(307 * 7.2 - 878 / 3, 1);
  });

  it("scrolls only the matching side in split view", async () => {
    const { store } = await renderApp(findApi());
    act(() => store.getState().toggleViewMode());
    await act(flush);
    await openBar();
    await search("zed");
    const left = activePanel().querySelector<HTMLElement>('.hscroll [data-pane="left"]')!;
    const right = activePanel().querySelector<HTMLElement>('.hscroll [data-pane="right"]')!;
    expect(left.scrollLeft).toBe(0);
    expect(right.scrollLeft).toBeGreaterThan(0);
  });
});

describe("find in the file view and across tabs", () => {
  async function withNotes(api = findApi()) {
    const utils = await renderApp(api);
    await act(async () => {
      utils.store.getState().pinTab("a.ts");
      utils.store.getState().openTreePath("notes.txt", true);
      await flush();
    });
    return utils;
  }

  it("counts, wraps and scrolls to off-screen matches", async () => {
    await withNotes();
    await openBar();
    await search("needle");
    expect(count()).toBe("1 of 2");
    expect(current()).toHaveTextContent("needle");
    await key({ key: "Enter" });
    expect(count()).toBe("2 of 2");
    const scroll = activePanel().querySelector<HTMLElement>(".diff-scroll")!;
    expect(scroll.scrollTop).toBe(2499 * 20 - 400 + 10);
    await key({ key: "F3" });
    expect(count()).toBe("1 of 2");
  });

  it("keeps the query across tabs and searches the active one", async () => {
    const { store } = await withNotes();
    await openBar();
    await search("needle");
    expect(count()).toBe("1 of 2");
    await act(async () => {
      store.getState().cycleTab(-1);
      await flush();
    });
    expect(store.getState().activePath).toBe("a.ts");
    expect(input()).toHaveValue("needle");
    expect(count()).toBe("No results");
    expect(document.querySelector(".tab-panel.inactive .find-match")).toBeNull();
  });

  it("recomputes when the contents change", async () => {
    let needles = [5, 2500];
    const { store } = await withNotes(findApi(() => notes(needles)));
    await openBar();
    await search("needle");
    expect(count()).toBe("1 of 2");
    needles = [5, 6, 2500];
    await act(async () => {
      await store.getState().refresh();
      await flush();
    });
    expect(store.getState().activePath).toBe("notes.txt");
    expect(count()).toBe("1 of 3");
  });
});
