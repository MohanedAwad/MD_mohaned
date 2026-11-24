import { EditorView, basicSetup } from 'codemirror';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { openSearchPanel } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { Vim, vim } from '@replit/codemirror-vim';

// Nested syntax highlighting for fenced code blocks inside Markdown.
const codeLanguages = [
  LanguageDescription.of({ name: 'JavaScript', alias: ['js', 'mjs', 'cjs', 'jsx'], support: javascript({ jsx: true }) }),
  LanguageDescription.of({ name: 'TypeScript', alias: ['ts', 'mts', 'cts', 'tsx'], support: javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: 'JSON', alias: ['json', 'jsonc'], support: javascript() }),
  LanguageDescription.of({ name: 'HTML', alias: ['html', 'htm', 'xml', 'svg'], support: html() }),
  LanguageDescription.of({ name: 'CSS', alias: ['css', 'scss', 'less'], support: css() }),
];

// Code-editor themes tuned to match MD Viewer's dark and light palettes.
const darkUi = EditorView.theme({
  '&': {
    color: '#d5dae3',
    backgroundColor: '#0d1017',
  },
  '.cm-content': {
    caretColor: '#6ea8fe',
    padding: '12px 0 64px',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#6ea8fe',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(110, 168, 254, 0.24)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(110, 168, 254, 0.07)',
  },
  '.cm-gutters': {
    backgroundColor: '#11151e',
    color: '#4e596e',
    borderRight: '1px solid #1e2430',
    paddingRight: '4px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '38px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(110, 168, 254, 0.1)',
    color: '#9ec5fe',
    fontWeight: '600',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#1c2333',
    border: '1px solid #2d3748',
    color: '#8a94a6',
    borderRadius: '4px',
    padding: '0 6px',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'rgba(110, 168, 254, 0.22)',
    outline: '1px solid rgba(110, 168, 254, 0.45)',
    borderRadius: '2px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(251, 191, 36, 0.25)',
    outline: '1px solid rgba(251, 191, 36, 0.5)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(251, 191, 36, 0.48)',
  },
  '.cm-panels': {
    backgroundColor: '#131822',
    color: '#d5dae3',
    borderColor: '#242b38',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid #242b38',
  },
  '.cm-panel.cm-search': {
    padding: '6px 10px',
    fontFamily: 'var(--font)',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    borderRadius: '6px',
    border: '1px solid #2a3242',
    backgroundColor: '#0d1017',
    color: '#d5dae3',
  },
  '.cm-fat-cursor': {
    backgroundColor: '#6ea8fe !important',
    color: '#0d1017 !important',
    borderRadius: '1px',
  },
  '&:not(.cm-focused) .cm-fat-cursor': {
    backgroundColor: 'transparent !important',
    outline: '1px solid rgba(110, 168, 254, 0.7) !important',
    color: 'inherit !important',
  },
}, { dark: true });

const darkHighlight = HighlightStyle.define([
  { tag: t.heading1, color: '#79c0ff', fontWeight: '700', fontSize: '1.18em' },
  { tag: t.heading2, color: '#8ab4f8', fontWeight: '700', fontSize: '1.1em' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: '#d2a8ff', fontWeight: '650' },
  { tag: t.heading, color: '#79c0ff', fontWeight: '700' },
  { tag: t.strong, color: '#f4f6fb', fontWeight: '700' },
  { tag: t.emphasis, color: '#e2c08d', fontStyle: 'italic' },
  { tag: t.strikethrough, color: '#6e7681', textDecoration: 'line-through' },
  { tag: t.quote, color: '#8b949e', fontStyle: 'italic' },
  { tag: t.link, color: '#6ea8fe', textDecoration: 'underline' },
  { tag: t.url, color: '#58a6ff' },
  { tag: t.monospace, color: '#7ee787' },
  { tag: t.processingInstruction, color: '#7c8ba1' },
  { tag: [t.contentSeparator, t.punctuation], color: '#6e7b91' },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: '#ff7b72' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#a5d6ff' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#79c0ff' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#d2a8ff' },
  { tag: [t.variableName, t.attributeName], color: '#ffa657' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: '#79c0ff' },
  { tag: [t.typeName, t.className, t.tagName, t.namespace], color: '#7ee787' },
  { tag: [t.operator, t.compareOperator, t.logicOperator], color: '#ff7b72' },
  { tag: [t.comment, t.meta], color: '#6e7681', fontStyle: 'italic' },
  { tag: t.invalid, color: '#f87171', textDecoration: 'underline wavy' },
]);

