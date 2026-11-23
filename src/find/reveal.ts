// Scrolling a find match into view, vertically by row and horizontally by column.

/** Display columns of `text`, counting a tab as 4 (as the views' content width does). */
export function columnsOf(text: string): number {
  let tabs = 0;
  for (let i = text.indexOf("\t"); i !== -1; i = text.indexOf("\t", i + 1)) tabs++;
  return text.length + 3 * tabs;
}

/** Fallback character width when layout is unavailable (12px monospace is about 7.2px). */
export const FALLBACK_CHAR_WIDTH = 7.2;
const charWidths = new WeakMap<HTMLElement, number>();

/** Width of one monospace character in `scrollEl`, measured once with a `1ch` probe. */
export function charWidth(scrollEl: HTMLElement): number {
  const cached = charWidths.get(scrollEl);
  if (cached) return cached;
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;width:1ch;height:0;";
  scrollEl.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  if (w > 0) {
    charWidths.set(scrollEl, w);
    return w;
  }
  return FALLBACK_CHAR_WIDTH;
}

/** Scroll `scrollEl` vertically so row `index` is visible, centring it if it was off-screen. */
export function revealRow(scrollEl: HTMLElement, index: number, rowHeight: number) {
  const top = index * rowHeight;
  const view = scrollEl.clientHeight;
  if (top >= scrollEl.scrollTop && top + rowHeight <= scrollEl.scrollTop + view) return;
  scrollEl.scrollTop = Math.max(0, top - view / 2 + rowHeight / 2);
}

/**
 * Scroll `scroller` horizontally so columns `[start, end)` of `text` are visible in a code
 * area `visibleWidth` pixels wide, placing the match about a third of the way in.
 */
export function revealColumns(
  scroller: HTMLElement,
  charW: number,
  text: string,
  start: number,
  end: number,
  visibleWidth: number,
) {
  const x0 = columnsOf(text.slice(0, start)) * charW;
  const x1 = columnsOf(text.slice(0, end)) * charW;
  const left = scroller.scrollLeft;
  if (x0 >= left && x1 <= left + visibleWidth) return;
  scroller.scrollLeft = Math.max(0, x0 - visibleWidth / 3);
}

/** Width of the sticky gutter (line numbers) in `scrollEl`'s rows, or `fallback` without layout. */
export function gutterWidth(scrollEl: HTMLElement, selector: string, fallback: number): number {
  const w = scrollEl.querySelector(selector)?.getBoundingClientRect().width ?? 0;
  return w > 0 ? w : fallback;
}
