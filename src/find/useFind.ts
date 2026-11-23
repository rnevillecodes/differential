// Find-in-view state for one view: matches over its search units, the current match,
// reacting to next/previous requests, and publishing the count to the store.

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Range } from "../model/Range";
import { useApp } from "../store";
import { findMatches, firstMatchFrom, rangesByLine, type FindMatch, type SearchUnit } from "./match";

/** What a view needs to draw find highlights. */
export interface FindHighlights {
  /** Match ranges per line key. */
  ranges: Map<string, Range[]>;
  /** The current match's line key and range. */
  current: { key: string; range: Range } | null;
}

const NO_MATCHES: FindMatch[] = [];
export const NO_HIGHLIGHTS: FindHighlights = { ranges: new Map(), current: null };

/** Whether a view should build its search units: its tab is active and the bar has a query. */
export function useSearching(active: boolean): boolean {
  return useApp((s) => active && s.findOpen && s.findQuery !== "");
}

export interface FindCallbacks {
  /** Index of the first unit at the top of the viewport. */
  topUnit(units: SearchUnit[]): number;
  /** Bring a match into view (scrolling, expanding collapsed lines). */
  reveal(unit: SearchUnit, match: FindMatch): void;
}

export function useFind(active: boolean, units: SearchUnit[] | null, callbacks: FindCallbacks): FindHighlights {
  const findOpen = useApp((s) => s.findOpen);
  const query = useDeferredValue(useApp((s) => s.findQuery));
  const matchCase = useApp((s) => s.findMatchCase);
  const nav = useApp((s) => s.findNav);
  const setFindStatus = useApp((s) => s.setFindStatus);
  const live = active && findOpen;

  const cb = useRef(callbacks);
  cb.current = callbacks;

  const matches = useMemo(
    () => (live && units ? findMatches(units, query, matchCase) : NO_MATCHES),
    [live, units, query, matchCase],
  );

  // `token` changes whenever the current match should be revealed.
  const [cur, setCur] = useState({ index: -1, token: 0 });
  const prev = useRef<{ units: SearchUnit[] | null; query: string; matchCase: boolean; key: string | null }>({
    units: null,
    query: "",
    matchCase: false,
    key: null,
  });

  // New matches: keep the current line when only the contents changed, otherwise start from the viewport top.
  useEffect(() => {
    const p = prev.current;
    let index = -1;
    if (units && matches.length > 0) {
      const contentOnly = p.units !== units && p.units !== null && p.query === query && p.matchCase === matchCase;
      const kept = contentOnly && p.key !== null ? matches.findIndex((m) => units[m.unit].key === p.key) : -1;
      index = kept >= 0 ? kept : firstMatchFrom(matches, cb.current.topUnit(units));
    }
    prev.current = { units, query, matchCase, key: index >= 0 && units ? units[matches[index].unit].key : null };
    setCur((c) => ({ index, token: c.token + 1 }));
  }, [matches, units, query, matchCase]);

  // Next / previous requests.
  const seenNav = useRef(nav.seq);
  useEffect(() => {
    if (nav.seq === seenNav.current) return;
    seenNav.current = nav.seq;
    const n = matches.length;
    if (!live || n === 0) return;
    setCur((c) => {
      const index = c.index < 0 ? (nav.dir === 1 ? 0 : n - 1) : (c.index + nav.dir + n) % n;
      if (units) prev.current.key = units[matches[index].unit].key;
      return { index, token: c.token + 1 };
    });
  }, [nav, live, matches, units]);

  // Reveal the current match when it changes.
  useEffect(() => {
    const m = matches[cur.index];
    if (m && units) cb.current.reveal(units[m.unit], m);
    // Only on a new current match (token), not when the callbacks or matches change identity.
  }, [cur.token]);

  // Publish the count while this view is the one being searched.
  const index = cur.index < matches.length ? cur.index : -1;
  useEffect(() => {
    if (!live) return;
    setFindStatus({ current: index + 1, total: matches.length });
    return () => setFindStatus(null);
  }, [live, index, matches.length, setFindStatus]);

  const ranges = useMemo(() => (units && matches.length ? rangesByLine(units, matches) : NO_HIGHLIGHTS.ranges), [units, matches]);
  const current = useMemo(() => {
    const m = matches[index];
    return m && units ? { key: units[m.unit].key, range: { start: m.start, end: m.end } } : null;
  }, [matches, index, units]);
  return useMemo(() => (ranges.size === 0 && !current ? NO_HIGHLIGHTS : { ranges, current }), [ranges, current]);
}

/** The find ranges to draw on line `key`, or null when it has none. */
export function lineFind(h: FindHighlights, key: string) {
  const ranges = h.ranges.get(key);
  const current = h.current?.key === key ? h.current.range : null;
  return ranges || current ? { ranges: ranges ?? [], current } : null;
}
