import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { highlighter } from "../highlight/client";
import { diffUnits, gapContaining, lineKey, lineKeyIndex, type FindMatch, type SearchUnit } from "../find/match";
import { charWidth, gutterWidth, revealColumns, revealRow } from "../find/reveal";
import { lineFind, useFind, useSearching, type FindHighlights } from "../find/useFind";
import { segments, type LineTokens } from "../highlight/tokens";
import type { FileDiff } from "../model/FileDiff";
import type { FileSummary } from "../model/FileSummary";
import {
  buildRows,
  EXPAND_STEP,
  expandGap,
  type DisplayLine,
  type ExpansionState,
  type Gap,
  type GapRow,
  type Row,
  type ViewMode,
} from "../rows/build";
import { TokenSpans } from "./TokenSpans";

export const ROW_HEIGHT = 20;
/** Rows rendered beyond each edge of the viewport. */
export const OVERSCAN = 10;
/** Unified gutter (two line-number columns and the marker) and a split cell's line-number width, without layout. */
const UNIFIED_GUTTER = 122;
const SPLIT_LN = 52;

interface Props {
  file: FileSummary;
  baseSha: string;
  diff: FileDiff;
  oldContent: string | null;
  newContent: string | null;
  mode: ViewMode;
  /** Whether this view's tab is the active one (find runs only there). */
  active?: boolean;
}

/** Tokens for both sides, filled in asynchronously by the highlight worker. */
function useTokens(file: FileSummary, baseSha: string, oldContent: string | null, newContent: string | null) {
  const [tokens, setTokens] = useState<{ old: LineTokens[] | null; new: LineTokens[] | null }>({ old: null, new: null });
  useEffect(() => {
    let live = true;
    setTokens({ old: null, new: null });
    if (oldContent !== null && file.oldPath) {
      void highlighter.highlight(baseSha, file.oldPath, oldContent).then((t) => live && setTokens((s) => ({ ...s, old: t })));
    }
    if (newContent !== null && file.newPath) {
      void highlighter.highlight("worktree", file.newPath, newContent).then((t) => live && setTokens((s) => ({ ...s, new: t })));
    }
    return () => {
      live = false;
    };
  }, [file.oldPath, file.newPath, baseSha, oldContent, newContent]);
  return tokens;
}

