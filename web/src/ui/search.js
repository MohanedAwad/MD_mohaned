// Find in the rendered document with the CSS Custom Highlight API (no DOM changes).
export function createSearch({ bar, input, count, doc, scroller, editor }) {
  let ranges = [];
  let i = 0;

  function paint(jump) {
    CSS.highlights.delete('search');
    CSS.highlights.delete('search-current');
    if (!ranges.length) { count.textContent = input.value ? '0/0' : ''; return; }
    CSS.highlights.set('search', new Highlight(...ranges));
    CSS.highlights.set('search-current', new Highlight(ranges[i]));
    count.textContent = `${i + 1}/${ranges.length}`;
    if (!jump) return;
    const r = ranges[i].getBoundingClientRect();
    const p = scroller.getBoundingClientRect();
    if (r.top < p.top + 40 || r.bottom > p.bottom - 40) scroller.scrollTop += r.top - p.top - p.height / 3;
  }

  function run(jump) {
    ranges = [];
    const q = input.value.toLocaleLowerCase();
    if (q) {
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode());) {
        const t = n.nodeValue.toLocaleLowerCase();
        if (t.length !== n.nodeValue.length) continue;
        for (let k = t.indexOf(q); k !== -1; k = t.indexOf(q, k + q.length)) {
          const r = new Range();
          r.setStart(n, k);
          r.setEnd(n, k + q.length);
          ranges.push(r);
        }
      }
    }
    if (i >= ranges.length) i = 0;
    paint(jump);
  }

  const api = {
    get open() { return !bar.hidden; },
    show() {
      if (editor()?.hasFocus()) return editor().openSearch();
      bar.hidden = false;
      input.focus();
      input.select();
      run(true);
    },
    hide() { bar.hidden = true; CSS.highlights.delete('search'); CSS.highlights.delete('search-current'); count.textContent = ''; },
    step(d) {
      if (bar.hidden) return api.show();
      if (!ranges.length) return;
      i = (i + d + ranges.length) % ranges.length;
      paint(true);
    },
    refresh() { if (!bar.hidden) run(false); },
  };

  input.addEventListener('input', () => { i = 0; run(true); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); api.step(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') api.hide();
  });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.step) api.step(Number(b.dataset.step));
    if (b.hasAttribute('data-close')) api.hide();
  });
  return api;
}
