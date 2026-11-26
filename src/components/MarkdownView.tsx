import { openUrl } from "@tauri-apps/plugin-opener";
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { SearchUnit } from "../find/match";
import { useFind, useSearching } from "../find/useFind";
import { highlighter } from "../highlight/client";
import { languageForFence } from "../highlight/languages";
import { segments, type LineTokens } from "../highlight/tokens";
import { blockRange, textUnits, type TextBlock } from "../markdown/find";
import { linkTarget } from "../markdown/links";
import { rehypeHeadingAnchors } from "../markdown/plugins";
import { useApp } from "../store";
import { TokenSpans } from "./TokenSpans";

/**
 * An unchanged Markdown file, rendered. HTML is sanitized with GitHub's allowlist, only local
 * images are loaded (through the backend, as `blob:` URLs), and links never navigate the window: they scroll, open a repository file, or open in
 * the system's default handler (see `onLink`).
 */
export default function MarkdownView({ path, content, active = true }: { path: string; content: string; active?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const openTreePath = useApp((s) => s.openTreePath);
  const pinTab = useApp((s) => s.pinTab);

  const onLink = useCallback(
    (href: string) => {
      const target = linkTarget(href, path);
      switch (target.kind) {
        case "anchor":
          if (bodyRef.current) scrollToAnchor(bodyRef.current, scrollRef.current, target.id);
          break;
        case "external":
          void openUrl(target.url).catch(() => {});
          break;
        case "file":
          // Keep this document open while following its link.
          pinTab(path);
          openTreePath(target.path);
          break;
      }
    },
    [path, openTreePath, pinTab],
  );
  const ctx = useMemo(() => ({ path, onLink }), [path, onLink]);

  // Find: the rendered text as search units, rebuilt whenever the DOM changes (new
  // contents, or code blocks gaining highlighting).
  const searching = useSearching(active);
  const [found, setFound] = useState<{ units: SearchUnit[]; blocks: TextBlock[] } | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!searching || !body) {
      setFound(null);
      return;
    }
    const rebuild = () => setFound(textUnits(body));
    rebuild();
    const observer = new MutationObserver(rebuild);
    observer.observe(body, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [searching]);

  const blocksRef = useRef<TextBlock[]>([]);
  blocksRef.current = found?.blocks ?? [];
  const find = useFind(active, found?.units ?? null, {
    topUnit: () => {
      const top = scrollRef.current?.getBoundingClientRect().top ?? 0;
      const i = blocksRef.current.findIndex((b) => (b.nodes[0].parentElement?.getBoundingClientRect().bottom ?? 0) >= top);
      return Math.max(0, i);
    },
    reveal: (unit, match) => {
      const block = blocksRef.current[unitIndex(unit)];
      const range = block && blockRange(block, match.start, match.end);
      if (range && scrollRef.current) revealRange(scrollRef.current, range);
    },
  });

  // Paint matches with the CSS Custom Highlight API. Where it is missing, find still
  // counts and scrolls to matches, only without painting them.
  useEffect(() => {
    const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
    if (!registry || typeof Highlight === "undefined" || !found) return;
    const all: Range[] = [];
    const current: Range[] = [];
    found.units.forEach((u, i) => {
      for (const r of find.ranges.get(u.key) ?? []) {
        const range = blockRange(found.blocks[i], r.start, r.end);
        if (range) all.push(range);
      }
      if (find.current?.key === u.key) {
        const range = blockRange(found.blocks[i], find.current.range.start, find.current.range.end);
        if (range) current.push(range);
      }
    });
    registry.set("md-find", new Highlight(...all));
    registry.set("md-find-current", new Highlight(...current));
    return () => {
      registry.delete("md-find");
      registry.delete("md-find-current");
    };
  }, [find, found]);

  return (
    <div
      className="markdown-view"
      ref={scrollRef}
      data-testid="markdown-view-scroll"
      tabIndex={-1}
      // Belt and braces: nothing in the document may navigate the app window.
      onClickCapture={(e) => {
        if ((e.target as Element).closest?.("a")) e.preventDefault();
      }}
      onAuxClick={(e) => e.preventDefault()}
    >
      <article className="markdown-body" ref={bodyRef} data-testid="markdown-body">
        <LinkContext.Provider value={ctx}>
          <MarkdownContent content={content} />
        </LinkContext.Provider>
      </article>
    </div>
  );
}

/** Index of a unit built by `textUnits` (its key is `md:<index>`). */
const unitIndex = (unit: SearchUnit) => Number(unit.key.slice(3));

const LinkContext = createContext<{ path: string; onLink: (href: string) => void }>({ path: "", onLink: () => {} });

const remarkPlugins = [remarkGfm];
// HTML in the document is parsed, then cut down to GitHub's README allowlist (the default
// schema): no scripts, styles, iframes, forms, event handlers or unsafe URL schemes.
// Anchors are added last so the sanitizer cannot strip them.
const rehypePlugins = [rehypeRaw, rehypeSanitize, rehypeHeadingAnchors];
// Links and images are handled by the components below, which never let the webview
// follow or fetch a URL, so URLs pass through unchanged for them to classify.
const keepUrl = (url: string) => url;

/** The rendered document; re-renders only when the text changes, not on find updates. */
const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} urlTransform={keepUrl} components={components}>
      {content}
    </Markdown>
  );
});

