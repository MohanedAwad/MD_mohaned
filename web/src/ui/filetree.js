import { fuzzyFilter } from '../lib/fuzzy.js';
import { isPrimaryMod, isWindows } from '../lib/bridge.js';
import { icon } from './icons.js';

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function buildTree(paths) {
  const root = { dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split('/');
    const name = parts.pop();
    let node = root;
    let dir = '';
    for (const part of parts) {
      dir = dir ? `${dir}/${part}` : part;
      if (!node.dirs.has(part)) node.dirs.set(part, { path: dir, dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push({ name, path: p });
  }
  return root;
}

/** Workspace file tree (Markdown files only). onOpen(relPath, { newTab }). */
export function createFileTree(container, filterInput, { onOpen }) {
  let paths = [];
  let tree = buildTree([]);
  let current = null;
  const expanded = new Set();

  function row({ depth, kind, path, name, open }) {
    const cls = kind === 'dir' ? 'tr-dir' : `tr-file${path === current ? ' current' : ''}`;
    const glyph = kind === 'dir' ? `<span class="tr-chev${open ? ' open' : ''}">${icon('chevron')}</span>${icon('folder')}` : `<span class="tr-chev"></span>${icon('file')}`;
    const modHint = isWindows ? 'Ctrl-click: new window' : '⌘-click: new tab';
    const tip = kind === 'file' ? ` data-tip="${escapeHtml(path)}" data-keys="${modHint}"` : '';
    return `<div class="tr-row ${cls}" data-kind="${kind}" data-path="${escapeHtml(path)}"${tip} style="--depth:${depth}" dir="auto">${glyph}<span class="tr-name">${escapeHtml(name)}</span></div>`;
  }

  function renderNode(node, depth, out) {
    const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    for (const [name, d] of dirs) {
      const open = expanded.has(d.path);
      out.push(row({ depth, kind: 'dir', path: d.path, name, open }));
      if (open) renderNode(d, depth + 1, out);
    }
    for (const f of node.files) out.push(row({ depth, kind: 'file', path: f.path, name: f.name }));
  }

  function render() {
    const q = filterInput.value.trim();
    const out = [];
    if (q) {
      for (const { item } of fuzzyFilter(q, paths)) {
        const slash = item.lastIndexOf('/');
        out.push(row({ depth: 0, kind: 'file', path: item, name: slash < 0 ? item : `${item.slice(slash + 1)}  ·  ${item.slice(0, slash)}` }));
      }
    } else {
      renderNode(tree, 0, out);
    }
    container.innerHTML = out.join('') || `<p class="side-empty">${paths.length ? 'No matches' : 'No Markdown files in this folder'}</p>`;
    container.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }

  container.addEventListener('click', (e) => {
    const r = e.target.closest('.tr-row');
    if (!r) return;
    const path = r.dataset.path;
    if (r.dataset.kind === 'dir') {
      expanded.has(path) ? expanded.delete(path) : expanded.add(path);
      render();
    } else {
      onOpen(path, { newTab: isPrimaryMod(e) });
    }
  });
  filterInput.addEventListener('input', render);
  filterInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { filterInput.value = ''; render(); filterInput.blur(); }
    if (e.key === 'Enter') { const first = container.querySelector('.tr-file'); if (first) onOpen(first.dataset.path, { newTab: isPrimaryMod(e) }); }
  });

  return {
    setFiles(list) {
      paths = list;
      tree = buildTree(list);
      render();
    },
    setCurrent(rel) {
      current = rel;
      if (rel) {
        const parts = rel.split('/');
        parts.pop();
        let dir = '';
        for (const p of parts) { dir = dir ? `${dir}/${p}` : p; expanded.add(dir); }
      }
      render();
    },
    get count() { return paths.length; },
  };
}
