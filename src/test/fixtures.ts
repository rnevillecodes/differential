// Shared test helpers: a fake backend and model builders.

import { vi } from "vitest";
import type { Api } from "../api";
import type { ChangeSet } from "../model/ChangeSet";
import type { CommitInfo } from "../model/CommitInfo";
import type { FileDiff } from "../model/FileDiff";
import type { FileSummary } from "../model/FileSummary";
import type { Hunk } from "../model/Hunk";
import type { RepoEvent } from "../model/RepoEvent";
import type { Line } from "../model/Line";
import type { KeyValue } from "../store";

export function summary(id: number, path: string, over: Partial<FileSummary> = {}): FileSummary {
  return {
    id,
    status: "modified",
    oldPath: path,
    newPath: path,
    additions: 1,
    deletions: 1,
    isBinary: false,
    isLarge: false,
    ...over,
  };
}

export function changeSet(files: FileSummary[], over: Partial<ChangeSet> = {}): ChangeSet {
  return {
    repoRoot: "C:/repo",
    baseRef: "HEAD",
    baseSha: "abc123",
    files,
    totals: {
      files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
    },
    ...over,
  };
}

export const ctx = (text: string, oldNo: number, newNo: number): Line => ({
  kind: "context",
  text,
  oldNo,
  newNo,
  intraline: null,
});
export const add = (text: string, newNo: number, intraline: Line["intraline"] = null): Line => ({
  kind: "added",
  text,
  oldNo: null,
  newNo,
  intraline,
});
export const rem = (text: string, oldNo: number, intraline: Line["intraline"] = null): Line => ({
  kind: "removed",
  text,
  oldNo,
  newNo: null,
  intraline,
});

export function hunk(oldStart: number, oldLines: number, newStart: number, newLines: number, lines: Line[], header = ""): Hunk {
  return { oldStart, oldLines, newStart, newLines, header, lines };
}

export function fileDiff(hunks: Hunk[], over: Partial<FileDiff> = {}): FileDiff {
  return { fileId: 0, isBinary: false, hunks, oldNoEofNewline: false, newNoEofNewline: false, ...over };
}

/** A commit whose short SHA is its SHA and whose subject defaults to "commit <sha>". */
export function commit(sha: string, parents: string[] = [], over: Partial<CommitInfo> = {}): CommitInfo {
  return {
    sha,
    shortSha: sha,
    parents,
    author: "Ada",
    date: "2026-01-02T03:04:05+00:00",
    subject: `commit ${sha}`,
    labels: [],
    head: false,
    ...over,
  };
}

export function fakeApi(over: Partial<Api> = {}): Api {
  return {
    initialArgs: vi.fn(async () => ({ path: null, base: null })),
    openRepo: vi.fn(async (path: string) => ({ root: path, headSha: "abc123" })),
    listChanges: vi.fn(async () => changeSet([summary(0, "a.ts"), summary(1, "b.ts")])),
    fileDiff: vi.fn(async () => fileDiff([])),
    fileContent: vi.fn(async () => "x\n"),
    listFiles: vi.fn(async () => ["a.ts", "b.ts", "README.md"]),
    viewFile: vi.fn(async () => ({ kind: "text" as const, content: "x\n" })),
    listRefs: vi.fn(async () => [
      { name: "feature", rev: "feature", kind: "local" as const, current: true },
      { name: "main", rev: "main", kind: "local" as const, current: false },
      { name: "origin/main", rev: "origin/main", kind: "remote" as const, current: false },
      { name: "v1.0", rev: "v1.0", kind: "tag" as const, current: false },
    ]),
    listCommits: vi.fn(async () => ({
      commits: [
        commit("abc123", ["def456"], { head: true, labels: [{ name: "main", rev: "main", kind: "local" }] }),
        commit("def456"),
      ],
      hasMore: false,
    })),
    pickFolder: vi.fn(async () => null),
    setZoom: vi.fn(async () => {}),
    terminalSpawn: vi.fn(async () => 1),
    terminalWrite: vi.fn(async () => {}),
    terminalResize: vi.fn(async () => {}),
    terminalClose: vi.fn(async () => {}),
    watchRepo: vi.fn(async () => 1),
    unwatchRepo: vi.fn(async () => {}),
    ...over,
  };
}

/**
 * A controllable repository watcher for `fakeApi`: spread `api` into the overrides, then call
 * `emit` to deliver an event to the most recent watch (or to a given earlier one by index).
 */
export function fakeWatcher() {
  const listeners: ((e: RepoEvent) => void)[] = [];
  let nextId = 0;
  const api = {
    watchRepo: vi.fn(async (_root: string, onEvent: (e: RepoEvent) => void) => {
      listeners.push(onEvent);
      return ++nextId;
    }),
    unwatchRepo: vi.fn(async () => {}),
  };
  return {
    api,
    /** Number of watches started so far. */
    get count() {
      return listeners.length;
    },
    emit(event: RepoEvent, watch = listeners.length - 1) {
      listeners[watch]?.(event);
    },
    changed(worktree = true, git = false, watch?: number) {
      this.emit({ kind: "changed", worktree, git }, watch);
    },
  };
}

export function memoryStorage(initial: Record<string, string> = {}): KeyValue & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: (k) => data[k] ?? null,
    set: (k, v) => {
      data[k] = v;
    },
  };
}

/** Let pending promise callbacks run. */
export const flush = () => new Promise((r) => setTimeout(r, 0));
