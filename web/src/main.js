import 'katex/dist/katex.min.css';
import './style.css';
import { render, buildOutline } from './render.js';
import { createEditor } from './editor.js';

const $ = (s) => document.querySelector(s);
const native = (msg) => window.webkit?.messageHandlers?.mdv?.postMessage(msg);
window.addEventListener('error', (e) => native({ type: 'log', message: `${e.message} @${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => native({ type: 'log', message: String(e.reason?.stack || e.reason) }));

const prefs = { theme: 'auto', outline: true, sync: true, ...(window.MDV_PREFS || {}) };
const state = { path: null, text: '', saved: '', dirty: false, editor: null, pendingDisk: null, outline: [] };
const preview = $('#preview');
const doc = $('#doc');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

const isDark = () => prefs.theme === 'dark' || (prefs.theme === 'auto' && darkQuery.matches);
function setPref(key, value) { prefs[key] = value; native({ type: 'pref', key, value }); }

function applyTheme() {
  document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
  $('#btn-theme').textContent = { auto: 'Auto', light: 'Light', dark: 'Dark' }[prefs.theme];
  state.editor?.setDark(isDark());
}

function applyLayout() {
  $('#outline').hidden = !prefs.outline;
  $('#btn-outline').setAttribute('aria-pressed', prefs.outline);
  $('#btn-sync').setAttribute('aria-pressed', prefs.sync);
  $('#btn-sync').hidden = !state.editor || $('#editor-pane').hidden;
  $('#btn-editor').setAttribute('aria-pressed', !$('#editor-pane').hidden);
}

async function refresh({ keepScroll = true } = {}) {
  $('#empty').hidden = state.path !== null;
  const y = preview.scrollTop;
  const done = await render(state.text, doc, { dark: isDark() });
  if (!done) return;
  state.outline = buildOutline(doc, $('#outline-list'));
  preview.scrollTop = keepScroll ? y : 0;
  markActiveHeading();
  if (search.open) search.run(false);
  native({ type: 'rendered' });
}

let renderTimer = 0;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => refresh(), 150);
}

function setDirty(d) {
  if (state.dirty === d) return;
  state.dirty = d;
  native({ type: 'dirty', value: d });
}

// Outline highlight follows the preview scroll position.
function markActiveHeading() {
  const top = preview.getBoundingClientRect().top + 80;
  let active = null;
  for (const it of state.outline) {
    if (it.h.getBoundingClientRect().top <= top) active = it; else break;
  }
  state.outline.forEach((it) => it.a.classList.toggle('active', it === active));
  active?.a.scrollIntoView({ block: 'nearest' });
}

// --- Sync scroll (proportional, like markdownlivepreview.com) ---
let syncLock = 0;
function syncFrom(src, dst) {
  if (!prefs.sync || $('#editor-pane').hidden || Date.now() < syncLock) return;
  const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
  syncLock = Date.now() + 60;
  dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
}
preview.addEventListener('scroll', () => {
  markActiveHeading();
  if (state.editor) syncFrom(preview, state.editor.scroller);
});

function toggleEditor(force) {
  const pane = $('#editor-pane');
  const show = force ?? pane.hidden;
  if (show && !state.editor) {
    state.editor = createEditor(pane, state.text, {
      dark: isDark(),
      onChange(text) { state.text = text; setDirty(text !== state.saved); scheduleRender(); },
      onScroll(el) { syncFrom(el, preview); },
    });
  }
  pane.hidden = !show;
  applyLayout();
  if (show) state.editor.focus();
}

// --- Find in preview (CSS Custom Highlight API: no DOM changes) ---
const search = {
  open: false, ranges: [], i: 0,
  input: $('#search-input'),
  show() {
    if (state.editor?.hasFocus()) return state.editor.openSearch();
    $('#search').hidden = false; this.open = true;
    this.input.focus(); this.input.select(); this.run(true);
  },
  hide() { $('#search').hidden = true; this.open = false; CSS.highlights.clear(); $('#search-count').textContent = ''; },
  run(jump) {
    CSS.highlights.clear();
    this.ranges = [];
    const q = this.input.value.toLocaleLowerCase();
    if (!q) { $('#search-count').textContent = ''; return; }
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const t = n.nodeValue.toLocaleLowerCase();
      if (t.length !== n.nodeValue.length) continue;
      for (let k = t.indexOf(q); k !== -1; k = t.indexOf(q, k + q.length)) {
        const r = new Range(); r.setStart(n, k); r.setEnd(n, k + q.length); this.ranges.push(r);
      }
    }
    if (this.i >= this.ranges.length) this.i = 0;
    this.paint(jump);
  },
  paint(jump) {
    const count = $('#search-count');
    if (!this.ranges.length) { count.textContent = '0/0'; return; }
    CSS.highlights.set('search', new Highlight(...this.ranges));
    CSS.highlights.set('search-current', new Highlight(this.ranges[this.i]));
    count.textContent = `${this.i + 1}/${this.ranges.length}`;
    if (jump) {
      const r = this.ranges[this.i].getBoundingClientRect();
      const p = preview.getBoundingClientRect();
      if (r.top < p.top + 40 || r.bottom > p.bottom - 40) preview.scrollTop += r.top - p.top - p.height / 3;
    }
  },
  step(d) {
    if (!this.open) return this.show();
    if (!this.ranges.length) return;
    this.i = (this.i + d + this.ranges.length) % this.ranges.length;
    this.paint(true);
  },
};
search.input.addEventListener('input', () => { search.i = 0; search.run(true); });
search.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); search.step(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') search.hide();
});
$('#search-next').onclick = () => search.step(1);
$('#search-prev').onclick = () => search.step(-1);
$('#search-close').onclick = () => search.hide();

// --- Links: anchors scroll here; everything else goes to the app ---
function onLinkClick(e) {
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
doc.addEventListener('click', onLinkClick);
$('#outline').addEventListener('click', onLinkClick);

// --- Commands (toolbar and native menu) ---
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
};
$('#btn-outline').onclick = commands.toggleOutline;
$('#btn-editor').onclick = commands.toggleEditor;
$('#btn-sync').onclick = commands.toggleSync;
$('#btn-find').onclick = commands.find;
$('#btn-copy').onclick = commands.copy;
$('#btn-pdf').onclick = commands.print;
$('#btn-theme').onclick = commands.cycleTheme;
$('#btn-open').onclick = commands.open;
darkQuery.addEventListener('change', () => { if (prefs.theme === 'auto') { applyTheme(); refresh(); } });

$('#banner-reload').onclick = () => {
  const text = state.pendingDisk;
  $('#banner').hidden = true;
  state.text = state.saved = text;
  setDirty(false);
  state.editor?.setText(text);
  refresh();
};
$('#banner-keep').onclick = () => { $('#banner').hidden = true; };

function setBase(dir) {
  const url = 'mdv://doc' + dir.split('/').map(encodeURIComponent).join('/') + '/';
  document.querySelector('base').href = url;
}

// --- API used by the Swift side ---
let printTheme = null;
window.mdv = {
  load({ path, name, text }) {
    state.path = path;
    state.text = state.saved = text;
    state.dirty = false;
    setBase(path.slice(0, path.lastIndexOf('/')));
    $('#title').textContent = name;
    document.title = name;
    state.editor?.setText(text);
    $('#banner').hidden = true;
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
    refresh();
  },
  getText: () => state.text,
  saved(text) {
    state.saved = text;
    setDirty(state.text !== text);
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
$('#empty').hidden = false;
if (window.webkit?.messageHandlers?.mdv) native({ type: 'ready' });
