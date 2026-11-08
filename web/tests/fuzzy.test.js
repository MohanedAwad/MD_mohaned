import { describe, expect, test } from 'vitest';
import { formatKeys, fuzzyFilter, fuzzyScore } from '../src/lib/fuzzy.js';

describe('fuzzyScore', () => {
  test('letters in order match', () => expect(fuzzyScore('rdm', 'README.md')).not.toBe(null));
  test('out of order does not', () => expect(fuzzyScore('mdr', 'readme')).toBe(null));
  test('works with Arabic', () => expect(fuzzyScore('دلي', 'دليل المشروع')).not.toBe(null));
});

describe('fuzzyFilter', () => {
  test('word starts and consecutive letters rank first', () => {
    const files = ['docs/guide/setup.md', 'src/sample/textup.md', 'setup.md'];
    expect(fuzzyFilter('setup', files).map((r) => r.item)[0]).toBe('setup.md');
  });
  test('empty query keeps order', () => {
    expect(fuzzyFilter('', ['b', 'a']).map((r) => r.item)).toEqual(['b', 'a']);
  });
});

describe('formatKeys', () => {
  test('macOS modifier order', () => expect(formatKeys('cmd+shift+p')).toBe('⇧⌘P'));
  test('option and ctrl', () => expect(formatKeys('ctrl+alt+tab')).toBe('⌃⌥⇥'));
  test('empty', () => expect(formatKeys('')).toBe(''));
});
