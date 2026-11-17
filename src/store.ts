// Application state: which repo/base is open, the change set, the selected file and
// its loaded diff, and the view mode.

import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { createContext, useContext } from "react";
import { toErrorPayload, type Api } from "./api";
import type { ChangeSet } from "./model/ChangeSet";
import type { ErrorPayload } from "./model/ErrorPayload";
import type { FileDiff } from "./model/FileDiff";
import type { FileSummary } from "./model/FileSummary";
import type { RepoInfo } from "./model/RepoInfo";

export type ViewMode = "unified" | "split";

export type FileLoad =
  | { status: "loading" }
  | { status: "binary" }
  | { status: "large" }
  | { status: "error"; error: ErrorPayload }
  | { status: "ready"; diff: FileDiff; oldContent: string | null; newContent: string | null };

export interface AppState {
  repo: RepoInfo | null;
  /** The base the current change set was computed against. */
  base: string;
  changes: ChangeSet | null;
  selectedId: number | null;
  viewMode: ViewMode;
  /** Blocking error (git missing, not a repository, ...). */
  error: ErrorPayload | null;
  /** Error from the last base change; the previous diff stays visible. */
  baseError: string | null;
  loading: boolean;
  /** Loaded per-file data, keyed by file id within `changes`. */
  files: Record<number, FileLoad>;

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

export const displayPath = (f: FileSummary): string => f.newPath ?? f.oldPath ?? "";

export function createAppStore(api: Api, storage: KeyValue = browserStorage): StoreApi<AppState> {
  // Incremented on every change-set load; stale responses are dropped.
  let generation = 0;

  return createStore<AppState>((set, get) => {
    const loadChanges = async (root: string, base: string, keepSelection: boolean): Promise<boolean> => {
      const gen = ++generation;
      set({ loading: true });
      try {
        const changes = await api.listChanges(root, base);
        if (gen !== generation) return false;
        const prev = get();
        const prevPath =
          keepSelection && prev.changes && prev.selectedId !== null
            ? displayPath(prev.changes.files[prev.selectedId])
            : null;
        const kept = prevPath === null ? undefined : changes.files.find((f) => displayPath(f) === prevPath);
        set({
          changes,
          base: changes.baseRef,
          files: {},
          baseError: null,
          error: null,
          loading: false,
          selectedId: kept ? kept.id : changes.files.length > 0 ? 0 : null,
        });
        const sel = get().selectedId;
        if (sel !== null) loadFile(sel, false);
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

    const move = (delta: number) => {
      const { changes, selectedId } = get();
      if (!changes || changes.files.length === 0) return;
      const next =
        selectedId === null ? 0 : Math.min(changes.files.length - 1, Math.max(0, selectedId + delta));
      get().select(next);
    };

    const savedMode = storage.get(VIEW_MODE_KEY);

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

      async init() {
        try {
          const args = await api.initialArgs();
          if (args.path) await get().openPath(args.path, args.base ?? undefined);
          else await get().pickAndOpen();
        } catch (e) {
          set({ error: toErrorPayload(e) });
        }
      },

      async openPath(path, base) {
        generation++;
        set({ loading: true, error: null, baseError: null });
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
        if (get().selectedId === id && get().files[id]) return;
        set({ selectedId: id });
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
    };
  });
}

export const StoreContext = createContext<StoreApi<AppState> | null>(null);

export function useApp<T>(selector: (s: AppState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error("StoreContext missing");
  return useStore(store, selector);
}
