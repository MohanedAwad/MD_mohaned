// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { renderMarkdown } from '../src/render/markdown.js';

const blocks = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return [...div.querySelectorAll('.blk')].map((b) => [Number(b.dataset.line), b.firstElementChild?.tagName]);
};

describe('renderMarkdown', () => {
  test('tags each block with its source line', () => {
    const src = '# Title\n\nPara one\nstill one\n\n- a\n- b\n\n## Next\n';
    expect(blocks(renderMarkdown(src).html)).toEqual([[1, 'H1'], [3, 'P'], [6, 'UL'], [9, 'H2']]);
  });

  test('line numbers count the front matter', () => {
    const src = '---\ntitle: x\n---\n# Title\n\ntext\n';
    const r = renderMarkdown(src);
    expect(r.meta).toEqual([['title', 'x']]);
    expect(blocks(r.html)).toEqual([[4, 'H1'], [6, 'P']]);
  });

  test('mermaid stays as a diagram source block', () => {
    const { html } = renderMarkdown('```mermaid\nflowchart LR\n  A-->B\n```\n');
    expect(html).toContain('<pre class="mermaid">flowchart LR\n  A--&gt;B</pre>');
  });

  test('code is highlighted', () => {
    expect(renderMarkdown('```js\nconst a = 1;\n```\n').html).toContain('hljs-keyword');
  });

  test('reference links resolve across blocks', () => {
    expect(renderMarkdown('See [x][1].\n\n[1]: https://example.com\n').html).toContain('href="https://example.com"');
  });

  test('scripts are removed', () => {
    expect(renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>').html).not.toMatch(/script|onerror/);
  });
});
