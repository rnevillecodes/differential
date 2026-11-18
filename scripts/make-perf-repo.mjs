#!/usr/bin/env node
// Generate a throwaway git repository for manual performance checks:
//   - big.ts: a single file whose diff against HEAD is 50,000 changed lines
//   - files/fNNNN.ts: 1,000 small files, each modified against HEAD
//   - with --files N: N unchanged files spread over nested folders under tree/
//     (for checking the project tree; 50,000 if N is omitted)
//
// Usage: node scripts/make-perf-repo.mjs [target-dir] [--files [N]]   (default dir: ./perf-repo)
// Then:  npm run tauri dev -- -- <target-dir>

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BIG_LINES = 25_000; // every line rewritten: 25,000 removed + 25,000 added
const FILE_COUNT = 1_000;

const args = process.argv.slice(2);
let treeFiles = 0;
let targetArg;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--files") {
    const n = Number(args[i + 1]);
    if (Number.isInteger(n) && n > 0) {
      treeFiles = n;
      i++;
    } else {
      treeFiles = 50_000;
    }
  } else if (args[i].startsWith("--files=")) {
    treeFiles = Number(args[i].slice("--files=".length));
    if (!Number.isInteger(treeFiles) || treeFiles <= 0) {
      console.error(`invalid --files value: ${args[i]}`);
      process.exit(1);
    }
  } else {
    targetArg = args[i];
  }
}

const target = resolve(targetArg ?? "perf-repo");
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`refusing to write into non-empty directory: ${target}`);
  process.exit(1);
}
mkdirSync(join(target, "files"), { recursive: true });

const git = (...args) =>
  execFileSync(
    "git",
    ["-c", "user.name=perf", "-c", "user.email=perf@example.invalid", ...args],
    { cwd: target, stdio: ["ignore", "ignore", "inherit"] },
  );

const bigFile = (version) =>
  Array.from(
    { length: BIG_LINES },
    (_, i) => `export const value${i} = computeSomething(${i}, "${version}-${(i * 7919) % 10007}"); // line ${i + 1}`,
  ).join("\n") + "\n";

const smallFile = (n, version) =>
  [
    `// file ${n}`,
    `export function handler${n}(input: string): string {`,
    `  const prefix = "${version}";`,
    `  return prefix + input.trim();`,
    `}`,
    ...Array.from({ length: 30 }, (_, i) => `export const c${i} = ${i};`),
    "",
  ].join("\n");

const name = (n) => join(target, "files", `f${String(n).padStart(4, "0")}.ts`);

git("init", "-q");
// Keep the generated LF content as-is regardless of the user's global autocrlf.
git("config", "core.autocrlf", "false");
writeFileSync(join(target, "big.ts"), bigFile("base"));
for (let n = 0; n < FILE_COUNT; n++) writeFileSync(name(n), smallFile(n, "base"));
// Unchanged files for the project tree: tree/pkgNN/modNN/fileNNNNN.ts (100 per folder).
for (let n = 0; n < treeFiles; n++) {
  const dir = join(target, "tree", `pkg${String(Math.floor(n / 2000)).padStart(2, "0")}`, `mod${String(Math.floor(n / 100) % 20).padStart(2, "0")}`);
  if (n % 100 === 0) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `file${String(n).padStart(5, "0")}.ts`), `export const id${n} = ${n};\n`);
}
git("add", "-A");
git("commit", "-q", "-m", "base");

writeFileSync(join(target, "big.ts"), bigFile("work"));
for (let n = 0; n < FILE_COUNT; n++) writeFileSync(name(n), smallFile(n, "work"));

console.log(`perf repo ready: ${target}`);
console.log(`  big.ts: ${BIG_LINES * 2} changed lines; files/: ${FILE_COUNT} modified files`);
if (treeFiles > 0) console.log(`  tree/: ${treeFiles} unchanged files`);
