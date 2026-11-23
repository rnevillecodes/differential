// Find-in-view matching: the searchable lines of a view (including lines hidden in
// collapsed regions) and plain-text matches over them. Pure, so it is tested without React.

import type { FileDiff } from "../model/FileDiff";
import type { LineKind } from "../model/LineKind";
import type { Range } from "../model/Range";
import { buildRows, type DisplayLine, type ExpansionState, type Gap, type Row, type ViewMode } from "../rows/build";

/** One searchable line, in display order. */
export interface SearchUnit {
  /** Identifies the line across row rebuilds (see `lineKey`). */
  key: string;
  kind: LineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
  /** Lower-cased `text` with the same length, filled in on the first case-insensitive search. */
  lower?: string;
}

/** A match: `[start, end)` within unit `unit`'s text. */
export interface FindMatch {
  unit: number;
  start: number;
  end: number;
}

/** Stable identity of a diff or file line: kind plus its old and new line numbers. */
export function lineKey(line: { kind: LineKind; oldNo: number | null; newNo: number | null }): string {
  return `${line.kind}:${line.oldNo}:${line.newNo}`;
}

/** Expansion that reveals every collapsed region of `diff`. */
export function fullExpansion(diff: FileDiff): ExpansionState {
  const all: Record<number, { top: number; bottom: number }> = {};
  for (let i = 0; i <= diff.hunks.length; i++) all[i] = { top: Number.MAX_SAFE_INTEGER, bottom: 0 };
  return all;
}

const unit = (l: DisplayLine): SearchUnit => ({ key: lineKey(l), kind: l.kind, oldNo: l.oldNo, newNo: l.newNo, text: l.text });

/**
 * Searchable lines of a diff in display order, with every collapsed region revealed.
 * In split mode the left side of a row comes before the right; an unchanged line shown
 * on both sides is one unit.
 */
export function diffUnits(input: {
  diff: FileDiff;
  oldContent: string | null;
  newContent: string | null;
  mode: ViewMode;
}): SearchUnit[] {
  const { rows } = buildRows({ ...input, expansion: fullExpansion(input.diff) });
  const units: SearchUnit[] = [];
  for (const row of rows) {
    if (row.type === "line") units.push(unit(row.line));
    else if (row.type === "pair") {
      if (row.left) units.push(unit(row.left));
      if (row.right && row.right !== row.left) units.push(unit(row.right));
    }
  }
  return units;
}

/** Searchable lines of a whole file shown as-is (line `n` is `context:n:n`). */
export function fileUnits(lines: string[]): SearchUnit[] {
  return lines.map((text, i) => ({ key: `context:${i + 1}:${i + 1}`, kind: "context", oldNo: i + 1, newNo: i + 1, text }));
}

/** Lower-case `s` without changing its length, so match offsets stay valid. */
function lowerSameLength(s: string): string {
  const lower = s.toLowerCase();
  if (lower.length === s.length) return lower;
  let out = "";
  for (const ch of s) {
    const l = ch.toLowerCase();
    out += l.length === ch.length ? l : ch;
  }
  return out;
}

/** Non-overlapping, single-line plain-text matches of `query`, ordered by unit then position. */
export function findMatches(units: SearchUnit[], query: string, matchCase: boolean): FindMatch[] {
  if (query === "") return [];
  const needle = matchCase ? query : lowerSameLength(query);
  const out: FindMatch[] = [];
  for (let u = 0; u < units.length; u++) {
    const unit = units[u];
    let hay: string;
    if (matchCase) hay = unit.text;
    else hay = unit.lower ??= lowerSameLength(unit.text);
    if (hay.length < needle.length) continue;
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
      out.push({ unit: u, start: at, end: at + needle.length });
    }
  }
  return out;
}

/** Match ranges per line key, for highlighting. */
export function rangesByLine(units: SearchUnit[], matches: FindMatch[]): Map<string, Range[]> {
  const map = new Map<string, Range[]>();
  for (const m of matches) {
    const key = units[m.unit].key;
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push({ start: m.start, end: m.end });
  }
  return map;
}

/** Row index of each displayed line, by line key (both sides of a split row map to it). */
export function lineKeyIndex(rows: Row[]): Map<string, number> {
  const map = new Map<string, number>();
  rows.forEach((row, i) => {
    if (row.type === "line") map.set(lineKey(row.line), i);
    else if (row.type === "pair") {
      if (row.left) map.set(lineKey(row.left), i);
      if (row.right) map.set(lineKey(row.right), i);
    }
  });
  return map;
}

/** The collapsed region (gap) whose lines include unit `u`, if any. Only unchanged lines are ever hidden. */
export function gapContaining(gaps: Gap[], u: SearchUnit): Gap | null {
  if (u.kind !== "context") return null;
  for (const g of gaps) {
    if (g.count === 0) continue;
    if (u.oldNo !== null && u.oldNo >= g.oldStart && u.oldNo < g.oldStart + g.count) return g;
    if (u.oldNo === null && u.newNo !== null && u.newNo >= g.newStart && u.newNo < g.newStart + g.count) return g;
  }
  return null;
}

/** Index of the first match whose unit is at or after unit `fromUnit` (wrapping to 0). */
export function firstMatchFrom(matches: FindMatch[], fromUnit: number): number {
  if (matches.length === 0) return -1;
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid].unit < fromUnit) lo = mid + 1;
    else hi = mid;
  }
  return lo < matches.length ? lo : 0;
}
