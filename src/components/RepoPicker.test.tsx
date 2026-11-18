import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { createAppStore } from "../store";
import { fakeApi, flush, memoryStorage } from "../test/fixtures";

const RECENT = ["C:/code/differential", "C:/code/website", "D:/work/api-server"];

async function renderApp(api = fakeApi(), recent = RECENT) {
  const store = createAppStore(api, memoryStorage({ "differential.recentRepos": JSON.stringify(recent) }));
  // Opening moves the repo to the top of the list, as in the real app.
  await act(async () => {
    await store.getState().openPath(recent[0] ?? "C:/repo");
    await flush();
  });
  const utils = render(<App store={store} />);
  await act(flush);
  return { store, api, ...utils };
}

/** The toolbar button; its accessible name is the repository path. */
const trigger = () => screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "listbox")!;
const search = () => screen.getByRole("combobox", { name: "Search repositories" });
const options = () => within(screen.getByRole("listbox", { name: "Repositories" })).getAllByRole("option");
const optionText = () =>
  options().map((o) => (o.querySelector(".repo-option-path") ?? o.querySelector(".repo-option-name"))!.textContent);

describe("repository picker", () => {
  it("shows the open repository's path instead of an Open button", async () => {
    await renderApp();
    expect(screen.queryByRole("button", { name: "Open…" })).toBeNull();
    expect(trigger()).toHaveTextContent("C:/code/differential");
  });

  it("lists recent repositories, marks the current one and starts on the previous one", async () => {
    await renderApp();
    fireEvent.click(trigger());
    expect(search()).toHaveFocus();
    expect(optionText()).toEqual([...RECENT, "Browse for a folder…"]);
    expect(options()[0]).toHaveAttribute("aria-current", "true");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
  });

  it("filters by every search word and opens the chosen repository with Enter", async () => {
    const { api, store } = await renderApp();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "code web" } });
    expect(optionText()).toEqual(["C:/code/website", "Browse for a folder…"]);
    await act(async () => {
      fireEvent.keyDown(search(), { key: "Enter" });
      await flush();
    });
    expect(api.openRepo).toHaveBeenLastCalledWith("C:/code/website");
    expect(store.getState().repoPickerOpen).toBe(false);
    expect(store.getState().recentRepos[0]).toBe("C:/code/website");
  });

  it("offers a typed path that is not in the list", async () => {
    const { api } = await renderApp();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "E:/elsewhere" } });
    expect(screen.getByText("No recent repository matches.")).toBeInTheDocument();
    expect(optionText()).toEqual(["E:/elsewhere", "Browse for a folder…"]);
    await act(async () => {
      fireEvent.click(options()[0]);
      await flush();
    });
    expect(api.openRepo).toHaveBeenLastCalledWith("E:/elsewhere");
  });

  it("browses for a folder from the last option", async () => {
    const api = fakeApi({ pickFolder: vi.fn(async () => null) });
    await renderApp(api);
    fireEvent.click(trigger());
    fireEvent.keyDown(search(), { key: "End" });
    await act(async () => {
      fireEvent.keyDown(search(), { key: "Enter" });
      await flush();
    });
    expect(api.pickFolder).toHaveBeenCalled();
  });

  it("removes an entry without closing", async () => {
    const { store } = await renderApp();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Remove C:/code/website from recent repositories" }));
    expect(optionText()).toEqual(["C:/code/differential", "D:/work/api-server", "Browse for a folder…"]);
    expect(store.getState().repoPickerOpen).toBe(true);
    // The open repository cannot be removed.
    expect(screen.queryByRole("button", { name: /Remove C:\/code\/differential/ })).toBeNull();
  });

  it("opens with Ctrl+O and closes with Escape or a click outside", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(search()).toBeInTheDocument();
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(trigger()).toHaveFocus();
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("does nothing when choosing the open repository", async () => {
    const { api } = await renderApp();
    fireEvent.click(trigger());
    fireEvent.click(options()[0]);
    expect(api.openRepo).toHaveBeenCalledTimes(1);
  });
});
