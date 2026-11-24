import { icon } from '../ui/icons.js';
import { edgeEnds, nodeKey } from '../lib/diagram.js';

let mermaidPromise = null;
const loadMermaid = () => (mermaidPromise ??= import('mermaid').then((m) => m.default));
let initializedMode = null;

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
// What the reader did to a diagram (zoom, scroll, picked box), by its source, so it survives the
// redraw that follows every edit and save.
const views = new Map();
const sources = new WeakMap();
const MAX_ZOOM = 8;
const viewOf = (pre) => {
  const src = sources.get(pre);
  if (!views.has(src)) { if (views.size > 200) views.clear(); views.set(src, { zoom: 1, x: 0, y: 0, picked: null }); }
  return views.get(src);
};
const parts = (pre) => {
  const scroller = pre.querySelector('.mermaid-scroll');
  return { scroller, svg: scroller?.firstElementChild };
};

/** Mermaid's settings for the current theme; returns the theme name. */
async function setup(dark) {
  const mermaid = await loadMermaid();
  const mode = dark ? 'dark' : 'light';
  if (initializedMode !== mode) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: FONT,
      themeVariables: { ...THEMES[mode], fontFamily: FONT, darkMode: dark },
      flowchart: { curve: 'basis', padding: 14 },
    });
    initializedMode = mode;
  }
  return { mermaid, mode };
}

let renders = 0;
/** One diagram's SVG markup, for the diagram editor. Throws mermaid's error for code it cannot draw. */
export async function renderSvg(src, dark) {
  const { mermaid } = await setup(dark);
  const id = `mmd-edit-${++renders}`;
  try {
    return (await mermaid.render(id, src)).svg;
  } catch (err) {
    document.getElementById('d' + id)?.remove();
    throw err;
  }
}

/** The code a drawn diagram came from. */
export const diagramSource = (pre) => sources.get(pre);

/** Draws every `pre.mermaid` in root. Returns false if `isCurrent()` turned false meanwhile. */
export async function renderDiagrams(root, dark, isCurrent, { force = false } = {}) {
  const nodes = [...root.querySelectorAll('pre.mermaid')];
  if (!nodes.length) return true;
  const mode = dark ? 'dark' : 'light';
  let mermaid = null;
  for (const [i, el] of nodes.entries()) {
    // Incremental DOM patch preserved an already-rendered diagram for the same theme.
    if (!force && el.querySelector('.mermaid-scroll')) continue;
    const src = sources.get(el) ?? el.textContent;
    const key = `${mode}\n${src}`;
    let svg = cache.get(key);
    if (!svg) {
      if (!mermaid) ({ mermaid } = await setup(dark));
      if (!isCurrent()) return false;
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
    el.classList.remove('mermaid-error');
    el.innerHTML = `<div class="mermaid-scroll">${svg}</div><div class="mermaid-tools"><button data-zoom="0.8" data-tip="Zoom out">−</button><button data-zoom="1.25" data-tip="Zoom in" data-keys="pinch or ⌘-scroll">+</button><button class="mermaid-expand" data-tip="Full window">${icon('expand')}</button></div>`;
    // Flowcharts can be edited by hand: add, rename and delete boxes and arrows.
    if (el.querySelector('svg')?.getAttribute('aria-roledescription')?.startsWith('flowchart')) {
      el.querySelector('.mermaid-tools').insertAdjacentHTML('afterbegin', `<button class="mermaid-edit" data-tip="Edit diagram">${icon('editor')}</button>`);
    }
    sources.set(el, src);
    restoreView(el);
  }
  return true;
}

function applyZoom(pre, view) {
  const { scroller } = parts(pre);
  // The box keeps the size it had at fit; a zoomed diagram scrolls inside it.
  if (view.zoom > 1 && !scroller.style.height) scroller.style.height = `${scroller.offsetHeight}px`;
  if (view.zoom === 1) scroller.style.height = '';
  scroller.style.setProperty('--dz', view.zoom);
  pre.classList.toggle('zoomed', view.zoom > 1);
}

function restoreView(pre) {
  const { scroller, svg } = parts(pre);
  // Mermaid's inline max-width is the diagram's natural size; the styles need it as a number.
  if (svg.style.maxWidth) scroller.style.setProperty('--natural', svg.style.maxWidth);
  const view = viewOf(pre);
  if (view.zoom > 1) { applyZoom(pre, view); scroller.scrollLeft = view.x; scroller.scrollTop = view.y; }
  if (view.picked) {
    const box = [...svg.querySelectorAll('g.node')].find((n) => nodeKey(n.id) === view.picked);
    if (box) focusBox(svg, box); else view.picked = null;
  }
}

/** Zooms one diagram inside its box, keeping the point `at` (client x/y; default the centre) still. */
export function zoomDiagram(pre, factor, at) {
  const { scroller, svg } = parts(pre);
  if (!svg) return;
  const view = viewOf(pre);
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * factor));
  if (zoom === view.zoom) return;
  const frame = scroller.getBoundingClientRect();
  const point = at || { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
  const before = svg.getBoundingClientRect();
  const fx = (point.x - before.left) / before.width;
  const fy = (point.y - before.top) / before.height;
  view.zoom = zoom;
  applyZoom(pre, view);
  const after = svg.getBoundingClientRect();
  scroller.scrollLeft += after.left + fx * after.width - point.x;
  scroller.scrollTop += after.top + fy * after.height - point.y;
  view.x = scroller.scrollLeft;
  view.y = scroller.scrollTop;
}

