import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useApp } from "../store";
import { ancestorsOf, buildTree, flatten, parentOf, type TreeRow } from "../tree/build";
import { CollapseAllIcon, FilesIcon, FolderOpenIcon } from "./icons";
import { SidebarEmpty } from "./SidebarEmpty";
import { StatusBadge } from "./status";

const ROW_HEIGHT = 28;
const INDENT = 12;

/** The project as a virtualized, keyboard-navigable folder tree. */
export function FileTree() {
  const repo = useApp((s) => s.repo);
  const changes = useApp((s) => s.changes);
  const projectFiles = useApp((s) => s.projectFiles);
  const filesError = useApp((s) => s.filesError);
  const expanded = useApp((s) => s.expanded);
  const selectedPath = useApp((s) => s.activePath);
  const toggleFolder = useApp((s) => s.toggleFolder);
  const setFolderExpanded = useApp((s) => s.setFolderExpanded);
  const collapseAll = useApp((s) => s.collapseAll);
  const collapseSubtree = useApp((s) => s.collapseSubtree);
  const setPickerOpen = useApp((s) => s.setRepoPickerOpen);
  const refresh = useApp((s) => s.refresh);
  const reveal = useApp((s) => s.reveal);
  const openTreePath = useApp((s) => s.openTreePath);

  const tree = useMemo(
    () => (projectFiles ? buildTree(projectFiles, changes?.files ?? null) : null),
    [projectFiles, changes],
  );
  const rows = useMemo(() => (tree ? flatten(tree, expanded) : []), [tree, expanded]);
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.node.path, i])), [rows]);
  // Folders with an expanded folder somewhere below them (remembered ones included).
  const hasExpandedBelow = useMemo(() => {
    const out = new Set<string>();
    for (const p of expanded) for (const a of ancestorsOf(p)) out.add(a);
    return out;
  }, [expanded]);

  // Whether the tree holds focus: the cursor outline and full-strength selection depend on it.
  const [focused, setFocused] = useState(false);

  // Keyboard cursor; follows the selection when it changes elsewhere.
  const [active, setActive] = useState<string | null>(selectedPath);
  useEffect(() => setActive(selectedPath), [selectedPath]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Reveal the selected file: expand its folders, then scroll it into view once it has a row.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (tree && selectedPath) reveal(selectedPath);
  }, [tree, selectedPath, reveal]);
  useEffect(() => {
    if (!selectedPath || revealed.current === selectedPath) return;
    const i = indexOf.get(selectedPath);
    if (i !== undefined) {
      revealed.current = selectedPath;
      virtualizer.scrollToIndex(i, { align: "auto" });
    }
  }, [selectedPath, indexOf, virtualizer]);

  if (!repo) {
    return (
      <nav className="file-tree" aria-label="Project files">
        <SidebarEmpty
          icon={<FilesIcon width={28} height={28} />}
          title="No repository open"
          action={{ label: "Open a repository…", onClick: () => setPickerOpen(true) }}
        >
          Open a repository to browse its files.
        </SidebarEmpty>
      </nav>
    );
  }
  if (filesError) {
    return (
      <nav className="file-tree" aria-label="Project files">
        <SidebarEmpty
          tone="error"
          title="Could not list files"
          action={{ label: "Try again", onClick: () => void refresh() }}
        >
          {filesError.message}
        </SidebarEmpty>
      </nav>
    );
  }
  if (!tree) {
    return (
      <nav className="file-tree" aria-label="Project files">
        <SidebarEmpty title="Loading files…" />
      </nav>
    );
  }
  if (tree.dirs.length === 0 && tree.files.length === 0) {
    return (
      <nav className="file-tree" aria-label="Project files">
        <SidebarEmpty icon={<FilesIcon width={28} height={28} />} title="No files">
          This repository has no tracked or untracked files yet.
        </SidebarEmpty>
      </nav>
    );
  }

  const activate = (row: TreeRow, pin = false) => {
    setActive(row.node.path);
    if (row.node.type === "dir") {
      if (!pin) toggleFolder(row.node.path);
    } else {
      openTreePath(row.node.path, pin);
    }
  };

  const moveTo = (i: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!row) return;
    setActive(row.node.path);
    virtualizer.scrollToIndex(indexOf.get(row.node.path)!, { align: "auto" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey || rows.length === 0) return;
    const i = active === null ? -1 : (indexOf.get(active) ?? -1);
    const row = i >= 0 ? rows[i] : null;
    switch (e.key) {
      case "ArrowDown":
        moveTo(i + 1);
        break;
      case "ArrowUp":
        moveTo(i < 0 ? 0 : i - 1);
        break;
      case "ArrowRight":
        if (row?.node.type !== "dir") return;
        if (!expanded.has(row.node.path)) setFolderExpanded(row.node.path, true);
        else if (rows[i + 1]?.depth > row.depth) moveTo(i + 1);
        break;
      case "ArrowLeft": {
        if (!row) return;
        if (e.shiftKey) {
          if (row.node.type === "dir") collapseSubtree(row.node.path);
          break;
        }
        if (row.node.type === "dir" && expanded.has(row.node.path)) {
          setFolderExpanded(row.node.path, false);
        } else {
          const parent = indexOf.get(parentOf(row.node.path));
          if (parent === undefined) return;
          moveTo(parent);
        }
        break;
      }
      case "Enter":
        // A deliberate open, so it gets a regular tab rather than the preview tab.
        if (!row) return;
        activate(row, row.node.type === "file");
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <nav className="file-tree" aria-label="Project files">
      <div className="file-list-header tree-header">
        <span className="tree-root-name" title={repo.root}>
          {repoName(repo.root)}
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={collapseAll}
          disabled={expanded.size === 0}
          title="Collapse all folders"
          aria-label="Collapse all folders"
        >
          <CollapseAllIcon />
        </button>
      </div>
      <div
        className={`file-list-scroll${focused ? " tree-focused" : ""}`}
        ref={scrollRef}
        role="tree"
        aria-label="Files"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
        aria-activedescendant={active !== null && indexOf.has(active) ? treeItemId(active) : undefined}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            const isOpenDir = row.node.type === "dir" && expanded.has(row.node.path);
            return (
              <TreeRowView
                key={row.node.path}
                row={row}
                top={item.start}
                expanded={isOpenDir}
                canCollapseSubtree={isOpenDir && hasExpandedBelow.has(row.node.path)}
                selected={row.node.path === selectedPath}
                active={row.node.path === active}
                onActivate={activate}
                onCollapseSubtree={collapseSubtree}
              />
            );
          })}
        </div>
      </div>
    </nav>
  );
}

