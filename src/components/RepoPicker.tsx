import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { sameRoot, useApp } from "../store";
import { ChevronDownIcon, FolderOpenIcon } from "./icons";

type Item =
  | { kind: "recent"; root: string }
  | { kind: "typed"; path: string }
  | { kind: "browse" };

const itemId = (i: number) => `repo-option-${i}`;
const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
/** Whether the search text looks like a folder path the user wants to open directly. */
const looksLikePath = (q: string) => /[\\/]/.test(q) || /^[a-z]:/i.test(q);

/**
 * The open repository's path, as a searchable dropdown of recently opened repositories
 * (Ctrl+O). Typing filters by path; a typed path can be opened directly, and
 * "Browse…" picks a folder with the system dialog.
 */
export function RepoPicker() {
  const repo = useApp((s) => s.repo);
  const recent = useApp((s) => s.recentRepos);
  const open = useApp((s) => s.repoPickerOpen);
  const setOpen = useApp((s) => s.setRepoPickerOpen);
  const openPath = useApp((s) => s.openPath);
  const pickAndOpen = useApp((s) => s.pickAndOpen);
  const removeRecent = useApp((s) => s.removeRecentRepo);
  const base = useApp((s) => s.base);

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo<Item[]>(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = recent.filter((r) => tokens.every((t) => r.toLowerCase().includes(t)));
    const out: Item[] = matches.map((root) => ({ kind: "recent", root }));
    const typed = query.trim();
    if (looksLikePath(typed) && !recent.some((r) => sameRoot(r, typed))) out.push({ kind: "typed", path: typed });
    out.push({ kind: "browse" });
    return out;
  }, [recent, query]);

  // Fresh search each time it opens; start on the previous repository for a quick switch back.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const current = repo ? recent.findIndex((r) => sameRoot(r, repo.root)) : -1;
    setIndex(current === 0 && recent.length > 1 ? 1 : 0);
  }, [open]); // only on opening

  useEffect(() => setIndex((i) => Math.min(i, items.length - 1)), [items.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, setOpen]);

  useEffect(() => {
    listRef.current?.querySelector(`#${itemId(index)}`)?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (item: Item) => {
    close(true);
    // Keep the current base, as the folder dialog does.
    const keepBase = repo ? base : undefined;
    if (item.kind === "browse") void pickAndOpen();
    else if (item.kind === "typed") void openPath(item.path, keepBase);
    else if (!repo || !sameRoot(item.root, repo.root)) void openPath(item.root, keepBase);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        setIndex((i) => (i + 1) % items.length);
        break;
      case "ArrowUp":
        setIndex((i) => (i - 1 + items.length) % items.length);
        break;
      case "Home":
        setIndex(0);
        break;
      case "End":
        setIndex(items.length - 1);
        break;
      case "Enter":
        if (items[index]) choose(items[index]);
        break;
      case "Escape":
        close(true);
        break;
      case "Tab":
        close(false);
        return;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div className="repo-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="repo-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={repo ? `${repo.root}\nSwitch repository (Ctrl+O)` : "Open a repository (Ctrl+O)"}
        onClick={() => setOpen(!open)}
      >
        {/* Long paths are cut at the start, keeping the repository's own folder visible. */}
        <span className={`repo-path${repo ? "" : " placeholder"}`}>
          <bdi>{repo ? repo.root : "Open a repository…"}</bdi>
        </span>
        <ChevronDownIcon />
      </button>

      {open && (
        <div className="repo-popover">
          <input
            className="repo-search"
            role="combobox"
            aria-label="Search repositories"
            aria-expanded="true"
            aria-controls="repo-options"
            aria-activedescendant={items[index] ? itemId(index) : undefined}
            aria-autocomplete="list"
            placeholder="Search recent repositories or type a path"
            spellCheck={false}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul className="repo-options" id="repo-options" role="listbox" aria-label="Repositories" ref={listRef}>
            {recent.length === 0 && !query && <li className="repo-empty">No recent repositories yet.</li>}
            {recent.length > 0 && items[0]?.kind !== "recent" && query && (
              <li className="repo-empty">No recent repository matches.</li>
            )}
            {items.map((item, i) => {
              const current = item.kind === "recent" && repo !== null && sameRoot(item.root, repo.root);
              let content: ReactNode;
              if (item.kind === "recent") {
                content = (
                  <>
                    <span className="repo-option-text">
                      <span className="repo-option-name">{baseName(item.root)}</span>
                      <span className="repo-option-path">{item.root}</span>
                    </span>
                    {current ? (
                      <span className="repo-current">current</span>
                    ) : (
                      <button
                        type="button"
                        className="repo-remove"
                        tabIndex={-1}
                        aria-label={`Remove ${item.root} from recent repositories`}
                        title="Remove from list"
                        onMouseDown={(e) => e.preventDefault() /* keep focus in the search box */}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecent(item.root);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </>
                );
              } else if (item.kind === "typed") {
                content = (
                  <span className="repo-option-text">
                    <span className="repo-option-name">Open this folder</span>
                    <span className="repo-option-path">{item.path}</span>
                  </span>
                );
              } else {
                content = (
                  <>
                    <FolderOpenIcon />
                    <span className="repo-option-name">Browse for a folder…</span>
                  </>
                );
              }
              return (
                <li
                  key={item.kind === "recent" ? item.root : item.kind}
                  id={itemId(i)}
                  role="option"
                  aria-selected={i === index}
                  aria-current={current || undefined}
                  className={`repo-option repo-option-${item.kind}${i === index ? " active" : ""}`}
                  onMouseDown={(e) => e.preventDefault() /* keep focus in the search box */}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={() => choose(item)}
                >
                  {content}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