export function DiffView({ file, baseSha, diff, oldContent, newContent, mode, active = true }: Props) {
  const [expansion, setExpansion] = useState<ExpansionState>({});
  // Expanded ranges refer to this diff's line numbers: start over when the diff changes.
  // (An update that changes nothing keeps the same diff object.)
  const [expansionDiff, setExpansionDiff] = useState(diff);
  if (expansionDiff !== diff) {
    setExpansionDiff(diff);
    setExpansion({});
  }
  const tokens = useTokens(file, baseSha, oldContent, newContent);
  const { rows, gaps, maxColumns } = useMemo(
    () => buildRows({ diff, oldContent, newContent, expansion, mode }),
    [diff, oldContent, newContent, expansion, mode],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // Render scrolled-in rows in React's normal update instead of a synchronous flush per scroll event.
    useFlushSync: false,
  });

  // Stable, so memoized rows are not re-rendered on every scroll.
  const onExpand = useCallback(
    (gap: Gap, how: "all" | "up" | "down") => setExpansion((s) => expandGap(s, gap, how)),
    [],
  );
  // ---- find: search every line (including collapsed ones), reveal the current match
  const searching = useSearching(active);
  const units = useMemo(
    () => (searching ? diffUnits({ diff, oldContent, newContent, mode }) : null),
    [searching, diff, oldContent, newContent, mode],
  );
  const unitIndex = useMemo(() => (units ? new Map(units.map((u, i) => [u.key, i])) : null), [units]);
  const keyIndex = useMemo(() => (searching ? lineKeyIndex(rows) : null), [searching, rows]);
  const latest = useRef({ keyIndex, gaps });
  latest.current = { keyIndex, gaps };
  const pendingReveal = useRef<{ unit: SearchUnit; match: FindMatch } | null>(null);

  const revealMatch = (unit: SearchUnit, match: FindMatch) => {
    const el = scrollRef.current;
    if (!el) return;
    const index = latest.current.keyIndex?.get(unit.key);
    if (index === undefined) {
      // Hidden in a collapsed region: expand it, then reveal once the rows are rebuilt.
      const gap = gapContaining(latest.current.gaps, unit);
      if (gap) {
        pendingReveal.current = { unit, match };
        setExpansion((s) => expandGap(s, gap, "all"));
      }
      return;
    }
    revealRow(el, index, ROW_HEIGHT);
    const cw = charWidth(el);
    if (mode === "unified") {
      const visible = el.clientWidth - gutterWidth(el, ".row .gutter", UNIFIED_GUTTER);
      revealColumns(el, cw, unit.text, match.start, match.end, visible);
      return;
    }
    // Split: scroll only the side(s) showing the line, through that side's scrollbar.
    const sides = unit.kind === "removed" ? ["left"] : unit.kind === "added" ? ["right"] : ["left", "right"];
    for (const side of sides) {
      const bar = el.parentElement?.querySelector<HTMLElement>(`.hscroll [data-pane="${side}"]`);
      if (bar) revealColumns(bar, cw, unit.text, match.start, match.end, bar.clientWidth - SPLIT_LN);
    }
  };

  useEffect(() => {
    const p = pendingReveal.current;
    if (p && keyIndex?.has(p.unit.key)) {
      pendingReveal.current = null;
      revealMatch(p.unit, p.match);
    }
  });

  const find = useFind(active, units, {
    topUnit: () => {
      const first = Math.floor((scrollRef.current?.scrollTop ?? 0) / ROW_HEIGHT);
      for (let i = first; i < rows.length; i++) {
        const r = rows[i];
        const line = r.type === "line" ? r.line : r.type === "pair" ? (r.left ?? r.right) : null;
        const u = line ? unitIndex?.get(lineKey(line)) : undefined;
        if (u !== undefined) return u;
      }
      return 0;
    },
    reveal: revealMatch,
  });

  const contentWidth = `calc(${maxColumns}ch + 24px)`;

  return (
    <div className={`diff-view ${mode}`}>
      <div
        className="diff-scroll"
        ref={scrollRef}
        data-testid="diff-scroll"
        tabIndex={-1}
        onWheel={mode === "split" ? (e) => splitWheel(e, scrollRef.current) : undefined}
      >
        <div
          className="diff-inner"
          style={{
            height: virtualizer.getTotalSize(),
            width: mode === "unified" ? `max(100%, calc(140px + ${contentWidth}))` : "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <RowView
                key={row.key}
                row={row}
                top={item.start}
                tokens={tokens}
                gap={row.type === "gap" ? gaps[row.gapIndex] : undefined}
                onExpand={onExpand}
                find={find}
              />
            );
          })}
        </div>
      </div>
      {mode === "split" && <SplitScrollbars scrollEl={scrollRef} contentWidth={contentWidth} />}
    </div>
  );
}

type Tokens = { old: LineTokens[] | null; new: LineTokens[] | null };

interface RowProps {
  row: Row;
  top: number;
  tokens: Tokens;
  gap?: Gap;
  onExpand: (gap: Gap, how: "all" | "up" | "down") => void;
  find: FindHighlights;
}

/** Line keys shown in a row. */
function rowKeys(row: Row): string[] {
  if (row.type === "line") return [lineKey(row.line)];
  if (row.type === "pair") return [row.left, row.right].filter((l): l is DisplayLine => l !== null).map(lineKey);
  return [];
}

/** Rows re-render on a find change only when their own lines' matches or current match change. */
function sameRow(a: RowProps, b: RowProps): boolean {
  if (a.row !== b.row || a.top !== b.top || a.tokens !== b.tokens || a.gap !== b.gap || a.onExpand !== b.onExpand) return false;
  if (a.find === b.find) return true;
  return rowKeys(a.row).every((k) => {
    const curA = a.find.current?.key === k ? a.find.current.range : null;
    const curB = b.find.current?.key === k ? b.find.current.range : null;
    return a.find.ranges.get(k) === b.find.ranges.get(k) && curA === curB;
  });
}

const RowView = memo(function RowView({ row, top, tokens, gap, onExpand, find }: RowProps) {
  const style = { transform: `translateY(${top}px)` };
  if (row.type === "gap") return <GapView row={row} gap={gap!} style={style} onExpand={onExpand} />;

  if (row.type === "line") {
    const l = row.line;
    return (
      <div className={`row ${l.kind}`} style={style} data-testid="diff-row">
        <span className="gutter">
          <span className="ln">{l.oldNo ?? ""}</span>
          <span className="ln">{l.newNo ?? ""}</span>
          <span className="marker">{l.kind === "added" ? "+" : l.kind === "removed" ? "-" : " "}</span>
        </span>
        <Code line={l} tokens={tokens} find={find} />
      </div>
    );
  }

  return (
    <div className="row" style={style} data-testid="diff-row">
      <Cell side="left" line={row.left} tokens={tokens} find={find} />
      <Cell side="right" line={row.right} tokens={tokens} find={find} />
    </div>
  );
}, sameRow);

