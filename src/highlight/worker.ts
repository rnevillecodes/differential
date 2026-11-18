/// <reference lib="webworker" />
// Syntax highlighting off the UI thread: tokenizes a whole file with Shiki and returns
// compact per-line tokens with light and dark colors.

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import type { LineTokens } from "./tokens";

export interface HighlightRequest {
  id: number;
  code: string;
  lang: string;
}

export type HighlightResponse =
  | { id: number; tokens: LineTokens[] }
  | { id: number; error: string };

let highlighter: Promise<HighlighterCore> | null = null;
const getHighlighter = () =>
  (highlighter ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }));

async function highlight({ code, lang }: HighlightRequest): Promise<LineTokens[]> {
  const h = await getHighlighter();
  if (!h.getLoadedLanguages().includes(lang)) {
    const loader = bundledLanguages[lang as keyof typeof bundledLanguages];
    if (!loader) throw new Error(`unknown language ${lang}`);
    await h.loadLanguage(loader);
  }
  const lines = h.codeToTokensWithThemes(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
  });
  return lines.map((line) =>
    line.map((t) => [t.content, t.variants.light?.color ?? "", t.variants.dark?.color ?? ""]),
  );
}

// Requests are processed one at a time, in order.
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<HighlightRequest>) => {
  const req = e.data;
  queue = queue.then(async () => {
    let res: HighlightResponse;
    try {
      res = { id: req.id, tokens: await highlight(req) };
    } catch (err) {
      res = { id: req.id, error: String(err) };
    }
    self.postMessage(res);
  });
};
