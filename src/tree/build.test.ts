import { describe, expect, it } from "vitest";
import { summary } from "../test/fixtures";
import { ancestorsOf, buildTree, flatten, parentOf, pruneExpanded, type DirNode, type TreeRow } from "./build";

const names = (rows: TreeRow[]) => rows.map((r) => `${"  ".repeat(r.depth)}${r.node.name}${r.node.type === "dir" ? "/" : ""}`);
const dir = (root: DirNode, path: string): DirNode => {
  let d = root;
  for (const part of path.split("/")) d = d.dirs.find((c) => c.name === part)!;
  return d;
};

describe("buildTree / flatten", () => {
  it("lists folders before files, sorted case-insensitively", () => {
    const tree = buildTree(["README.md", "src/main.ts", "src/ui/App.tsx", "b.txt", "A.txt"], null);
    expect(names(flatten(tree, new Set()))).toEqual(["src/", "A.txt", "b.txt", "README.md"]);
    expect(names(flatten(tree, new Set(["src"])))).toEqual(["src/", "  ui/", "  main.ts", "A.txt", "b.txt", "README.md"]);
    expect(names(flatten(tree, new Set(["src", "src/ui"])))).toContain("    App.tsx");
  });

  it("hides descendants of collapsed folders even if they are expanded", () => {
    const tree = buildTree(["a/b/c.ts"], null);
    expect(names(flatten(tree, new Set(["a/b"])))).toEqual(["a/"]);
  });

  it("includes deleted files from the change set", () => {
    const tree = buildTree(["keep.ts"], [summary(0, "old.ts", { status: "deleted", newPath: null })]);
    const rows = flatten(tree, new Set());
    expect(names(rows)).toEqual(["keep.ts", "old.ts"]);
    const old = rows[1].node;
    expect(old.type === "file" && old.change?.status).toBe("deleted");
  });

  it("counts nested changes per folder and decorates files", () => {
    const tree = buildTree(
      ["src/a.ts", "src/ui/b.tsx", "src/ui/c.tsx", "README.md"],
      [summary(0, "src/a.ts"), summary(1, "src/ui/b.tsx", { status: "untracked", oldPath: null })],
    );
    expect(tree.changedCount).toBe(2);
    expect(dir(tree, "src").changedCount).toBe(2);
    expect(dir(tree, "src/ui").changedCount).toBe(1);
    expect(dir(tree, "src").files[0].change?.status).toBe("modified");
    expect(dir(tree, "src/ui").files.map((f) => f.change?.status ?? null)).toEqual(["untracked", null]);
    expect(tree.files[0].change).toBeNull();
  });

  it("places renamed files at their new path only", () => {
    const tree = buildTree(["lib/new.ts"], [summary(0, "x", { status: "renamed", oldPath: "src/old.ts", newPath: "lib/new.ts" })]);
    expect(names(flatten(tree, new Set(["lib", "src"])))).toEqual(["lib/", "  new.ts"]);
    expect(dir(tree, "lib").files[0].change?.status).toBe("renamed");
  });

  it("lists each path once", () => {
    const tree = buildTree(["a.ts", "a.ts"], [summary(0, "a.ts")]);
    expect(tree.files).toHaveLength(1);
  });
});

describe("tree helpers", () => {
  it("computes ancestors and parents", () => {
    expect(ancestorsOf("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(ancestorsOf("top.ts")).toEqual([]);
    expect(parentOf("a/b/c.ts")).toBe("a/b");
    expect(parentOf("top.ts")).toBe("");
  });

  it("prunes vanished folders and keeps existing ones", () => {
    const tree = buildTree(["a/b/c.ts", "d/e.ts"], null);
    expect([...pruneExpanded(new Set(["a", "a/b", "gone", "d/e.ts"]), tree)]).toEqual(["a", "a/b"]);
  });
});

describe("performance", () => {
  it("builds and flattens 50,000 paths quickly", () => {
    const paths: string[] = [];
    for (let i = 0; i < 50_000; i++) paths.push(`pkg${i % 50}/mod${i % 20}/sub${i % 7}/file${i}.ts`);
    const changes = paths.slice(0, 1000).map((p, i) => summary(i, p));
    const start = performance.now();
    const tree = buildTree(paths, changes);
    const all = new Set<string>();
    const walk = (d: DirNode) => d.dirs.forEach((c) => (all.add(c.path), walk(c)));
    walk(tree);
    const rows = flatten(tree, all);
    const elapsed = performance.now() - start;
    expect(rows.filter((r) => r.node.type === "file")).toHaveLength(50_000);
    expect(elapsed).toBeLessThan(200);
  });
});
