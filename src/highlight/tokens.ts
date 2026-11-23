// Token types shared by the worker and the UI, and merging tokens with intraline ranges.

import type { Range } from "../model/Range";

/** One highlighted token: text plus its light- and dark-theme colors. */
export type Token = [text: string, light: string, dark: string];
export type LineTokens = Token[];

export interface Segment {
  text: string;
  light?: string;
  dark?: string;
  /** Inside an intraline (word-level) change range. */
  changed: boolean;
  /** Inside a find match (set only when true). */
  match?: true;
  /** Inside the current find match (set only when true). */
  current?: true;
}

/** Find matches to mark on a line: all of its match ranges and the current one, if on this line. */
export interface FindRanges {
  ranges: Range[];
  current: Range | null;
}

const inside = (ranges: Range[], at: number) => ranges.some((r) => at >= r.start && at < r.end);

/**
 * Split a line into styled segments. Tokens are used only if they spell out exactly the
 * line's text (a trailing `\r` is ignored); otherwise the line is plain. Segments are cut
 * at the edges of intraline ranges and find ranges, and flagged accordingly.
 */
export function segments(
  text: string,
  tokens: LineTokens | undefined,
  intraline: Range[] | null,
  find?: FindRanges | null,
): Segment[] {
  const visible = text.endsWith("\r") ? text.slice(0, -1) : text;
  let base: Segment[];
  if (tokens && tokens.map((t) => t[0]).join("") === visible) {
    base = tokens.filter((t) => t[0] !== "").map(([t, light, dark]) => ({ text: t, light, dark, changed: false }));
  } else {
    base = [{ text: visible, changed: false }];
  }
  const changed = intraline ?? [];
  const matches = find?.ranges ?? [];
  const current = find?.current ? [find.current] : [];
  if (changed.length === 0 && matches.length === 0 && current.length === 0) return base;

  // Every position where some flag may change, in order.
  const cuts = [...new Set([...changed, ...matches, ...current].flatMap((r) => [r.start, r.end]))].sort((a, b) => a - b);
  const out: Segment[] = [];
  let pos = 0;
  for (const seg of base) {
    const segEnd = pos + seg.text.length;
    let at = pos;
    while (at < segEnd) {
      const next = cuts.find((c) => c > at);
      const end = next === undefined ? segEnd : Math.min(next, segEnd);
      const part: Segment = { ...seg, text: seg.text.slice(at - pos, end - pos), changed: inside(changed, at) };
      if (inside(matches, at) || inside(current, at)) part.match = true;
      if (inside(current, at)) part.current = true;
      out.push(part);
      at = end;
    }
    pos = segEnd;
  }
  return out;
}

/** Fast 32-bit FNV-1a hash of a string (cache key, not security). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ":" + s.length.toString(36);
}
