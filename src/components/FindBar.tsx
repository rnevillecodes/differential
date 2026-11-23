import { useEffect, useRef } from "react";
import { useApp } from "../store";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "./icons";

/** Focus the active tab's view (its scroll container), e.g. after closing the find bar. */
export function focusActiveView() {
  document.querySelector<HTMLElement>(".tab-panel:not(.inactive) .diff-scroll")?.focus();
}

/** The Ctrl+F find bar, floating at the top-right of the active tab's view. */
export function FindBar() {
  const query = useApp((s) => s.findQuery);
  const matchCase = useApp((s) => s.findMatchCase);
  const status = useApp((s) => s.findStatus);
  const focusSeq = useApp((s) => s.findFocusSeq);
  const setFindQuery = useApp((s) => s.setFindQuery);
  const toggleFindMatchCase = useApp((s) => s.toggleFindMatchCase);
  const findNext = useApp((s) => s.findNext);
  const findPrev = useApp((s) => s.findPrev);
  const closeFind = useApp((s) => s.closeFind);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSeq]);

  const close = () => {
    closeFind();
    focusActiveView();
  };

  let count = "";
  if (query !== "") count = status && status.total > 0 ? `${Math.max(status.current, 1)} of ${status.total}` : "No results";

  return (
    <div className="find-bar" role="search" aria-label="Find in file">
      <input
        ref={inputRef}
        type="text"
        aria-label="Find"
        placeholder="Find"
        spellCheck={false}
        value={query}
        onChange={(e) => setFindQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) findPrev();
            else findNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      <span className={`find-count${count === "No results" ? " none" : ""}`} aria-live="polite" data-testid="find-count">
        {count}
      </span>
      <button
        type="button"
        className={`find-toggle${matchCase ? " on" : ""}`}
        aria-label="Match case"
        aria-pressed={matchCase}
        title="Match case"
        onClick={toggleFindMatchCase}
      >
        Aa
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Previous match"
        title="Previous match (Shift+Enter, Shift+F3)"
        disabled={!status || status.total === 0}
        onClick={findPrev}
      >
        <ChevronUpIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Next match"
        title="Next match (Enter, F3)"
        disabled={!status || status.total === 0}
        onClick={findNext}
      >
        <ChevronDownIcon />
      </button>
      <button type="button" className="icon-button" aria-label="Close find" title="Close (Escape)" onClick={close}>
        <CloseIcon />
      </button>
    </div>
  );
}