/**
 * Mouse and trackpad inside a diagram: pinch or ⌘/⌃-scroll zooms at the pointer, and dragging the
 * background pans once it is zoomed. Plain scrolling is left alone so the page still scrolls past.
 */
export function installDiagramGestures(root) {
  const diagramAt = (e) => (e.target.closest ? e.target.closest('pre.mermaid:not(.mermaid-error)') : null);

  root.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const pre = diagramAt(e);
    if (!pre) return;
    e.preventDefault();
    zoomDiagram(pre, Math.exp(Math.max(-40, Math.min(40, -e.deltaY)) * 0.01), { x: e.clientX, y: e.clientY });
  }, { passive: false });

  // Trackpad pinch (WebKit gesture events; `scale` is relative to the start of the pinch).
  let pinch = null;
  root.addEventListener('gesturestart', (e) => {
    const pre = diagramAt(e);
    if (!pre) return;
    e.preventDefault();
    pinch = { pre, last: 1 };
  });
  root.addEventListener('gesturechange', (e) => {
    if (!pinch) return;
    e.preventDefault();
    zoomDiagram(pinch.pre, e.scale / pinch.last, { x: e.clientX, y: e.clientY });
    pinch.last = e.scale;
  });
  root.addEventListener('gestureend', () => { pinch = null; });

  // Remember where a zoomed diagram was scrolled to (scroll does not bubble, hence capture).
  root.addEventListener('scroll', (e) => {
    const scroller = e.target;
    if (!scroller.classList?.contains('mermaid-scroll')) return;
    const view = viewOf(scroller.parentElement);
    view.x = scroller.scrollLeft;
    view.y = scroller.scrollTop;
  }, true);

  // Drag the background of a zoomed diagram to pan. Drags that start on text select it instead.
  let drag = null;
  root.addEventListener('mousedown', (e) => {
    const scroller = e.target.closest?.('pre.mermaid.zoomed .mermaid-scroll');
    if (!scroller || e.button !== 0 || e.target.closest('.nodeLabel, .edgeLabel, text')) return;
    drag = { scroller, x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop, moved: false };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.scroller.scrollLeft = drag.left - dx;
    drag.scroller.scrollTop = drag.top - dy;
  });
  window.addEventListener('mouseup', () => {
    if (drag?.moved) panned = Date.now();
    drag = null;
  });
}
let panned = 0;

/** Clicks inside a diagram: the corner buttons, and picking a flowchart box. True when it was one. */
export function diagramClick(e) {
  const pre = e.target.closest('pre.mermaid');
  if (!pre || pre.classList.contains('mermaid-error')) return false;
  const { svg } = parts(pre);
  const button = e.target.closest('.mermaid-tools button');
  if (button?.dataset.zoom) zoomDiagram(pre, Number(button.dataset.zoom));
  else if (button) openLightbox(svg);
  // A press picks a box; the end of a pan, or a drag that selected text, is left alone.
  else if (svg?.classList.contains('flowchart') && Date.now() - panned > 250 && getSelection().isCollapsed) {
    const box = e.target.closest('g.node');
    focusBox(svg, box);
    viewOf(pre).picked = svg.querySelector('.mmd-picked') ? nodeKey(box.id) : null;
  }
  return true;
}

/**
 * Flowcharts: pressing a box keeps it, its arrows and the boxes they reach bright and dims the rest.
 * Pressing the same box again, or anywhere else in the diagram, clears it.
 */
function focusBox(svg, box) {
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
