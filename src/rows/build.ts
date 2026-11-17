// Pure conversion of a FileDiff (+ full file contents and expansion state) into the
// flat list of fixed-height rows the virtualized views render.

import type { FileDiff } from "../model/FileDiff";
import type { Hunk } from "../model/Hunk";
import type { LineKind } from "../model/LineKind";
import type { Range } from "../model/Range";

export type ViewMode = "unified" | "split";

export interface DisplayLine {
  kind: LineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
  intraline: Range[] | null;
}

export interface GapRow {
  type: "gap";
  key: string;
  gapIndex: number;
  /** Lines still hidden. */
  hidden: number;
  /** Can reveal lines just above the next hunk. */
  canExpandUp: boolean;
  /** Can reveal lines just below the previous hunk. */
  canExpandDown: boolean;
  /** `@@ ... @@` text of the hunk that follows, if any. */
  header: string;
}

export interface LineRow {
  type: "line";
  key: string;
  line: DisplayLine;
}

export interface PairRow {
  type: "pair";
  key: string;
  left: DisplayLine | null;
  right: DisplayLine | null;
}

export type Row = GapRow | LineRow | PairRow;

/** Unchanged lines hidden before hunk `index` (or after the last hunk). */
export interface Gap {
  index: number;
  oldStart: number;
  newStart: number;
  count: number;
}

/** Lines revealed at the top (after the previous hunk) and bottom (before the next hunk) of a gap. */
export interface Expansion {
  top: number;
  bottom: number;
}

export type ExpansionState = Readonly<Record<number, Expansion>>;

/** Split file content into lines (a trailing newline does not start a new line). */
export function splitLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const firstLine = (start: number, len: number) => (len === 0 ? start + 1 : start);

/** Gaps between hunks, and before the first / after the last, given the base line count. */
export function computeGaps(hunks: Hunk[], oldTotal: number | null): Gap[] {
  const gaps: Gap[] = [];
  let prevOldEnd = 0;
  let prevNewEnd = 0;
  hunks.forEach((h, i) => {
    const oldFirst = firstLine(h.oldStart, h.oldLines);
    const newFirst = firstLine(h.newStart, h.newLines);
    gaps.push({ index: i, oldStart: prevOldEnd + 1, newStart: prevNewEnd + 1, count: Math.max(0, oldFirst - 1 - prevOldEnd) });
    prevOldEnd = oldFirst + h.oldLines - 1;
    prevNewEnd = newFirst + h.newLines - 1;
  });
  if (hunks.length > 0) {
    const trailing = oldTotal === null ? 0 : Math.max(0, oldTotal - prevOldEnd);
    gaps.push({ index: hunks.length, oldStart: prevOldEnd + 1, newStart: prevNewEnd + 1, count: trailing });
  }
  return gaps;
}

export interface BuildInput {
  diff: FileDiff;
  oldContent: string | null;
  newContent: string | null;
  expansion: ExpansionState;
  mode: ViewMode;
}

export interface BuildResult {
  rows: Row[];
  gaps: Gap[];
  /** Longest displayed line, in columns (tabs counted as 4). */
  maxColumns: number;
}

