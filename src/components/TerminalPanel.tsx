import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { MIN_TERMINAL_HEIGHT, useApp, type TerminalTab } from "../store";
import { ChevronDownIcon, MaximizeIcon, PlusIcon, RestoreIcon } from "./icons";

/** Space always left for the file pane above the terminal panel, in pixels. */
export const MIN_FILE_PANE_HEIGHT = 160;

/**
 * The terminal panel under the file pane: a resize handle, terminal tabs, and the terminals.
 * It stays mounted (hidden) while it has terminals, so their shells and scrollback survive.
 */
export function TerminalPanel() {
  const repo = useApp((s) => s.repo);
  const open = useApp((s) => s.terminalOpen);
  const height = useApp((s) => s.terminalHeight);
  const terminals = useApp((s) => s.terminals);
  const active = useApp((s) => s.activeTerminal);
  const sessions = useApp((s) => s.terminalSessions);
  const toggleTerminal = useApp((s) => s.toggleTerminal);
  const newTerminal = useApp((s) => s.newTerminal);
  const closeTerminal = useApp((s) => s.closeTerminal);
  const setActiveTerminal = useApp((s) => s.setActiveTerminal);
  const setTerminalHeight = useApp((s) => s.setTerminalHeight);
  const maximized = useApp((s) => s.terminalMaximized);
  const toggleTerminalMaximized = useApp((s) => s.toggleTerminalMaximized);
  const panelRef = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; canCopy: boolean } | null>(null);

  // Showing the panel or switching terminals puts the keyboard in the active terminal.
  useEffect(() => {
    if (open && active !== null) sessions.focus(active);
  }, [open, active, sessions]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", dismiss);
    };
  }, [menu]);

  if (!repo || (!open && terminals.length === 0)) return null;

  const onResizeStart = (e: PointerEvent<HTMLDivElement>) => {
    const container = panelRef.current?.parentElement;
    if (!container || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    const onMove = (ev: globalThis.PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const max = Math.max(MIN_TERMINAL_HEIGHT, rect.height - MIN_FILE_PANE_HEIGHT);
      setTerminalHeight(Math.min(max, Math.max(MIN_TERMINAL_HEIGHT, rect.bottom - ev.clientY)));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const onContextMenu = (e: MouseEvent) => {
    if (active === null) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, canCopy: sessions.hasSelection(active) });
  };

  const runMenu = (action: "copy" | "paste") => {
    setMenu(null);
    if (active === null) return;
    if (action === "copy") sessions.copy(active);
    else sessions.paste(active);
    sessions.focus(active);
  };

  return (
    <section
      ref={panelRef}
      className="terminal-panel"
      aria-label="Terminal"
      hidden={!open}
      style={
        maximized
          ? undefined
          : { height: `clamp(${MIN_TERMINAL_HEIGHT}px, ${height}px, calc(100% - ${MIN_FILE_PANE_HEIGHT}px))` }
      }
    >
      {!maximized && (
        <div
          className="terminal-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal panel"
          onPointerDown={onResizeStart}
        />
      )}
      <div className="terminal-header">
        <div className="terminal-tabs" role="tablist" aria-label="Terminals">
          {terminals.map((t) => (
            <TerminalTabButton
              key={t.id}
              tab={t}
              active={t.id === active}
              onSelect={() => setActiveTerminal(t.id)}
              onClose={() => closeTerminal(t.id)}
            />
          ))}
        </div>
        <button type="button" className="icon-button" aria-label="New terminal" title="New terminal" onClick={newTerminal}>
          <PlusIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={maximized ? "Restore terminal panel" : "Maximize terminal panel"}
          aria-pressed={maximized}
          title={maximized ? "Restore panel size" : "Maximize panel"}
          onClick={toggleTerminalMaximized}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Hide terminal panel"
          title="Hide terminal panel (Ctrl+`)"
          onClick={toggleTerminal}
        >
          <ChevronDownIcon />
        </button>
      </div>
      <div className="terminal-body" data-terminal onContextMenu={onContextMenu}>
        {terminals.map((t) => (
          <TerminalHost key={t.id} tab={t} active={t.id === active} />
        ))}
      </div>
      {menu && (
        <div
          className="context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" role="menuitem" disabled={!menu.canCopy} onClick={() => runMenu("copy")}>
            Copy <kbd>Ctrl+C</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => runMenu("paste")}>
            Paste <kbd>Ctrl+V</kbd>
          </button>
        </div>
      )}
    </section>
  );
}

function statusLabel(tab: TerminalTab): string | null {
  return tab.status.kind === "failed" ? "failed" : null;
}

function TerminalTabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: TerminalTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const label = statusLabel(tab);
  const tooltip =
    tab.status.kind === "failed" ? `${tab.title} — ${tab.status.message}` : `${tab.title} — ${tab.cwd}`;
  return (
    <div
      className={`terminal-tab${active ? " active" : ""}${label ? ` ${label}` : ""}`}
      data-testid="terminal-tab"
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
    >
      <button type="button" role="tab" aria-selected={active} title={tooltip} onClick={onSelect}>
        {tab.title}
        {label && <span className="terminal-tab-status">({label})</span>}
      </button>
      <button
        type="button"
        className="editor-tab-close"
        tabIndex={-1}
        aria-label={`Close ${tab.title}`}
        title="Close terminal"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}

/** Where one terminal's xterm element is shown; inactive terminals stay mounted but hidden. */
function TerminalHost({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const sessions = useApp((s) => s.terminalSessions);
  const ref = useRef<HTMLDivElement>(null);
  const { id, cwd } = tab;

  useEffect(() => {
    if (ref.current) sessions.attach(id, cwd, ref.current);
  }, [sessions, id, cwd]);

  return <div ref={ref} className="terminal-host" hidden={!active} data-testid="terminal-host" />;
}
