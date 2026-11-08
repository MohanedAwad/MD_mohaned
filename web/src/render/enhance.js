import { ALERT_TITLES, alertType, slugify, textDirection } from '../lib/text.js';
import { icon } from '../ui/icons.js';

const DIR_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,ul,ol,blockquote,table,th,td,dt,dd,.frontmatter';

// Explicit, not dir="auto": auto on a list/table skips children that carry their own dir.
function applyDirection(root) {
  root.querySelectorAll(DIR_BLOCKS).forEach((el) => {
    const dir = textDirection(el.textContent);
    if (dir) el.setAttribute('dir', dir);
  });
}

// `> [!NOTE]` blockquotes become coloured callouts with a title in the text's language.
function alerts(root) {
  root.querySelectorAll('blockquote').forEach((bq) => {
    const p = bq.querySelector(':scope > p');
    const type = p && alertType(p.textContent);
    if (!type) return;
    const first = p.firstChild;
    if (first?.nodeType === Node.TEXT_NODE) {
      first.nodeValue = first.nodeValue.replace(/^\s*\[![a-z]+\]\s*/i, '');
      if (!first.nodeValue && first.nextSibling?.nodeName === 'BR') first.nextSibling.remove();
    }
    if (!p.textContent.trim() && !p.children.length) p.remove();
    const dir = textDirection(bq.textContent) || 'ltr';
    const title = document.createElement('div');
    title.className = 'alert-title';
    title.innerHTML = icon(`alert-${type}`) + `<span>${ALERT_TITLES[type][dir]}</span>`;
    bq.prepend(title);
    bq.classList.add('alert', `alert-${type}`);
  });
}

// Language label + copy button on code blocks.
function codeBlocks(root) {
  root.querySelectorAll('pre:not(.mermaid) > code').forEach((code) => {
    const pre = code.parentElement;
    const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1] || '';
    const wrap = document.createElement('div');
    wrap.className = 'codeblock';
    const head = document.createElement('div');
    head.className = 'code-head';
    head.innerHTML = `<span class="code-lang">${lang}</span><button class="code-copy" data-tip="Copy this code">${icon('copy')}<span>Copy</span></button>`;
    pre.replaceWith(wrap);
    wrap.append(head, pre);
  });
}

function frontMatter(root, meta) {
  if (!meta.length) return;
  const card = document.createElement('dl');
  card.className = 'frontmatter';
  for (const [k, v] of meta) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    card.append(dt, dd);
  }
  root.prepend(card);
}

function headingIds(root) {
  const used = new Map();
  root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    const base = slugify(h.textContent);
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    h.id = n ? `${base}-${n}` : base;
  });
}

export function enhance(root, { meta }) {
  frontMatter(root, meta);
  alerts(root);
  codeBlocks(root);
  headingIds(root);
  applyDirection(root);
}
