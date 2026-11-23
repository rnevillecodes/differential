import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { createAppStore } from "./store";
import { fakeApi, memoryStorage } from "./test/fixtures";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

describe("theme", () => {
  it("defaults to the OS preference (light in jsdom) and applies it to <html>", () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    expect(store.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("restores a saved theme", () => {
    const store = createAppStore(fakeApi(), memoryStorage({ "differential.theme": "dark" }));
    expect(store.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("ignores an unrecognised saved value", () => {
    const store = createAppStore(fakeApi(), memoryStorage({ "differential.theme": "purple" }));
    expect(store.getState().theme).toBe("light");
  });

  it("toggles, applies and persists the theme", () => {
    const storage = memoryStorage();
    const store = createAppStore(fakeApi(), storage);
    store.getState().toggleTheme();
    expect(store.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(storage.data["differential.theme"]).toBe("dark");
    store.getState().toggleTheme();
    expect(store.getState().theme).toBe("light");
    expect(storage.data["differential.theme"]).toBe("light");
  });

  it("switches theme from the toolbar button", () => {
    const store = createAppStore(fakeApi(), memoryStorage());
    render(<App store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
