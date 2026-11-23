import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { highlighter } from "../highlight/client";
import { fileUnits } from "../find/match";
import { charWidth, gutterWidth, revealColumns, revealRow } from "../find/reveal";
import { useFind, useSearching, type FindHighlights } from "../find/useFind";
import { segments, type LineTokens } from "../highlight/tokens";
import { OVERSCAN, ROW_HEIGHT } from "./DiffView";
import type { Range } from "../model/Range";
import { TokenSpans } from "./TokenSpans";

/** Read-only, virtualized view of a whole (unchanged) file with line numbers. */
/** Gutter width of the file view (one line-number column), used when layout is unavailable. */
const FILE_GUTTER = 52;

export function FileView({ path, content, active = true }: { path: string; content: string; active?: boolean }) {
  const lines = useMemo(() => {
    const body = content.endsWith("\n") ? content.slice(0, -1) : content;
    return content === "" ? [] : body.split("\n");
  }, [content]);
  const maxColumns = useMemo(() => lines.reduce((m, l) => Math.max(m, l.length), 0), [lines]);

  const [tokens, setTokens] = useState<LineTokens[] | null>(null);
  useEffect(() => {
    let live = true;
    setTokens(null);
    void highlighter.highlight("worktree", path, content).then((t) => live && setTokens(t));
    return () => {
      live = false;
    };
  }, [path, content]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // Render scrolled-in rows in React's normal update instead of a synchronous flush per scroll event.
    useFlushSync: false,
  });

  const searching = useSearching(active);
  const units = useMemo(() => (searching ? fileUnits(lines) : null), [searching, lines]);
  const find = useFind(active, units, {
    topUnit: () => Math.floor((scrollRef.current?.scrollTop ?? 0) / ROW_HEIGHT),
    reveal: (unit, match) => {
      const el = scrollRef.current;
      if (!el || unit.oldNo === null) return;
      revealRow(el, unit.oldNo - 1, ROW_HEIGHT);
      const visible = el.clientWidth - gutterWidth(el, ".row .gutter", FILE_GUTTER);
      revealColumns(el, charWidth(el), unit.text, match.start, match.end, visible);
    },
  });

  if (lines.length === 0) {
    return (
      <div className="message">
        <h2>Empty file</h2>
      </div>
    );
  }

  return (
    <div className="diff-view unified file-view">
      <div className="diff-scroll" ref={scrollRef} data-testid="file-view-scroll" tabIndex={-1}>
        <div
          className="diff-inner"
          style={{ height: virtualizer.getTotalSize(), width: `max(100%, calc(76px + ${maxColumns}ch + 24px))` }}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <LineView
              key={item.index}
              no={item.index + 1}
              text={lines[item.index]}
              tokens={tokens?.[item.index]}
              top={item.start}
              {...findProps(find, item.index + 1)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Line `no`'s find ranges as stable props, so lines without matches skip re-rendering. */
function findProps(find: FindHighlights, no: number) {
  const key = `context:${no}:${no}`;
  return { matches: find.ranges.get(key), current: find.current?.key === key ? find.current.range : null };
}

const LineView = memo(function LineView({
  no,
  text,
  tokens,
  top,
  matches,
  current,
}: {
  no: number;
  text: string;
  tokens: LineTokens | undefined;
  top: number;
  matches: Range[] | undefined;
  current: Range | null;
}) {
  return (
    <div className="row" style={{ transform: `translateY(${top}px)` }} data-testid="file-line">
      <span className="gutter">
        <span className="ln">{no}</span>
      </span>
      <span className="code">
        <TokenSpans segments={segments(text, tokens, null, matches || current ? { ranges: matches ?? [], current } : null)} />
      </span>
    </div>
  );
});
