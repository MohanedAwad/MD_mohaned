import { describe, expect, test } from 'vitest';
import { alertType, countWords, readingMinutes, slugify, splitFrontMatter, textDirection } from '../src/lib/text.js';

describe('textDirection', () => {
  test('Arabic first → rtl', () => expect(textDirection('مرحبا English')).toBe('rtl'));
  test('Latin first → ltr', () => expect(textDirection('Hello مرحبا')).toBe('ltr'));
  test('skips digits and punctuation', () => expect(textDirection('1. - (مرحبا)')).toBe('rtl'));
  test('Persian and Hebrew are rtl', () => {
    expect(textDirection('سلام')).toBe('rtl');
    expect(textDirection('שלום')).toBe('rtl');
  });
  test('no letters → null', () => expect(textDirection('123 — ٤٥٦')).toBe(null));
});

describe('slugify', () => {
  test('keeps Arabic letters', () => expect(slugify('مخطط سير العمل')).toBe('مخطط-سير-العمل'));
  test('GitHub-like for English', () => expect(slugify('Hello, World!')).toBe('hello-world'));
  test('falls back when empty', () => expect(slugify('!!!')).toBe('section'));
});

describe('splitFrontMatter', () => {
  test('reads flat keys and strips quotes', () => {
    const r = splitFrontMatter('---\ntitle: "Doc"\nauthor: أحمد\n---\n# Hi\n');
    expect(r.meta).toEqual([['title', 'Doc'], ['author', 'أحمد']]);
    expect(r.body).toBe('# Hi\n');
    expect(r.lineOffset).toBe(4);
  });
  test('no front matter', () => {
    expect(splitFrontMatter('# Hi')).toEqual({ meta: [], body: '# Hi', lineOffset: 0 });
  });
  test('a horizontal rule later is not front matter', () => {
    expect(splitFrontMatter('# Hi\n---\nx').meta).toEqual([]);
  });
});

describe('words', () => {
  test('counts Arabic and English, skips code fences', () => {
    expect(countWords('# عنوان\nهذا نص **مهم** and more\n```js\nlet a = 1;\n```')).toBe(6);
  });
  test('reading time is at least a minute', () => {
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(1000)).toBe(5);
  });
});

describe('alertType', () => {
  test('detects GitHub alerts case-insensitively', () => {
    expect(alertType('[!NOTE]\ntext')).toBe('note');
    expect(alertType('[!warning] x')).toBe('warning');
  });
  test('ignores normal quotes', () => expect(alertType('just a quote')).toBe(null));
});
