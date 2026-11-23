import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { GraphLine, GraphRow } from "../graph/layout";
import type { RefLabel } from "../model/RefLabel";
import { MIN_GRAPH_WIDTH, useApp } from "../store";
import { GraphIcon } from "./icons";

export const GRAPH_ROW_HEIGHT = 24;
const LANE_WIDTH = 12;
/** Lanes drawn before the graph column is clipped (with a fade). */
const MAX_LANES = 16;
const LANE_COLORS = 8;
/** Load the next page when this many rows or fewer remain below the last rendered row. */
const LOAD_AHEAD = 50;
/** Space always left for the file pane beside the graph pane, in pixels. */
export const MIN_FILE_PANE_WIDTH = 400;

const laneX = (column: number) => column * LANE_WIDTH + LANE_WIDTH / 2;
const laneColor = (color: number) => `var(--lane-${color % LANE_COLORS})`;

/** SVG path for one line segment of a row (see `GraphLine`). */
function linePath(line: GraphLine, column: number): string {
  const mid = GRAPH_ROW_HEIGHT / 2;
  const bottom = GRAPH_ROW_HEIGHT;
  if (line.kind === "pass") return `M${laneX(line.from)} 0V${bottom}`;
  if (line.kind === "in") {
    const [x1, x2] = [laneX(line.from), laneX(column)];
    return x1 === x2 ? `M${x1} 0V${mid}` : `M${x1} 0C${x1} ${mid} ${x2} 0 ${x2} ${mid}`;
  }
  const [x1, x2] = [laneX(column), laneX(line.to)];
  return x1 === x2 ? `M${x1} ${mid}V${bottom}` : `M${x1} ${mid}C${x1} ${bottom} ${x2} ${mid} ${x2} ${bottom}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * The commit graph pane on the right of the window: the history of all branches and tags as
 * lanes, loaded in pages as it scrolls. Clicking a commit (or a branch or tag label) sets the base.
 */
export function CommitGraph() {
  const graph = useApp((s) => s.graph);
  const baseSha = useApp((s) => s.changes?.baseSha ?? null);
  const width = useApp((s) => s.graphWidth);
  const setBase = useApp((s) => s.setBase);
  const setGraphWidth = useApp((s) => s.setGraphWidth);
  const toggleGraph = useApp((s) => s.toggleGraph);
  const loadMoreCommits = useApp((s) => s.loadMoreCommits);
  const scrollRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const { rows } = graph;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GRAPH_ROW_HEIGHT,
    overscan: 20,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length > 0 ? items[items.length - 1].index : -1;

  useEffect(() => {
    if (rows.length > 0 && lastIndex >= rows.length - 1 - LOAD_AHEAD) loadMoreCommits();
  }, [lastIndex, rows.length, loadMoreCommits]);

  const lanes = Math.max(1, ...items.map((item) => rows[item.index]?.width ?? 1));
  const clipped = lanes > MAX_LANES;
  const graphWidth = Math.min(lanes, MAX_LANES) * LANE_WIDTH;

  const onResizeStart = (e: PointerEvent<HTMLDivElement>) => {
    const main = paneRef.current?.parentElement;
    if (!main || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    const onMove = (ev: globalThis.PointerEvent) => {
      const rect = main.getBoundingClientRect();
      const sidebar = main.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0;
      const max = Math.max(MIN_GRAPH_WIDTH, rect.width - sidebar - MIN_FILE_PANE_WIDTH);
      setGraphWidth(Math.min(max, Math.max(MIN_GRAPH_WIDTH, rect.right - ev.clientX)));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  let message: string | null = null;
  if (rows.length === 0) {
    if (graph.error) message = `Could not list the history: ${graph.error.message}`;
    else if (graph.loading || graph.stale) message = "Loading history…";
    else message = "No commits yet.";
  }

  return (
    <aside ref={paneRef} className="graph-pane" aria-label="Commit graph" style={{ width }}>
      <div
        className="graph-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize commit graph"
        onPointerDown={onResizeStart}
      />
      <div className="graph-header">
        <span className="graph-title">Commits</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Hide commit graph"
          title="Hide commit graph (Ctrl+G)"
          onClick={toggleGraph}
        >
          ×
        </button>
      </div>
      {message !== null ? (
        <div className={`graph-message${graph.error ? " error" : ""}`} role={graph.error ? "alert" : undefined}>
          {message}
        </div>
      ) : (
        <div className="graph-scroll" ref={scrollRef} role="listbox" aria-label="Commits">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {items.map((item) => {
              const row = rows[item.index];
              return (
                <CommitRow
                  key={row.commit.sha}
                  row={row}
                  top={item.start}
                  graphWidth={graphWidth}
                  clipped={clipped}
                  isBase={row.commit.sha === baseSha}
                  onPick={setBase}
                />
              );
            })}
          </div>
          {graph.error && <div className="graph-message error">Could not load more: {graph.error.message}</div>}
        </div>
      )}
    </aside>
  );
}

const CommitRow = memo(function CommitRow({
  row,
  top,
  graphWidth,
  clipped,
  isBase,
  onPick,
}: {
  row: GraphRow;
  top: number;
  graphWidth: number;
  clipped: boolean;
  isBase: boolean;
  onPick: (rev: string) => Promise<void>;
}) {
  const { commit, column, color, lines } = row;
  const pick = () => void onPick(commit.shortSha);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      pick();
    }
  };
  const title = `${commit.sha}\n${commit.author}\n${formatDate(commit.date)}\n\n${commit.subject}`;
  return (
    <div
      className={`commit-row${isBase ? " is-base" : ""}`}
      role="option"
      aria-selected={isBase}
      tabIndex={0}
      style={{ transform: `translateY(${top}px)` }}
      onClick={pick}
      onKeyDown={onKeyDown}
      title={title}
      data-testid="commit-row"
    >
      <svg
        className={`commit-lanes${clipped ? " clipped" : ""}`}
        width={graphWidth}
        height={GRAPH_ROW_HEIGHT}
        aria-hidden="true"
        focusable="false"
      >
        {lines.map((line, i) => (
          <path key={i} d={linePath(line, column)} stroke={laneColor(line.color)} />
        ))}
        <circle
          cx={laneX(column)}
          cy={GRAPH_ROW_HEIGHT / 2}
          r={commit.head ? 3.5 : 4}
          fill={commit.head ? "var(--bg)" : laneColor(color)}
          stroke={laneColor(color)}
          strokeWidth={commit.head ? 2 : 0}
        />
      </svg>
      <code className="commit-sha">{commit.shortSha}</code>
      {commit.labels.map((label) => (
        <RefChip key={`${label.kind}:${label.name}`} label={label} onPick={onPick} />
      ))}
      <span className="commit-subject">{commit.subject}</span>
    </div>
  );
});

function RefChip({ label, onPick }: { label: RefLabel; onPick: (rev: string) => Promise<void> }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`ref-chip ${label.kind}`}
      title={`Use ${label.name} as the base`}
      onClick={(e) => {
        e.stopPropagation();
        void onPick(label.rev);
      }}
    >
      {label.name}
    </button>
  );
}

/** Toolbar button showing and hiding the commit graph pane. */
export function GraphToggle() {
  const repo = useApp((s) => s.repo);
  const open = useApp((s) => s.graphOpen);
  const toggleGraph = useApp((s) => s.toggleGraph);
  return (
    <button
      type="button"
      className="icon-button graph-toggle"
      onClick={toggleGraph}
      disabled={!repo}
      aria-pressed={open}
      aria-label="Commit graph"
      title={`${open ? "Hide" : "Show"} commit graph (Ctrl+G)`}
    >
      <GraphIcon width={16} height={16} />
    </button>
  );
}
