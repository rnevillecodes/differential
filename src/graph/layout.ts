// Lane layout for the commit graph.
//
// Commits arrive in topological order (children before parents). Each lane is a column waiting
// for one commit: the parent of the commit drawn above it. Laying out is incremental: the state
// after one page is the input for the next, so loaded rows never change when more are appended.

import type { CommitInfo } from "../model/CommitInfo";

export interface LayoutState {
  /** For each column, the SHA it is waiting for, or null when free. Trailing nulls are trimmed. */
  lanes: (string | null)[];
  /** Colour index of each column's line (parallel to `lanes`). */
  colors: number[];
  /** Next colour index to hand out. */
  nextColor: number;
}

/**
 * A line segment within one row, between columns:
 * - `pass`: a lane running straight through the row at `from` (= `to`), not involving this commit.
 * - `in`:   from the top of column `from` to the commit's dot (a child's lane ending here).
 * - `out`:  from the commit's dot to the bottom of column `to` (a parent's lane).
 */
export interface GraphLine {
  kind: "pass" | "in" | "out";
  from: number;
  to: number;
  color: number;
}

export interface GraphRow {
  commit: CommitInfo;
  /** Column of the commit's dot. */
  column: number;
  /** Colour index of the commit's dot. */
  color: number;
  lines: GraphLine[];
  /** Columns the row spans (highest column used + 1). */
  width: number;
}

export const emptyLayout = (): LayoutState => ({ lanes: [], colors: [], nextColor: 0 });

const firstFree = (lanes: (string | null)[]) => {
  const i = lanes.indexOf(null);
  return i === -1 ? lanes.length : i;
};

/** Lay out `commits` following on from `state`. Does not modify `state`. */
export function layout(commits: CommitInfo[], state: LayoutState): { rows: GraphRow[]; state: LayoutState } {
  const lanes = [...state.lanes];
  const colors = [...state.colors];
  let nextColor = state.nextColor;
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    const lines: GraphLine[] = [];
    const matching: number[] = [];
    lanes.forEach((sha, i) => {
      if (sha === commit.sha) matching.push(i);
    });

    // The dot goes in the leftmost lane waiting for this commit, or a free one for a branch tip.
    const column = matching.length > 0 ? matching[0] : firstFree(lanes);
    let color: number;
    if (matching.length > 0) color = colors[column];
    else {
      color = nextColor++;
      colors[column] = color;
    }

    lanes.forEach((sha, i) => {
      if (sha === null) return;
      if (sha === commit.sha) lines.push({ kind: "in", from: i, to: column, color: colors[i] });
      else lines.push({ kind: "pass", from: i, to: i, color: colors[i] });
    });
    for (const i of matching) lanes[i] = null;
    if (column >= lanes.length) lanes.length = column + 1;
    lanes[column] = null;

    commit.parents.forEach((parent, n) => {
      const existing = lanes.indexOf(parent);
      if (existing !== -1) {
        // Another lane already leads to this parent: join it.
        lines.push({ kind: "out", from: column, to: existing, color: colors[existing] });
        return;
      }
      let target: number;
      if (n === 0) {
        // The first parent continues the commit's own lane and colour.
        target = column;
        colors[target] = color;
      } else {
        target = firstFree(lanes);
        colors[target] = nextColor++;
      }
      lanes[target] = parent;
      lines.push({ kind: "out", from: column, to: target, color: colors[target] });
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    colors.length = lanes.length;

    const width = Math.max(column, ...lines.map((l) => Math.max(l.from, l.to))) + 1;
    rows.push({ commit, column, color, lines, width });
  }

  return { rows, state: { lanes, colors, nextColor } };
}
