// xterm colours derived from the app's CSS custom properties, so terminals follow light/dark mode.

import type { ITheme } from "@xterm/xterm";

/** ANSI colours readable on a light background (xterm's defaults suit dark backgrounds). */
const LIGHT_ANSI: ITheme = {
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#7d4e00",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#633c01",
  brightBlue: "#218bff",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
};

const DARK_ANSI: ITheme = {
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function prefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/** The current terminal theme, read from the document's CSS variables. */
export function terminalTheme(dark = prefersDark()): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const bg = v("--bg", dark ? "#0d1117" : "#ffffff");
  const fg = v("--fg", dark ? "#e6edf3" : "#1f2328");
  return {
    ...(dark ? DARK_ANSI : LIGHT_ANSI),
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: v("--selected", dark ? "#1c3354" : "#dbe9ff"),
    selectionForeground: fg,
  };
}

export function terminalFont(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
    '"Cascadia Mono", Consolas, monospace'
  );
}
