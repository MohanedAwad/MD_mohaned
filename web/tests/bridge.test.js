import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { docBaseHref, normalizePath } from '../src/lib/bridge.js';
import { formatKeys } from '../src/lib/fuzzy.js';

const require = createRequire(import.meta.url);
const { findReadme, findRoot, isMarkdownFile, scanWorkspace } = require('../../windows/lib/workspace.cjs');
const { createPrefsStore } = require('../../windows/lib/prefs.cjs');

describe('cross-platform bridge & shortcuts', () => {
  test('normalizePath converts Windows backslashes', () => {
    expect(normalizePath('C:\\Users\\docs\\README.md')).toBe('C:/Users/docs/README.md');
  });

  test('docBaseHref encodes macOS and Windows paths cleanly', () => {
    expect(docBaseHref('/Users/me/My Docs')).toBe('mdv://doc/Users/me/My%20Docs/');
    expect(docBaseHref('C:\\Users\\My Docs\\notes')).toBe('mdv://doc/C%3A/Users/My%20Docs/notes/');
  });

  test('formatKeys formats macOS and Windows shortcuts', () => {
    expect(formatKeys('cmd+shift+p', false)).toBe('⇧⌘P');
    expect(formatKeys('cmd+shift+p', true)).toBe('Ctrl+Shift+P');
    expect(formatKeys('cmd+alt+o', true)).toBe('Ctrl+Alt+O');
  });
});

describe('Windows host helpers', () => {
  test('workspace scan finds markdown files, skips build folders, and finds README', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-win-'));
    try {
      fs.mkdirSync(path.join(tmp, '.git'));
      fs.mkdirSync(path.join(tmp, 'docs'));
      fs.mkdirSync(path.join(tmp, 'node_modules', 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'README.md'), '# hi');
      fs.writeFileSync(path.join(tmp, 'docs', 'guide.md'), '# guide');
      fs.writeFileSync(path.join(tmp, 'node_modules', 'pkg', 'ignored.md'), '# nope');

      const files = await scanWorkspace(tmp);
      expect(files).toEqual(['docs/guide.md', 'README.md']);
      expect(findRoot(path.join(tmp, 'docs', 'guide.md'))).toBe(tmp);
      expect(findReadme(tmp, files)).toBe(path.join(tmp, 'README.md'));
      expect(isMarkdownFile('note.mdx')).toBe(true);
      expect(isMarkdownFile('image.png')).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('prefs store persists web keys, recents, and last session', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-prefs-'));
    const file = path.join(tmp, 'prefs.json');
    try {
      const store = createPrefsStore(file);
      store.setFromWeb('theme', 'dark');
      store.setFromWeb('unknownKey', 'ignored');
      store.noteRecent(tmp);
      store.setLastSession(tmp, path.join(tmp, 'a.md'));

      const reloaded = createPrefsStore(file);
      expect(reloaded.web).toEqual({ theme: 'dark' });
      expect(reloaded.recents).toEqual([tmp]);
      expect(reloaded.lastSession).toEqual({ workspace: tmp, file: path.join(tmp, 'a.md') });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
