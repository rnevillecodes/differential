import { useEffect, useMemo } from "react";
import type { StoreApi } from "zustand";
import { tauriApi } from "./api";
import { CommitGraph } from "./components/CommitGraph";
import { DiffPane } from "./components/DiffPane";
import { Sidebar } from "./components/Sidebar";
import { TerminalPanel } from "./components/TerminalPanel";
import { Toolbar } from "./components/Toolbar";
import { createAppStore, StoreContext, useApp, type AppState } from "./store";
import { isToggleKey } from "./terminal/sessions";

/**
 * Global shortcuts: ] / [ next/previous file, Ctrl+R refresh, Ctrl+O repository picker, Ctrl+\ toggle view,
 * Ctrl+B toggle sidebar, Ctrl+G toggle the commit graph pane,
 * Ctrl+W close tab, Ctrl+Tab / Ctrl+Shift+Tab (or Ctrl+PageDown / Ctrl+PageUp) switch tabs,
 * Ctrl+` show/hide the terminal panel, Ctrl+F find in the active tab (seeded with a single-line selection),
 * F3 / Shift+F3 next/previous match while the find bar is open,
 * Ctrl+= / Ctrl++ zoom in, Ctrl+- zoom out, Ctrl+0 reset zoom.
 *
 * While a terminal has focus every key belongs to its shell, except Ctrl+`.
 */
export function handleShortcut(e: KeyboardEvent, s: AppState): boolean {
  if (isToggleKey(e)) {
    s.toggleTerminal();
    return true;
  }
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("[data-terminal]")) return false;
  const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
  if (e.key === "F3" && !e.ctrlKey && !e.altKey && !e.metaKey) {
    if (!s.findOpen) return false;
    if (e.shiftKey) s.findPrev();
    else s.findNext();
    return true;
  }
  if (e.ctrlKey && !e.altKey) {
    if (e.key === "Tab") s.cycleTab(e.shiftKey ? -1 : 1);
    else if (e.key === "PageDown" && !e.shiftKey) s.cycleTab(1);
    else if (e.key === "PageUp" && !e.shiftKey) s.cycleTab(-1);
    // Zoom keys come shifted or not depending on the layout (e.g. + is Shift+= on US keyboards).
    else if (e.key === "=" || e.key === "+") s.zoomIn();
    else if (e.key === "-" || e.key === "_") s.zoomOut();
    else if (e.key === "0" && !e.shiftKey) s.resetZoom();
    else if (e.shiftKey) return false;
    else {
      const key = e.key.toLowerCase();
      if (key === "r") void s.refresh();
      else if (key === "o") s.setRepoPickerOpen(!s.repoPickerOpen);
      else if (key === "\\") s.toggleViewMode();
      else if (key === "b") s.toggleSidebar();
      else if (key === "g") s.toggleGraph();
      else if (key === "f") {
        // Handled (default prevented) even without a tab, so the webview's own find never opens.
        if (s.activePath !== null) s.openFind(selectionQuery());
      }
      else if (key === "w") {
        if (s.activePath !== null) s.closeTab(s.activePath);
      } else return false;
    }
    return true;
  }
  if (typing || e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.key === "]") s.selectNext();
  else if (e.key === "[") s.selectPrev();
  else return false;
  return true;
}

/** The selected text, if it lies within one line of the open tab's view; otherwise undefined. */
function selectionQuery(): string | undefined {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return undefined;
  const text = sel.toString();
  if (text === "" || /[\r\n]/.test(text)) return undefined;
  const node = sel.getRangeAt(0).commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest(".tab-panels") ? text : undefined;
}

export default function App({ store: injected }: { store?: StoreApi<AppState> }) {
  const store = useMemo(() => injected ?? createAppStore(tauriApi), [injected]);

  useEffect(() => {
    if (!injected) void store.getState().init();
  }, [store, injected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handleShortcut(e, store.getState())) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  return (
    <StoreContext.Provider value={store}>
      <div className="app">
        <Toolbar />
        <Main />
      </div>
    </StoreContext.Provider>
  );
}

function Main() {
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  // The file pane gives way to the terminal only while the panel is actually shown.
  const terminalMaximized = useApp((s) => s.terminalMaximized && s.terminalOpen && s.repo !== null);
  const graphShown = useApp((s) => s.graphOpen && s.repo !== null);
  return (
    <main className={`main${sidebarOpen ? "" : " sidebar-hidden"}${graphShown ? " graph-open" : ""}`}>
      {sidebarOpen && <Sidebar />}
      <div className={`workspace${terminalMaximized ? " terminal-maximized" : ""}`}>
        <DiffPane />
        <TerminalPanel />
      </div>
      {graphShown && <CommitGraph />}
    </main>
  );
}
