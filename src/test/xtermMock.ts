// A stand-in for @xterm/xterm and @xterm/addon-fit in jsdom, which cannot render xterm.
// Each instance records what was written and exposes its handlers so tests can drive it.

import type { ITerminalOptions } from "@xterm/xterm";

type Handler<T> = (value: T) => void;

export class FakeTerminal {
  static instances: FakeTerminal[] = [];
  options: ITerminalOptions;
  cols = 80;
  rows = 24;
  written: (string | Uint8Array)[] = [];
  pasted: string[] = [];
  disposed = false;
  focused = false;
  selection = "";
  element: HTMLElement | null = null;
  keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  dataHandler: Handler<string> | null = null;
  binaryHandler: Handler<string> | null = null;
  resizeHandler: Handler<{ cols: number; rows: number }> | null = null;

  constructor(options: ITerminalOptions = {}) {
    this.options = { ...options };
    FakeTerminal.instances.push(this);
  }

  loadAddon() {}
  open(el: HTMLElement) {
    this.element = el;
  }
  write(data: string | Uint8Array) {
    this.written.push(data);
  }
  paste(text: string) {
    this.pasted.push(text);
  }
  text(): string {
    return this.written.map((w) => (typeof w === "string" ? w : new TextDecoder().decode(w))).join("");
  }
  focus() {
    this.focused = true;
  }
  refresh() {}
  dispose() {
    this.disposed = true;
  }
  getSelection() {
    return this.selection;
  }
  hasSelection() {
    return this.selection.length > 0;
  }
  attachCustomKeyEventHandler(h: (e: KeyboardEvent) => boolean) {
    this.keyHandler = h;
  }
  onData(h: Handler<string>) {
    this.dataHandler = h;
    return { dispose() {} };
  }
  onBinary(h: Handler<string>) {
    this.binaryHandler = h;
    return { dispose() {} };
  }
  onResize(h: Handler<{ cols: number; rows: number }>) {
    this.resizeHandler = h;
    return { dispose() {} };
  }
  /** Simulate a fit to a new size. */
  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.resizeHandler?.({ cols, rows });
  }
}

export class FakeFitAddon {
  fit() {}
}