const lightUi = EditorView.theme({
  '&': {
    color: '#24292f',
    backgroundColor: '#ffffff',
  },
  '.cm-content': {
    caretColor: '#2563eb',
    padding: '12px 0 64px',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#2563eb',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(37, 99, 235, 0.16)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(37, 99, 235, 0.055)',
  },
  '.cm-gutters': {
    backgroundColor: '#f7f8fc',
    color: '#8c959f',
    borderRight: '1px solid #e5e8f0',
    paddingRight: '4px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '38px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
    color: '#2563eb',
    fontWeight: '600',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#eef0f6',
    border: '1px solid #d8dde8',
    color: '#5f6b7a',
    borderRadius: '4px',
    padding: '0 6px',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'rgba(37, 99, 235, 0.14)',
    outline: '1px solid rgba(37, 99, 235, 0.35)',
    borderRadius: '2px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(245, 158, 11, 0.25)',
    outline: '1px solid rgba(245, 158, 11, 0.5)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(245, 158, 11, 0.5)',
  },
  '.cm-panels': {
    backgroundColor: '#f6f7fb',
    color: '#24292f',
    borderColor: '#e2e5ee',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid #e2e5ee',
  },
  '.cm-panel.cm-search': {
    padding: '6px 10px',
    fontFamily: 'var(--font)',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    borderRadius: '6px',
    border: '1px solid #d6dbe6',
    backgroundColor: '#ffffff',
    color: '#24292f',
  },
  '.cm-fat-cursor': {
    backgroundColor: '#2563eb !important',
    color: '#ffffff !important',
    borderRadius: '1px',
  },
  '&:not(.cm-focused) .cm-fat-cursor': {
    backgroundColor: 'transparent !important',
    outline: '1px solid rgba(37, 99, 235, 0.6) !important',
    color: 'inherit !important',
  },
}, { dark: false });

const lightHighlight = HighlightStyle.define([
  { tag: t.heading1, color: '#0550ae', fontWeight: '700', fontSize: '1.18em' },
  { tag: t.heading2, color: '#1d4ed8', fontWeight: '700', fontSize: '1.1em' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: '#7c3aed', fontWeight: '650' },
  { tag: t.heading, color: '#0550ae', fontWeight: '700' },
  { tag: t.strong, color: '#0b1220', fontWeight: '700' },
  { tag: t.emphasis, color: '#953800', fontStyle: 'italic' },
  { tag: t.strikethrough, color: '#6e7781', textDecoration: 'line-through' },
  { tag: t.quote, color: '#5f6b7a', fontStyle: 'italic' },
  { tag: t.link, color: '#2563eb', textDecoration: 'underline' },
  { tag: t.url, color: '#0969da' },
  { tag: t.monospace, color: '#116329' },
  { tag: t.processingInstruction, color: '#768390' },
  { tag: [t.contentSeparator, t.punctuation], color: '#6e7781' },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: '#cf222e' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#0a3069' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#0550ae' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#8250df' },
  { tag: [t.variableName, t.attributeName], color: '#953800' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: '#0550ae' },
  { tag: [t.typeName, t.className, t.tagName, t.namespace], color: '#116329' },
  { tag: [t.operator, t.compareOperator, t.logicOperator], color: '#cf222e' },
  { tag: [t.comment, t.meta], color: '#6e7781', fontStyle: 'italic' },
  { tag: t.invalid, color: '#dc2626', textDecoration: 'underline wavy' },
]);

const editorTheme = (dark) => (dark ? [darkUi, syntaxHighlighting(darkHighlight)] : [lightUi, syntaxHighlighting(lightHighlight)]);

