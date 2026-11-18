// Application state: which repo/base is open, the change set, the open file tabs and
// their loaded diffs or contents, the view mode, and the project explorer (sidebar
// tab, project file listing, expanded folders).

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

/**
 * An open tab in the main pane. It shows the path's diff while the path is in the
 * change set, and the file's contents otherwise, so a refresh can switch it either way.
 */
export interface Tab {
  path: string;
  /** A preview tab is replaced by the next file opened; pinning it keeps it open. */
  preview: boolean;
}

export interface AppState {
  repo: RepoInfo | null;
  /** The base the current change set was computed against. */
  base: string;
  changes: ChangeSet | null;
  /** Id of the active tab's changed file; null when it shows an unchanged file or no tab is open. */
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
  /** Open tabs, in display order. At most one is a preview tab. */
  tabs: Tab[];
  /** Path of the tab shown in the main pane. */
  activePath: string | null;
  /** Contents of open unchanged files, by path. */
  views: Record<string, ViewLoad>;

  init(): Promise<void>;
  openPath(path: string, base?: string): Promise<void>;
  pickAndOpen(): Promise<void>;
  setBase(base: string): Promise<void>;
  refresh(): Promise<void>;
  /** Open a changed file in the preview tab, or in a pinned tab with `pin`. */
  select(id: number, pin?: boolean): void;
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
  /** Open a file from the project tree (its diff if changed, else its contents), like `select`. */
  openTreePath(path: string, pin?: boolean): void;
  activateTab(path: string): void;
  /** Close a tab; closing the active one activates its neighbour. */
  closeTab(path: string): void;
  /** Turn a preview tab into a regular one. */
  pinTab(path: string): void;
  /** Activate the tab `delta` places from the active one, wrapping around. */
  cycleTab(delta: number): void;
  /** Load an unchanged file even though it is large. */
  loadViewAnyway(path: string): void;
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

const pathIndex = new WeakMap<ChangeSet, Map<string, FileSummary>>();

/** The changed file shown at `path`, if any (indexed once per change set). */
export function changeAt(changes: ChangeSet | null, path: string): FileSummary | undefined {
  if (!changes) return undefined;
  let index = pathIndex.get(changes);
  if (!index) {
    index = new Map(changes.files.map((f) => [displayPath(f), f]));
    pathIndex.set(changes, index);
  }
  return index.get(path);
}

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
  // Every unchanged-file request gets a token; a response is applied only if it is the
  // latest request for its path and the path is still open.
  let viewSeq = 0;
  const viewLatest = new Map<string, number>();
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

