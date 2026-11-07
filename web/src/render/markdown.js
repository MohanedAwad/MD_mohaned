import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { splitFrontMatter } from '../lib/text.js';

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang === 'mermaid') return code;
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return hljs.highlightAuto(code).value;
    },
  }),
  markedKatex({ throwOnError: false, nonStandard: true }),
  {
    gfm: true,
    renderer: {
      code(token) {
        if (token.lang === 'mermaid') return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`;
        return false;
      },
    },
  },
);

/**
 * Markdown → sanitized HTML. Each top-level block is wrapped in
 * `<div class="blk" data-line="N">` (N = 1-based source line) so the view can
 * scroll to the line the Zed cursor is on and sync with the editor.
 */
export function renderMarkdown(src) {
  const { meta, body, lineOffset } = splitFrontMatter(src);
  const tokens = marked.lexer(body);
  // lexer() + parser() skip the walkTokens step that parse() runs; highlighting lives there.
  if (marked.defaults.walkTokens) marked.walkTokens(tokens, marked.defaults.walkTokens);

  let line = lineOffset + 1;
  let html = '';
  for (const token of tokens) {
    const start = line;
    line += (token.raw.match(/\n/g) || []).length;
    if (token.type === 'space') continue;
    const one = [token];
    one.links = tokens.links;
    html += `<div class="blk" data-line="${start}">${marked.parser(one)}</div>`;
  }
  return { html: DOMPurify.sanitize(html), meta };
}
