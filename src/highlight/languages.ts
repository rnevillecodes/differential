// Map a file path to a Shiki language id (or null for plain text).

const BY_EXTENSION: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", jsonc: "jsonc", json5: "json5",
  md: "markdown", mdx: "mdx",
  css: "css", scss: "scss", sass: "sass", less: "less",
  html: "html", htm: "html", vue: "vue", svelte: "svelte", astro: "astro",
  xml: "xml", svg: "xml", xaml: "xml", csproj: "xml",
  rs: "rust", go: "go", py: "python", pyi: "python", rb: "ruby", php: "php",
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", swift: "swift", dart: "dart",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp", fs: "fsharp", vb: "vb",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript",
  ps1: "powershell", psm1: "powershell", bat: "bat", cmd: "bat",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "proto",
  lua: "lua", r: "r", ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell",
  clj: "clojure", zig: "zig", nim: "nim", tf: "terraform", hcl: "hcl",
  diff: "diff", patch: "diff",
};

const BY_FILENAME: Record<string, string> = {
  dockerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  cmakelists: "cmake",
  "cmakelists.txt": "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
  justfile: "just",
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
  ".gitignore": "ini",
  ".env": "dotenv",
};

export function languageFor(path: string): string | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (BY_FILENAME[name]) return BY_FILENAME[name];
  if (name.startsWith("dockerfile")) return "docker";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 && !name.startsWith(".")) return null;
  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

/** Whether `path` is a Markdown file shown rendered: `.md` or `.markdown`, ignoring case (not `.mdx`). */
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** Every language id the extension and file-name maps produce. */
const KNOWN_IDS = new Set([...Object.values(BY_EXTENSION), ...Object.values(BY_FILENAME)]);

/** Common fence names that are neither a language id nor an extension above. */
const FENCE_ALIASES: Record<string, string> = {
  shell: "shellscript", console: "shellscript", "c++": "cpp", "c#": "csharp", "f#": "fsharp",
  golang: "go", dockerfile: "docker", makefile: "make", jsonl: "json", text: "", txt: "", plaintext: "",
};

/**
 * The Shiki language for a fenced code block's info string (`ts`, `typescript`, `py {title=x}`),
 * or null for an empty or unknown one.
 */
export function languageForFence(info: string | null | undefined): string | null {
  const word = (info ?? "").trim().split(/[\s{]/)[0].toLowerCase();
  if (!word) return null;
  if (word in FENCE_ALIASES) return FENCE_ALIASES[word] || null;
  if (KNOWN_IDS.has(word)) return word;
  return BY_EXTENSION[word] ?? null;
}
