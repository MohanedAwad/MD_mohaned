// Hover label with the command name and its shortcut, for anything with
// data-cmd (looked up in the command list) or data-tip / data-keys.
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function installTooltips(resolve) {
  const tip = document.createElement('div');
  tip.id = 'tooltip';
  tip.hidden = true;
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  let target = null;
  let timer = 0;

  function hide() {
    clearTimeout(timer);
    tip.hidden = true;
    target = null;
  }

  function show(el) {
    const { label, keys } = resolve(el);
    if (!label || !el.isConnected) return;
    tip.innerHTML = `<span>${escapeHtml(label)}</span>${keys ? `<kbd>${escapeHtml(keys)}</kbd>` : ''}`;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const below = r.bottom + 8 + t.height < innerHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? r.bottom + 8 : r.top - t.height - 8}px`;
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-cmd], [data-tip]');
    if (el === target) return;
    hide();
    if (!el) return;
    target = el;
    timer = setTimeout(() => show(el), 350);
  });
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  return { hide };
}
