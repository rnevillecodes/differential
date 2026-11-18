import { memo } from "react";
import type { ChangeSet } from "../model/ChangeSet";
import type { FileSummary } from "../model/FileSummary";
import { changeAt, displayPath, useApp, type FileLoad, type ViewLoad, type ViewMode } from "../store";
import { DiffView } from "./DiffView";
import { FileView } from "./FileView";
import { LogoMark } from "./icons";
import { TabBar, tabId, tabPanelId } from "./TabBar";

const ERROR_TITLES: Record<string, string> = {
  gitNotFound: "Git not found",
  gitTooOld: "Git is too old",
  notARepo: "Not a git repository",
  badRevision: "Unknown revision",
};

export function DiffPane() {
  const repo = useApp((s) => s.repo);
  const error = useApp((s) => s.error);
  const changes = useApp((s) => s.changes);
  const loading = useApp((s) => s.loading);
  const pickAndOpen = useApp((s) => s.pickAndOpen);
  const tabs = useApp((s) => s.tabs);
  const activePath = useApp((s) => s.activePath);

  if (error) {
    return (
      <section className="diff-pane">
        <div className="message error" role="alert">
          <h2>{ERROR_TITLES[error.kind] ?? "Something went wrong"}</h2>
          <p>{error.message}</p>
          {error.kind === "gitNotFound" && <p>Install git and make sure it is on your PATH, then restart differential.</p>}
          {error.kind === "badRevision" && <p>Enter a different base revision above.</p>}
          {error.kind === "notARepo" && <button onClick={() => void pickAndOpen()}>Open another folder…</button>}
        </div>
      </section>
    );
  }

  if (!repo) {
    return (
      <section className="diff-pane">
        <div className="message">
          <LogoMark size={72} className="start-logo" />
          <h2>Open a repository</h2>
          <p>Pick a folder inside a git repository to review its changes.</p>
          <button onClick={() => void pickAndOpen()}>Open…</button>
        </div>
      </section>
    );
  }

  if (!changes) {
    return (
      <section className="diff-pane">
        <div className="message">{loading ? "Loading changes…" : ""}</div>
      </section>
    );
  }

  return (
    <section className="diff-pane">
      {tabs.length > 0 && <TabBar />}
      <div className="tab-panels">
        {tabs.map((t) => (
          <TabPanel key={t.path} path={t.path} active={t.path === activePath} />
        ))}
        {activePath === null &&
          (changes.files.length === 0 ? (
            <div className="message">
              <h2>No changes</h2>
              <p>
                The working tree matches <code>{changes.baseRef}</code>.
              </p>
            </div>
          ) : (
            <div className="message">
              <h2>No file open</h2>
              <p>Pick a file from the sidebar, or press ] to open the next changed file.</p>
            </div>
          ))}
      </div>
    </section>
  );
}

/**
 * One open tab. Every tab stays mounted (inactive ones are hidden and inert) so that
 * switching back keeps its scroll position, expanded context and highlighting.
 */
const TabPanel = memo(function TabPanel({ path, active }: { path: string; active: boolean }) {
  const changes = useApp((s) => s.changes);
  const file = changeAt(changes, path);
  const load = useApp((s) => (file ? s.files[file.id] : undefined));
  const view = useApp((s) => (file ? undefined : s.views[path]));
  const viewMode = useApp((s) => s.viewMode);
  const loadLarge = useApp((s) => s.loadLarge);
  const loadViewAnyway = useApp((s) => s.loadViewAnyway);

  return (
    <div
      className={`tab-panel${active ? "" : " inactive"}`}
      role="tabpanel"
      id={tabPanelId(path)}
      aria-labelledby={tabId(path)}
      inert={!active}
    >
      {file && changes ? (
        <ChangedFile file={file} changes={changes} load={load} mode={viewMode} onLoadLarge={loadLarge} />
      ) : (
        <UnchangedFile path={path} load={view} onLoadAnyway={() => loadViewAnyway(path)} />
      )}
    </div>
  );
});

