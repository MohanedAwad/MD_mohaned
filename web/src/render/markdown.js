import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { splitFrontMatter } from '../lib/text.js';

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Cache highlighted code blocks and sanitized top-level blocks so live editing
// only re-parses and re-sanitizes the block that actually changed.
const hlCache = new Map();
const blockCache = new Map();
const CACHE_LIMIT = 500;

function cacheSet(map, key, value) {
  if (map.size >= CACHE_LIMIT) {
    // Evict oldest quarter instead of wiping everything at once.
    const drop = Math.floor(CACHE_LIMIT / 4);
    let n = 0;
    for (const k of map.keys()) {
      map.delete(k);
      if (++n >= drop) break;
    }
  }
  map.set(key, value);
}

export const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang === 'mermaid') return code;
      if (!lang || !hljs.getLanguage(lang)) return escapeHtml(code);
      const key = `${lang}\0${code}`;
      const hit = hlCache.get(key);
      if (hit !== undefined) return hit;
      const out = hljs.highlight(code, { language: lang }).value;
      cacheSet(hlCache, key, out);
      return out;
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
 * Markdown → sanitized HTML and per-block descriptors. Each top-level block is
 * wrapped in `<div class="blk" data-line="N">` (N = 1-based source line) so the
 * view can scroll to the line the Zed cursor is on, sync with the editor, and
 * incrementally patch only changed blocks while typing.
 */
export function renderMarkdown(src) {
  const { meta, body, lineOffset } = splitFrontMatter(src);
  const tokens = marked.lexer(body);
  // lexer() + parser() skip the walkTokens step that parse() runs; highlighting lives there.
  if (marked.defaults.walkTokens) marked.walkTokens(tokens, marked.defaults.walkTokens);

  const linkKeys = Object.keys(tokens.links || {});
  const linksSig = linkKeys.length ? JSON.stringify(tokens.links) : '';

  let line = lineOffset + 1;
  const blocks = [];
  let html = '';
  for (const token of tokens) {
    const start = line;
    line += (token.raw.match(/\n/g) || []).length;
    if (token.type === 'space') continue;
    const key = linksSig ? `${token.raw}\0${linksSig}` : token.raw;
    let inner = blockCache.get(key);
    if (inner === undefined) {
      const one = [token];
      one.links = tokens.links;
      inner = DOMPurify.sanitize(marked.parser(one));
      cacheSet(blockCache, key, inner);
    }
    blocks.push({ line: start, html: inner });
    html += `<div class="blk" data-line="${start}">${inner}</div>`;
  }
  return { html, blocks, meta };
}
