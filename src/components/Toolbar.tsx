import { useEffect, useState, type FormEvent } from "react";
import { useApp } from "../store";
import { SidebarIcon } from "./icons";
import { RepoPicker } from "./RepoPicker";

export function Toolbar() {
  const repo = useApp((s) => s.repo);
  const base = useApp((s) => s.base);
  const baseError = useApp((s) => s.baseError);
  const loading = useApp((s) => s.loading);
  const viewMode = useApp((s) => s.viewMode);
  const setBase = useApp((s) => s.setBase);
  const refresh = useApp((s) => s.refresh);
  const setViewMode = useApp((s) => s.setViewMode);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const toggleSidebar = useApp((s) => s.toggleSidebar);

  const [draft, setDraft] = useState(base);
  // Show the committed base whenever it changes (open, successful base change).
  useEffect(() => setDraft(base), [base]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void setBase(draft);
  };

  return (
    <header className="toolbar">
      <button
        type="button"
        className="icon-button sidebar-toggle"
        onClick={toggleSidebar}
        aria-pressed={sidebarOpen}
        aria-label="Sidebar"
        title={`${sidebarOpen ? "Hide" : "Show"} sidebar (Ctrl+B)`}
      >
        <SidebarIcon width={16} height={16} />
      </button>
      <RepoPicker />

      <form onSubmit={submit}>
        <label htmlFor="base-input">Base</label>
        <input
          id="base-input"
          className="base-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setDraft(base)}
          placeholder="HEAD"
          spellCheck={false}
          disabled={!repo}
          aria-invalid={baseError ? true : undefined}
          title="Any git revision: branch, tag, SHA, HEAD~3 … (Enter to apply)"
        />
        {baseError && (
          <span className="base-error" role="alert" title={baseError}>
            {baseError}
          </span>
        )}
      </form>

      <button onClick={() => void refresh()} disabled={!repo || loading} title="Refresh (Ctrl+R)">
        {loading ? "Loading…" : "Refresh"}
      </button>

      <div className="segmented" role="group" aria-label="View mode" title="Toggle view (Ctrl+\)">
        <button aria-pressed={viewMode === "unified"} onClick={() => setViewMode("unified")}>
          Unified
        </button>
        <button aria-pressed={viewMode === "split"} onClick={() => setViewMode("split")}>
          Split
        </button>
      </div>
    </header>
  );
}
