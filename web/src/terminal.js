// The terminal panel (⌃`): xterm.js draws, the Swift side owns the shell.
// Swift → page: mdvTerm.write(base64), mdvTerm.setTheme(dark), mdvTerm.focus(), mdvTerm.text().
// Page → Swift: { type: 'ready' | 'input' | 'resize' | 'toggle' } on the `term` message handler.
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const native = (msg) => window.webkit?.messageHandlers?.term?.postMessage(msg);

// Same surfaces as styles/theme.css; ANSI colours chosen to stay readable on each background.
const THEMES = {
  light: {
    background: '#ffffff', foreground: '#24292f', cursor: '#2563eb', cursorAccent: '#ffffff', selectionBackground: '#c7d7fb',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#7d4e00', blue: '#0550ae', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#0969da', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
  },
  dark: {
    background: '#0f1117', foreground: '#d5dae3', cursor: '#6ea8fe', cursorAccent: '#0f1117', selectionBackground: '#2b3f66',
    black: '#484f58', red: '#ff7b72', green: '#7ee787', yellow: '#d29922', blue: '#6ea8fe', magenta: '#b197fc', cyan: '#39c5cf', white: '#b1bac4',
    brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f4f6fb',
  },
};

const style = document.createElement('style');
style.textContent = 'html, body { height: 100%; margin: 0; overflow: hidden; } #term { position: absolute; inset: 6px 4px 4px 10px; }';
document.head.append(style);

const term = new Terminal({
  fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
  fontSize: 13,
  lineHeight: 1.2,
  scrollback: 10000,
  cursorBlink: true,
  theme: THEMES.light,
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('term'));

const refit = () => { try { fit.fit(); } catch { /* not laid out yet */ } };
// ⌃` belongs to the app (hide the panel), not to the shell.
term.attachCustomKeyEventHandler((e) => {
  if (!(e.ctrlKey && e.code === 'Backquote')) return true;
  if (e.type === 'keydown') { e.preventDefault(); native({ type: 'toggle' }); }
  return false;
});
term.onData((data) => native({ type: 'input', data }));
term.onResize(({ cols, rows }) => native({ type: 'resize', cols, rows }));
new ResizeObserver(refit).observe(document.body);

window.mdvTerm = {
  write(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    term.write(bytes);
  },
  setTheme(dark) {
    const theme = THEMES[dark ? 'dark' : 'light'];
    term.options.theme = theme;
    document.body.style.background = theme.background;
  },
  focus: () => term.focus(),
  /** What is on screen and in the scrollback, as plain text (used by the app's snapshot check). */
  text() {
    const buffer = term.buffer.active;
    const lines = [];
    for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i).translateToString(true));
    return lines.join('\n').trimEnd();
  },
};

refit();
native({ type: 'ready', cols: term.cols, rows: term.rows });
