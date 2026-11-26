// Where a link in rendered Markdown leads. Pure, so every case is tested without React.

export type LinkTarget =
  /** An in-page anchor (`#usage`): scroll to the heading or element with this id. */
  | { kind: "anchor"; id: string }
  /** A web or mail link, opened in the operating system's default handler. */
  | { kind: "external"; url: string }
  /** A repository-relative file path, opened like a file picked in the project tree. */
  | { kind: "file"; path: string }
  /** Anything else (other schemes, paths outside the repository): does nothing. */
  | { kind: "none" };

const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto"]);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Resolve link `href` found in the Markdown file at repository-relative `fromPath`. */
export function linkTarget(href: string | null | undefined, fromPath: string): LinkTarget {
  const raw = (href ?? "").trim();
  if (raw === "") return { kind: "none" };
  if (raw.startsWith("#")) return { kind: "anchor", id: decode(raw.slice(1)) };

  const scheme = SCHEME.exec(raw)?.[1].toLowerCase();
  if (scheme !== undefined) return EXTERNAL_SCHEMES.has(scheme) ? { kind: "external", url: raw } : { kind: "none" };
  // Protocol-relative (`//host/x`) and Windows-style (`\\server`) links have no meaning here.
  if (raw.startsWith("//") || raw.startsWith("\\")) return { kind: "none" };

  const pathPart = decode(raw.replace(/[?#].*$/, ""));
  if (pathPart === "") return { kind: "none" };
  // A leading `/` is relative to the repository root, as on GitHub.
  const base = pathPart.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  const parts = [...base];
  for (const seg of pathPart.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return { kind: "none" };
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length === 0 ? { kind: "none" } : { kind: "file", path: parts.join("/") };
}
