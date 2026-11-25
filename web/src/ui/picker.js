import { fuzzyFilter, fuzzyScore } from '../lib/fuzzy.js';
import { isPrimaryMod } from '../lib/bridge.js';

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function highlight(text, query) {
  const r = query.trim() && fuzzyScore(query.trim(), text);
  if (!r) return escapeHtml(text);
  const hits = new Set(r.hits);
  return [...text].map((ch, i) => (hits.has(i) ? `<b>${escapeHtml(ch)}</b>` : escapeHtml(ch))).join('');
}

let active = null;

/**
 * Quick-open overlay (Zed-style). Items are { title, detail?, hint?, match?, value }.
 * `match` (default title) is what the query is matched against.
 * onPick(value, { alt }) — alt is true for ⌘↩ (open in a new tab).
 */
export function openPicker({ placeholder, items, onPick, empty = 'No matches' }) {
  active?.close();
  const box = document.createElement('div');
  box.id = 'picker';
  box.innerHTML = `<div class="pk-box" role="dialog"><input class="pk-input" spellcheck="false" dir="auto" placeholder="${escapeHtml(placeholder)}"><ul class="pk-list" role="listbox"></ul></div>`;
  const input = box.querySelector('.pk-input');
  const list = box.querySelector('.pk-list');
  let shown = [];
  let index = 0;

  function render() {
    shown = fuzzyFilter(input.value, items, (it) => it.match ?? it.title);
    index = Math.min(index, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length
      ? shown.map(({ item }, i) => `
          <li class="pk-item${i === index ? ' sel' : ''}" data-i="${i}" role="option">
            <span class="pk-title" dir="auto">${highlight(item.title, input.value)}</span>
            ${item.detail ? `<span class="pk-detail" dir="auto">${escapeHtml(item.detail)}</span>` : ''}
            ${item.hint ? `<kbd class="pk-hint">${escapeHtml(item.hint)}</kbd>` : ''}
          </li>`).join('')
      : `<li class="pk-empty">${escapeHtml(empty)}</li>`;
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i, alt) {
    const hit = shown[i];
    if (!hit) return;
    close();
    onPick(hit.item.value, { alt });
  }

  function close() {
    box.remove();
    if (active === api) active = null;
  }

  function updateSelection() {
    list.querySelector('.sel')?.classList.remove('sel');
    const el = list.children[index];
    if (el?.classList.contains('pk-item')) {
      el.classList.add('sel');
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  input.addEventListener('input', () => { index = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); index = Math.min(index + 1, shown.length - 1); updateSelection(); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); index = Math.max(index - 1, 0); updateSelection(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(index, isPrimaryMod(e)); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  list.addEventListener('mousemove', (e) => {
    const li = e.target.closest('.pk-item');
    if (li && Number(li.dataset.i) !== index) { index = Number(li.dataset.i); updateSelection(); }
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.pk-item');
    if (li) choose(Number(li.dataset.i), isPrimaryMod(e));
  });
  box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });

  document.body.append(box);
  render();
  input.focus();
  const api = { close };
  active = api;
  return api;
}
