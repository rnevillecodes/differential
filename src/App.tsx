import { useEffect, useMemo } from "react";
import type { StoreApi } from "zustand";
import { tauriApi } from "./api";
import { DiffPane } from "./components/DiffPane";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { createAppStore, StoreContext, type AppState } from "./store";

/** Global shortcuts: ] / [ next/previous file, Ctrl+R refresh, Ctrl+O open, Ctrl+\ toggle view. */
export function handleShortcut(e: KeyboardEvent, s: AppState): boolean {
  const target = e.target as HTMLElement | null;
  const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
  if (e.ctrlKey && !e.altKey && !e.shiftKey) {
    const key = e.key.toLowerCase();
    if (key === "r") void s.refresh();
    else if (key === "o") void s.pickAndOpen();
    else if (key === "\\") s.toggleViewMode();
    else return false;
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
        <main className="main">
          <Sidebar />
          <DiffPane />
        </main>
      </div>
    </StoreContext.Provider>
  );
}
