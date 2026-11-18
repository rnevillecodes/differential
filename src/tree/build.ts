// Pure project-tree model: build a folder tree from repo-relative paths, decorate it
// with the change set, and flatten it into the visible rows for a virtualized list.

import type { FileSummary } from "../model/FileSummary";

export interface FileNode {
  type: "file";
  name: string;
  path: string;
  /** The change for this path, or `null` when the file is unchanged. */
  change: FileSummary | null;
}

export interface DirNode {
  type: "dir";
  name: string;
  /** Repo-relative path; `""` for the root. */
  path: string;
  dirs: DirNode[];
  files: FileNode[];
  /** Changed files at any depth below this folder. */
  changedCount: number;
}

export type TreeNode = DirNode | FileNode;

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

/** The path a change occupies in the working-tree view: its old path only if deleted. */
export const treePathOf = (f: FileSummary): string =>
  (f.status === "deleted" ? f.oldPath : f.newPath) ?? f.oldPath ?? "";

const collator = new Intl.Collator(undefined, { sensitivity: "base" });
const byName = (a: { name: string }, b: { name: string }): number =>
  collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

interface BuildDir {
  name: string;
  path: string;
  dirs: Map<string, BuildDir>;
  files: FileNode[];
}

/**
 * Build the tree from the project listing plus the change set. Every changed path is
 * included even if absent from `paths` (deleted files, or a listing older than the
 * change set); a renamed file's old path is not.
 */
export function buildTree(paths: readonly string[], changes: readonly FileSummary[] | null): DirNode {
  const changed = new Map<string, FileSummary>();
  for (const f of changes ?? []) changed.set(treePathOf(f), f);

  const root: BuildDir = { name: "", path: "", dirs: new Map(), files: [] };
  const seen = new Set<string>();
  const add = (path: string) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    const parts = path.split("/");
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = dir.dirs.get(parts[i]);
      if (!next) {
        next = { name: parts[i], path: dir.path ? `${dir.path}/${parts[i]}` : parts[i], dirs: new Map(), files: [] };
        dir.dirs.set(parts[i], next);
      }
      dir = next;
    }
    dir.files.push({ type: "file", name: parts[parts.length - 1], path, change: changed.get(path) ?? null });
  };
  for (const p of paths) add(p);
  for (const p of changed.keys()) add(p);

  const finish = (d: BuildDir): DirNode => {
    const dirs = [...d.dirs.values()].map(finish).sort(byName);
    const files = d.files.sort(byName);
    const changedCount =
      dirs.reduce((n, c) => n + c.changedCount, 0) + files.reduce((n, f) => n + (f.change ? 1 : 0), 0);
    return { type: "dir", name: d.name, path: d.path, dirs, files, changedCount };
  };
  return finish(root);
}

/** The visible rows: children of the root, descending only into expanded folders. */
export function flatten(root: DirNode, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: DirNode, depth: number) => {
    for (const d of dir.dirs) {
      rows.push({ node: d, depth });
      if (expanded.has(d.path)) walk(d, depth + 1);
    }
    for (const f of dir.files) rows.push({ node: f, depth });
  };
  walk(root, 0);
  return rows;
}

/** Folder paths containing `path`, outermost first: `a/b/c.ts` → `["a", "a/b"]`. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/** Parent folder path, or `""` for top-level entries. */
export const parentOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
};

/** All folder paths in the tree (excluding the root). */
export function dirPaths(root: DirNode): Set<string> {
  const out = new Set<string>();
  const walk = (d: DirNode) => {
    for (const c of d.dirs) {
      out.add(c.path);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** Keep only expanded folders that still exist in `root`. */
export function pruneExpanded(expanded: ReadonlySet<string>, root: DirNode): Set<string> {
  const dirs = dirPaths(root);
  return new Set([...expanded].filter((p) => dirs.has(p)));
}
