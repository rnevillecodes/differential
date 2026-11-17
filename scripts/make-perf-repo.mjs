#!/usr/bin/env node
// Generate a throwaway git repository for manual performance checks:
//   - big.ts: a single file whose diff against HEAD is 50,000 changed lines
//   - files/fNNNN.ts: 1,000 small files, each modified against HEAD
//
// Usage: node scripts/make-perf-repo.mjs [target-dir]   (default: ./perf-repo)
// Then:  npm run tauri dev -- -- <target-dir>

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BIG_LINES = 25_000; // every line rewritten: 25,000 removed + 25,000 added
const FILE_COUNT = 1_000;

const target = resolve(process.argv[2] ?? "perf-repo");
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
git("add", "-A");
git("commit", "-q", "-m", "base");

writeFileSync(join(target, "big.ts"), bigFile("work"));
for (let n = 0; n < FILE_COUNT; n++) writeFileSync(name(n), smallFile(n, "work"));

console.log(`perf repo ready: ${target}`);
console.log(`  big.ts: ${BIG_LINES * 2} changed lines; files/: ${FILE_COUNT} modified files`);
