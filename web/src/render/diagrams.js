import mermaid from 'mermaid';
import { icon } from '../ui/icons.js';
import { edgeEnds, nodeKey } from '../lib/diagram.js';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Arabic", "Geeza Pro", sans-serif';

const THEMES = {
  light: {
    background: '#ffffff',
    primaryColor: '#e8efff',
    primaryBorderColor: '#2563eb',
    primaryTextColor: '#0b1220',
    secondaryColor: '#f1e8ff',
    secondaryBorderColor: '#7c3aed',
    tertiaryColor: '#e7f8f0',
    tertiaryBorderColor: '#059669',
    lineColor: '#64748b',
    textColor: '#1f2328',
    edgeLabelBackground: '#ffffff',
    clusterBkg: '#f7f8fa',
    clusterBorder: '#d0d7de',
    noteBkgColor: '#fff7d6',
    noteBorderColor: '#d4a72c',
  },
  dark: {
    background: '#0f1117',
    primaryColor: '#1b2a4a',
    primaryBorderColor: '#6ea8fe',
    primaryTextColor: '#e6edf3',
    secondaryColor: '#2a2145',
    secondaryBorderColor: '#b197fc',
    tertiaryColor: '#11302a',
    tertiaryBorderColor: '#34d399',
    lineColor: '#8b949e',
    textColor: '#d6dae0',
    edgeLabelBackground: '#161b22',
    clusterBkg: '#161b22',
    clusterBorder: '#30363d',
    noteBkgColor: '#3a3214',
    noteBorderColor: '#d4a72c',
  },
};

const cache = new Map();

/** Draws every `pre.mermaid` in root. Returns false if `isCurrent()` turned false meanwhile. */
export async function renderDiagrams(root, dark, isCurrent) {
  const nodes = [...root.querySelectorAll('pre.mermaid')];
  if (!nodes.length) return true;
  const mode = dark ? 'dark' : 'light';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: FONT,
    themeVariables: { ...THEMES[mode], fontFamily: FONT, darkMode: dark },
    flowchart: { curve: 'basis', padding: 14 },
  });
  for (const [i, el] of nodes.entries()) {
    const src = el.textContent;
    const key = `${mode}\n${src}`;
    let svg = cache.get(key);
    if (!svg) {
      const id = `mmd-${Date.now()}-${i}`;
      try {
        ({ svg } = await mermaid.render(id, src));
        if (cache.size > 200) cache.clear();
        cache.set(key, svg);
      } catch (err) {
        document.getElementById('d' + id)?.remove();
        if (!isCurrent()) return false;
        el.classList.add('mermaid-error');
        el.textContent = 'Mermaid: ' + (err?.message || err);
        continue;
      }
    }
    if (!isCurrent()) return false;
    el.innerHTML = `<div class="mermaid-scroll">${svg}</div><button class="mermaid-expand" data-tip="Enlarge · scroll to zoom · drag to pan">${icon('expand')}</button>`;
  }
  return true;
}

/**
 * Flowcharts: pressing a box keeps it, its arrows and the boxes they reach bright and dims the rest.
 * Pressing the same box again, or anywhere else in the diagram, clears it.
 */
export function focusBox(svg, box) {
  const again = box?.classList.contains('mmd-picked');
  svg.classList.remove('mmd-focus');
  svg.querySelectorAll('.mmd-on, .mmd-picked').forEach((el) => el.classList.remove('mmd-on', 'mmd-picked'));
  if (!box || again) return;
  const picked = nodeKey(box.id);
  const boxes = new Map([...svg.querySelectorAll('g.node')].map((n) => [nodeKey(n.id), n]));
  const ids = new Set([...boxes.keys(), ...[...svg.querySelectorAll('g.cluster')].map((c) => c.id)]);
  box.classList.add('mmd-on', 'mmd-picked');
  // Arrows and their labels are drawn in the same order inside each (possibly nested) graph.
  for (const paths of svg.querySelectorAll('g.edgePaths')) {
    const arrows = [...paths.children];
    const labels = [...(paths.parentElement.querySelector(':scope > g.edgeLabels')?.children || [])];
    arrows.forEach((arrow, i) => {
      const ends = edgeEnds(arrow.id, ids);
      if (!ends || !ends.includes(picked)) return;
      arrow.classList.add('mmd-on');
      if (labels.length === arrows.length) labels[i].classList.add('mmd-on');
      for (const end of ends) boxes.get(end)?.classList.add('mmd-on');
    });
  }
  svg.classList.add('mmd-focus');
}

/** Full-window view of one diagram: wheel or +/- to zoom, drag to pan, Esc to close. */
export function openLightbox(svg) {
  const box = document.createElement('div');
  box.id = 'lightbox';
  box.innerHTML = '<div class="lb-stage"></div><div class="lb-bar"><button data-z="-1" data-tip="Zoom out" data-keys="−">−</button><button data-z="0" data-tip="Fit" data-keys="0">Fit</button><button data-z="1" data-tip="Zoom in" data-keys="+">+</button><button data-close data-tip="Close" data-keys="Esc">✕</button></div>';
  const stage = box.querySelector('.lb-stage');
  const clone = svg.cloneNode(true);
  clone.removeAttribute('style');
  clone.setAttribute('width', '100%');
  clone.setAttribute('height', '100%');
  stage.append(clone);
  let scale = 1, x = 0, y = 0, drag = null;
  const apply = () => { clone.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };
  const zoom = (d) => { scale = d === 0 ? 1 : Math.min(8, Math.max(0.3, scale * (d > 0 ? 1.25 : 0.8))); if (d === 0) x = y = 0; apply(); };
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === '+' || e.key === '=') zoom(1);
    if (e.key === '-') zoom(-1);
    if (e.key === '0') zoom(0);
  };
  box.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  stage.addEventListener('pointerdown', (e) => { drag = { sx: e.clientX - x, sy: e.clientY - y }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => { if (drag) { x = e.clientX - drag.sx; y = e.clientY - drag.sy; apply(); } });
  stage.addEventListener('pointerup', () => { drag = null; });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.z !== undefined) zoom(Number(b.dataset.z));
    if (b?.hasAttribute('data-close')) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(box);
}
