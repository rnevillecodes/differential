import { describe, expect, it, vi } from "vitest";
import type { TerminalExit } from "../model/TerminalExit";
import { fakeApi, flush } from "../test/fixtures";
import { FakeTerminal } from "../test/xtermMock";
import { createTerminalSessions, isToggleKey, type TerminalSessionEvents } from "./sessions";
import { applyTheme } from "./theme";

function setup(spawn?: () => Promise<number>) {
  let onData: (b: Uint8Array) => void = () => {};
  let onExit: (e: TerminalExit) => void = () => {};
  const api = fakeApi({
    terminalSpawn: vi.fn(async (_cwd, _c, _r, d, e) => {
      onData = d;
      onExit = e;
      return spawn ? spawn() : 7;
    }),
  });
  const events: TerminalSessionEvents = { onRunning: vi.fn(), onExit: vi.fn(), onFailed: vi.fn() };
  const sessions = createTerminalSessions(api, events);
  const host = document.createElement("div");
  document.body.appendChild(host);
  return {
    api,
    events,
    sessions,
    host,
    data: (s: string) => onData(new TextEncoder().encode(s)),
    exit: (code: number | null) => onExit({ code }),
  };
}

const key = (code: string, over: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent("keydown", { code, ctrlKey: true, ...over });

describe("terminal sessions", () => {
  it("recolours open terminals when the app theme changes", async () => {
    const { sessions, host } = setup();
    applyTheme("light");
    sessions.attach(1, "C:/repo", host);
    const term = FakeTerminal.instances[0];
    expect(term.options.theme?.red).toBe("#cf222e");
    applyTheme("dark");
    await flush(); // MutationObserver callbacks run as microtasks
    expect(term.options.theme?.red).toBe("#ff7b72");
    delete document.documentElement.dataset.theme;
  });

  it("spawns once per tab, in the given directory, at the terminal's size", async () => {
    const { api, sessions, host, events } = setup();
    sessions.attach(1, "C:/repo", host);
    sessions.attach(1, "C:/repo", host);
    await flush();
    expect(api.terminalSpawn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.terminalSpawn).mock.calls[0].slice(0, 3)).toEqual(["C:/repo", 80, 24]);
    expect(FakeTerminal.instances).toHaveLength(1);
    expect(host.querySelector(".terminal-xterm")).not.toBeNull();
    expect(events.onRunning).toHaveBeenCalledWith(1);
  });

  it("writes output and forwards input and resizes once running", async () => {
    const { api, sessions, host, data } = setup();
    sessions.attach(1, "C:/repo", host);
    const term = FakeTerminal.instances[0];
    term.dataHandler!("early");
    expect(api.terminalWrite).not.toHaveBeenCalled();
    await flush();
    data("hello");
    expect(term.text()).toContain("hello");
    term.dataHandler!("ls\r");
    expect(api.terminalWrite).toHaveBeenCalledWith(7, "ls\r");
    term.resize(100, 30);
    expect(api.terminalResize).toHaveBeenCalledWith(7, 100, 30);
  });

  it("moves an existing terminal into a new host without respawning", async () => {
    const { api, sessions, host } = setup();
    sessions.attach(1, "C:/repo", host);
    const other = document.createElement("div");
    sessions.attach(1, "C:/repo", other);
    await flush();
    expect(other.querySelector(".terminal-xterm")).not.toBeNull();
    expect(host.querySelector(".terminal-xterm")).toBeNull();
    expect(api.terminalSpawn).toHaveBeenCalledTimes(1);
  });

  it("reports the exit once and stops sending input when the shell exits", async () => {
    const { api, sessions, host, events, exit } = setup();
    sessions.attach(1, "C:/repo", host);
    await flush();
    exit(2);
    exit(2);
    expect(events.onExit).toHaveBeenCalledTimes(1);
    expect(events.onExit).toHaveBeenCalledWith(1, 2);
    FakeTerminal.instances[0].dataHandler!("x");
    expect(api.terminalWrite).not.toHaveBeenCalled();
  });

  it("reports a shell that fails to start", async () => {
    const { sessions, host, events } = setup(async () => {
      throw { kind: "io", message: "could not start shell 'pwsh.exe'" };
    });
    sessions.attach(1, "C:/repo", host);
    await flush();
    expect(FakeTerminal.instances[0].text()).toContain("could not start shell 'pwsh.exe'");
    expect(events.onFailed).toHaveBeenCalledWith(1, "could not start shell 'pwsh.exe'");
    expect(events.onRunning).not.toHaveBeenCalled();
  });

  it("closes the backend session and disposes the terminal", async () => {
    const { api, sessions, host } = setup();
    sessions.attach(1, "C:/repo", host);
    await flush();
    sessions.close(1);
    expect(api.terminalClose).toHaveBeenCalledWith(7);
    expect(FakeTerminal.instances[0].disposed).toBe(true);
    expect(host.querySelector(".terminal-xterm")).toBeNull();
    expect(sessions.has(1)).toBe(false);
    sessions.close(1);
    expect(api.terminalClose).toHaveBeenCalledTimes(1);
  });

  it("closes a session that finishes starting after its tab was closed", async () => {
    let resolve!: (id: number) => void;
    const { api, sessions, host, events } = setup(() => new Promise((r) => (resolve = r)));
    sessions.attach(1, "C:/repo", host);
    sessions.close(1);
    expect(api.terminalClose).not.toHaveBeenCalled();
    resolve(9);
    await flush();
    expect(api.terminalClose).toHaveBeenCalledWith(9);
    expect(events.onRunning).not.toHaveBeenCalled();
  });

  it("keeps Ctrl+` away from the shell and handles copy and paste keys", async () => {
    const writeText = vi.fn(async () => {});
    const readText = vi.fn(async () => "pasted");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText, readText } });
    const { sessions, host } = setup();
    sessions.attach(1, "C:/repo", host);
    await flush();
    const term = FakeTerminal.instances[0];
    expect(term.keyHandler!(key("Backquote"))).toBe(false);
    expect(term.keyHandler!(key("KeyR"))).toBe(true);
    expect(term.keyHandler!(key("KeyC"))).toBe(true); // Ctrl+C without a selection goes to the shell
    expect(writeText).not.toHaveBeenCalled();

    term.selection = "chosen";
    expect(term.keyHandler!(key("KeyC"))).toBe(false);
    expect(writeText).toHaveBeenCalledWith("chosen");
    expect(term.selection).toBe(""); // cleared, so the next Ctrl+C interrupts
    expect(term.keyHandler!(key("KeyC"))).toBe(true);

    expect(term.keyHandler!(key("KeyV"))).toBe(false);
    await flush();
    expect(term.pasted).toEqual(["pasted"]);
  });

  it("recognises the panel toggle key by its physical position", () => {
    expect(isToggleKey(key("Backquote"))).toBe(true);
    expect(isToggleKey(key("Backquote", { shiftKey: true }))).toBe(false);
    expect(isToggleKey(key("Backquote", { ctrlKey: false }))).toBe(false);
  });
});
