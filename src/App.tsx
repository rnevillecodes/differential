import { useEffect, useMemo } from "react";
import type { StoreApi } from "zustand";
import { tauriApi } from "./api";
import { DiffPane } from "./components/DiffPane";
import { Sidebar } from "./components/Sidebar";
import { TerminalPanel } from "./components/TerminalPanel";
import { Toolbar } from "./components/Toolbar";
import { createAppStore, StoreContext, useApp, type AppState } from "./store";
import { isToggleKey } from "./terminal/sessions";

/**
 * Global shortcuts: ] / [ next/previous file, Ctrl+R refresh, Ctrl+O repository picker, Ctrl+\ toggle view,
 * Ctrl+B toggle sidebar,
 * Ctrl+W close tab, Ctrl+Tab / Ctrl+Shift+Tab (or Ctrl+PageDown / Ctrl+PageUp) switch tabs,
 * Ctrl+` show/hide the terminal panel.
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
  if (e.ctrlKey && !e.altKey) {
    if (e.key === "Tab") s.cycleTab(e.shiftKey ? -1 : 1);
    else if (e.key === "PageDown" && !e.shiftKey) s.cycleTab(1);
    else if (e.key === "PageUp" && !e.shiftKey) s.cycleTab(-1);
    else if (e.shiftKey) return false;
    else {
      const key = e.key.toLowerCase();
      if (key === "r") void s.refresh();
      else if (key === "o") s.setRepoPickerOpen(!s.repoPickerOpen);
      else if (key === "\\") s.toggleViewMode();
      else if (key === "b") s.toggleSidebar();
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
  return (
    <main className={`main${sidebarOpen ? "" : " sidebar-hidden"}`}>
      {sidebarOpen && <Sidebar />}
      <div className="workspace">
        <DiffPane />
        <TerminalPanel />
      </div>
    </main>
  );
}
