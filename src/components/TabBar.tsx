import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { changeAt, useApp, type Tab } from "../store";
import { StatusBadge } from "./status";

export const tabId = (path: string) => `editor-tab-${encodeURIComponent(path)}`;
export const tabPanelId = (path: string) => `editor-panel-${encodeURIComponent(path)}`;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirName = (path: string) => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};

/**
 * Tabs for the open files. Click to switch, double-click to pin a preview tab,
 * middle-click or × to close; ←/→, Home/End and Delete work when a tab has focus.
 */
export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const activePath = useApp((s) => s.activePath);
  const changes = useApp((s) => s.changes);
  const activateTab = useApp((s) => s.activateTab);
  const closeTab = useApp((s) => s.closeTab);
  const pinTab = useApp((s) => s.pinTab);
  const listRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);

  // Names shared by several tabs get their folder shown too.
  const duplicated = useMemo(() => {
    const seen = new Map<string, number>();
    for (const t of tabs) seen.set(baseName(t.path), (seen.get(baseName(t.path)) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  }, [tabs]);

  useEffect(() => {
    if (activePath === null) {
      refocus.current = false;
      return;
    }
    const el = document.getElementById(tabId(activePath));
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    if (refocus.current) {
      refocus.current = false;
      el?.focus();
    }
  }, [activePath, tabs]);

  const onKeyDown = (e: KeyboardEvent, tab: Tab, i: number) => {
    let target: Tab | undefined;
    switch (e.key) {
      case "ArrowLeft":
        target = tabs[(i - 1 + tabs.length) % tabs.length];
        break;
      case "ArrowRight":
        target = tabs[(i + 1) % tabs.length];
        break;
      case "Home":
        target = tabs[0];
        break;
      case "End":
        target = tabs[tabs.length - 1];
        break;
      case "Delete":
        refocus.current = true;
        closeTab(tab.path);
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    refocus.current = true;
    activateTab(target.path);
  };

  const onAuxClick = (e: MouseEvent, tab: Tab) => {
    if (e.button !== 1) return;
    e.preventDefault();
    closeTab(tab.path);
  };

  // Let a plain mouse wheel scroll the strip sideways.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaX === 0 && listRef.current) listRef.current.scrollLeft += e.deltaY;
  };

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open files" ref={listRef} onWheel={onWheel}>
      {tabs.map((tab, i) => {
        const active = tab.path === activePath;
        const change = changeAt(changes, tab.path);
        const name = baseName(tab.path);
        const dir = duplicated.has(name) ? dirName(tab.path) : "";
        return (
          <div
            key={tab.path}
            className={`editor-tab${active ? " active" : ""}${tab.preview ? " preview" : ""}`}
            onAuxClick={(e) => onAuxClick(e, tab)}
            onMouseDown={(e) => e.button === 1 && e.preventDefault() /* no autoscroll */}
            data-testid="editor-tab"
          >
            <button
              type="button"
              role="tab"
              id={tabId(tab.path)}
              aria-selected={active}
              aria-controls={tabPanelId(tab.path)}
              tabIndex={active ? 0 : -1}
              title={tab.preview ? `${tab.path} (preview — double-click to keep open)` : tab.path}
              onClick={() => activateTab(tab.path)}
              onDoubleClick={() => pinTab(tab.path)}
              onKeyDown={(e) => onKeyDown(e, tab, i)}
            >
              {change && <StatusBadge status={change.status} />}
              <span className="editor-tab-name">{name}</span>
              {dir && <span className="editor-tab-dir">{dir}</span>}
            </button>
            <button
              type="button"
              className="editor-tab-close"
              tabIndex={-1}
              aria-label={`Close ${tab.path}`}
              title="Close (Ctrl+W)"
              onClick={() => closeTab(tab.path)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
