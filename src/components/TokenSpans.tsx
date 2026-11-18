import type { Segment } from "../highlight/tokens";

/**
 * Render styled line segments: syntax colors as `--l`/`--d` (light/dark) variables on
 * `.tok` spans, and intraline changes with `changedClass`.
 */
export function TokenSpans({ segments, changedClass }: { segments: Segment[]; changedClass?: string }) {
  return (
    <>
      {segments.map((s, i) => {
        const cls = [s.light ? "tok" : "", s.changed && changedClass ? changedClass : ""].filter(Boolean).join(" ");
        if (!cls) return <span key={i}>{s.text}</span>;
        return (
          <span key={i} className={cls} style={s.light ? ({ "--l": s.light, "--d": s.dark } as React.CSSProperties) : undefined}>
            {s.text}
          </span>
        );
      })}
    </>
  );
}
