import { useApp } from "../store";
import { BasePicker } from "./BasePicker";
import { SidebarIcon, TerminalIcon } from "./icons";
import { RepoPicker } from "./RepoPicker";

export function Toolbar() {
  const repo = useApp((s) => s.repo);
  const loading = useApp((s) => s.loading);
  const viewMode = useApp((s) => s.viewMode);
  const refresh = useApp((s) => s.refresh);
  const setViewMode = useApp((s) => s.setViewMode);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const terminalOpen = useApp((s) => s.terminalOpen);
  const toggleTerminal = useApp((s) => s.toggleTerminal);

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

      <BasePicker />

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

      <button
        type="button"
        className="icon-button terminal-toggle"
        onClick={toggleTerminal}
        disabled={!repo}
        aria-pressed={terminalOpen}
        aria-label="Terminal"
        title={`${terminalOpen ? "Hide" : "Show"} terminal (Ctrl+\`)`}
      >
        <TerminalIcon width={16} height={16} />
      </button>
    </header>
  );
}
