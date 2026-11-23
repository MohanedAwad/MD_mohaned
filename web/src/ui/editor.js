import { EditorView, basicSetup } from 'codemirror';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { openSearchPanel } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { Vim, vim } from '@replit/codemirror-vim';

// perLineTextDirection only reads each line's dir; this sets dir="auto" so the line picks it from its text.
const autoDir = Decoration.line({ attributes: { dir: 'auto' } });
const lineDirection = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view) {
    const ranges = [];
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        ranges.push(autoDir.range(line.from));
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
  let silent = false;
  // Ex commands are global to the vim package, and this page has one editor.
  Vim.defineEx('write', 'w', () => onSave());
  Vim.defineEx('quit', 'q', () => onClose());
  Vim.defineEx('wq', 'wq', () => { onSave(); onClose(); });
  const view = new EditorView({
    parent,
    doc: text,
    extensions: [
      keys.of(vimKeys(vimMode)), // before basicSetup: vim has to see keys ahead of the default keymap
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      EditorView.perLineTextDirection.of(true),
      lineDirection,
      theme.of(dark ? oneDark : []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !silent) onChange(u.state.doc.toString());
      }),
    ],
  });
  view.scrollDOM.addEventListener('scroll', () => onScroll());

  return {
    setDark(d) { view.dispatch({ effects: theme.reconfigure(d ? oneDark : []) }); },
    setVim(on) { view.dispatch({ effects: keys.reconfigure(vimKeys(on)) }); },
    setText(t) {
      const old = view.state.doc.toString();
      if (t === old) return;
      // Only the part that differs, so the cursor and the rest of the document stay put.
      let from = 0;
      while (from < old.length && from < t.length && old[from] === t[from]) from++;
      let end = 0;
      while (end < old.length - from && end < t.length - from && old[old.length - 1 - end] === t[t.length - 1 - end]) end++;
      silent = true;
      view.dispatch({ changes: { from, to: old.length - end, insert: t.slice(from, t.length - end) } });
      silent = false;
    },
    hasFocus: () => view.hasFocus,
    focus: () => view.focus(),
    openSearch: () => openSearchPanel(view),
    /** 1-based line at the top of the editor viewport. */
    topLine() {
      const block = view.lineBlockAtHeight(view.scrollDOM.getBoundingClientRect().top - view.documentTop);
      return view.state.doc.lineAt(block.from).number;
    },
    scrollToLine(n) {
      const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines));
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
    },
  };
}
