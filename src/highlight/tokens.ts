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
}

/**
 * Split a line into styled segments. Tokens are used only if they spell out exactly the
 * line's text (a trailing `\r` is ignored); otherwise the line is plain.
 */
export function segments(text: string, tokens: LineTokens | undefined, intraline: Range[] | null): Segment[] {
  const visible = text.endsWith("\r") ? text.slice(0, -1) : text;
  let base: Segment[];
  if (tokens && tokens.map((t) => t[0]).join("") === visible) {
    base = tokens.filter((t) => t[0] !== "").map(([t, light, dark]) => ({ text: t, light, dark, changed: false }));
  } else {
    base = [{ text: visible, changed: false }];
  }
  if (!intraline || intraline.length === 0) return base;

  // Cut segments at range boundaries and flag the parts inside ranges.
  const out: Segment[] = [];
  let pos = 0;
  for (const seg of base) {
    let offset = 0;
    while (offset < seg.text.length) {
      const at = pos + offset;
      const inRange = intraline.find((r) => at >= r.start && at < r.end);
      let end: number;
      if (inRange) {
        end = Math.min(inRange.end, pos + seg.text.length);
      } else {
        const next = intraline.filter((r) => r.start > at).reduce((m, r) => Math.min(m, r.start), Infinity);
        end = Math.min(next, pos + seg.text.length);
      }
      out.push({ ...seg, text: seg.text.slice(offset, end - pos), changed: Boolean(inRange) });
      offset = end - pos;
    }
    pos += seg.text.length;
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
