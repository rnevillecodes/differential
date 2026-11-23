import "@xterm/xterm/css/xterm.css";
import { Fragment, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import {
  MAX_TERMINAL_GROUPS,
  MAX_TERMINAL_TITLE,
  MIN_TERMINAL_GROUP_WIDTH,
  MIN_TERMINAL_HEIGHT,
  useApp,
  type TerminalGroup,
  type TerminalTab,
} from "../store";
import { ChevronDownIcon, MaximizeIcon, PlusIcon, RestoreIcon, SplitIcon } from "./icons";

/** Space always left for the file pane above the terminal panel, in pixels. */
export const MIN_FILE_PANE_HEIGHT = 160;

interface MenuState {
  x: number;
  y: number;
  canCopy: boolean;
  /** The terminal the menu acts on: the clicked group's shown tab. */
  tab: number;
}

/**
 * The terminal panel under the file pane: a resize handle and one or more terminal groups side by side,
 * each with its own tabs and terminals. It stays mounted (hidden) while it has terminals, so their
 * shells and scrollback survive.
 */
export function TerminalPanel() {
  const repo = useApp((s) => s.repo);
  const open = useApp((s) => s.terminalOpen);
  const height = useApp((s) => s.terminalHeight);
  const terminals = useApp((s) => s.terminals);
  const groups = useApp((s) => s.terminalGroups);
  const activeGroup = useApp((s) => s.activeTerminalGroup);
  const active = useApp((s) => s.activeTerminal);
  const sessions = useApp((s) => s.terminalSessions);
  const toggleTerminal = useApp((s) => s.toggleTerminal);
  const setActiveTerminalGroup = useApp((s) => s.setActiveTerminalGroup);
  const setTerminalHeight = useApp((s) => s.setTerminalHeight);
  const setTerminalGroupSizes = useApp((s) => s.setTerminalGroupSizes);
  const maximized = useApp((s) => s.terminalMaximized);
  const toggleTerminalMaximized = useApp((s) => s.toggleTerminalMaximized);
  const panelRef = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Showing the panel, switching terminals, or splitting puts the keyboard in the active terminal.
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
    trackDrag(e.currentTarget, e.pointerId, (ev) => {
      const rect = container.getBoundingClientRect();
      const max = Math.max(MIN_TERMINAL_HEIGHT, rect.height - MIN_FILE_PANE_HEIGHT);
      setTerminalHeight(Math.min(max, Math.max(MIN_TERMINAL_HEIGHT, rect.bottom - ev.clientY)));
    });
  };

  /** Drag the divider right of group `index`: width moves between that group and the next one only. */
  const onDividerStart = (index: number, e: PointerEvent<HTMLDivElement>) => {
    const row = e.currentTarget.parentElement;
    if (!row || e.button !== 0) return;
    const widths = Array.from(row.querySelectorAll<HTMLElement>(":scope > .terminal-group"), (el) =>
      el.getBoundingClientRect().width,
    );
    if (widths.length !== groups.length || index + 1 >= widths.length) return;
    const pair = widths[index] + widths[index + 1];
    if (pair < 2 * MIN_TERMINAL_GROUP_WIDTH) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = widths[index];
    trackDrag(e.currentTarget, e.pointerId, (ev) => {
      const left = Math.min(pair - MIN_TERMINAL_GROUP_WIDTH, Math.max(MIN_TERMINAL_GROUP_WIDTH, start + ev.clientX - startX));
      const next = [...widths];
      next[index] = left;
      next[index + 1] = pair - left;
      setTerminalGroupSizes(next);
    });
  };

  const onContextMenu = (group: TerminalGroup, e: MouseEvent) => {
    e.preventDefault();
    setActiveTerminalGroup(group.id);
    setMenu({ x: e.clientX, y: e.clientY, canCopy: sessions.hasSelection(group.active), tab: group.active });
  };

  const runMenu = (action: "copy" | "paste") => {
    if (!menu) return;
    setMenu(null);
    if (action === "copy") sessions.copy(menu.tab);
    else sessions.paste(menu.tab);
    sessions.focus(menu.tab);
  };

  const byId = new Map(terminals.map((t) => [t.id, t]));
  const panelControls = (
    <>
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
    </>
  );

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
      <div className={`terminal-groups${groups.length > 1 ? " split" : ""}`}>
        {groups.map((g, i) => (
          <Fragment key={g.id}>
            {i > 0 && (
              <div
                className="terminal-group-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize terminal groups"
                onPointerDown={(e) => onDividerStart(i - 1, e)}
              />
            )}
            <TerminalGroupView
              group={g}
              tabs={g.tabs.flatMap((id) => byId.get(id) ?? [])}
              active={g.id === activeGroup}
              marked={groups.length > 1 && g.id === activeGroup}
              canSplit={groups.length < MAX_TERMINAL_GROUPS}
              onContextMenu={(e) => onContextMenu(g, e)}
              controls={i === groups.length - 1 ? panelControls : null}
            />
          </Fragment>
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

/** Follow a pointer drag that started on `handle` until it is released. */
function trackDrag(handle: HTMLElement, pointerId: number, onMove: (e: globalThis.PointerEvent) => void) {
  handle.setPointerCapture?.(pointerId);
  const onUp = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
}

/** One terminal group: its header (tabs, new, split, and the panel controls in the last group) and its terminals. */
function TerminalGroupView({
  group,
  tabs,
  active,
  marked,
  canSplit,
  onContextMenu,
  controls,
}: {
  group: TerminalGroup;
  tabs: TerminalTab[];
  /** Whether this is the active group. */
  active: boolean;
  /** Whether to show it as active (only when there is more than one group). */
  marked: boolean;
  canSplit: boolean;
  onContextMenu: (e: MouseEvent) => void;
  controls: ReactNode;
}) {
  const sessions = useApp((s) => s.terminalSessions);
  const newTerminal = useApp((s) => s.newTerminal);
  const splitTerminal = useApp((s) => s.splitTerminal);
  const closeTerminal = useApp((s) => s.closeTerminal);
  const setActiveTerminal = useApp((s) => s.setActiveTerminal);
  const setActiveTerminalGroup = useApp((s) => s.setActiveTerminalGroup);
  const renameTerminal = useApp((s) => s.renameTerminal);
  const activate = () => {
    if (!active) setActiveTerminalGroup(group.id);
  };

  return (
    <div
      className={`terminal-group${marked ? " active" : ""}`}
      data-testid="terminal-group"
      style={{ flex: `${group.size} 1 0` }}
      onFocusCapture={activate}
      onPointerDown={activate}
    >
      <div className="terminal-header">
        <div className="terminal-tabs" role="tablist" aria-label="Terminals">
          {tabs.map((t) => (
            <TerminalTabButton
              key={t.id}
              tab={t}
              active={t.id === group.active}
              onSelect={() => setActiveTerminal(t.id)}
              onClose={() => closeTerminal(t.id)}
              onRename={(title) => {
                if (title !== null) renameTerminal(t.id, title);
                sessions.focus(group.active);
              }}
            />
          ))}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="New terminal"
          title="New terminal"
          onClick={() => newTerminal(group.id)}
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Split terminal"
          title={canSplit ? "Split terminal" : `Split terminal (at most ${MAX_TERMINAL_GROUPS} groups)`}
          disabled={!canSplit}
          onClick={() => splitTerminal(group.id)}
        >
          <SplitIcon />
        </button>
        {controls}
      </div>
      <div className="terminal-body" data-terminal onContextMenu={onContextMenu}>
        {tabs.map((t) => (
          <TerminalHost key={t.id} tab={t} active={t.id === group.active} />
        ))}
      </div>
    </div>
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
  onRename,
}: {
  tab: TerminalTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  /** Called when renaming ends: the new title, or null if it was cancelled. */
  onRename: (title: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const label = statusLabel(tab);
  const detail = tab.status.kind === "failed" ? tab.status.message : tab.cwd;
  const tooltip = `${tab.title} — ${detail}\nDouble-click or F2 to rename`;
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
      {editing ? (
        <TerminalTitleInput
          title={tab.title}
          onDone={(title) => {
            setEditing(false);
            onRename(title);
          }}
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          title={tooltip}
          onClick={onSelect}
          onDoubleClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key !== "F2") return;
            e.preventDefault();
            setEditing(true);
          }}
        >
          {tab.title}
          {label && <span className="terminal-tab-status">({label})</span>}
        </button>
      )}
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

/** Inline editor for a terminal tab's title: Enter or leaving it saves, Escape cancels. */
function TerminalTitleInput({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="terminal-tab-input"
      aria-label="Terminal name"
      defaultValue={title}
      maxLength={MAX_TERMINAL_TITLE}
      size={Math.max(8, title.length + 1)}
      spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
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
