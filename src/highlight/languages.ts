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
