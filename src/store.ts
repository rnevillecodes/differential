// Application state: which repo/base is open, the change set, the selected file and
// its loaded diff, the view mode, and the project explorer (sidebar tab, project
// file listing, expanded folders, and the unchanged file being viewed).

import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { createContext, useContext } from "react";
import { toErrorPayload, type Api } from "./api";
import type { ChangeSet } from "./model/ChangeSet";
import type { ErrorPayload } from "./model/ErrorPayload";
import type { FileDiff } from "./model/FileDiff";
import type { FileSummary } from "./model/FileSummary";
import type { FileView } from "./model/FileView";
import type { RepoInfo } from "./model/RepoInfo";
import { ancestorsOf } from "./tree/build";

export type ViewMode = "unified" | "split";
export type SidebarTab = "changes" | "files";

export type FileLoad =
  | { status: "loading" }
  | { status: "binary" }
  | { status: "large" }
  | { status: "error"; error: ErrorPayload }
  | { status: "ready"; diff: FileDiff; oldContent: string | null; newContent: string | null };

/** Load state of an unchanged file opened from the project tree. */
export type ViewLoad =
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "binary" }
  | { status: "large"; size: number }
  | { status: "missing" }
  | { status: "notAFile" }
  | { status: "error"; error: ErrorPayload };

export interface ViewedFile {
  path: string;
  load: ViewLoad;
}

export interface AppState {
  repo: RepoInfo | null;
  /** The base the current change set was computed against. */
  base: string;
  changes: ChangeSet | null;
  /** Selected changed file. Never set while `viewed` is set. */
  selectedId: number | null;
  viewMode: ViewMode;
  /** Blocking error (git missing, not a repository, ...). */
  error: ErrorPayload | null;
  /** Error from the last base change; the previous diff stays visible. */
  baseError: string | null;
  loading: boolean;
  /** Loaded per-file data, keyed by file id within `changes`. */
  files: Record<number, FileLoad>;

  sidebarTab: SidebarTab;
  /** Every project file, once the Files tab has been opened for this repo. */
  projectFiles: string[] | null;
  filesError: ErrorPayload | null;
  /** Expanded folder paths in the project tree. */
  expanded: ReadonlySet<string>;
  /** Unchanged file shown in the main pane. Never set while `selectedId` is set. */
  viewed: ViewedFile | null;

  init(): Promise<void>;
  openPath(path: string, base?: string): Promise<void>;
  pickAndOpen(): Promise<void>;
  setBase(base: string): Promise<void>;
  refresh(): Promise<void>;
  select(id: number): void;
  selectNext(): void;
  selectPrev(): void;
  loadLarge(id: number): void;
  setViewMode(mode: ViewMode): void;
  toggleViewMode(): void;

  setSidebarTab(tab: SidebarTab): void;
  toggleFolder(path: string): void;
  setFolderExpanded(path: string, open: boolean): void;
  /** Collapse every folder in the project tree. */
  collapseAll(): void;
  /** Expand every folder containing `path`. */
  reveal(path: string): void;
  /** Open a file from the project tree: its diff if changed, else its contents. */
  openTreePath(path: string): void;
  /** Load the viewed file even though it is large. */
  loadViewedAnyway(): void;
}

/** Minimal key-value storage (localStorage in the app). */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const browserStorage: KeyValue = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // storage unavailable: the preference just won't persist
    }
  },
};

const VIEW_MODE_KEY = "differential.viewMode";
const SIDEBAR_TAB_KEY = "differential.sidebarTab";

export const displayPath = (f: FileSummary): string => f.newPath ?? f.oldPath ?? "";

function toViewLoad(v: FileView): ViewLoad {
  switch (v.kind) {
    case "text":
      return { status: "ready", content: v.content };
    case "large":
      return { status: "large", size: v.size };
    default:
      return { status: v.kind };
  }
}

/** Folders implied by a set of file paths. */
function foldersOf(paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const p of paths) for (const a of ancestorsOf(p)) out.add(a);
  return out;
}