function Cell({
  side,
  line,
  tokens,
  find,
}: {
  side: "left" | "right";
  line: DisplayLine | null;
  tokens: Tokens;
  find: FindHighlights;
}) {
  if (!line) return <span className={`cell ${side} filler`} />;
  const no = side === "left" ? line.oldNo : line.newNo;
  return (
    <span className={`cell ${side} ${line.kind}`}>
      <span className="ln">{no ?? ""}</span>
      <span className="code">
        <span className="shift">
          <CodeSegments line={line} tokens={tokens} find={find} />
        </span>
      </span>
    </span>
  );
}

function Code({ line, tokens, find }: { line: DisplayLine; tokens: Tokens; find: FindHighlights }) {
  return (
    <span className="code">
      <CodeSegments line={line} tokens={tokens} find={find} />
    </span>
  );
}

function CodeSegments({ line, tokens, find }: { line: DisplayLine; tokens: Tokens; find: FindHighlights }) {
  // Removed lines are highlighted from the base; everything else from the worktree
  // (falling back to the base for files whose worktree side is missing).
  const lineTokens =
    line.kind === "removed"
      ? line.oldNo !== null
        ? tokens.old?.[line.oldNo - 1]
        : undefined
      : line.newNo !== null && tokens.new
        ? tokens.new[line.newNo - 1]
        : line.oldNo !== null
          ? tokens.old?.[line.oldNo - 1]
          : undefined;
  const wordClass = line.kind === "added" ? "ix added-word" : "ix removed-word";
  return (
    <TokenSpans
      segments={segments(line.text, lineTokens, line.intraline, lineFind(find, lineKey(line)))}
      changedClass={wordClass}
    />
  );
}

function GapView({
  row,
  gap,
  style,
  onExpand,
}: {
  row: GapRow;
  gap: Gap;
  style: React.CSSProperties;
  onExpand: (gap: Gap, how: "all" | "up" | "down") => void;
}) {
  const step = Math.min(EXPAND_STEP, row.hidden);
  return (
    <div className="row gap" style={style} data-testid="gap-row">
      <span className="gap-actions">
        {row.canExpandDown && row.hidden > EXPAND_STEP && (
          <button onClick={() => onExpand(gap, "down")} title={`Show ${step} lines below the previous change`}>
            ↓ {step}
          </button>
        )}
        {row.canExpandUp && row.hidden > EXPAND_STEP && (
          <button onClick={() => onExpand(gap, "up")} title={`Show ${step} lines above the next change`}>
            ↑ {step}
          </button>
        )}
        {(row.canExpandUp || row.canExpandDown) && (
          <button onClick={() => onExpand(gap, "all")} title="Show all hidden lines">
            Expand all
          </button>
        )}
      </span>
      <span className="gap-text">
        {row.hidden} hidden {row.hidden === 1 ? "line" : "lines"}
        {row.header ? `   ${row.header}` : ""}
      </span>
    </div>
  );
}

// ---- split view horizontal scrolling -------------------------------------------
// Each pane has its own horizontal offset, applied as a CSS variable on the scroll
// container (so scrolling never re-renders rows), driven by a per-pane scrollbar.

function SplitScrollbars({ scrollEl, contentWidth }: { scrollEl: React.RefObject<HTMLDivElement | null>; contentWidth: string }) {
  const onScroll = (side: "left" | "right") => (e: React.UIEvent<HTMLDivElement>) => {
    scrollEl.current?.style.setProperty(`--sx-${side}`, String(e.currentTarget.scrollLeft));
  };
  return (
    <div className="hscroll">
      <div data-pane="left" onScroll={onScroll("left")} aria-label="Scroll left pane horizontally">
        <div style={{ width: contentWidth }} />
      </div>
      <div data-pane="right" onScroll={onScroll("right")} aria-label="Scroll right pane horizontally">
        <div style={{ width: contentWidth }} />
      </div>
    </div>
  );
}

/** Shift+wheel (or a horizontal trackpad swipe) scrolls the pane under the pointer. */
function splitWheel(e: WheelEvent<HTMLDivElement>, el: HTMLDivElement | null) {
  const dx = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
  if (!el || dx === 0 || (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY))) return;
  const rect = el.getBoundingClientRect();
  const side = e.clientX < rect.left + rect.width / 2 ? "left" : "right";
  const bar = el.parentElement?.querySelector<HTMLDivElement>(`.hscroll [data-pane="${side}"]`);
  if (bar) bar.scrollLeft += dx;
}
