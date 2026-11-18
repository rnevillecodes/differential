// UI-side client for the highlight worker: language detection, size cutoff, caching
// and de-duplication of in-flight requests.

import { languageFor } from "./languages";
import { hashString, type LineTokens } from "./tokens";
import type { HighlightRequest, HighlightResponse } from "./worker";

/** Sides longer than this render without syntax highlighting. */
export const MAX_HIGHLIGHT_LINES = 20_000;

export interface WorkerLike {
  postMessage(msg: HighlightRequest): void;
  onmessage: ((e: MessageEvent<HighlightResponse>) => void) | null;
}

export class HighlightClient {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private pending = new Map<number, (tokens: LineTokens[] | null) => void>();
  private cache = new Map<string, Promise<LineTokens[] | null>>();

  constructor(private createWorker: () => WorkerLike) {}

  /**
   * Tokens per line for `content`, or `null` when it is not highlighted (unknown
   * language, too long, or the highlighter failed). `version` distinguishes sides,
   * e.g. the base SHA or "worktree".
   */
  highlight(version: string, path: string, content: string): Promise<LineTokens[] | null> {
    const lang = languageFor(path);
    if (!lang || countLines(content) > MAX_HIGHLIGHT_LINES) return Promise.resolve(null);
    const key = `${version}|${path}|${hashString(content)}`;
    let result = this.cache.get(key);
    if (!result) {
      result = this.request(content, lang);
      this.cache.set(key, result);
    }
    return result;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  private request(code: string, lang: string): Promise<LineTokens[] | null> {
    if (!this.worker) {
      this.worker = this.createWorker();
      this.worker.onmessage = (e) => {
        const res = e.data;
        const done = this.pending.get(res.id);
        this.pending.delete(res.id);
        done?.("tokens" in res ? res.tokens : null);
      };
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker!.postMessage({ id, code, lang });
    });
  }
}

function countLines(s: string): number {
  let n = 1;
  for (let i = s.indexOf("\n"); i !== -1; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

export const highlighter = new HighlightClient(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike,
);
