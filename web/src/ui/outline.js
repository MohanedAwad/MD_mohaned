// Sidebar table of contents that tracks the reading position.
export function createOutline(list, scroller) {
  let items = [];
  let current = null;

  function markActive() {
    if (!items.length) return;
    const top = scroller.getBoundingClientRect().top + 90;
    // Binary search for the last heading at or above `top`.
    let lo = 0;
    let hi = items.length - 1;
    let active = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].h.getBoundingClientRect().top <= top) {
        active = items[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (active === current) return;
    current?.a.classList.remove('active');
    current = active;
    if (active) {
      active.a.classList.add('active');
      active.a.scrollIntoView({ block: 'nearest' });
    }
  }

  return {
    build(doc) {
      list.textContent = '';
      current = null;
      items = [...doc.querySelectorAll('h1,h2,h3,h4')].map((h) => {
        const a = document.createElement('a');
        a.href = '#' + h.id;
        a.textContent = h.textContent;
        a.className = 'lvl' + h.tagName[1];
        a.dir = 'auto';
        list.append(a);
        return { h, a };
      });
      if (!items.length) list.innerHTML = '<p class="outline-empty">No headings</p>';
      markActive();
    },
    markActive,
    get count() { return items.length; },
  };
}
