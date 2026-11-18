// Typed wrappers around the backend's Tauri commands.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ChangeSet } from "../model/ChangeSet";
import type { ErrorPayload } from "../model/ErrorPayload";
import type { FileDiff } from "../model/FileDiff";
import type { FileSummary } from "../model/FileSummary";
import type { FileView } from "../model/FileView";
import type { RefInfo } from "../model/RefInfo";
import type { RepoInfo } from "../model/RepoInfo";
import type { Side } from "../model/Side";

export interface InitialArgs {
  path: string | null;
  base: string | null;
}

/** Everything the UI needs from the backend; mocked in tests. */
export interface Api {
  initialArgs(): Promise<InitialArgs>;
  openRepo(path: string): Promise<RepoInfo>;
  listChanges(root: string, base: string): Promise<ChangeSet>;
  fileDiff(root: string, baseSha: string, file: FileSummary, force: boolean): Promise<FileDiff>;
  fileContent(root: string, baseSha: string, path: string, side: Side): Promise<string | null>;
  /** Every project file in the working tree (tracked + untracked, not ignored). */
  listFiles(root: string): Promise<string[]>;
  /** One working-tree file for display; large files are only read with `force`. */
  viewFile(root: string, path: string, force: boolean): Promise<FileView>;
  /** Local branches, remote-tracking branches and tags, most recent first. */
  listRefs(root: string): Promise<RefInfo[]>;
  pickFolder(): Promise<string | null>;
}

export const tauriApi: Api = {
  initialArgs: () => invoke("initial_args"),
  openRepo: (path) => invoke("open_repo", { path }),
  listChanges: (root, base) => invoke("list_changes", { root, base }),
  fileDiff: (root, baseSha, file, force) => invoke("file_diff", { root, baseSha, file, force }),
  fileContent: (root, baseSha, path, side) => invoke("file_content", { root, baseSha, path, side }),
  listFiles: (root) => invoke("list_files", { root }),
  viewFile: (root, path, force) => invoke("view_file", { root, path, force }),
  listRefs: (root) => invoke("list_refs", { root }),
  pickFolder: async () => {
    const picked = await open({ directory: true, multiple: false, title: "Open repository" });
    return typeof picked === "string" ? picked : null;
  },
};

export function isErrorPayload(e: unknown): e is ErrorPayload {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

/** Normalize anything thrown by `invoke` into an `ErrorPayload`. */
export function toErrorPayload(e: unknown): ErrorPayload {
  if (isErrorPayload(e)) return e;
  return { kind: "invalid", message: e instanceof Error ? e.message : String(e) };
}
