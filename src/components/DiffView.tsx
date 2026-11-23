import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { highlighter } from "../highlight/client";
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

interface Props {
  file: FileSummary;
  baseSha: string;
  diff: FileDiff;
  oldContent: string | null;
  newContent: string | null;
  mode: ViewMode;
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

export function DiffView({ file, baseSha, diff, oldContent, newContent, mode }: Props) {
  const [expansion, setExpansion] = useState<ExpansionState>({});
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
  const contentWidth = `calc(${maxColumns}ch + 24px)`;

  return (
    <div className={`diff-view ${mode}`}>
      <div
        className="diff-scroll"
        ref={scrollRef}
        data-testid="diff-scroll"
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

const RowView = memo(function RowView({
  row,
  top,
  tokens,
  gap,
  onExpand,
}: {
  row: Row;
  top: number;
  tokens: Tokens;
  gap?: Gap;
  onExpand: (gap: Gap, how: "all" | "up" | "down") => void;
}) {
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
        <Code line={l} tokens={tokens} />
      </div>
    );
  }

  return (
    <div className="row" style={style} data-testid="diff-row">
      <Cell side="left" line={row.left} tokens={tokens} />
      <Cell side="right" line={row.right} tokens={tokens} />
    </div>
  );
});

function Cell({ side, line, tokens }: { side: "left" | "right"; line: DisplayLine | null; tokens: Tokens }) {
  if (!line) return <span className={`cell ${side} filler`} />;
  const no = side === "left" ? line.oldNo : line.newNo;
  return (
    <span className={`cell ${side} ${line.kind}`}>
      <span className="ln">{no ?? ""}</span>
      <span className="code">
        <span className="shift">
          <CodeSegments line={line} tokens={tokens} />
        </span>
      </span>
    </span>
  );
}

function Code({ line, tokens }: { line: DisplayLine; tokens: Tokens }) {
  return (
    <span className="code">
      <CodeSegments line={line} tokens={tokens} />
    </span>
  );
}

function CodeSegments({ line, tokens }: { line: DisplayLine; tokens: Tokens }) {
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
  return <TokenSpans segments={segments(line.text, lineTokens, line.intraline)} changedClass={wordClass} />;
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
