import { describe, expect, it } from "vitest";
import { buildRows, computeGaps, expandGap } from "../rows/build";
import { add, ctx, fileDiff, hunk, rem } from "../test/fixtures";
import {
  diffUnits,
  fileUnits,
  findMatches,
  firstMatchFrom,
  gapContaining,
  lineKey,
  lineKeyIndex,
  rangesByLine,
} from "./match";

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

// Base has 12 lines; line 5 changed. Lines 1 and 10..12 are collapsed.
const diff = fileDiff([
  hunk(2, 7, 2, 7, [
    ctx("line 2", 2, 2),
    ctx("line 3", 3, 3),
    ctx("line 4", 4, 4),
    rem("line 5 oldName", 5),
    add("line 5 newName", 5),
    ctx("line 6", 6, 6),
    ctx("line 7", 7, 7),
    ctx("line 8", 8, 8),
  ]),
]);
const oldContent = numbered(12).replace("line 5", "line 5 oldName");
const newContent = numbered(12).replace("line 5", "line 5 newName");

describe("findMatches", () => {
  const units = fileUnits(["TODO: one", "todo two todo", "nothing"]);

  it("is case-insensitive unless match case is on", () => {
    expect(findMatches(units, "todo", false)).toEqual([
      { unit: 0, start: 0, end: 4 },
      { unit: 1, start: 0, end: 4 },
      { unit: 1, start: 9, end: 13 },
    ]);
    expect(findMatches(units, "TODO", true)).toEqual([{ unit: 0, start: 0, end: 4 }]);
  });

  it("finds nothing for an empty query", () => {
    expect(findMatches(units, "", false)).toEqual([]);
  });

  it("does not overlap repeated matches", () => {
    expect(findMatches(fileUnits(["aaa"]), "aa", true)).toEqual([{ unit: 0, start: 0, end: 2 }]);
    expect(findMatches(fileUnits(["aaaa"]), "aa", true)).toHaveLength(2);
  });

  it("keeps offsets valid when lower-casing changes length", () => {
    const m = findMatches(fileUnits(["İx foo"]), "foo", false);
    expect(m).toEqual([{ unit: 0, start: 3, end: 6 }]);
  });

  it("is fast on 50,000 lines", () => {
    const big = fileUnits(Array.from({ length: 50_000 }, (_, i) => `const value${i} = compute(${i}); // padding text here`));
    const t = performance.now();
    const m = findMatches(big, "compute(4", false);
    expect(performance.now() - t).toBeLessThan(50);
    expect(m.length).toBeGreaterThan(0);
  });
});

describe("diffUnits", () => {
  it("includes hidden lines in display order and both removed and added lines", () => {
    const units = diffUnits({ diff, oldContent, newContent, mode: "unified" });
    expect(units.map((u) => u.text)).toEqual([
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5 oldName",
      "line 5 newName",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
      "line 10",
      "line 11",
      "line 12",
    ]);
    const m = findMatches(units, "Name", true);
    expect(m.map((x) => units[x.unit].kind)).toEqual(["removed", "added"]);
  });

  it("orders split rows left before right and counts unchanged lines once", () => {
    const d = fileDiff([hunk(1, 3, 1, 3, [rem("a x", 1), rem("b x", 2), add("A x", 1), add("B x", 2), ctx("z x", 3, 3)])]);
    const units = diffUnits({ diff: d, oldContent: "a x\nb x\nz x\n", newContent: "A x\nB x\nz x\n", mode: "split" });
    expect(units.map((u) => u.text)).toEqual(["a x", "A x", "b x", "B x", "z x"]);
    expect(findMatches(units, "x", true)).toHaveLength(5);
  });
});

describe("row and gap lookup", () => {
  const units = diffUnits({ diff, oldContent, newContent, mode: "unified" });
  const unitFor = (text: string) => units.find((u) => u.text === text)!;
  const gaps = computeGaps(diff.hunks, 12);

  it("maps displayed lines to rows, and hidden ones to their gap", () => {
    const { rows } = buildRows({ diff, oldContent, newContent, expansion: {}, mode: "unified" });
    const index = lineKeyIndex(rows);
    expect(index.get(unitFor("line 3").key)).toBe(rows.findIndex((r) => r.type === "line" && r.line.text === "line 3"));
    expect(index.has(unitFor("line 1").key)).toBe(false);
    expect(gapContaining(gaps, unitFor("line 1"))?.index).toBe(0); // before the first hunk
    expect(gapContaining(gaps, unitFor("line 11"))?.index).toBe(1); // after the last hunk
    expect(gapContaining(gaps, unitFor("line 3"))).toBeNull();
    expect(gapContaining(gaps, unitFor("line 5 newName"))).toBeNull();
  });

  it("finds the gap between hunks and in a partly expanded gap", () => {
    const d = fileDiff([hunk(2, 1, 2, 1, [rem("b", 2), add("B", 2)]), hunk(20, 1, 20, 1, [rem("t", 20), add("T", 20)])]);
    const base = numbered(25);
    const u = diffUnits({ diff: d, oldContent: base, newContent: base, mode: "unified" });
    const g = computeGaps(d.hunks, 25);
    expect(gapContaining(g, u.find((x) => x.text === "line 10")!)?.index).toBe(1);

    const expansion = expandGap({}, g[1], "down", 3); // reveals lines 3..5
    const { rows } = buildRows({ diff: d, oldContent: base, newContent: base, expansion, mode: "unified" });
    const index = lineKeyIndex(rows);
    expect(index.has(lineKey({ kind: "context", oldNo: 4, newNo: 4 }))).toBe(true);
    expect(index.has(lineKey({ kind: "context", oldNo: 10, newNo: 10 }))).toBe(false);
    expect(gapContaining(g, u.find((x) => x.text === "line 10")!)?.index).toBe(1);
  });

  it("maps both sides of a split row to it", () => {
    const { rows } = buildRows({ diff, oldContent, newContent, expansion: {}, mode: "split" });
    const index = lineKeyIndex(rows);
    expect(index.get(unitFor("line 5 oldName").key)).toBe(index.get(unitFor("line 5 newName").key));
  });
});

describe("helpers", () => {
  it("groups ranges by line and finds the first match from a unit", () => {
    const units = fileUnits(["ab ab", "x", "ab"]);
    const m = findMatches(units, "ab", true);
    expect(rangesByLine(units, m).get(units[0].key)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(firstMatchFrom(m, 1)).toBe(2);
    expect(firstMatchFrom(m, 3)).toBe(0); // wraps
    expect(firstMatchFrom([], 0)).toBe(-1);
  });
});
