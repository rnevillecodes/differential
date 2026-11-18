import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useRef } from "react";
import type { FileSummary } from "../model/FileSummary";
import { displayPath, useApp } from "../store";
import { ChangesIcon } from "./icons";
import { SidebarEmpty } from "./SidebarEmpty";
import { StatusBadge } from "./status";

const ROW_HEIGHT = 28;

function splitPath(path: string): [dir: string, name: string] {
  const i = path.lastIndexOf("/");
  return i === -1 ? ["", path] : [path.slice(0, i + 1), path.slice(i + 1)];
}

export function FileList() {
  const repo = useApp((s) => s.repo);
  const changes = useApp((s) => s.changes);
  const loading = useApp((s) => s.loading);
  const setPickerOpen = useApp((s) => s.setRepoPickerOpen);
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const scrollRef = useRef<HTMLDivElement>(null);
  const files = changes?.files ?? [];

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  useEffect(() => {
    if (selectedId !== null && selectedId < files.length) virtualizer.scrollToIndex(selectedId, { align: "auto" });
  }, [selectedId, files.length, virtualizer]);

  if (!repo) {
    return (
      <nav className="file-list" aria-label="Changed files">
        <SidebarEmpty
          icon={<ChangesIcon width={28} height={28} />}
          title="No repository open"
          action={{ label: "Open a repository…", onClick: () => setPickerOpen(true) }}
        >
          Open a repository to review its changes.
        </SidebarEmpty>
      </nav>
    );
  }
  if (!changes) {
    return (
      <nav className="file-list" aria-label="Changed files">
        {loading && <SidebarEmpty title="Loading changes…" />}
      </nav>
    );
  }
  if (changes.files.length === 0) {
    return (
      <nav className="file-list" aria-label="Changed files">
        <SidebarEmpty icon={<ChangesIcon width={28} height={28} />} title="No changed files">
          Nothing differs from <code>{changes.baseRef}</code>. Edits show up here after a refresh (Ctrl+R).
        </SidebarEmpty>
      </nav>
    );
  }

  const { totals } = changes;
  return (
    <nav className="file-list" aria-label="Changed files">
      <div className="file-list-header">
        <span>
          {totals.files} {totals.files === 1 ? "file" : "files"}
        </span>
        <span className="stat-add">+{totals.additions}</span>
        <span className="stat-del">−{totals.deletions}</span>
      </div>
      <div className="file-list-scroll" ref={scrollRef} role="listbox" aria-label="Files">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const f = files[item.index];
            return (
              <FileRow
                key={f.id}
                file={f}
                selected={f.id === selectedId}
                top={item.start}
                onSelect={select}
              />
            );
          })}
        </div>
      </div>
    </nav>
  );
}

const FileRow = memo(function FileRow({
  file,
  selected,
  top,
  onSelect,
}: {
  file: FileSummary;
  selected: boolean;
  top: number;
  onSelect: (id: number, pin?: boolean) => void;
}) {
  const path = displayPath(file);
  const [dir, name] = splitPath(path);
  const renamedFrom = file.status === "renamed" ? file.oldPath : null;
  const title = renamedFrom ? `${renamedFrom} → ${path}` : path;
  return (
    <div
      className="file-row"
      role="option"
      aria-selected={selected}
      style={{ transform: `translateY(${top}px)` }}
      onClick={() => onSelect(file.id)}
      onDoubleClick={() => onSelect(file.id, true)}
      title={title}
      data-testid="file-row"
    >
      <StatusBadge status={file.status} />
      <span className="file-path">
        <bdi>
          {renamedFrom && <span className="dir">{renamedFrom} → </span>}
          <span className="dir">{dir}</span>
          {name}
        </bdi>
      </span>
      {file.isBinary && <span className="tag">binary</span>}
      {file.isLarge && <span className="tag">large</span>}
      {!file.isBinary && (
        <>
          <span className="stat-add">+{file.additions}</span>
          <span className="stat-del">−{file.deletions}</span>
        </>
      )}
    </div>
  );
});
