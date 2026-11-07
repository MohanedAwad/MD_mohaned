import { EditorView, basicSetup } from 'codemirror';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { openSearchPanel } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';

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

export function createEditor(parent, text, { dark, onChange, onScroll }) {
  const theme = new Compartment();
  let silent = false;
  const view = new EditorView({
    parent,
    doc: text,
    extensions: [
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
  view.scrollDOM.addEventListener('scroll', () => onScroll(view.scrollDOM));

  return {
    scroller: view.scrollDOM,
    setDark(d) { view.dispatch({ effects: theme.reconfigure(d ? oneDark : []) }); },
    setText(t) {
      if (t === view.state.doc.toString()) return;
      silent = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
      silent = false;
    },
    hasFocus() { return view.hasFocus; },
    focus() { view.focus(); },
    openSearch() { openSearchPanel(view); },
  };
}
