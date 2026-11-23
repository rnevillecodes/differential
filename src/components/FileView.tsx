import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { highlighter } from "../highlight/client";
import { segments, type LineTokens } from "../highlight/tokens";
import { OVERSCAN, ROW_HEIGHT } from "./DiffView";
import { TokenSpans } from "./TokenSpans";

/** Read-only, virtualized view of a whole (unchanged) file with line numbers. */
export function FileView({ path, content }: { path: string; content: string }) {
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

  if (lines.length === 0) {
    return (
      <div className="message">
        <h2>Empty file</h2>
      </div>
    );
  }

  return (
    <div className="diff-view unified file-view">
      <div className="diff-scroll" ref={scrollRef} data-testid="file-view-scroll">
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
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const LineView = memo(function LineView({
  no,
  text,
  tokens,
  top,
}: {
  no: number;
  text: string;
  tokens: LineTokens | undefined;
  top: number;
}) {
  return (
    <div className="row" style={{ transform: `translateY(${top}px)` }} data-testid="file-line">
      <span className="gutter">
        <span className="ln">{no}</span>
      </span>
      <span className="code">
        <TokenSpans segments={segments(text, tokens, null)} />
      </span>
    </div>
  );
});
