// Small unified plugins for the rendered Markdown view. The tree types are kept
// structural so this module needs only what react-markdown already provides.

interface Node {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

/** Text content of a hast node. */
function textOf(node: Node): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** GitHub-style heading slug: lower-case, punctuation removed, spaces to dashes. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** Slugs that stay unique within one document: repeats get `-1`, `-2`, … */
export function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slug(text);
    let id = base;
    let n = seen.get(base) ?? 0;
    while (seen.has(id)) id = `${base}-${++n}`;
    seen.set(base, n);
    seen.set(id, 0);
    return id;
  };
}

/**
 * rehype plugin: give each heading a `data-anchor` with its GitHub-style slug, so
 * `#anchor` links can find it. A data attribute (not `id`) cannot clash with the
 * app's own element ids or with another open document.
 */
export function rehypeHeadingAnchors() {
  return (tree: Node) => {
    const next = slugger();
    const walk = (node: Node) => {
      if (node.type === "element" && /^h[1-6]$/.test(node.tagName ?? "")) {
        node.properties = { ...node.properties, dataAnchor: next(textOf(node)) };
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
