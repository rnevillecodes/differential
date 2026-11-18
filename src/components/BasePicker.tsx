import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { RefInfo } from "../model/RefInfo";
import type { RefKind } from "../model/RefKind";
import { useApp } from "../store";
import { CheckIcon, ChevronDownIcon } from "./icons";

/** Rows rendered at most; the rest are reachable by typing more. */
export const MAX_REF_ROWS = 200;

type Item = { kind: "ref"; ref: RefInfo } | { kind: "typed"; text: string };

const GROUPS: { kind: RefKind; label: string }[] = [
  { kind: "local", label: "Local branches" },
  { kind: "remote", label: "Remote branches" },
  { kind: "tag", label: "Tags" },
];

const optionId = (i: number) => `base-option-${i}`;
const isBase = (ref: RefInfo, base: string) => ref.rev === base || ref.name === base;

/**
 * The diff base as a searchable dropdown of the repository's branches and tags.
 * Any typed revision (a SHA, `HEAD~3`, …) can still be applied with "Use …".
 */
export function BasePicker() {
  const repo = useApp((s) => s.repo);
  const base = useApp((s) => s.base);
  const baseError = useApp((s) => s.baseError);
  const refs = useApp((s) => s.refs);
  const refsError = useApp((s) => s.refsError);
  const setBase = useApp((s) => s.setBase);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Matching refs in group order (most recent first within a group), then the typed revision.
  const { items, hidden } = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (refs ?? []).filter((r) => tokens.every((t) => r.name.toLowerCase().includes(t)));
    const ordered = GROUPS.flatMap((g) => matches.filter((r) => r.kind === g.kind));
    const shown = ordered.slice(0, MAX_REF_ROWS);
    const out: Item[] = shown.map((ref) => ({ kind: "ref", ref }));
    const typed = query.trim();
    if (typed && !(refs ?? []).some((r) => r.name === typed || r.rev === typed)) out.push({ kind: "typed", text: typed });
    return { items: out, hidden: ordered.length - shown.length };
  }, [refs, query]);

  // Each opening starts a fresh search, highlighting the current base when it is listed.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const current = GROUPS.flatMap((g) => (refs ?? []).filter((r) => r.kind === g.kind))
      .slice(0, MAX_REF_ROWS)
      .findIndex((r) => isBase(r, base));
    setIndex(Math.max(0, current));
  }, [open]); // only on opening

  useEffect(() => setIndex((i) => Math.max(0, Math.min(i, items.length - 1))), [items.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`#${optionId(index)}`)?.scrollIntoView?.({ block: "nearest" });
  }, [index, open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (item: Item) => {
    close(true);
    void setBase(item.kind === "ref" ? item.ref.rev : item.text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = items.length;
    switch (e.key) {
      case "ArrowDown":
        if (n) setIndex((i) => (i + 1) % n);
        break;
      case "ArrowUp":
        if (n) setIndex((i) => (i - 1 + n) % n);
        break;
      case "Home":
        setIndex(0);
        break;
      case "End":
        setIndex(Math.max(0, n - 1));
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

  const moreNote =
    hidden > 0 ? (
      <li key="more" role="presentation" className="ref-note">
        {hidden} more — keep typing to narrow
      </li>
    ) : null;

  // Ref rows (with a heading before each kind), then the "N more" note, then the typed option.
  const rows: ReactNode[] = [];
  let lastKind: RefKind | null = null;
  items.forEach((item, i) => {
    if (item.kind === "ref" && item.ref.kind !== lastKind) {
      lastKind = item.ref.kind;
      const label = GROUPS.find((g) => g.kind === lastKind)!.label;
      rows.push(
        <li key={`group-${lastKind}`} role="presentation" className="ref-group">
          {label}
        </li>,
      );
    }
    if (item.kind === "typed") rows.push(moreNote);
    const selected = item.kind === "ref" && isBase(item.ref, base);
    rows.push(
      <li
        key={item.kind === "ref" ? `${item.ref.kind}:${item.ref.name}` : "typed"}
        id={optionId(i)}
        role="option"
        aria-selected={i === index}
        aria-current={selected || undefined}
        className={`ref-option ref-option-${item.kind}${i === index ? " active" : ""}`}
        onMouseDown={(e) => e.preventDefault() /* keep focus in the search box */}
        onMouseMove={() => i !== index && setIndex(i)}
        onClick={() => choose(item)}
      >
        <span className="ref-check">{selected && <CheckIcon />}</span>
        {item.kind === "ref" ? (
          <>
            <span className="ref-name">{item.ref.name}</span>
            {item.ref.current && <span className="ref-current">current</span>}
          </>
        ) : (
          <span className="ref-name">
            Use <code>{item.text}</code>
          </span>
        )}
      </li>,
    );
  });
  if (!items.some((it) => it.kind === "typed")) rows.push(moreNote);

  let status: string | null = null;
  if (refsError) status = `Couldn't list branches: ${refsError.message}`;
  else if (refs === null) status = "Loading branches…";
  else if (refs.length === 0 && !query) status = "No branches or tags yet. Type a revision.";
  else if (items.length === 0) status = "No branch or tag matches.";

  return (
    <div className="base-picker" ref={rootRef}>
      <span className="base-label" id="base-label">
        Base
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="base-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="base-label base-value"
        aria-invalid={baseError ? true : undefined}
        disabled={!repo}
        title="Compare the working tree against a branch, tag, or any revision"
        onClick={() => setOpen(!open)}
      >
        <span className="base-value" id="base-value">
          {base}
        </span>
        <ChevronDownIcon />
      </button>
      {baseError && (
        <span className="base-error" role="alert" title={baseError}>
          {baseError}
        </span>
      )}

      {open && (
        <div className="base-popover">
          <input
            className="base-search"
            role="combobox"
            aria-label="Search branches and tags"
            aria-expanded="true"
            aria-controls="base-options"
            aria-activedescendant={items[index] ? optionId(index) : undefined}
            aria-autocomplete="list"
            placeholder="Search branches and tags, or type a revision"
            spellCheck={false}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul className="ref-options" id="base-options" role="listbox" aria-label="Branches and tags" ref={listRef}>
            {status && (
              <li role="presentation" className={`ref-note${refsError ? " error" : ""}`}>
                {status}
              </li>
            )}
            {rows}
          </ul>
        </div>
      )}
    </div>
  );
}
