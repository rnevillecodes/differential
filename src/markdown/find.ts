// Find in the rendered Markdown view: its visible text as search units (one per block,
// so a match can cross inline formatting like `**bold** text`), and DOM ranges for matches.

import type { SearchUnit } from "../find/match";

/** Elements whose text is one search unit. The nearest one around a text node wins. */
const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,td,th,pre,dt,dd,blockquote,summary,figcaption";

/** A block's text nodes with each one's start offset in the block's text. */
export interface TextBlock {
  nodes: Text[];
  starts: number[];
}

/** Search units over the text inside `root`, and the text nodes behind each unit. */
export function textUnits(root: HTMLElement): { units: SearchUnit[]; blocks: TextBlock[] } {
  const units: SearchUnit[] = [];
  const blocks: TextBlock[] = [];
  let currentBlock: Element | null = null;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (n.data === "") continue;
    const block = n.parentElement?.closest(BLOCKS) ?? root;
    if (block !== currentBlock || units.length === 0) {
      currentBlock = block;
      units.push({ key: `md:${units.length}`, kind: "context", oldNo: units.length + 1, newNo: null, text: "" });
      blocks.push({ nodes: [], starts: [] });
    }
    const unit = units[units.length - 1];
    const tb = blocks[blocks.length - 1];
    tb.nodes.push(n);
    tb.starts.push(unit.text.length);
    unit.text += n.data;
  }
  return { units, blocks };
}

/** The DOM range covering `[start, end)` of a block's text. */
export function blockRange(block: TextBlock, start: number, end: number): Range | null {
  const at = (offset: number, preferNext: boolean): [Text, number] | null => {
    for (let i = block.nodes.length - 1; i >= 0; i--) {
      const s = block.starts[i];
      const len = block.nodes[i].data.length;
      // A boundary between two nodes belongs to the next node for a start, the previous for an end.
      if (offset > s || (offset === s && (preferNext || i === 0))) {
        if (offset <= s + len) return [block.nodes[i], offset - s];
      }
    }
    return null;
  };
  const a = at(start, true);
  const b = at(end, false);
  if (!a || !b) return null;
  const range = a[0].ownerDocument.createRange();
  range.setStart(a[0], a[1]);
  range.setEnd(b[0], b[1]);
  return range;
}
