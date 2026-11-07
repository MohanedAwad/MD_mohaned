import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const marked = new Marked(
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

const STRONG = /[A-Za-z\u00C0-\u024F\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const DIR_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,ul,ol,blockquote,table,th,td,dt,dd';

// Explicit, not dir="auto": auto on a list/table skips children that carry their own dir.
function applyDirection(root) {
  root.querySelectorAll(DIR_BLOCKS).forEach((el) => {
    const m = el.textContent.match(STRONG);
    if (m) el.setAttribute('dir', RTL.test(m[0]) ? 'rtl' : 'ltr');
  });
}

const FONT = '-apple-system, BlinkMacSystemFont, "SF Arabic", "Geeza Pro", sans-serif';
const svgCache = new Map();
let seq = 0;

async function renderMermaid(root, dark, my) {
  const nodes = [...root.querySelectorAll('pre.mermaid')];
  if (!nodes.length) return true;
  const theme = dark ? 'dark' : 'default';
  mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: FONT });
  for (const [i, el] of nodes.entries()) {
    const src = el.textContent;
    const key = theme + '\n' + src;
    let svg = svgCache.get(key);
    if (!svg) {
      const id = `mmd-${my}-${i}`;
      try {
        ({ svg } = await mermaid.render(id, src));
        if (svgCache.size > 200) svgCache.clear();
        svgCache.set(key, svg);
      } catch (err) {
        document.getElementById('d' + id)?.remove();
        if (my !== seq) return false;
        el.classList.add('mermaid-error');
        el.textContent = 'Mermaid error: ' + (err?.message || err);
        continue;
      }
    }
    if (my !== seq) return false;
    el.innerHTML = svg;
  }
  return true;
}

// Returns false when a newer render superseded this one.
export async function render(text, root, { dark }) {
  const my = ++seq;
  root.innerHTML = DOMPurify.sanitize(marked.parse(text));
  applyDirection(root);
  return renderMermaid(root, dark, my);
}

export function buildOutline(root, list) {
  list.textContent = '';
  const used = new Map();
  const items = [];
  root.querySelectorAll('h1,h2,h3,h4').forEach((h) => {
    const base = h.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    h.id = n ? `${base}-${n}` : base;
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    a.className = 'lvl' + h.tagName[1];
    a.dir = 'auto';
    list.append(a);
    items.push({ h, a });
  });
  return items;
}