export function buildRows({ diff, oldContent, newContent, expansion, mode }: BuildInput): BuildResult {
  const oldLines = oldContent === null ? null : splitLines(oldContent);
  const newLines = newContent === null ? null : splitLines(newContent);
  // Unchanged text comes from the base when we have it (identical to the worktree there).
  const contextText = (oldNo: number, newNo: number): string | null =>
    oldLines?.[oldNo - 1] ?? newLines?.[newNo - 1] ?? null;
  const canReveal = oldLines !== null || newLines !== null;

  const gaps = computeGaps(diff.hunks, oldLines ? oldLines.length : null);
  const rows: Row[] = [];
  let maxColumns = 0;
  const measure = (l: DisplayLine | null) => {
    if (!l) return;
    const cols = l.text.length + 3 * (l.text.split("\t").length - 1);
    if (cols > maxColumns) maxColumns = cols;
  };
  const pushContext = (line: DisplayLine) => {
    measure(line);
    if (mode === "unified") rows.push({ type: "line", key: `c${line.oldNo}:${line.newNo}`, line });
    else rows.push({ type: "pair", key: `c${line.oldNo}:${line.newNo}`, left: line, right: line });
  };

  const emitGap = (gap: Gap) => {
    if (gap.count === 0) return;
    const hunk = diff.hunks[gap.index];
    const header = hunk
      ? `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.header ? " " + hunk.header : ""}`
      : "";
    const exp = expansion[gap.index] ?? { top: 0, bottom: 0 };
    const top = Math.min(exp.top, gap.count);
    const bottom = Math.min(exp.bottom, gap.count - top);
    const reveal = (from: number, n: number) => {
      for (let k = 0; k < n; k++) {
        const o = gap.oldStart + from + k;
        const nn = gap.newStart + from + k;
        const text = contextText(o, nn);
        if (text === null) continue;
        pushContext({ kind: "context", text, oldNo: o, newNo: nn, intraline: null });
      }
    };
    reveal(0, top);
    const hidden = gap.count - top - bottom;
    if (hidden > 0) {
      const isFirst = gap.index === 0;
      const isLast = gap.index === diff.hunks.length;
      rows.push({
        type: "gap",
        key: `g${gap.index}`,
        gapIndex: gap.index,
        hidden,
        canExpandUp: canReveal && !isLast,
        canExpandDown: canReveal && !isFirst,
        header,
      });
    }
    reveal(gap.count - bottom, bottom);
  };

  diff.hunks.forEach((hunk, hi) => {
    emitGap(gaps[hi]);
    const lines = hunk.lines;
    if (mode === "unified") {
      lines.forEach((l, li) => {
        const line: DisplayLine = { kind: l.kind, text: l.text, oldNo: l.oldNo, newNo: l.newNo, intraline: l.intraline };
        measure(line);
        rows.push({ type: "line", key: `h${hi}:${li}`, line });
      });
      return;
    }
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (l.kind === "context") {
        const line: DisplayLine = { ...l };
        measure(line);
        rows.push({ type: "pair", key: `h${hi}:${i}`, left: line, right: line });
        i++;
        continue;
      }
      const removed: DisplayLine[] = [];
      const added: DisplayLine[] = [];
      while (i < lines.length && lines[i].kind === "removed") removed.push({ ...lines[i++] });
      while (i < lines.length && lines[i].kind === "added") added.push({ ...lines[i++] });
      const n = Math.max(removed.length, added.length);
      for (let k = 0; k < n; k++) {
        const left = removed[k] ?? null;
        const right = added[k] ?? null;
        measure(left);
        measure(right);
        rows.push({ type: "pair", key: `h${hi}:${i}:${k}`, left, right });
      }
    }
  });
  if (gaps.length > 0) emitGap(gaps[gaps.length - 1]);

  return { rows, gaps, maxColumns };
}

/** Lines revealed per click by the partial-expansion buttons. */
export const EXPAND_STEP = 20;

/**
 * Reveal lines of gap `index`:
 * - `all`: every hidden line
 * - `up`: `step` more lines just above the next hunk
 * - `down`: `step` more lines just below the previous hunk
 */
export function expandGap(
  state: ExpansionState,
  gap: Gap,
  how: "all" | "up" | "down",
  step = EXPAND_STEP,
): ExpansionState {
  const cur = state[gap.index] ?? { top: 0, bottom: 0 };
  const remaining = Math.max(0, gap.count - cur.top - cur.bottom);
  let next: Expansion;
  if (how === "all") next = { top: gap.count - cur.bottom, bottom: cur.bottom };
  else if (how === "up") next = { top: cur.top, bottom: cur.bottom + Math.min(step, remaining) };
  else next = { top: cur.top + Math.min(step, remaining), bottom: cur.bottom };
  return { ...state, [gap.index]: next };
}
