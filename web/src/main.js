import 'katex/dist/katex.min.css';
import './styles/theme.css';
import './styles/app.css';
import './styles/document.css';
import { renderMarkdown } from './render/markdown.js';
import { enhance } from './render/enhance.js';
import { renderDiagrams, openLightbox } from './render/diagrams.js';
import { countWords, readingMinutes } from './lib/text.js';
import { formatKeys } from './lib/fuzzy.js';
import { COMMANDS } from './ui/commands.js';
import { icon } from './ui/icons.js';
import { createOutline } from './ui/outline.js';
import { createFileTree } from './ui/filetree.js';
import { createSearch } from './ui/search.js';
import { createEditor } from './ui/editor.js';
import { openPicker } from './ui/picker.js';
import { installTooltips } from './ui/tooltip.js';

const $ = (s) => document.querySelector(s);
const native = (msg) => window.webkit?.messageHandlers?.mdv?.postMessage(msg);
window.addEventListener('error', (e) => native({ type: 'log', message: `${e.message} @${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => native({ type: 'log', message: String(e.reason?.stack || e.reason) }));

const prefs = { theme: 'auto', sync: true, sidebar: 'files', sidebarHidden: false, ...(window.MDV_PREFS || {}) };
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

const relPath = (abs) => (state.workspace && abs?.startsWith(state.workspace.root + '/') ? abs.slice(state.workspace.root.length + 1) : null);
const absPath = (rel) => `${state.workspace.root}/${rel}`;

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

function updateStatus() {
  const words = countWords(state.text);
  $('#st-words').textContent = `${words.toLocaleString()} words`;
  $('#st-read').textContent = `${readingMinutes(words)} min read`;
  $('#st-heads').textContent = `${outline.count} sections`;
}

function updateHeader() {
  const ws = state.workspace;
  $('#project-name').textContent = ws ? ws.name : 'No project';
  $('#files-count').textContent = ws ? String(state.files.length) : '';
  const rel = relPath(state.path);
  const shown = state.untitled ? 'Untitled' : rel ?? (state.path ? state.path.split('/').pop() : '');
  $('#crumb-path').innerHTML = shown
    .split('/')
    .map((p, i, all) => `<span class="${i === all.length - 1 ? 'crumb-file' : 'crumb-dir'}">${p.replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'))}</span>`)
    .join('<span class="crumb-sep">/</span>');
  document.title = shown || 'MD Viewer';
}

function updateEmpty() {
  const noFile = state.path === null && !state.untitled;
  $('#empty').hidden = !noFile;
  $('#status').hidden = noFile;
  if (!noFile) return;
  const keys = state.workspace
    ? [['goToFile', 'Go to a file'], ['showFiles', 'Files panel'], ['switchProject', 'Switch project'], ['palette', 'All commands']]
    : [['openAny', 'Open a file or folder'], ['switchProject', 'Recent projects'], ['palette', 'All commands']];
  $('#empty-title').textContent = state.workspace ? state.workspace.name : 'MD Viewer';
  $('#empty-text').textContent = state.workspace
    ? `${state.files.length} Markdown files. Pick one to start reading.`
    : 'Open a Markdown file or a project folder, or press ⌥⇧P in Zed.';
  $('#empty-keys').innerHTML = keys.map(([id, label]) => `<div><span>${label}</span><kbd>${keysOf(id)}</kbd></div>`).join('');
}

// --- Render ---

let seq = 0;
async function refresh({ keepScroll = true } = {}) {
  const my = ++seq;
  updateEmpty();
  const y = preview.scrollTop;
  if (state.untitled && !state.text.trim()) {
    doc.innerHTML = `<p class="untitled-hint">Start writing on the left. The preview follows as you type. <kbd>${keysOf('save')}</kbd> saves.</p>`;
  } else {
    const { html, meta } = renderMarkdown(state.text);
    doc.innerHTML = html;
    enhance(doc, { meta });
  }
  if (!(await renderDiagrams(doc, isDark(), () => my === seq))) return;
  outline.build(doc);
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
  renderTimer = setTimeout(() => refresh(), 150);
}

// --- Source line mapping (Zed cursor, editor sync) ---

function blockForLine(n) {
  let best = null;
  for (const b of doc.querySelectorAll('.blk')) {
    if (Number(b.dataset.line) <= n) best = b; else break;
  }
  return best;
}

function scrollPreviewToLine(n, flash) {
  const b = blockForLine(n);
  if (!b) return;
  preview.scrollTop += b.getBoundingClientRect().top - preview.getBoundingClientRect().top - 24;
  if (flash) {
    b.classList.remove('flash');
    void b.offsetWidth;
    b.classList.add('flash');
  }
}

function topPreviewLine() {
  const top = preview.getBoundingClientRect().top + 8;
  let line = 1;
  for (const b of doc.querySelectorAll('.blk')) {
    if (b.getBoundingClientRect().bottom > top) return Number(b.dataset.line);
    line = Number(b.dataset.line);
  }
  return line;
}

let syncUntil = 0;
const syncing = () => prefs.sync && editorOpen() && state.editor && Date.now() >= syncUntil;
const lockSync = () => { syncUntil = Date.now() + 120; };

function updateProgress() {
  const max = preview.scrollHeight - preview.clientHeight;
  $('#progress').style.transform = `scaleX(${max > 0 ? preview.scrollTop / max : 0})`;
}

preview.addEventListener('scroll', () => {
  outline.markActive();
  updateProgress();
  if (syncing()) { lockSync(); state.editor.scrollToLine(topPreviewLine()); }
});

// --- Editor ---

function setDirty(d) {
  if (state.dirty === d) return;
  state.dirty = d;
  $('#dirty-dot').hidden = !d;
  native({ type: 'dirty', value: d });
}

function toggleEditor(force) {
  if (state.path === null && !state.untitled) return;
  const show = force ?? !editorOpen();
  if (show && !state.editor) {
    state.editor = createEditor(editorPane, state.text, {
      dark: isDark(),
      onChange(text) { state.text = text; setDirty(text !== state.saved); scheduleRender(); },
      onScroll() { if (syncing()) { lockSync(); scrollPreviewToLine(state.editor.topLine(), false); } },
    });
  }
  const line = preview.scrollTop < 10 ? 1 : topPreviewLine();
  editorPane.hidden = !show;
  applyLayout();
  if (show) { state.editor.scrollToLine(line); state.editor.focus(); }
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
  toggleEditor: () => toggleEditor(),
  toggleSync: () => { setPref('sync', !prefs.sync); applyLayout(); },
  find: () => search.show(),
  findNext: () => search.step(1),
  findPrevious: () => search.step(-1),
  copyMarkdown: () => native({ type: 'copy', text: state.text }),
  cycleTheme: () => setTheme({ auto: 'light', light: 'dark', dark: 'auto' }[prefs.theme]),
  themeAuto: () => setTheme('auto'),
  themeLight: () => setTheme('light'),
  themeDark: () => setTheme('dark'),
  scrollToLine: (n) => {
    if (state.editor && editorOpen()) state.editor.scrollToLine(Number(n));
    scrollPreviewToLine(Number(n), true);
  },
};

function setTheme(t) { setPref('theme', t); applyTheme(); refresh(); }

function run(id, arg) {
  if (commands[id]) return commands[id](arg);
  if (byId[id]?.native) native({ type: 'native', id });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cmd]');
  if (b) run(b.dataset.cmd);
});
darkQuery.addEventListener('change', () => { if (prefs.theme === 'auto') { applyTheme(); refresh(); } });

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
  const diagram = e.target.closest('pre.mermaid');
  if (diagram?.querySelector('svg') && !e.target.closest('a')) { openLightbox(diagram.querySelector('svg')); return; }

  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  if (href.startsWith('#')) {
    document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
  } else {
    native({ type: 'link', href: a.href, newTab: e.metaKey });
  }
}
doc.addEventListener('click', onDocClick);
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
    state.path = path;
    state.untitled = false;
    state.text = state.saved = text;
    state.pendingLine = Number(line) || 0;
    setDirty(false);
    const dir = path.slice(0, path.lastIndexOf('/'));
    document.querySelector('base').href = 'mdv://doc' + dir.split('/').map(encodeURIComponent).join('/') + '/';
    state.editor?.setText(text);
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
    state.path = null;
    state.untitled = true;
    state.text = state.saved = '';
    setDirty(false);
    if (state.workspace) {
      document.querySelector('base').href = 'mdv://doc' + state.workspace.root.split('/').map(encodeURIComponent).join('/') + '/';
    }
    tree.setCurrent(null);
    state.editor?.setText('');
    updateHeader();
    refresh({ keepScroll: false });
    toggleEditor(true);
  },
  clear() {
    state.path = null;
    state.untitled = false;
    state.text = state.saved = '';
    setDirty(false);
    doc.innerHTML = '';
    outline.build(doc);
    editorPane.hidden = true;
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
  async preparePrint() {
    printTheme = prefs.theme;
    prefs.theme = 'light';
    applyTheme();
    await refresh();
    return true;
  },
  endPrint() {
    if (printTheme === null) return;
    prefs.theme = printTheme;
    printTheme = null;
    applyTheme();
    refresh();
  },
};

applyTheme();
applyLayout();
updateHeader();
updateEmpty();
native({ type: 'ready', commands: COMMANDS });