function ChangedFile({
  file,
  changes,
  load,
  mode,
  onLoadLarge,
}: {
  file: FileSummary;
  changes: ChangeSet;
  load: FileLoad | undefined;
  mode: ViewMode;
  onLoadLarge: (id: number) => void;
}) {
  const path = displayPath(file);
  let body: React.ReactNode;
  if (!load || load.status === "loading") {
    body = <div className="message">Loading…</div>;
  } else if (load.status === "binary") {
    body = (
      <div className="message" data-testid="binary-placeholder">
        <h2>Binary file</h2>
        <p>This file is binary; its contents are not shown.</p>
      </div>
    );
  } else if (load.status === "large") {
    body = (
      <div className="message" data-testid="large-placeholder">
        <h2>Large file</h2>
        <p>
          This diff is large ({file.additions + file.deletions} changed lines) and is not shown by default.
        </p>
        <button onClick={() => onLoadLarge(file.id)}>Load diff anyway</button>
      </div>
    );
  } else if (load.status === "error") {
    body = (
      <div className="message error" role="alert">
        <h2>Could not load this file</h2>
        <p>{load.error.message}</p>
      </div>
    );
  } else if (load.diff.isBinary) {
    body = (
      <div className="message" data-testid="binary-placeholder">
        <h2>Binary file</h2>
        <p>This file is binary; its contents are not shown.</p>
      </div>
    );
  } else if (load.diff.hunks.length === 0) {
    body = (
      <div className="message">
        <h2>No content changes</h2>
        <p>{file.status === "renamed" ? "The file was renamed without edits." : "Only file metadata changed."}</p>
      </div>
    );
  } else {
    body = (
      <DiffView
        key={`${changes.baseSha}:${file.id}:${path}`}
        file={file}
        baseSha={changes.baseSha}
        diff={load.diff}
        oldContent={load.oldContent}
        newContent={load.newContent}
        mode={mode}
      />
    );
  }

  return (
    <div className="file-pane" aria-label={`Diff of ${path}`}>
      <div className="diff-header">
        <span className={`diff-status status-${file.status}`}>{file.status}</span>
        {file.status === "renamed" && file.oldPath && (
          <>
            <span className="diff-path old-path">{file.oldPath}</span>
            <span>→</span>
          </>
        )}
        <span className="diff-path">{path}</span>
      </div>
      {body}
    </div>
  );
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

/** An unchanged file opened from the project tree. */
function UnchangedFile({ path, load, onLoadAnyway }: { path: string; load: ViewLoad | undefined; onLoadAnyway: () => void }) {
  let body: React.ReactNode;
  switch (load?.status) {
    case undefined:
    case "loading":
      body = <div className="message">Loading…</div>;
      break;
    case "ready":
      body = <FileView key={path} path={path} content={load.content} />;
      break;
    case "binary":
      body = (
        <div className="message" data-testid="binary-placeholder">
          <h2>Binary file</h2>
          <p>This file is binary; its contents are not shown.</p>
        </div>
      );
      break;
    case "large":
      body = (
        <div className="message" data-testid="large-placeholder">
          <h2>Large file</h2>
          <p>This file is large ({formatSize(load.size)}) and is not shown by default.</p>
          <button onClick={onLoadAnyway}>Load file anyway</button>
        </div>
      );
      break;
    case "missing":
      body = (
        <div className="message" data-testid="missing-placeholder">
          <h2>File not found</h2>
          <p>This file no longer exists on disk. Refresh (Ctrl+R) to update the file list.</p>
        </div>
      );
      break;
    case "notAFile":
      body = (
        <div className="message">
          <h2>Not a file</h2>
          <p>This entry is a folder or submodule; its contents are not shown.</p>
        </div>
      );
      break;
    case "error":
      body = (
        <div className="message error" role="alert">
          <h2>Could not load this file</h2>
          <p>{load.error.message}</p>
        </div>
      );
      break;
  }
  return (
    <div className="file-pane" aria-label={`Contents of ${path}`}>
      <div className="diff-header">
        <span className="diff-status status-unchanged">unchanged</span>
        <span className="diff-path">{path}</span>
      </div>
      {body}
    </div>
  );
}