type Props<T extends keyof React.JSX.IntrinsicElements> = React.JSX.IntrinsicElements[T] & ExtraProps;

function Link({ href, title, children }: Props<"a">) {
  const { path, onLink } = useContext(LinkContext);
  const target = linkTarget(href, path);
  return (
    <a
      // Only targets the app can handle keep an href (so they look and focus like links).
      href={target.kind === "none" ? undefined : href}
      title={title ? `${title}\n${href ?? ""}` : href}
      onClick={(e) => {
        e.preventDefault();
        if (href) onLink(href);
      }}
    >
      {children}
    </a>
  );
}

/** MIME type by extension of the image formats the backend serves (`files::IMAGE_EXTENSIONS`). */
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
};
const imageType = (path: string): string | undefined => IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];

/**
 * An image: a relative path to a supported image in the repository is read through the
 * backend and shown from a `blob:` URL. Anything else (remote, `data:`, missing, too large)
 * stays a placeholder with the alt text, so the webview never fetches a URL from the document.
 */
function Image({ src, alt, width, height }: Props<"img">) {
  const { path: docPath } = useContext(LinkContext);
  const readImage = useApp((s) => s.readImage);
  // Read the image again whenever repository changes are picked up or the user refreshes.
  const changesSeq = useApp((s) => s.changesSeq);
  const raw = typeof src === "string" ? src : undefined;
  const target = linkTarget(raw, docPath);
  const file = target.kind === "file" && imageType(target.path) ? target.path : null;

  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const show = (next: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next;
    setUrl(next);
  };
  useEffect(() => {
    if (!file) {
      show(null);
      return;
    }
    let live = true;
    // The previous image stays on screen until the new bytes arrive.
    readImage(file).then(
      (bytes) => live && show(URL.createObjectURL(new Blob([bytes], { type: imageType(file) }))),
      () => live && show(null),
    );
    return () => {
      live = false;
    };
  }, [file, readImage, changesSeq]);
  useEffect(() => () => show(null), []);

  if (!url) {
    return (
      <span className="md-image" title={raw} data-testid="md-image">
        {alt || "image"}
      </span>
    );
  }
  return <img className="md-img" src={url} alt={alt ?? ""} title={raw} width={width} height={height} data-testid="md-img" />;
}

function Checkbox(props: Props<"input">) {
  if (props.type !== "checkbox") return null;
  return <input type="checkbox" checked={!!props.checked} disabled readOnly onClick={(e) => e.preventDefault()} />;
}

function Table({ node: _node, ...props }: Props<"table">) {
  return (
    <div className="md-table-wrap">
      <table {...props} />
    </div>
  );
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

const hastText = (n: HastNode): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(hastText).join(""));

/** A code block: fenced code is highlighted by the fence's language when it is known. */
function Pre({ node }: Props<"pre">) {
  const code = (node as HastNode | undefined)?.children?.find((c) => c.type === "element" && c.tagName === "code");
  const classes = code?.properties?.className;
  const fence = (Array.isArray(classes) ? classes : [])
    .map(String)
    .find((c) => c.startsWith("language-"))
    ?.slice("language-".length);
  const text = code ? hastText(code) : "";
  return <CodeBlock lang={languageForFence(fence)} text={text.endsWith("\n") ? text.slice(0, -1) : text} />;
}

function CodeBlock({ lang, text }: { lang: string | null; text: string }) {
  const { path } = useContext(LinkContext);
  const [tokens, setTokens] = useState<LineTokens[] | null>(null);
  useEffect(() => {
    let live = true;
    setTokens(null);
    void highlighter.highlightLang(`md:${path}`, lang, text).then((t) => live && setTokens(t));
    return () => {
      live = false;
    };
  }, [path, lang, text]);
  const lines = text.split("\n");
  return (
    <pre className="md-code" data-lang={lang ?? undefined}>
      <code>
        {tokens
          ? lines.map((line, i) => (
              <span key={i}>
                <TokenSpans segments={segments(line, tokens[i], null)} />
                {i < lines.length - 1 ? "\n" : null}
              </span>
            ))
          : text}
      </code>
    </pre>
  );
}

const components: Components = {
  a: Link,
  img: Image,
  input: Checkbox,
  table: Table,
  pre: Pre,
};

/** Scroll the heading (or other element) with anchor `id` to the top of the view. */
function scrollToAnchor(body: HTMLElement, scroller: HTMLElement | null, id: string) {
  const el = [...body.querySelectorAll<HTMLElement>("[data-anchor], [id]")].find(
    // The sanitizer prefixes ids with `user-content-` (as GitHub does); links may use either form.
    (e) => e.dataset.anchor === id || e.id === id || e.id === `user-content-${id}`,
  );
  if (!el || !scroller) return;
  const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = Math.max(0, top - 8);
}

/** Bring `range` into view: vertically in the document, horizontally in a wide code block or table. */
function revealRange(scroller: HTMLElement, range: Range) {
  const rect = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const margin = 24;
  if (rect.top < box.top + margin || rect.bottom > box.bottom - margin) {
    scroller.scrollTop += rect.top - box.top - box.height / 3;
  }
  const wide = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>(".md-code, .md-table-wrap");
  if (wide) {
    const w = wide.getBoundingClientRect();
    if (rect.left < w.left + margin || rect.right > w.right - margin) {
      wide.scrollLeft += rect.left - w.left - w.width / 3;
    }
  }
}