// perLineTextDirection only reads each line's dir; this sets dir="auto" so the line picks it from its text.
// Tracks lastFrom so adjacent visibleRanges touching the same line never add duplicate decorations.
const autoDir = Decoration.line({ attributes: { dir: 'auto' } });
const lineDirection = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view) {
    const ranges = [];
    let lastFrom = -1;
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        if (line.from > lastFrom) {
          ranges.push(autoDir.range(line.from));
          lastFrom = line.from;
        }
        pos = line.to + 1;
      }
    }
    return Decoration.set(ranges);
  }
}, { decorations: (p) => p.decorations });

// Vim keys with the mode shown under the editor (also where `:` commands are typed).
const vimKeys = (on) => (on ? vim({ status: true }) : []);

export function createEditor(parent, text, { dark, vimMode, onChange, onScroll, onSave, onClose }) {
  const theme = new Compartment();
  const keys = new Compartment();
  let isDark = Boolean(dark);
  let isVim = Boolean(vimMode);
  let silent = false;
  let scrollRaf = 0;

  // Ex commands are global to the vim package, and this page has one editor.
  Vim.defineEx('write', 'w', () => onSave());
  Vim.defineEx('quit', 'q', () => onClose());
  Vim.defineEx('wq', 'wq', () => { onSave(); onClose(); });
  Vim.defineEx('xit', 'x', () => { onSave(); onClose(); });

  const makeExtensions = () => [
    keys.of(vimKeys(isVim)), // before basicSetup: vim has to see keys ahead of the default keymap
    basicSetup,
    markdown({ codeLanguages }),
    EditorView.lineWrapping,
    EditorView.perLineTextDirection.of(true),
    lineDirection,
    theme.of(editorTheme(isDark)),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !silent) onChange(u.state.doc.toString());
    }),
  ];

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: text, extensions: makeExtensions() }),
  });

  const handleScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      onScroll();
    });
  };
  view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });

  return {
    setDark(d) {
      isDark = Boolean(d);
      view.dispatch({ effects: theme.reconfigure(editorTheme(isDark)) });
    },
    setVim(on) {
      isVim = Boolean(on);
      view.dispatch({ effects: keys.reconfigure(vimKeys(isVim)) });
    },
    /** Replaces the whole editor state (new file / clear): wipes undo history and resets Vim to NORMAL. */
    reset(t) {
      silent = true;
      view.setState(EditorState.create({ doc: t, extensions: makeExtensions() }));
      silent = false;
    },
    /** Minimal diff update for external disk / diagram edits on the same file. */
    setText(t) {
      const old = view.state.doc.toString();
      if (t === old) return;
      let from = 0;
      while (from < old.length && from < t.length && old[from] === t[from]) from++;
      let end = 0;
      while (end < old.length - from && end < t.length - from && old[old.length - 1 - end] === t[t.length - 1 - end]) end++;
      silent = true;
      view.dispatch({ changes: { from, to: old.length - end, insert: t.slice(from, t.length - end) } });
      silent = false;
    },
    measure() { view.requestMeasure(); },
    hasFocus: () => view.hasFocus,
    focus: () => view.focus(),
    openSearch: () => openSearchPanel(view),
    /** 1-based line at the top of the editor viewport. */
    topLine() {
      if (!view.state.doc.lines || !view.scrollDOM.clientHeight) return 1;
      const y = Math.max(0, view.scrollDOM.getBoundingClientRect().top - view.documentTop);
      const block = view.lineBlockAtHeight(Number.isFinite(y) ? y : 0);
      return view.state.doc.lineAt(block.from).number;
    },
    scrollToLine(n, { moveCursor = false } = {}) {
      if (!view.state.doc.lines) return;
      const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines));
      const spec = { effects: EditorView.scrollIntoView(line.from, { y: 'start' }) };
      if (moveCursor) spec.selection = { anchor: line.from };
      view.dispatch(spec);
    },
    destroy() {
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      view.destroy();
    },
  };
}
