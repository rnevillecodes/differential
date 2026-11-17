// Shared test helpers: a fake backend and model builders.

import { vi } from "vitest";
import type { Api } from "../api";
import type { ChangeSet } from "../model/ChangeSet";
import type { FileDiff } from "../model/FileDiff";
import type { FileSummary } from "../model/FileSummary";
import type { Hunk } from "../model/Hunk";
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

export function fakeApi(over: Partial<Api> = {}): Api {
  return {
    initialArgs: vi.fn(async () => ({ path: null, base: null })),
    openRepo: vi.fn(async (path: string) => ({ root: path, headSha: "abc123" })),
    listChanges: vi.fn(async () => changeSet([summary(0, "a.ts"), summary(1, "b.ts")])),
    fileDiff: vi.fn(async () => fileDiff([])),
    fileContent: vi.fn(async () => "x\n"),
    listFiles: vi.fn(async () => ["a.ts", "b.ts", "README.md"]),
    viewFile: vi.fn(async () => ({ kind: "text" as const, content: "x\n" })),
    pickFolder: vi.fn(async () => null),
    ...over,
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
