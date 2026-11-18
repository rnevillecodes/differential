import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { displayPath, useApp } from "../store";
import { buildTree, flatten, parentOf, type TreeRow } from "../tree/build";
import { CollapseAllIcon } from "./icons";
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
  const selectedId = useApp((s) => s.selectedId);
  const viewed = useApp((s) => s.viewed);
  const toggleFolder = useApp((s) => s.toggleFolder);
  const setFolderExpanded = useApp((s) => s.setFolderExpanded);
  const collapseAll = useApp((s) => s.collapseAll);
  const reveal = useApp((s) => s.reveal);
  const openTreePath = useApp((s) => s.openTreePath);

  const tree = useMemo(
    () => (projectFiles ? buildTree(projectFiles, changes?.files ?? null) : null),
    [projectFiles, changes],
  );
  const rows = useMemo(() => (tree ? flatten(tree, expanded) : []), [tree, expanded]);
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.node.path, i])), [rows]);

  const selectedPath =
    viewed?.path ?? (changes && selectedId !== null && changes.files[selectedId] ? displayPath(changes.files[selectedId]) : null);

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

  if (!repo) return <nav className="file-tree" aria-label="Project files" />;
  if (filesError) {
    return (
      <nav className="file-tree" aria-label="Project files">
        <div className="tree-message error" role="alert">
          Could not list files: {filesError.message}
        </div>
      </nav>
    );
  }
  if (!tree) {
    return (
      <nav className="file-tree" aria-label="Project files">
        <div className="tree-message">Loading files…</div>
      </nav>
    );
  }

  const activate = (row: TreeRow) => {
    setActive(row.node.path);
    if (row.node.type === "dir") toggleFolder(row.node.path);
    else openTreePath(row.node.path);
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
        if (!row) return;
        activate(row);
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
        className="file-list-scroll"
        ref={scrollRef}
        role="tree"
        aria-label="Files"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-activedescendant={active !== null && indexOf.has(active) ? treeItemId(active) : undefined}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <TreeRowView
                key={row.node.path}
                row={row}
                top={item.start}
                expanded={row.node.type === "dir" && expanded.has(row.node.path)}
                selected={row.node.path === selectedPath}
                active={row.node.path === active}
                onActivate={activate}
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
  selected,
  active,
  onActivate,
}: {
  row: TreeRow;
  top: number;
  expanded: boolean;
  selected: boolean;
  active: boolean;
  onActivate: (row: TreeRow) => void;
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
      title={node.path}
      data-testid="tree-row"
    >
      <span className="chevron" aria-hidden="true">
        {isDir ? (expanded ? "▾" : "▸") : ""}
      </span>
      <span className={`tree-name${isDir ? " dir-name" : ""}`}>{node.name}</span>
      {isDir && node.changedCount > 0 && (
        <span className="tree-count" title={`${node.changedCount} changed ${node.changedCount === 1 ? "file" : "files"}`}>
          {node.changedCount}
        </span>
      )}
      {change && <StatusBadge status={change.status} />}
    </div>
  );
});
