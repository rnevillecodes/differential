// Terminal sessions for the terminal panel: one xterm instance and one backend shell per tab.
//
// The xterm instances live here, outside React state, so hiding the panel, switching tabs or
// re-mounting components never loses scrollback. Components only attach a tab's element into
// their container; attaching is idempotent, so StrictMode double-mounts start one shell.

import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITerminalOptions } from "@xterm/xterm";
import { toErrorPayload, type Api } from "../api";
import type { TerminalExit } from "../model/TerminalExit";
import { DARK_QUERY, terminalFont, terminalTheme } from "./theme";

/** Lifecycle notifications, applied to the store. */
export interface TerminalSessionEvents {
  onRunning(id: number): void;
  onExit(id: number, code: number | null): void;
  onFailed(id: number, message: string): void;
}

export interface TerminalSessions {
  /** Create tab `id`'s terminal once (starting its shell in `cwd`) and show it inside `host`. */
  attach(id: number, cwd: string, host: HTMLElement): void;
  focus(id: number): void;
  hasSelection(id: number): boolean;
  copy(id: number): void;
  paste(id: number): void;
  /** End the tab's shell and dispose its terminal. */
  close(id: number): void;
  has(id: number): boolean;
}

interface Entry {
  term: Terminal;
  fit: FitAddon;
  element: HTMLDivElement;
  observer: ResizeObserver;
  backendId: number | null;
  state: "starting" | "running" | "ended";
  closed: boolean;
  frame: number;
}

const isWindows = () => typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

export function failureMessage(message: string): string {
  return `\x1b[31mCould not start the shell: ${message}\x1b[0m\r\n`;
}

/** Whether a key event is the panel toggle (Ctrl+`), which never goes to the shell. */
export function isToggleKey(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.code === "Backquote";
}

export function createTerminalSessions(api: Api, events: TerminalSessionEvents): TerminalSessions {
  const entries = new Map<number, Entry>();

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    window.matchMedia(DARK_QUERY).addEventListener?.("change", (e) => {
      for (const entry of entries.values()) entry.term.options.theme = terminalTheme(e.matches);
    });
  }

  const fitNow = (entry: Entry) => {
    const { element } = entry;
    // Hidden panels and inactive tabs have no size; fitting them would shrink the terminal to nothing.
    if (!element.isConnected || element.offsetWidth === 0 || element.offsetHeight === 0) return;
    try {
      entry.fit.fit();
    } catch {
      // not laid out yet
    }
  };

  const scheduleFit = (entry: Entry) => {
    cancelAnimationFrame(entry.frame);
    entry.frame = requestAnimationFrame(() => fitNow(entry));
  };

  const send = (entry: Entry, data: string) => {
    if (entry.state === "running" && entry.backendId !== null) {
      api.terminalWrite(entry.backendId, data).catch(() => {});
    }
  };

  const copy = (entry: Entry) => {
    const text = entry.term.getSelection();
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  };

  const paste = (entry: Entry) => {
    if (entry.state !== "running") return;
    navigator.clipboard
      ?.readText()
      .then((text) => {
        if (text && !entry.closed) entry.term.paste(text);
      })
      .catch(() => {});
  };

  const end = (entry: Entry, text: string) => {
    entry.state = "ended";
    entry.term.write(text);
    entry.term.options.disableStdin = true;
    entry.term.options.cursorBlink = false;
  };

  const create = (id: number, cwd: string, host: HTMLElement): Entry => {
    const element = document.createElement("div");
    element.className = "terminal-xterm";
    host.appendChild(element);

    const options: ITerminalOptions = {
      fontFamily: terminalFont(),
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: terminalTheme(),
    };
    if (isWindows()) options.windowsPty = { backend: "conpty" };
    const term = new Terminal(options);
    const fit = new FitAddon();
    term.loadAddon(fit);

    const entry: Entry = {
      term,
      fit,
      element,
      observer: new ResizeObserver(() => scheduleFit(entry)),
      backendId: null,
      state: "starting",
      closed: false,
      frame: 0,
    };

    term.open(element);
    fitNow(entry);
    entry.observer.observe(element);

    term.attachCustomKeyEventHandler((e) => {
      if (isToggleKey(e)) return false; // handled by the app's shortcut listener
      const plainCtrl = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
      // Ctrl+C copies when text is selected; otherwise it goes to the shell as an interrupt.
      if (plainCtrl && e.code === "KeyC" && term.hasSelection()) {
        if (e.type === "keydown") {
          e.preventDefault();
          copy(entry);
          term.clearSelection();
        }
        return false;
      }
      if (plainCtrl && e.code === "KeyV") {
        if (e.type === "keydown") {
          e.preventDefault();
          paste(entry);
        }
        return false;
      }
      return true;
    });
    term.onData((data) => send(entry, data));
    term.onBinary((data) => send(entry, data));
    term.onResize(({ cols, rows }) => {
      if (entry.state === "running" && entry.backendId !== null) {
        api.terminalResize(entry.backendId, cols, rows).catch(() => {});
      }
    });

    api
      .terminalSpawn(
        cwd,
        term.cols,
        term.rows,
        (bytes) => {
          if (!entry.closed) term.write(bytes);
        },
        (exit: TerminalExit) => {
          if (entry.closed || entry.state === "ended") return;
          // The store closes the tab in response.
          entry.state = "ended";
          events.onExit(id, exit.code);
        },
      )
      .then(
        (backendId) => {
          if (entry.closed) {
            api.terminalClose(backendId).catch(() => {});
            return;
          }
          entry.backendId = backendId;
          if (entry.state !== "starting") return; // already exited
          entry.state = "running";
          events.onRunning(id);
          // The panel may have been resized while the shell was starting.
          api.terminalResize(backendId, term.cols, term.rows).catch(() => {});
        },
        (e) => {
          if (entry.closed) return;
          const { message } = toErrorPayload(e);
          end(entry, failureMessage(message));
          events.onFailed(id, message);
        },
      );

    return entry;
  };

  return {
    attach(id, cwd, host) {
      const entry = entries.get(id);
      if (!entry) {
        entries.set(id, create(id, cwd, host));
        return;
      }
      if (entry.element.parentElement !== host) {
        host.appendChild(entry.element);
        entry.term.refresh(0, entry.term.rows - 1);
      }
      scheduleFit(entry);
    },

    focus(id) {
      entries.get(id)?.term.focus();
    },

    hasSelection(id) {
      return entries.get(id)?.term.hasSelection() ?? false;
    },

    copy(id) {
      const entry = entries.get(id);
      if (entry) copy(entry);
    },

    paste(id) {
      const entry = entries.get(id);
      if (entry) paste(entry);
    },

    close(id) {
      const entry = entries.get(id);
      if (!entry) return;
      entries.delete(id);
      entry.closed = true;
      cancelAnimationFrame(entry.frame);
      entry.observer.disconnect();
      if (entry.backendId !== null) api.terminalClose(entry.backendId).catch(() => {});
      entry.term.dispose();
      entry.element.remove();
    },

    has(id) {
      return entries.has(id);
    },
  };
}
