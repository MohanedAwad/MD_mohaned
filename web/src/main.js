import 'katex/dist/katex.min.css';
import './styles/theme.css';
import './styles/app.css';
import './styles/document.css';
import { renderMarkdown } from './render/markdown.js';
import { enhance } from './render/enhance.js';
import { renderDiagrams, openLightbox } from './render/diagrams.js';
import { countWords, readingMinutes } from './lib/text.js';
import { icon } from './ui/icons.js';
import { createOutline } from './ui/outline.js';
import { createSearch } from './ui/search.js';
import { createEditor } from './ui/editor.js';

const $ = (s) => document.querySelector(s);
const native = (msg) => window.webkit?.messageHandlers?.mdv?.postMessage(msg);
window.addEventListener('error', (e) => native({ type: 'log', message: `${e.message} @${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => native({ type: 'log', message: String(e.reason?.stack || e.reason) }));

const prefs = { theme: 'auto', outline: true, sync: true, ...(window.MDV_PREFS || {}) };
const state = { path: null, text: '', saved: '', dirty: false, editor: null, pendingDisk: null, pendingLine: 0 };
const preview = $('#preview');
const doc = $('#doc');
const editorPane = $('#editor-pane');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const outline = createOutline($('#outline-list'), preview);
const search = createSearch({
  bar: $('#search'), input: $('#search-input'), count: $('#search-count'),
  doc, scroller: preview, editor: () => state.editor,
});

const isDark = () => prefs.theme === 'dark' || (prefs.theme === 'auto' && darkQuery.matches);
const editorOpen = () => !editorPane.hidden;

function setPref(key, value) {
  prefs[key] = value;
  native({ type: 'pref', key, value });
}

// --- Look ---

document.querySelectorAll('#toolbar button[data-icon]').forEach((b) => {
  b.innerHTML = icon(b.dataset.icon) + (b.dataset.label ? `<span>${b.dataset.label}</span>` : '');
});

function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const b = $('#btn-theme');
  b.innerHTML = icon(prefs.theme);
  b.title = `Theme: ${prefs.theme[0].toUpperCase() + prefs.theme.slice(1)}`;
  state.editor?.setDark(dark);
  native({ type: 'chrome', dark, color: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() });
}

function applyLayout() {
  $('#outline').hidden = !prefs.outline;
  document.querySelector('[data-cmd=toggleOutline]').setAttribute('aria-pressed', prefs.outline);
  document.querySelector('[data-cmd=toggleEditor]').setAttribute('aria-pressed', editorOpen());
  const sync = document.querySelector('[data-cmd=toggleSync]');
  sync.hidden = !editorOpen();
  sync.setAttribute('aria-pressed', prefs.sync);
}

function updateStatus() {
  const words = countWords(state.text);
  $('#st-words').textContent = `${words.toLocaleString()} words`;
  $('#st-read').textContent = `${readingMinutes(words)} min read`;
  $('#st-heads').textContent = `${outline.count} sections`;
}

// --- Render ---

let seq = 0;
async function refresh({ keepScroll = true } = {}) {
  const my = ++seq;
  $('#empty').hidden = state.path !== null;
  $('#status').hidden = state.path === null;
  const y = preview.scrollTop;
  const { html, meta } = renderMarkdown(state.text);
  doc.innerHTML = html;
  enhance(doc, { meta });
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
function syncing() { return prefs.sync && editorOpen() && state.editor && Date.now() >= syncUntil; }
function lockSync() { syncUntil = Date.now() + 120; }

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
    native({ type: 'link', href: a.href });
  }
}
doc.addEventListener('click', onDocClick);
$('#outline').addEventListener('click', onDocClick);

// --- Commands: toolbar buttons and the native menu ---

const commands = {
  toggleEditor: () => toggleEditor(),
  toggleOutline: () => { setPref('outline', !prefs.outline); applyLayout(); },
  toggleSync: () => { setPref('sync', !prefs.sync); applyLayout(); },
  find: () => search.show(),
  findNext: () => search.step(1),
  findPrevious: () => search.step(-1),
  copy: () => native({ type: 'copy', text: state.text }),
  print: () => native({ type: 'print' }),
  open: () => native({ type: 'open' }),
  cycleTheme: () => commands.setTheme({ auto: 'light', light: 'dark', dark: 'auto' }[prefs.theme]),
  setTheme: (t) => { setPref('theme', t); applyTheme(); refresh(); },
  scrollToLine: (n) => {
    if (state.editor && editorOpen()) state.editor.scrollToLine(Number(n));
    scrollPreviewToLine(Number(n), true);
  },
};

$('#toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cmd]');
  if (b) commands[b.dataset.cmd]();
});
darkQuery.addEventListener('change', () => { if (prefs.theme === 'auto') { applyTheme(); refresh(); } });

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
  load({ path, name, text, line }) {
    state.path = path;
    state.text = state.saved = text;
    state.pendingLine = Number(line) || 0;
    setDirty(false);
    const dir = path.slice(0, path.lastIndexOf('/'));
    document.querySelector('base').href = 'mdv://doc' + dir.split('/').map(encodeURIComponent).join('/') + '/';
    $('#crumb-dir').textContent = dir.split('/').pop() + ' /';
    $('#crumb-name').textContent = name;
    document.title = name;
    state.editor?.setText(text);
    $('#banner').hidden = true;
    stamp();
    refresh({ keepScroll: false });
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
  command(name, arg) { commands[name]?.(arg); },
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
$('#status').hidden = true;
native({ type: 'ready' });
