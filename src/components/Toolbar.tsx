import { currentBranch, MAX_ZOOM, MIN_ZOOM, useApp } from "../store";
import { BasePicker } from "./BasePicker";
import { GraphToggle } from "./CommitGraph";
import { BranchIcon, MoonIcon, SidebarIcon, SunIcon, TerminalIcon } from "./icons";
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
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const nextTheme = theme === "dark" ? "light" : "dark";

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
      <div className="repo-group">
        <RepoPicker />
        <BranchBadge />
      </div>

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
      <GraphToggle />
      <ZoomControl />
      <button
        type="button"
        className="icon-button theme-toggle"
        onClick={toggleTheme}
        aria-label={`Switch to ${nextTheme} mode`}
        title={`Switch to ${nextTheme} mode`}
      >
        {theme === "dark" ? <SunIcon width={16} height={16} /> : <MoonIcon width={16} height={16} />}
      </button>
    </header>
  );
}

/** The checked-out branch, refreshed with the refs (on open and on refresh). */
function BranchBadge() {
  const repo = useApp((s) => s.repo);
  const branch = useApp((s) => currentBranch(s.refs));
  if (!repo || branch === null) return null;
  const detached = branch === "";
  return (
    <span
      className={`branch-badge${detached ? " detached" : ""}`}
      role="status"
      aria-label={detached ? "HEAD is detached" : `Current branch: ${branch}`}
      title={detached ? "HEAD is detached (no branch checked out)" : `Current branch: ${branch}`}
    >
      <BranchIcon width={13} height={13} />
      <span className="branch-name">{detached ? "detached HEAD" : branch}</span>
    </span>
  );
}

/** Zoom out / current level (click to reset) / zoom in. */
function ZoomControl() {
  const zoom = useApp((s) => s.zoom);
  const zoomIn = useApp((s) => s.zoomIn);
  const zoomOut = useApp((s) => s.zoomOut);
  const resetZoom = useApp((s) => s.resetZoom);
  const percent = `${Math.round(zoom * 100)}%`;
  return (
    <div className="zoom-control" role="group" aria-label="Zoom">
      <button
        type="button"
        className="icon-button"
        onClick={zoomOut}
        disabled={zoom <= MIN_ZOOM}
        aria-label="Zoom out"
        title="Zoom out (Ctrl+-)"
      >
        −
      </button>
      <button
        type="button"
        className="zoom-level"
        onClick={resetZoom}
        aria-label={`Zoom ${percent}, reset to 100%`}
        title="Reset zoom (Ctrl+0)"
      >
        {percent}
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={zoomIn}
        disabled={zoom >= MAX_ZOOM}
        aria-label="Zoom in"
        title="Zoom in (Ctrl+=)"
      >
        +
      </button>
    </div>
  );
}
