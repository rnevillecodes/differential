import { describe, expect, it } from "vitest";
import { add, ctx, fileDiff, hunk, rem } from "../test/fixtures";
import { buildRows, computeGaps, expandGap, splitLines, type GapRow, type LineRow, type PairRow } from "./build";

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

describe("splitLines", () => {
  it("handles trailing newlines and empty content", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("\n")).toEqual([""]);
  });
});

describe("computeGaps", () => {
  it("finds leading, between and trailing gaps", () => {
    const hunks = [
      hunk(5, 3, 5, 3, []), // old 5..7
      hunk(20, 2, 20, 4, []), // old 20..21, new 20..23
    ];
    expect(computeGaps(hunks, 30)).toEqual([
      { index: 0, oldStart: 1, newStart: 1, count: 4 },
      { index: 1, oldStart: 8, newStart: 8, count: 12 },
      { index: 2, oldStart: 22, newStart: 24, count: 9 },
    ]);
  });

  it("treats zero-length sides as insertions after the start line", () => {
    // "@@ -3,0 +4,2 @@": two lines inserted after old line 3
    const gaps = computeGaps([hunk(3, 0, 4, 2, [])], 10);
    expect(gaps[0]).toEqual({ index: 0, oldStart: 1, newStart: 1, count: 3 });
    expect(gaps[1]).toEqual({ index: 1, oldStart: 4, newStart: 6, count: 7 });
  });

  it("has no trailing gap when the base is unknown (added file)", () => {
    const gaps = computeGaps([hunk(0, 0, 1, 2, [])], null);
    expect(gaps.map((g) => g.count)).toEqual([0, 0]);
  });
});

describe("buildRows", () => {
  // Base has 10 lines; line 5 changed.
  const diff = fileDiff([
    hunk(2, 7, 2, 7, [ctx("line 2", 2, 2), ctx("line 3", 3, 3), ctx("line 4", 4, 4), rem("line 5", 5), add("LINE 5", 5), ctx("line 6", 6, 6), ctx("line 7", 7, 7), ctx("line 8", 8, 8)]),
  ]);
  const content = numbered(10);

  it("builds unified rows with gaps and line numbers", () => {
    const { rows } = buildRows({ diff, oldContent: content, newContent: content.replace("line 5", "LINE 5"), expansion: {}, mode: "unified" });
    expect(rows[0]).toMatchObject({ type: "gap", hidden: 1, canExpandUp: true, canExpandDown: false });
    const lines = rows.filter((r): r is LineRow => r.type === "line").map((r) => [r.line.kind, r.line.oldNo, r.line.newNo]);
    expect(lines[3]).toEqual(["removed", 5, null]);
    expect(lines[4]).toEqual(["added", null, 5]);
    const last = rows[rows.length - 1] as GapRow;
    expect(last).toMatchObject({ type: "gap", hidden: 2, canExpandUp: false, canExpandDown: true });
  });

  it("pairs removed and added lines with filler in split mode", () => {
    const d = fileDiff([hunk(1, 3, 1, 4, [rem("a", 1), rem("b", 2), add("A", 1), add("B", 2), add("C", 3), ctx("z", 3, 4)])]);
    const { rows } = buildRows({ diff: d, oldContent: "a\nb\nz\n", newContent: "A\nB\nC\nz\n", expansion: {}, mode: "split" });
    const pairs = rows.filter((r): r is PairRow => r.type === "pair").map((r) => [r.left?.text ?? null, r.right?.text ?? null]);
    expect(pairs).toEqual([
      ["a", "A"],
      ["b", "B"],
      [null, "C"],
      ["z", "z"],
    ]);
  });

  it("expands a gap fully with correct numbers on both sides", () => {
    // 40 hidden lines between two hunks, new side shifted by +1.
    const d = fileDiff([
      hunk(1, 1, 1, 2, [ctx("line 1", 1, 1), add("inserted", 2)]),
      hunk(42, 1, 43, 1, [rem("line 42", 42), add("LINE 42", 43)]),
    ]);
    const old = numbered(42);
    const { gaps } = buildRows({ diff: d, oldContent: old, newContent: null, expansion: {}, mode: "unified" });
    expect(gaps[1].count).toBe(40);
    const expansion = expandGap({}, gaps[1], "all");
    const { rows } = buildRows({ diff: d, oldContent: old, newContent: null, expansion, mode: "unified" });
    expect(rows.some((r) => r.type === "gap" && r.gapIndex === 1)).toBe(false);
    const revealed = rows.filter((r): r is LineRow => r.type === "line" && r.key.startsWith("c"));
    expect(revealed).toHaveLength(40);
    expect(revealed[0].line).toMatchObject({ text: "line 2", oldNo: 2, newNo: 3 });
    expect(revealed[39].line).toMatchObject({ text: "line 41", oldNo: 41, newNo: 42 });
  });

  it("expands partially from either side and updates the remaining count", () => {
    const d = fileDiff([hunk(1, 1, 1, 1, [rem("a", 1), add("b", 1)]), hunk(50, 1, 50, 1, [rem("x", 50), add("y", 50)])]);
    const old = numbered(50);
    const { gaps } = buildRows({ diff: d, oldContent: old, newContent: null, expansion: {}, mode: "unified" });
    let exp = expandGap({}, gaps[1], "down", 5); // below previous hunk
    exp = expandGap(exp, gaps[1], "up", 10); // above next hunk
    const { rows } = buildRows({ diff: d, oldContent: old, newContent: null, expansion: exp, mode: "unified" });
    const gapIdx = rows.findIndex((r) => r.type === "gap");
    expect((rows[gapIdx] as GapRow).hidden).toBe(48 - 15);
    expect((rows[gapIdx - 1] as LineRow).line.oldNo).toBe(6);
    expect((rows[gapIdx + 1] as LineRow).line.oldNo).toBe(40);
    expect((rows[gapIdx + 10] as LineRow).line.oldNo).toBe(49);
    // Asking for more than remains clamps and removes the gap.
    exp = expandGap(exp, gaps[1], "up", 1000);
    const after = buildRows({ diff: d, oldContent: old, newContent: null, expansion: exp, mode: "unified" });
    expect(after.rows.some((r) => r.type === "gap")).toBe(false);
  });

  it("produces no gaps for an added file", () => {
    const d = fileDiff([hunk(0, 0, 1, 2, [add("a", 1), add("b", 2)])]);
    const { rows } = buildRows({ diff: d, oldContent: null, newContent: "a\nb\n", expansion: {}, mode: "unified" });
    expect(rows.every((r) => r.type === "line")).toBe(true);
  });

  it("reports the longest line with tabs as 4 columns", () => {
    const d = fileDiff([hunk(1, 1, 1, 1, [rem("\tab", 1), add("abcdef", 1)])]);
    expect(buildRows({ diff: d, oldContent: "\tab\n", newContent: "abcdef\n", expansion: {}, mode: "unified" }).maxColumns).toBe(6);
  });

  it("includes the next hunk's header on gap rows", () => {
    const d = fileDiff([hunk(10, 1, 10, 1, [rem("a", 10), add("b", 10)], "fn main() {")]);
    const { rows } = buildRows({ diff: d, oldContent: numbered(10), newContent: null, expansion: {}, mode: "split" });
    expect((rows[0] as GapRow).header).toBe("@@ -10,1 +10,1 @@ fn main() {");
  });
});
