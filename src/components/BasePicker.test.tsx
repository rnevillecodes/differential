import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import type { Api } from "../api";
import { createAppStore } from "../store";
import { changeSet, fakeApi, flush, memoryStorage, summary } from "../test/fixtures";
import { MAX_REF_ROWS } from "./BasePicker";

/** A fake whose change sets report the base they were computed against, like the backend. */
const echoingApi = (over: Partial<Api> = {}) =>
  fakeApi({
    listChanges: vi.fn(async (_root: string, base: string) =>
      changeSet([summary(0, "a.ts")], { baseRef: base.trim() || "HEAD" }),
    ),
    ...over,
  });

async function renderApp(api: Api = echoingApi(), open = true) {
  const store = createAppStore(api, memoryStorage());
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

const trigger = () => screen.getByRole("button", { name: /^Base/ });
const search = () => screen.getByRole("combobox", { name: "Search branches and tags" });
const list = () => screen.getByRole("listbox", { name: "Branches and tags" });
const options = () => within(list()).queryAllByRole("option");
const optionNames = () => options().map((o) => o.querySelector(".ref-name")!.textContent);
/** Names of the listed refs, leaving out the "Use …" option. */
const refNames = () =>
  options()
    .filter((o) => o.classList.contains("ref-option-ref"))
    .map((o) => o.querySelector(".ref-name")!.textContent);
const groups = () => [...list().querySelectorAll(".ref-group")].map((g) => g.textContent);

async function pick(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
    await flush();
  });
}

async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(search(), { key });
    await flush();
  });
}

describe("base picker", () => {
  it("shows the base and lists refs grouped, marking the checked-out branch and the current base", async () => {
    await renderApp();
    expect(trigger()).toHaveTextContent("HEAD");
    fireEvent.click(trigger());
    expect(search()).toHaveFocus();
    expect(groups()).toEqual(["Local branches", "Remote branches", "Tags"]);
    expect(optionNames()).toEqual(["feature", "main", "origin/main", "v1.0"]);
    expect(within(options()[0]).getByText("current")).toBeInTheDocument();
    expect(options().filter((o) => o.getAttribute("aria-current") === "true")).toHaveLength(0); // base is HEAD
  });

  it("is disabled with no repository open", async () => {
    await renderApp(echoingApi(), false);
    expect(trigger()).toBeDisabled();
  });

  it("diffs the working tree against a picked branch without switching", async () => {
    const { api, store } = await renderApp();
    fireEvent.click(trigger());
    await pick(options()[1]); // main
    expect(api.listChanges).toHaveBeenLastCalledWith("C:/repo", "main");
    expect(store.getState().base).toBe("main");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(trigger()).toHaveFocus();
    // Reopening marks it as the current base and highlights it.
    fireEvent.click(trigger());
    const main = options()[1];
    expect(main).toHaveAttribute("aria-current", "true");
    expect(main).toHaveAttribute("aria-selected", "true");
  });

  it("applies a tag's unambiguous revision", async () => {
    const api = echoingApi({
      listRefs: vi.fn(async () => [
        { name: "main", rev: "heads/main", kind: "local" as const, current: true },
        { name: "main", rev: "tags/main", kind: "tag" as const, current: false },
      ]),
    });
    await renderApp(api);
    fireEvent.click(trigger());
    await pick(options()[1]);
    expect(api.listChanges).toHaveBeenLastCalledWith("C:/repo", "tags/main");
  });

  it("filters by every typed word, ignoring case", async () => {
    await renderApp();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "ORIG ma" } });
    expect(refNames()).toEqual(["origin/main"]);
    expect(groups()).toEqual(["Remote branches"]);
  });

  it("applies a typed revision that matches no ref", async () => {
    const { api } = await renderApp();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "HEAD~3" } });
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent("Use HEAD~3");
    await press("Enter");
    expect(api.listChanges).toHaveBeenLastCalledWith("C:/repo", "HEAD~3");
  });

  it("does not offer the typed text again when it names a listed ref", async () => {
    await renderApp();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "main" } });
    expect(optionNames()).toEqual(["main", "origin/main"]);
  });

  it("shows an inline error and keeps the diff for a revision that does not resolve", async () => {
    const { api, store } = await renderApp();
    const before = store.getState().changes;
    vi.mocked(api.listChanges).mockRejectedValueOnce({ kind: "badRevision", message: "could not resolve 'no-such-ref'" });
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "no-such-ref" } });
    await press("Enter");
    expect(screen.getByRole("alert")).toHaveTextContent("no-such-ref");
    expect(trigger()).toHaveAttribute("aria-invalid", "true");
    expect(store.getState().changes).toBe(before);
  });

  it("caps the rendered rows and says how many more match", async () => {
    const many = Array.from({ length: MAX_REF_ROWS + 5 }, (_, i) => ({
      name: `b${i}`,
      rev: `b${i}`,
      kind: "local" as const,
      current: false,
    }));
    await renderApp(echoingApi({ listRefs: vi.fn(async () => many) }));
    fireEvent.click(trigger());
    expect(options()).toHaveLength(MAX_REF_ROWS);
    expect(list()).toHaveTextContent("5 more — keep typing to narrow");
  });
});

describe("base picker keyboard and failures", () => {
  it("chooses with the arrow keys and Enter", async () => {
    const { api } = await renderApp();
    fireEvent.click(trigger());
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    await press("ArrowDown");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    expect(search()).toHaveAttribute("aria-activedescendant", options()[1].id);
    await press("End");
    expect(options()[3]).toHaveAttribute("aria-selected", "true");
    await press("ArrowDown"); // wraps
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    await press("ArrowUp");
    await press("Enter");
    expect(api.listChanges).toHaveBeenLastCalledWith("C:/repo", "v1.0");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("closes without changes on Escape or a click outside", async () => {
    const { api } = await renderApp();
    const calls = vi.mocked(api.listChanges).mock.calls.length;
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "main" } });
    await press("Escape");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(trigger()).toHaveFocus();
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(vi.mocked(api.listChanges).mock.calls.length).toBe(calls);
  });

  it("says when branches could not be listed, and still applies a typed revision", async () => {
    const api = echoingApi({ listRefs: vi.fn(async () => Promise.reject({ kind: "git", message: "boom" })) });
    await renderApp(api);
    fireEvent.click(trigger());
    expect(list()).toHaveTextContent("Couldn't list branches: boom");
    fireEvent.change(search(), { target: { value: "main" } });
    expect(options()[0]).toHaveTextContent("Use main");
    await press("Enter");
    expect(api.listChanges).toHaveBeenLastCalledWith("C:/repo", "main");
  });
});