    const loadChanges = async (root: string, base: string, keepTabs: boolean): Promise<boolean> => {
      const gen = ++generation;
      set({ loading: true });
      const filesPromise = wantFiles() ? fetchFiles(root) : null;
      try {
        const changes = await api.listChanges(root, base);
        if (gen !== generation) return false;
        const prev = get();
        let tabs = keepTabs ? prev.tabs : [];
        let activePath = keepTabs ? prev.activePath : null;
        if (!keepTabs && changes.files.length > 0) {
          activePath = displayPath(changes.files[0]);
          tabs = [{ path: activePath, preview: true }];
        }
        const activeChange = activePath === null ? undefined : changeAt(changes, activePath);
        // Diffs are keyed by id, so they all reload. Keep the active unchanged file's
        // contents on screen while it is re-read; other tabs reload when activated.
        const keptView = activePath !== null && !activeChange ? prev.views[activePath] : undefined;
        set({
          changes,
          base: changes.baseRef,
          files: {},
          baseError: null,
          error: null,
          loading: false,
          tabs,
          activePath,
          selectedId: activeChange?.id ?? null,
          views: keptView ? { [activePath!]: keptView } : {},
        });
        if (activeChange) loadFile(activeChange.id, false);
        if (filesPromise) {
          const result = await filesPromise;
          if (gen !== generation) return true;
          applyFiles(result);
          closeVanished();
        }
        const active = get().activePath;
        if (active !== null && active === activePath && !activeChange) loadView(active, false);
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

    const setView = (path: string, load: ViewLoad) => set({ views: { ...get().views, [path]: load } });

    const loadView = (path: string, force: boolean) => {
      const { repo } = get();
      if (!repo) return;
      const token = ++viewSeq;
      viewLatest.set(path, token);
      const current = get().views[path];
      // Keep showing the old contents while a refresh re-reads the same file.
      const keep = current?.status === "ready" && !force;
      setView(path, keep ? current : { status: "loading" });
      const live = () => viewLatest.get(path) === token && get().tabs.some((t) => t.path === path);
      api.viewFile(repo.root, path, force).then(
        (v) => {
          if (live()) setView(path, toViewLoad(v));
        },
        (e) => {
          if (live()) setView(path, { status: "error", error: toErrorPayload(e) });
        },
      );
    };

    /** Show `path` (already a tab) in the main pane, loading it if needed. */
    const activate = (path: string | null) => {
      const change = path === null ? undefined : changeAt(get().changes, path);
      set({ activePath: path, selectedId: change?.id ?? null });
      if (path === null) return;
      if (change) {
        if (!get().files[change.id]) loadFile(change.id, false);
      } else if (!get().views[path]) {
        loadView(path, false);
      }
    };

    /** Open `path` in a tab: reuse its tab, else replace the preview tab, else add one after the active tab. */
    const open = (path: string, pin: boolean) => {
      const { tabs, activePath } = get();
      const i = tabs.findIndex((t) => t.path === path);
      let next = tabs;
      if (i >= 0) {
        if (pin && tabs[i].preview) next = tabs.map((t, j) => (j === i ? { path, preview: false } : t));
      } else {
        const tab = { path, preview: !pin };
        const p = tabs.findIndex((t) => t.preview);
        if (p >= 0) {
          next = tabs.map((t, j) => (j === p ? tab : t));
        } else {
          const a = tabs.findIndex((t) => t.path === activePath);
          const at = a < 0 ? tabs.length : a + 1;
          next = [...tabs.slice(0, at), tab, ...tabs.slice(at)];
        }
      }
      if (next !== tabs) setTabs(next);
      activate(path);
    };

    /** Replace the tab list, dropping contents of files no longer open. */
    const setTabs = (tabs: Tab[]) => {
      const { views } = get();
      const open = new Set(tabs.map((t) => t.path));
      const kept = Object.fromEntries(Object.entries(views).filter(([p]) => open.has(p)));
      set({ tabs, views: kept });
    };

    /** Close the tabs matching `drop`; if the active one closes, activate its nearest survivor. */
    const removeTabs = (drop: (t: Tab) => boolean) => {
      const { tabs, activePath } = get();
      const next = tabs.filter((t) => !drop(t));
      if (next.length === tabs.length) return;
      setTabs(next);
      if (activePath === null || next.some((t) => t.path === activePath)) return;
      const i = tabs.findIndex((t) => t.path === activePath);
      const after = tabs.slice(i + 1).find((t) => !drop(t));
      const before = tabs.slice(0, i).reverse().find((t) => !drop(t));
      activate((after ?? before)?.path ?? null);
    };

    /** Close tabs of files that are neither changed nor in the project listing any more. */
    const closeVanished = () => {
      const { projectFiles, changes } = get();
      if (!projectFiles) return;
      const listed = new Set(projectFiles);
      removeTabs((t) => !listed.has(t.path) && !changeAt(changes, t.path));
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
      tabs: [],
      activePath: null,
      views: {},

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
        viewLatest.clear();
        set({
          loading: true,
          error: null,
          baseError: null,
          projectFiles: null,
          filesError: null,
          expanded: new Set(),
          tabs: [],
          activePath: null,
          selectedId: null,
          views: {},
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

      select(id, pin = false) {
        const file = get().changes?.files[id];
        if (file) open(displayPath(file), pin);
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

      openTreePath(path, pin = false) {
        open(path, pin);
      },

      activateTab(path) {
        if (get().tabs.some((t) => t.path === path)) activate(path);
      },

      closeTab(path) {
        removeTabs((t) => t.path === path);
      },

      pinTab(path) {
        const { tabs } = get();
        if (tabs.some((t) => t.path === path && t.preview))
          set({ tabs: tabs.map((t) => (t.path === path ? { path, preview: false } : t)) });
      },

      cycleTab(delta) {
        const { tabs, activePath } = get();
        if (tabs.length === 0) return;
        const i = tabs.findIndex((t) => t.path === activePath);
        activate(tabs[(((i < 0 ? 0 : i + delta) % tabs.length) + tabs.length) % tabs.length].path);
      },

      loadViewAnyway(path) {
        if (get().tabs.some((t) => t.path === path)) loadView(path, true);
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
