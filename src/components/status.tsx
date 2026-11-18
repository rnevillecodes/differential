import type { FileStatus } from "../model/FileStatus";

export const STATUS_LETTER: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

/** One-letter, colored change indicator shared by the Changes list and the project tree. */
export function StatusBadge({ status }: { status: FileStatus }) {
  return (
    <span className={`status status-${status}`} aria-label={status}>
      {STATUS_LETTER[status]}
    </span>
  );
}
