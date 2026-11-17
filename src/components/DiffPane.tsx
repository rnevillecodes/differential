import { displayPath, useApp } from "../store";
import { DiffView } from "./DiffView";

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
  const selectedId = useApp((s) => s.selectedId);
  const files = useApp((s) => s.files);
  const viewMode = useApp((s) => s.viewMode);
  const loading = useApp((s) => s.loading);
  const pickAndOpen = useApp((s) => s.pickAndOpen);
  const loadLarge = useApp((s) => s.loadLarge);

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

  if (changes.files.length === 0) {
    return (
      <section className="diff-pane">
        <div className="message">
          <h2>No changes</h2>
          <p>
            The working tree matches <code>{changes.baseRef}</code>.
          </p>
        </div>
      </section>
    );
  }

  const file = selectedId === null ? null : changes.files[selectedId];
  if (!file) return <section className="diff-pane" />;
  const load = files[file.id];
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
        <button onClick={() => loadLarge(file.id)}>Load diff anyway</button>
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
        mode={viewMode}
      />
    );
  }

  return (
    <section className="diff-pane" aria-label={`Diff of ${path}`}>
      <div className="diff-header">
        <span className={`status status-${file.status}`}>{file.status}</span>
        {file.status === "renamed" && file.oldPath && (
          <>
            <span className="old-path">{file.oldPath}</span>
            <span>→</span>
          </>
        )}
        <span>{path}</span>
      </div>
      {body}
    </section>
  );
}
