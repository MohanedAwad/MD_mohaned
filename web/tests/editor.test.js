// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { EditorView } from '@codemirror/view';
import { Vim, getCM } from '@replit/codemirror-vim';
import { createEditor } from '../src/ui/editor.js';

// jsdom has no layout; CodeMirror only needs these to exist when it measures.
const noRects = () => [];
const zeroRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
Range.prototype.getClientRects ||= noRects;
Range.prototype.getBoundingClientRect ||= zeroRect;

function mount(vimMode) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const calls = [];
  const editor = createEditor(parent, 'one\ntwo\n', {
    dark: false,
    vimMode,
    onChange: (text) => calls.push(['change', text]),
    onScroll() {},
    onSave: () => calls.push(['save']),
    onClose: () => calls.push(['close']),
  });
  const view = EditorView.findFromDOM(parent.querySelector('.cm-editor'));
  return { parent, editor, view, calls };
}

afterEach(() => { document.body.innerHTML = ''; });

// These prove the vim package really calls the hooks the editor relies on.
describe('editor vim mode', () => {
  test('normal-mode keys edit the document', () => {
    const { view, calls } = mount(true);
    const cm = getCM(view);
    Vim.handleKey(cm, 'd', 'user');
    Vim.handleKey(cm, 'd', 'user');
    expect(view.state.doc.toString()).toBe('two\n');
    expect(calls).toEqual([['change', 'two\n']]);
  });

  // Typed keys, as the browser delivers them. Undo needs the editor's history, which only works
  // when there is a single copy of @codemirror/state in the build (two copies drop it silently).
  const type = (view, ...keys) => {
    for (const k of keys) {
      const ctrl = k.startsWith('C-');
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: ctrl ? k.slice(2) : k, ctrlKey: ctrl, bubbles: true, cancelable: true }));
    }
  };

  test('u undoes and Ctrl-R redoes', () => {
    const { view } = mount(true);
    type(view, 'd', 'd');
    expect(view.state.doc.toString()).toBe('two\n');
    type(view, 'u');
    expect(view.state.doc.toString()).toBe('one\ntwo\n');
    type(view, 'C-r');
    expect(view.state.doc.toString()).toBe('two\n');
    type(view, 'u');
    expect(view.state.doc.toString()).toBe('one\ntwo\n');
  });

  test('everyday normal- and visual-mode commands work', () => {
    const { view } = mount(true);
    const text = () => view.state.doc.toString();
    type(view, 'y', 'y', 'p');
    expect(text()).toBe('one\none\ntwo\n');
    type(view, 'x');
    expect(text()).toBe('one\nne\ntwo\n');
    type(view, 'g', 'g', 'J');
    expect(text()).toBe('one ne\ntwo\n');
    type(view, '>', '>');
    expect(text()).toBe('  one ne\ntwo\n');
    type(view, 'V', 'd'); // visual line, then delete it
    expect(text()).toBe('two\n');
    type(view, 'd', 'w');
    expect(text()).toBe('\n');
    type(view, 'u', 'u', 'u', 'u', 'u', 'u');
    expect(text()).toBe('one\ntwo\n');
    type(view, 'i');
    expect(getCM(view).state.vim.insertMode).toBe(true);
    type(view, 'Escape');
    expect(getCM(view).state.vim.insertMode).toBe(false);
  });

  test(':w saves, :q closes the editor, :wq does both', () => {
    const { view, calls } = mount(true);
    const cm = getCM(view);
    Vim.handleEx(cm, 'w');
    expect(calls).toEqual([['save']]);
    Vim.handleEx(cm, 'q');
    expect(calls).toEqual([['save'], ['close']]);
    Vim.handleEx(cm, 'wq');
    expect(calls).toEqual([['save'], ['close'], ['save'], ['close']]);
  });

  test('shows the mode under the editor, and turning vim off removes it', () => {
    const { parent, editor } = mount(true);
    expect(parent.querySelector('.cm-vim-panel')?.textContent).toContain('NORMAL');
    editor.setVim(false);
    expect(parent.querySelector('.cm-vim-panel')).toBeNull();
    editor.setVim(true);
    expect(parent.querySelector('.cm-vim-panel')?.textContent).toContain('NORMAL');
  });

  test('without vim mode there is no vim layer', () => {
    const { parent, view } = mount(false);
    expect(parent.querySelector('.cm-vim-panel')).toBeNull();
    expect(view.scrollDOM.classList.contains('cm-vimMode')).toBe(false);
  });
});
