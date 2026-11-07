// Sidebar table of contents that tracks the reading position.
export function createOutline(list, scroller) {
  let items = [];

  function markActive() {
    const top = scroller.getBoundingClientRect().top + 90;
    let active = null;
    for (const it of items) {
      if (it.h.getBoundingClientRect().top <= top) active = it;
      else break;
    }
    items.forEach((it) => it.a.classList.toggle('active', it === active));
    active?.a.scrollIntoView({ block: 'nearest' });
  }

  return {
    build(doc) {
      list.textContent = '';
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
