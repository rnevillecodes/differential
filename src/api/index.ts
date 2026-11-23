// Typed wrappers around the backend's Tauri commands.

import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import type { ChangeSet } from "../model/ChangeSet";
import type { CommitPage } from "../model/CommitPage";
import type { ErrorPayload } from "../model/ErrorPayload";
import type { FileDiff } from "../model/FileDiff";
import type { FileSummary } from "../model/FileSummary";
import type { FileView } from "../model/FileView";
import type { RefInfo } from "../model/RefInfo";
import type { RepoInfo } from "../model/RepoInfo";
import type { Side } from "../model/Side";
import type { TerminalExit } from "../model/TerminalExit";

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
  /** One page of the commit history (all branches, remote branches, tags and HEAD), topological order. */
  listCommits(root: string, offset: number, limit: number): Promise<CommitPage>;
  pickFolder(): Promise<string | null>;
  /** Scale the whole UI, like browser zoom; `1` is 100%. */
  setZoom(scale: number): Promise<void>;
  /**
   * Start the user's shell in `cwd` in a `cols`×`rows` pseudo-terminal. `onData` receives raw
   * output in order; `onExit` is called once, after the last output. Resolves to the session id.
   */
  terminalSpawn(
    cwd: string,
    cols: number,
    rows: number,
    onData: (bytes: Uint8Array) => void,
    onExit: (exit: TerminalExit) => void,
  ): Promise<number>;
  /** Send input to a session; unknown ids are ignored. */
  terminalWrite(id: number, data: string): Promise<void>;
  terminalResize(id: number, cols: number, rows: number): Promise<void>;
  /** End a session's shell and its programs; unknown ids are ignored. */
  terminalClose(id: number): Promise<void>;
}

/** Raw channel messages arrive as an ArrayBuffer (or a byte array from older runtimes). */
function toBytes(msg: unknown): Uint8Array {
  if (msg instanceof ArrayBuffer) return new Uint8Array(msg);
  if (ArrayBuffer.isView(msg)) return new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
  return Uint8Array.from(msg as number[]);
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
  listCommits: (root, offset, limit) => invoke("list_commits", { root, offset, limit }),
  setZoom: (scale) => getCurrentWebview().setZoom(scale),
  pickFolder: async () => {
    const picked = await open({ directory: true, multiple: false, title: "Open repository" });
    return typeof picked === "string" ? picked : null;
  },
  terminalSpawn: (cwd, cols, rows, onData, onExit) => {
    const dataChannel = new Channel<unknown>();
    dataChannel.onmessage = (msg) => onData(toBytes(msg));
    const exitChannel = new Channel<TerminalExit>();
    exitChannel.onmessage = onExit;
    return invoke("terminal_spawn", { cwd, cols, rows, onData: dataChannel, onExit: exitChannel });
  },
  terminalWrite: (id, data) => invoke("terminal_write", { id, data }),
  terminalResize: (id, cols, rows) => invoke("terminal_resize", { id, cols, rows }),
  terminalClose: (id) => invoke("terminal_close", { id }),
};

export function isErrorPayload(e: unknown): e is ErrorPayload {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

/** Normalize anything thrown by `invoke` into an `ErrorPayload`. */
export function toErrorPayload(e: unknown): ErrorPayload {
  if (isErrorPayload(e)) return e;
  return { kind: "invalid", message: e instanceof Error ? e.message : String(e) };
}
