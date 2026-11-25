import 'katex/dist/katex.min.css';
import './styles/theme.css';
import './styles/app.css';
import './styles/document.css';
import { renderMarkdown } from './render/markdown.js';
import { enhanceBlock, frontMatter, headingIds } from './render/enhance.js';
import { renderDiagrams, diagramClick, installDiagramGestures, diagramSource } from './render/diagrams.js';
import { findMermaidBlock, blockCode, replaceBlock } from './lib/diagram.js';
import { countWords, readingMinutes } from './lib/text.js';
import { formatKeys } from './lib/fuzzy.js';
import { docBaseHref, getInitialPrefs, isPrimaryMod, normalizePath, postToHost } from './lib/bridge.js';
import { COMMANDS } from './ui/commands.js';
import { icon } from './ui/icons.js';
import { createOutline } from './ui/outline.js';
import { createFileTree } from './ui/filetree.js';
import { createSearch } from './ui/search.js';
import { openPicker } from './ui/picker.js';
import { installTooltips } from './ui/tooltip.js';

const $ = (s) => document.querySelector(s);
const native = postToHost;
window.addEventListener('error', (e) => native({ type: 'log', message: `${e.message} @${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => native({ type: 'log', message: String(e.reason?.stack || e.reason) }));

const prefs = { theme: 'auto', sync: true, sidebar: 'files', sidebarHidden: false, vim: true, ...getInitialPrefs() };
const state = {
  path: null, untitled: false, text: '', saved: '', dirty: false, editor: null, pendingDisk: null, pendingLine: 0,
  workspace: null, files: [], recents: [],
};
const preview = $('#preview');
const doc = $('#doc');
const editorPane = $('#editor-pane');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const byId = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));
const keysOf = (id) => formatKeys(byId[id]?.keys);

function setPref(key, value) {
  prefs[key] = value;
  native({ type: 'pref', key, value });
}

const relPath = (abs) => {
  if (!state.workspace || !abs) return null;
  const root = normalizePath(state.workspace.root).replace(/\/+$/, '');
  const norm = normalizePath(abs);
  return norm.startsWith(root + '/') ? norm.slice(root.length + 1) : null;
};
const absPath = (rel) => `${normalizePath(state.workspace.root).replace(/\/+$/, '')}/${rel}`;

// --- Panels ---

const outline = createOutline($('#outline-list'), preview);
const tree = createFileTree($('#tree'), $('#files-filter'), {
  onOpen: (rel, { newTab }) => native({ type: 'openFile', path: absPath(rel), newTab }),
});
const search = createSearch({
  bar: $('#search'), input: $('#search-input'), count: $('#search-count'),
  doc, scroller: preview, editor: () => state.editor,
});

// --- Look ---

installTooltips((el) => {
  if (el.dataset.tip) return { label: el.dataset.tip, keys: el.dataset.keys || '' };
  const c = byId[el.dataset.cmd];
  return c ? { label: c.title, keys: formatKeys(c.keys) } : {};
});

for (const b of document.querySelectorAll('button[data-cmd]')) {
  const c = byId[b.dataset.cmd];
  if (b.dataset.icon) b.innerHTML = icon(b.dataset.icon) + (b.dataset.label ? `<span>${b.dataset.label}</span>` : '');
  if (c) b.setAttribute('aria-label', c.title);
}
$('#project-btn').insertAdjacentHTML('afterbegin', icon('project'));
$('#project-btn').insertAdjacentHTML('beforeend', `<span class="chev-down">${icon('chevron')}</span>`);

const isDark = () => prefs.theme === 'dark' || (prefs.theme === 'auto' && darkQuery.matches);
const editorOpen = () => !editorPane.hidden;

function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const b = $('#btn-theme');
  b.innerHTML = icon(prefs.theme);
  b.dataset.tip = `Theme: ${prefs.theme[0].toUpperCase() + prefs.theme.slice(1)} — click to change`;
  state.editor?.setDark(dark);
  native({ type: 'chrome', dark, color: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() });
}

function applyLayout() {
  const sidebar = $('#sidebar');
  sidebar.hidden = prefs.sidebarHidden;
  sidebar.dataset.mode = prefs.sidebar;
  $('#files-panel').hidden = prefs.sidebar === 'outline';
  $('#outline-panel').hidden = prefs.sidebar === 'files';
  for (const b of sidebar.querySelectorAll('.side-tabs button')) b.setAttribute('aria-pressed', b.dataset.panel === prefs.sidebar);
  document.querySelector('[data-cmd=toggleSidebar]').setAttribute('aria-pressed', !prefs.sidebarHidden);
  document.querySelector('[data-cmd=toggleEditor]').setAttribute('aria-pressed', editorOpen());
  const sync = document.querySelector('[data-cmd=toggleSync]');
  sync.hidden = !editorOpen();
  sync.setAttribute('aria-pressed', prefs.sync);
}

/** Zed-style: the shortcut for the panel already showing hides the sidebar; otherwise it shows that panel. */
function showPanel(mode) {
  if (!prefs.sidebarHidden && prefs.sidebar === mode) {
    setPref('sidebarHidden', true);
  } else {
    setPref('sidebar', mode);
    setPref('sidebarHidden', false);
  }
  applyLayout();
  if (!prefs.sidebarHidden && mode === 'files') $('#files-filter').focus();
}

let lastStatusText = null;
function updateStatus() {
  if (state.text !== lastStatusText) {
    lastStatusText = state.text;
    const words = countWords(state.text);
    $('#st-words').textContent = `${words.toLocaleString()} words`;
    $('#st-read').textContent = `${readingMinutes(words)} min read`;
  }
  $('#st-heads').textContent = `${outline.count} sections`;
}

function updateHeader() {
  const ws = state.workspace;
  $('#project-name').textContent = ws ? ws.name : 'No project';
  $('#files-count').textContent = ws ? String(state.files.length) : '';
  const rel = relPath(state.path);
  const shown = state.untitled ? 'Untitled' : rel ?? (state.path ? normalizePath(state.path).split('/').pop() : '');
  $('#crumb-path').innerHTML = shown
    .split('/')
    .map((p, i, all) => `<span class="${i === all.length - 1 ? 'crumb-file' : 'crumb-dir'}">${p.replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'))}</span>`)
    .join('<span class="crumb-sep">/</span>');
  document.title = shown || 'MD_mohaned';
}

function updateEmpty() {
  const noFile = state.path === null && !state.untitled;
  $('#empty').hidden = !noFile;
  $('#status').hidden = noFile;
  if (!noFile) return;
  const keys = state.workspace
    ? [['goToFile', 'Go to a file'], ['showFiles', 'Files panel'], ['switchProject', 'Switch project'], ['palette', 'All commands']]
    : [['openAny', 'Open a file or folder'], ['switchProject', 'Recent projects'], ['palette', 'All commands']];
  $('#empty-title').textContent = state.workspace ? state.workspace.name : 'MD_mohaned';
  $('#empty-text').textContent = state.workspace
    ? `${state.files.length} Markdown files. Pick one to start reading.`
    : 'Open a Markdown file or a project folder, or press ⌥⇧P in Zed.';
  $('#empty-keys').innerHTML = keys.map(([id, label]) => `<div><span>${label}</span><kbd>${keysOf(id)}</kbd></div>`).join('');
}

// --- Render (incremental block-level DOM patch) ---

let seq = 0;
let blockEls = [];
let lastMetaKey = '';
let showingHint = false;

function patchDocument(blocks, meta) {
  if (showingHint) {
    doc.textContent = '';
    blockEls = [];
    lastMetaKey = '';
    showingHint = false;
  }

  const metaKey = meta.length ? JSON.stringify(meta) : '';
  if (metaKey !== lastMetaKey) {
    doc.querySelector(':scope > .frontmatter')?.remove();
    if (meta.length) frontMatter(doc, meta);
    lastMetaKey = metaKey;
  }

  let domChanged = false;
  const nextEls = new Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const prev = blockEls[i];
    if (prev && prev._rawHtml === b.html) {
      if (prev.dataset.line !== String(b.line)) prev.dataset.line = String(b.line);
      nextEls[i] = prev;
      continue;
    }
    const el = document.createElement('div');
    el.className = 'blk';
    el.dataset.line = String(b.line);
    el._rawHtml = b.html;
    el.innerHTML = b.html;
    enhanceBlock(el);
    if (prev) prev.replaceWith(el);
    else doc.append(el);
    nextEls[i] = el;
    domChanged = true;
  }
  for (let i = blocks.length; i < blockEls.length; i++) {
    blockEls[i].remove();
    domChanged = true;
  }
  blockEls = nextEls;
  if (domChanged) headingIds(doc);
  return domChanged;
}

async function refresh({ keepScroll = true, force = false } = {}) {
  const my = ++seq;
  updateEmpty();
  const y = preview.scrollTop;
  let domChanged = false;
  if (state.untitled && !state.text.trim()) {
    doc.innerHTML = `<p class="untitled-hint">Start writing on the left. The preview follows as you type. <kbd>${keysOf('save')}</kbd> saves.</p>`;
    blockEls = [];
    lastMetaKey = '';
    showingHint = true;
    domChanged = true;
  } else {
    const { blocks, meta } = renderMarkdown(state.text);
    domChanged = patchDocument(blocks, meta);
  }
  if (!(await renderDiagrams(doc, isDark(), () => my === seq, { force }))) return;
  if (domChanged || !keepScroll) outline.build(doc);
  lockSync();
  preview.scrollTop = keepScroll ? y : 0;
  if (state.pendingLine) { scrollPreviewToLine(state.pendingLine, true); state.pendingLine = 0; }
  search.refresh();
  updateStatus();
  updateProgress();
  native({ type: 'rendered' });
}

let renderTimer = 0;
function scheduleRender() {
  clearTimeout(renderTimer);
  const delay = state.text.length > 20000 ? 110 : 45;
  renderTimer = setTimeout(() => refresh(), delay);
}

// --- Source line mapping (Zed cursor, editor sync) ---

function blockForLine(n) {
  let lo = 0;
  let hi = blockEls.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (Number(blockEls[mid].dataset.line) <= n) {
      best = blockEls[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function scrollPreviewToLine(n, flash) {
  const b = blockForLine(n);
  if (!b) return;
  lockSync();
  preview.scrollTop += b.getBoundingClientRect().top - preview.getBoundingClientRect().top - 24;
  if (flash) {
    b.classList.remove('flash');
    void b.offsetWidth;
    b.classList.add('flash');
  }
}

function topPreviewLine() {
  if (!blockEls.length) return 1;
  const top = preview.getBoundingClientRect().top + 8;
  let lo = 0;
  let hi = blockEls.length - 1;
  let found = blockEls.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blockEls[mid].getBoundingClientRect().bottom > top) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return Number(blockEls[found].dataset.line) || 1;
}

let syncUntil = 0;
const syncing = () => prefs.sync && editorOpen() && state.editor && Date.now() >= syncUntil;
const lockSync = () => { syncUntil = Date.now() + 140; };

function updateProgress() {
  const max = preview.scrollHeight - preview.clientHeight;
  $('#progress').style.transform = `scaleX(${max > 0 ? preview.scrollTop / max : 0})`;
}

let previewScrollRaf = 0;
preview.addEventListener('scroll', () => {
  if (previewScrollRaf) return;
  previewScrollRaf = requestAnimationFrame(() => {
    previewScrollRaf = 0;
    outline.markActive();
    updateProgress();
    if (syncing()) { lockSync(); state.editor.scrollToLine(topPreviewLine()); }
  });
}, { passive: true });

// --- Editor (lazy-loaded on first open) ---

function setDirty(d) {
  if (state.dirty === d) return;
  state.dirty = d;
  $('#dirty-dot').hidden = !d;
  native({ type: 'dirty', value: d });
}

let editorModulePromise = null;
let editorToggleSeq = 0;

async function toggleEditor(force) {
  if (state.path === null && !state.untitled) return;
  const show = force ?? !editorOpen();
  const myToggle = ++editorToggleSeq;
  const line = preview.scrollTop < 10 ? 1 : topPreviewLine();

  // Unhide BEFORE mounting CodeMirror so viewport & Vim fat-cursor measure real geometry.
  editorPane.hidden = !show;
  applyLayout();
  native({ type: 'editorState', open: show });

  if (!show) return;

  if (!state.editor) {
    editorModulePromise ??= import('./ui/editor.js');
    const { createEditor } = await editorModulePromise;
    // User may have closed the editor or switched tabs while the chunk was loading.
    if (myToggle !== editorToggleSeq || !editorOpen()) return;
    if (!state.editor) {
      state.editor = createEditor(editorPane, state.text, {
        dark: isDark(),
        vimMode: prefs.vim,
        onSave: () => native({ type: 'native', id: 'save' }),
        onClose: () => toggleEditor(false),
        onChange(text) { state.text = text; setDirty(text !== state.saved); scheduleRender(); },
        onScroll() { if (syncing()) { lockSync(); scrollPreviewToLine(state.editor.topLine(), false); } },
      });
    }
  } else {
    state.editor.setText(state.text);
  }

  lockSync();
  state.editor.measure();
  state.editor.scrollToLine(line, { moveCursor: true });
  state.editor.focus();
}

// --- Diagram editor (loaded on first use) ---

let diagramEditor = null;

/** Opens the flowchart editor on one diagram; each change is written into that block of the document. */
async function editDiagram(pre) {
  const src = diagramSource(pre);
  let block = src == null ? null : findMermaidBlock(state.text, Number(pre.closest('.blk')?.dataset.line) || 1, src);
  if (!block) { native({ type: 'log', message: 'diagram editor: block not found in the text' }); return; }
  const { openDiagramEditor } = await import('./ui/diagram-editor.js');
  diagramEditor?.close();
  let code = src;
  diagramEditor = openDiagramEditor({
    code,
    dark: isDark(),
    /** Writes the new code into the document; false if the block can no longer be found. */
    onChange(next) {
      if (blockCode(state.text, block) !== code) block = findMermaidBlock(state.text, 1, code);
      if (!block) return false;
      const out = replaceBlock(state.text, block, next);
      block = out.block;
      code = next;
      state.text = out.text;
      setDirty(state.text !== state.saved);
      state.editor?.setText(state.text);
      scheduleRender();
      return true;
    },
    onClose() { diagramEditor = null; },
  });
}

// --- Pickers ---

function goToFile() {
  if (!state.workspace) return commands.openAny();
  const current = relPath(state.path);
  openPicker({
    placeholder: `Go to file in ${state.workspace.name}`,
    empty: 'No matching Markdown files',
    items: state.files.map((rel) => {
      const slash = rel.lastIndexOf('/');
      return { title: rel.slice(slash + 1), detail: slash < 0 ? '' : rel.slice(0, slash), match: rel, value: rel, hint: rel === current ? 'open' : '' };
    }),
    onPick: (rel, { alt }) => native({ type: 'openFile', path: absPath(rel), newTab: alt }),
  });
}

function switchProject() {
  const items = state.recents.map((p) => ({ title: p.split('/').pop(), detail: p.replace(/^\/Users\/[^/]+/, '~'), match: p, value: p,
    hint: p === state.workspace?.root ? 'current' : '' }));
  items.push({ title: 'Open Folder…', detail: 'Choose a project folder', match: 'open folder', value: null, hint: keysOf('openAny') });
  openPicker({
    placeholder: 'Switch project',
    items,
    onPick: (path, { alt }) => (path ? native({ type: 'openWorkspace', path, newTab: alt }) : native({ type: 'native', id: 'openAny' })),
  });
}

function goToHeading() {
  const heads = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  openPicker({
    placeholder: 'Go to heading',
    empty: 'No headings',
    items: heads.map((h) => ({ title: h.textContent, detail: '#'.repeat(Number(h.tagName[1])), value: h.id })),
    onPick: (id) => document.getElementById(id)?.scrollIntoView({ block: 'start' }),
  });
}

function palette() {
  openPicker({
    placeholder: 'Run a command',
    items: COMMANDS.filter((c) => c.id !== 'palette').map((c) => ({ title: c.title, detail: c.group, hint: formatKeys(c.keys), value: c.id })),
    onPick: (id) => run(id),
  });
}

function shortcutsSheet() {
  const groups = {};
  for (const c of COMMANDS) if (c.keys) (groups[c.group] ||= []).push(c);
  openPicker({
    placeholder: 'Keyboard shortcuts — type to filter, ↩ to run',
    items: Object.entries(groups).flatMap(([g, cs]) => cs.map((c) => ({ title: c.title, detail: g, hint: formatKeys(c.keys), value: c.id }))),
    onPick: (id) => run(id),
  });
}

// --- Commands ---

const commands = {
  openAny: () => native({ type: 'native', id: 'openAny' }),
  switchProject,
  goToFile,
  goToHeading,
  palette,
  shortcuts: shortcutsSheet,
  toggleSidebar: () => { setPref('sidebarHidden', !prefs.sidebarHidden); applyLayout(); },
  showFiles: () => showPanel('files'),
  showOutline: () => showPanel('outline'),
  showBoth: () => showPanel('both'),
  toggleEditor: (force) => toggleEditor(force),
  toggleSync: () => { setPref('sync', !prefs.sync); applyLayout(); },
  toggleVim: () => { setPref('vim', !prefs.vim); state.editor?.setVim(prefs.vim); },
  find: () => search.show(),
  findNext: () => search.step(1),
  findPrevious: () => search.step(-1),
  copyMarkdown: () => native({ type: 'copy', text: state.text }),
  cycleTheme: () => setTheme({ auto: 'light', light: 'dark', dark: 'auto' }[prefs.theme]),
  themeAuto: () => setTheme('auto'),
  themeLight: () => setTheme('light'),
  themeDark: () => setTheme('dark'),
  scrollToLine: (n) => {
    lockSync();
    if (state.editor && editorOpen()) state.editor.scrollToLine(Number(n), { moveCursor: true });
    scrollPreviewToLine(Number(n), true);
  },
};

function setTheme(t) { setPref('theme', t); applyTheme(); refresh({ force: true }); }

function run(id, arg) {
  if (commands[id]) return commands[id](arg);
  if (byId[id]?.native) native({ type: 'native', id });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cmd]');
  if (b) run(b.dataset.cmd);
});
darkQuery.addEventListener('change', () => { if (prefs.theme === 'auto') { applyTheme(); refresh({ force: true }); } });

// --- Clicks inside the document ---

function onDocClick(e) {
  const copyBtn = e.target.closest('.code-copy');
  if (copyBtn) {
    native({ type: 'copy', text: copyBtn.closest('.codeblock').querySelector('code').textContent });
    copyBtn.classList.add('done');
    copyBtn.querySelector('span').textContent = 'Copied';
    setTimeout(() => { copyBtn.classList.remove('done'); copyBtn.querySelector('span').textContent = 'Copy'; }, 1200);
    return;
  }
  const edit = e.target.closest('.mermaid-edit');
  if (edit) { editDiagram(edit.closest('pre.mermaid')); return; }
  if (diagramClick(e)) return;

  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  if (href.startsWith('#')) {
    document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
  } else {
    native({ type: 'link', href: a.href, newTab: isPrimaryMod(e) });
  }
}
doc.addEventListener('click', onDocClick);
installDiagramGestures(doc);
$('#outline-list').addEventListener('click', onDocClick);

$('#banner-reload').onclick = () => {
  $('#banner').hidden = true;
  state.text = state.saved = state.pendingDisk;
  setDirty(false);
  state.editor?.setText(state.text);
  refresh();
};
$('#banner-keep').onclick = () => { $('#banner').hidden = true; };

function stamp() {
  $('#st-updated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// --- API called by the Swift side ---

let printTheme = null;
window.mdv = {
  load({ path, text, line }) {
    diagramEditor?.close();
    state.path = path;
    state.untitled = false;
    state.text = state.saved = text;
    state.pendingLine = Number(line) || 0;
    setDirty(false);
    const normPath = normalizePath(path);
    const dir = normPath.slice(0, normPath.lastIndexOf('/'));
    document.querySelector('base').href = docBaseHref(dir);
    state.editor?.reset(text);
    $('#banner').hidden = true;
    tree.setCurrent(relPath(path));
    updateHeader();
    stamp();
    refresh({ keepScroll: false });
  },
  setWorkspace({ root, name, files }) {
    const changed = state.workspace?.root !== root;
    state.workspace = { root, name };
    state.files = files;
    tree.setFiles(files);
    tree.setCurrent(relPath(state.path));
    updateHeader();
    if (state.path === null) updateEmpty();
    if (changed) $('#files-filter').value = '';
  },
  setRecents(list) { state.recents = list; },
  /** ⌘T: an empty, unsaved document with the editor open. */
  newDocument() {
    diagramEditor?.close();
    state.path = null;
    state.untitled = true;
    state.text = state.saved = '';
    setDirty(false);
    if (state.workspace) {
      document.querySelector('base').href = docBaseHref(state.workspace.root);
    }
    tree.setCurrent(null);
    state.editor?.reset('');
    updateHeader();
    refresh({ keepScroll: false });
    toggleEditor(true);
  },
  clear() {
    diagramEditor?.close();
    state.path = null;
    state.untitled = false;
    state.text = state.saved = '';
    setDirty(false);
    doc.innerHTML = '';
    blockEls = [];
    lastMetaKey = '';
    showingHint = false;
    outline.build(doc);
    editorPane.hidden = true;
    native({ type: 'editorState', open: false });
    state.editor?.reset('');
    tree.setCurrent(null);
    applyLayout();
    updateHeader();
    updateEmpty();
  },
  diskChanged(text) {
    if (text === state.saved) return;
    if (state.dirty) {
      state.pendingDisk = text;
      $('#banner').hidden = false;
      return;
    }
    state.text = state.saved = text;
    state.editor?.setText(text);
    stamp();
    refresh();
  },
  getText: () => state.text,
  saved(text) {
    state.saved = text;
    setDirty(state.text !== text);
    stamp();
  },
  command: (id, arg) => run(id, arg),
  /** Page zoom (⌘+ / ⌘−) from the Swift side; the styles use it to keep gutters fixed and grow diagrams. */
  setZoom(z) { document.documentElement.style.setProperty('--zoom', String(Number(z) || 1)); },
  async preparePrint() {
    printTheme = prefs.theme;
    prefs.theme = 'light';
    applyTheme();
    await refresh({ force: true });
    return true;
  },
  endPrint() {
    if (printTheme === null) return;
    prefs.theme = printTheme;
    printTheme = null;
    applyTheme();
    refresh({ force: true });
  },
};

applyTheme();
applyLayout();
updateHeader();
updateEmpty();
native({ type: 'ready', commands: COMMANDS });

// Warm the editor chunk once idle so toggling Vim/Editor is instant without slowing startup.
const preloadEditor = () => { editorModulePromise ??= import('./ui/editor.js'); };
if (typeof requestIdleCallback === 'function') requestIdleCallback(preloadEditor, { timeout: 1500 });
else setTimeout(preloadEditor, 300);
