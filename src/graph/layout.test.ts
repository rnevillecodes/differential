import { describe, expect, it } from "vitest";
import { commit } from "../test/fixtures";
import { emptyLayout, layout, type GraphRow } from "./layout";

const run = (commits: ReturnType<typeof commit>[]) => layout(commits, emptyLayout());
const columns = (rows: GraphRow[]) => rows.map((r) => r.column);
const lines = (row: GraphRow) => row.lines.map((l) => `${l.kind}:${l.from}>${l.to}`).sort();

describe("layout", () => {
  it("draws a linear history in one lane", () => {
    const { rows, state } = run([commit("c", ["b"]), commit("b", ["a"]), commit("a")]);
    expect(columns(rows)).toEqual([0, 0, 0]);
    expect(lines(rows[0])).toEqual(["out:0>0"]);
    expect(lines(rows[1])).toEqual(["in:0>0", "out:0>0"]);
    expect(lines(rows[2])).toEqual(["in:0>0"]);
    expect(new Set(rows.map((r) => r.color)).size).toBe(1);
    expect(state.lanes).toEqual([]);
  });

  it("opens a lane for a merged branch and closes it at the branch point", () => {
    // m merges b (main) and c (feature); both branch from a.
    const { rows } = run([commit("m", ["b", "c"]), commit("b", ["a"]), commit("c", ["a"]), commit("a")]);
    expect(columns(rows)).toEqual([0, 0, 1, 0]);
    expect(lines(rows[0])).toEqual(["out:0>0", "out:0>1"]);
    expect(lines(rows[1])).toEqual(["in:0>0", "out:0>0", "pass:1>1"]);
    // c's first parent is already awaited in lane 0, so c's lane joins it.
    expect(lines(rows[2])).toEqual(["in:1>1", "out:1>0", "pass:0>0"]);
    expect(lines(rows[3])).toEqual(["in:0>0"]);
    expect(rows[2].color).not.toBe(rows[0].color);
  });

  it("gives each extra parent of an octopus merge its own lane", () => {
    const { rows } = run([
      commit("m", ["a", "b", "c"]),
      commit("a", ["r"]),
      commit("b", ["r"]),
      commit("c", ["r"]),
      commit("r"),
    ]);
    expect(lines(rows[0])).toEqual(["out:0>0", "out:0>1", "out:0>2"]);
    expect(columns(rows)).toEqual([0, 0, 1, 2, 0]);
    expect(rows[0].width).toBe(3);
  });

  it("starts a new lane for a branch tip with no child above it", () => {
    const { rows, state } = run([commit("main2", ["base"]), commit("feat", ["base"]), commit("base")]);
    expect(columns(rows)).toEqual([0, 1, 0]);
    expect(lines(rows[1])).toEqual(["out:1>0", "pass:0>0"]);
    expect(lines(rows[2])).toEqual(["in:0>0"]);
    expect(state.lanes).toEqual([]);
  });

  it("lays out two unrelated roots", () => {
    const { rows } = run([commit("x2", ["x1"]), commit("y1"), commit("x1")]);
    expect(columns(rows)).toEqual([0, 1, 0]);
    expect(lines(rows[1])).toEqual(["pass:0>0"]);
  });

  it("reuses a freed column for a later branch tip", () => {
    const { rows } = run([
      commit("m", ["b", "c"]),
      commit("c", ["a"]),
      commit("b", ["a"]),
      commit("a"),
      commit("t", ["s"]),
      commit("s"),
    ]);
    expect(rows[4].column).toBe(0);
  });

  it("gives the same rows in two pages as in one", () => {
    const history = [
      commit("m", ["b", "c"]),
      commit("b", ["a"]),
      commit("t", ["c"]),
      commit("c", ["a"]),
      commit("a", ["r"]),
      commit("r"),
    ];
    const whole = run(history);
    for (let split = 1; split < history.length; split++) {
      const first = layout(history.slice(0, split), emptyLayout());
      const second = layout(history.slice(split), first.state);
      expect([...first.rows, ...second.rows]).toEqual(whole.rows);
      expect(second.state).toEqual(whole.state);
    }
  });

  it("does not modify the state it is given", () => {
    const first = run([commit("b", ["a"])]);
    const snapshot = structuredClone(first.state);
    layout([commit("a")], first.state);
    expect(first.state).toEqual(snapshot);
  });
});
