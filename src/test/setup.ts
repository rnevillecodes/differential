// jsdom has no layout: give elements a viewport size so virtualized lists render rows,
// and stub the browser APIs the app touches.
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { FakeTerminal } from "./xtermMock";

afterEach(() => cleanup());

Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 800 });
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1000 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Highlighting runs in a Web Worker in the app; tests render plain text.
vi.mock("../highlight/client", async (orig) => {
  const mod = await orig<typeof import("../highlight/client")>();
  return { ...mod, highlighter: { highlight: async () => null } };
});


// jsdom cannot render xterm: use the recording fake everywhere.
vi.mock("@xterm/xterm", async () => ({ Terminal: (await import("./xtermMock")).FakeTerminal }));
vi.mock("@xterm/addon-fit", async () => ({ FitAddon: (await import("./xtermMock")).FakeFitAddon }));
afterEach(() => {
  FakeTerminal.instances.length = 0;
});
