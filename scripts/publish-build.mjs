#!/usr/bin/env node
// Copy the release build of Differential into ~/bin so it can be run from anywhere.
//
// Usage: node scripts/publish-build.mjs [--build] [--dest <dir>]
//   --build        run `npx tauri build` first
//   --dest <dir>   install somewhere other than ~/bin
//
// The binary is written to a temporary file next to the destination and then
// renamed into place, so replacing a copy that is currently running works on
// Linux and macOS.

import { execSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "differential.exe" : "differential";
const source = join(root, "src-tauri", "target", "release", exe);

const args = process.argv.slice(2);
let build = false;
let destDir = join(homedir(), "bin");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--build") {
    build = true;
  } else if (args[i] === "--dest" && args[i + 1]) {
    destDir = resolve(args[++i]);
  } else if (args[i].startsWith("--dest=")) {
    destDir = resolve(args[i].slice("--dest=".length));
  } else {
    console.error(`Unknown argument: ${args[i]}`);
    console.error("Usage: node scripts/publish-build.mjs [--build] [--dest <dir>]");
    process.exit(2);
  }
}

if (build) {
  execSync("npx tauri build", { cwd: root, stdio: "inherit" });
}

if (!existsSync(source)) {
  console.error(`No release build found at ${source}`);
  console.error("Run `npx tauri build` first, or pass --build.");
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
const dest = join(destDir, exe);
const tmp = `${dest}.tmp-${process.pid}`;

try {
  copyFileSync(source, tmp);
  chmodSync(tmp, 0o755);
  renameSync(tmp, dest);
} catch (err) {
  rmSync(tmp, { force: true });
  if (process.platform === "win32" && (err.code === "EPERM" || err.code === "EBUSY")) {
    console.error(`Could not replace ${dest}: close any running Differential windows and try again.`);
  } else {
    console.error(`Could not install to ${dest}: ${err.message}`);
  }
  process.exit(1);
}

const built = statSync(source).mtime.toLocaleString();
console.log(`Installed ${dest} (built ${built})`);

const onPath = (process.env.PATH ?? "")
  .split(process.platform === "win32" ? ";" : ":")
  .some((p) => p && resolve(p) === destDir);
if (!onPath) {
  console.log(`Note: ${destDir} is not on your PATH.`);
}