const repoName = (repo: string) => repo.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || repo;

const treeItemId = (path: string) => `tree-${encodeURIComponent(path)}`;

const TreeRowView = memo(function TreeRowView({
  row,
  top,
  expanded,
  canCollapseSubtree,
  selected,
  active,
  onActivate,
  onCollapseSubtree,
}: {
  row: TreeRow;
  top: number;
  expanded: boolean;
  canCollapseSubtree: boolean;
  selected: boolean;
  active: boolean;
  onActivate: (row: TreeRow, pin?: boolean) => void;
  onCollapseSubtree: (path: string) => void;
}) {
  const { node, depth } = row;
  const isDir = node.type === "dir";
  const change = node.type === "file" ? node.change : null;
  return (
    <div
      id={treeItemId(node.path)}
      className={`file-row tree-row${active ? " active" : ""}${change?.status === "deleted" ? " deleted" : ""}`}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={isDir ? expanded : undefined}
      style={{ transform: `translateY(${top}px)`, paddingLeft: 8 + depth * INDENT }}
      onClick={() => onActivate(row)}
      onDoubleClick={() => onActivate(row, true)}
      title={node.path}
      data-testid="tree-row"
    >
      <span className="tree-icon" aria-hidden="true">
        {isDir &&
          (expanded ? <FolderOpenIcon data-icon="folder-open" /> : <FilesIcon data-icon="folder-closed" />)}
      </span>
      <span className={`tree-name${isDir ? " dir-name" : ""}`}>{node.name}</span>
      {isDir && node.changedCount > 0 && (
        <span className="tree-count" title={`${node.changedCount} changed ${node.changedCount === 1 ? "file" : "files"}`}>
          {node.changedCount}
        </span>
      )}
      {change && <StatusBadge status={change.status} />}
      <span className="subtree-slot">
        {canCollapseSubtree && (
          <button
            type="button"
            className="icon-button subtree-toggle"
            tabIndex={-1}
            title="Collapse folder and subfolders"
            aria-label="Collapse folder and subfolders"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onCollapseSubtree(node.path);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <CollapseAllIcon />
          </button>
        )}
      </span>
    </div>
  );
});