export function createAppStore(api: Api, storage: KeyValue = browserStorage): StoreApi<AppState> {
  // Incremented on every change-set load; stale responses are dropped.
  let generation = 0;
  // Incremented on every viewed-file request; stale responses are dropped.
  let viewToken = 0;
  let initialized = false;

  return createStore<AppState>((set, get) => {
    /** Whether the project listing should be (re)loaded with the change set. */
    const wantFiles = () => get().sidebarTab === "files" || get().projectFiles !== null;

    const fetchFiles = (root: string): Promise<{ files: string[] } | { error: ErrorPayload }> =>
      api.listFiles(root).then(
        (files) => ({ files }),
        (e) => ({ error: toErrorPayload(e) }),
      );

    const applyFiles = (result: { files: string[] } | { error: ErrorPayload }) => {
      if ("error" in result) {
        set({ filesError: result.error });
        return;
      }
      const { changes, expanded } = get();
      const folders = foldersOf([...result.files, ...(changes?.files.map(displayPath) ?? [])]);
      set({
        projectFiles: result.files,
        filesError: null,
        expanded: new Set([...expanded].filter((p) => folders.has(p))),
      });
    };

    const loadChanges = async (root: string, base: string, keepSelection: boolean): Promise<boolean> => {
      const gen = ++generation;
      set({ loading: true });
      const filesPromise = wantFiles() ? fetchFiles(root) : null;
      try {
        const changes = await api.listChanges(root, base);
        if (gen !== generation) return false;
        const prev = get();
        const prevPath =
          keepSelection && prev.changes && prev.selectedId !== null
            ? displayPath(prev.changes.files[prev.selectedId])
            : null;
        const viewedPath = keepSelection ? (prev.viewed?.path ?? null) : null;
        const findPath = (p: string | null) =>
          p === null ? undefined : changes.files.find((f) => displayPath(f) === p);
        const kept = findPath(prevPath) ?? findPath(viewedPath);
        // Still viewing an unchanged file: keep it unless it now has changes.
        const keepViewed = viewedPath !== null && !kept;
        set({
          changes,
          base: changes.baseRef,
          files: {},
          baseError: null,
          error: null,
          loading: false,
          selectedId: kept ? kept.id : keepViewed ? null : changes.files.length > 0 ? 0 : null,
          viewed: keepViewed ? get().viewed : null,
        });
        const sel = get().selectedId;
        if (sel !== null) loadFile(sel, false);
        if (filesPromise) {
          const result = await filesPromise;
          if (gen !== generation) return true;
          applyFiles(result);
        }
        const viewed = get().viewed;
        if (viewed) {
          const listed = get().projectFiles;
          if (listed && !listed.includes(viewed.path)) set({ viewed: null });
          else loadViewed(viewed.path, false);
        }
        return true;
      } catch (e) {
        if (gen !== generation) return false;
        const err = toErrorPayload(e);
        if (err.kind === "badRevision" && get().changes) {
          set({ baseError: err.message, loading: false });
        } else {
          set({ error: err, loading: false });
        }
        return false;
      }
    };

    /** Load the listing outside a change-set load (first switch to the Files tab). */
    const loadFilesNow = () => {
      const { repo } = get();
      if (!repo) return;
      const gen = generation;
      void fetchFiles(repo.root).then((result) => {
        if (gen === generation) applyFiles(result);
      });
    };

    const loadFile = (id: number, force: boolean) => {
      const { changes, repo } = get();
      if (!changes || !repo) return;
      const file = changes.files[id];
      if (!file) return;
      if (file.isBinary) {
        setFile(id, { status: "binary" });
        return;
      }
      if (file.isLarge && !force) {
        setFile(id, { status: "large" });
        return;
      }
      const gen = generation;
      setFile(id, { status: "loading" });
      const root = changes.repoRoot;
      const sha = changes.baseSha;
      const oldSide = file.status === "added" || file.status === "untracked" ? null : file.oldPath;
      const newSide = file.status === "deleted" ? null : file.newPath;
      Promise.all([
        api.fileDiff(root, sha, file, force),
        oldSide ? api.fileContent(root, sha, oldSide, "base") : Promise.resolve(null),
        newSide ? api.fileContent(root, sha, newSide, "worktree") : Promise.resolve(null),
      ]).then(
        ([diff, oldContent, newContent]) => {
          if (gen === generation) setFile(id, { status: "ready", diff, oldContent, newContent });
        },
        (e) => {
          if (gen === generation) setFile(id, { status: "error", error: toErrorPayload(e) });
        },
      );
    };

    const setFile = (id: number, load: FileLoad) => set({ files: { ...get().files, [id]: load } });

    const loadViewed = (path: string, force: boolean) => {
      const { repo } = get();
      if (!repo) return;
      const token = ++viewToken;
      const current = get().viewed;
      // Keep showing the old contents while a refresh re-reads the same file.
      const keep = current?.path === path && current.load.status === "ready" && !force;
      set({ selectedId: null, viewed: { path, load: keep ? current.load : { status: "loading" } } });
      api.viewFile(repo.root, path, force).then(
        (v) => {
          if (token === viewToken && get().viewed?.path === path) set({ viewed: { path, load: toViewLoad(v) } });
        },
        (e) => {
          if (token === viewToken && get().viewed?.path === path)
            set({ viewed: { path, load: { status: "error", error: toErrorPayload(e) } } });
        },
      );
    };

    const move = (delta: number) => {
      const { changes, selectedId } = get();
      if (!changes || changes.files.length === 0) return;
      const next =
        selectedId === null ? 0 : Math.min(changes.files.length - 1, Math.max(0, selectedId + delta));
      get().select(next);
    };

    const savedMode = storage.get(VIEW_MODE_KEY);
    const savedTab = storage.get(SIDEBAR_TAB_KEY);

    return {
      repo: null,
      base: "HEAD",
      changes: null,
      selectedId: null,
      viewMode: savedMode === "split" ? "split" : "unified",
      error: null,
      baseError: null,
      loading: false,
      files: {},
      sidebarTab: savedTab === "files" ? "files" : "changes",
      projectFiles: null,
      filesError: null,
      expanded: new Set(),
      viewed: null,

      async init() {
        // Run once per store: React StrictMode mounts effects twice in development.
        if (initialized) return;
        initialized = true;
        try {
          const args = await api.initialArgs();
          // Without a path, the "Open a repository" screen is shown; no dialog opens by itself.
          if (args.path) await get().openPath(args.path, args.base ?? undefined);
        } catch (e) {
          set({ error: toErrorPayload(e) });
        }
      },

      async openPath(path, base) {
        generation++;
        viewToken++;
        set({
          loading: true,
          error: null,
          baseError: null,
          projectFiles: null,
          filesError: null,
          expanded: new Set(),
          viewed: null,
        });
        let repo: RepoInfo;
        try {
          repo = await api.openRepo(path);
        } catch (e) {
          set({ error: toErrorPayload(e), loading: false, repo: null, changes: null, selectedId: null, files: {} });
          return;
        }
        set({ repo, changes: null, selectedId: null, files: {} });
        await loadChanges(repo.root, base?.trim() || "HEAD", false);
      },

      async pickAndOpen() {
        const path = await api.pickFolder();
        if (path) await get().openPath(path, get().repo ? get().base : undefined);
      },

      async setBase(base) {
        const { repo } = get();
        if (!repo) return;
        await loadChanges(repo.root, base.trim() || "HEAD", true);
      },

      async refresh() {
        const { repo, base } = get();
        if (!repo) return;
        await loadChanges(repo.root, base, true);
      },

      select(id) {
        if (get().selectedId === id && get().files[id] && !get().viewed) return;
        viewToken++;
        set({ selectedId: id, viewed: null });
        if (!get().files[id]) loadFile(id, false);
      },

      selectNext: () => move(1),
      selectPrev: () => move(-1),

      loadLarge(id) {
        loadFile(id, true);
      },

      setViewMode(mode) {
        storage.set(VIEW_MODE_KEY, mode);
        set({ viewMode: mode });
      },

      toggleViewMode() {
        get().setViewMode(get().viewMode === "unified" ? "split" : "unified");
      },

      setSidebarTab(tab) {
        storage.set(SIDEBAR_TAB_KEY, tab);
        set({ sidebarTab: tab });
        // Load lazily, the first time the tab is shown for this repo; later change-set
        // loads refresh it too (see `wantFiles`).
        if (tab === "files" && get().projectFiles === null) loadFilesNow();
      },

      toggleFolder(path) {
        get().setFolderExpanded(path, !get().expanded.has(path));
      },

      setFolderExpanded(path, open) {
        const { expanded } = get();
        if (expanded.has(path) === open) return;
        const next = new Set(expanded);
        if (open) next.add(path);
        else next.delete(path);
        set({ expanded: next });
      },

      collapseAll() {
        if (get().expanded.size > 0) set({ expanded: new Set() });
      },

      reveal(path) {
        const { expanded } = get();
        const missing = ancestorsOf(path).filter((a) => !expanded.has(a));
        if (missing.length > 0) set({ expanded: new Set([...expanded, ...missing]) });
      },

      openTreePath(path) {
        const changed = get().changes?.files.find((f) => displayPath(f) === path);
        if (changed) get().select(changed.id);
        else if (get().viewed?.path !== path) loadViewed(path, false);
      },

      loadViewedAnyway() {
        const viewed = get().viewed;
        if (viewed) loadViewed(viewed.path, true);
      },
    };
  });
}

export const StoreContext = createContext<StoreApi<AppState> | null>(null);

export function useApp<T>(selector: (s: AppState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error("StoreContext missing");
  return useStore(store, selector);
}
