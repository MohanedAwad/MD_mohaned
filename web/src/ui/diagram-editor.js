// Full-window visual flowchart editor. Click a box, arrow or group to change it in the side panel;
// drag box to box to connect; drag an arrow's end dot to another box to re-attach it. Every change is
// written into the diagram's mermaid code (lib/flowchart.js), so the file stays plain mermaid.
import { renderSvg } from '../render/diagrams.js';
import { edgeEnds, nodeKey } from '../lib/diagram.js';
import * as fc from '../lib/flowchart.js';
import '../styles/diagram-editor.css';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const attempt = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

// Small pictures for the panel. viewBox 0 0 28 20.
const SHAPE_ICONS = {
  rect: '<rect x="3" y="4" width="22" height="12"/>',
  round: '<rect x="3" y="4" width="22" height="12" rx="4"/>',
  stadium: '<rect x="3" y="4" width="22" height="12" rx="6"/>',
  subroutine: '<rect x="3" y="4" width="22" height="12"/><path d="M6.5 4v12M21.5 4v12"/>',
  database: '<path d="M5 6v8c0 1.7 4 3 9 3s9-1.3 9-3V6"/><ellipse cx="14" cy="6" rx="9" ry="3"/>',
  circle: '<circle cx="14" cy="10" r="7.5"/>',
  'double-circle': '<circle cx="14" cy="10" r="8"/><circle cx="14" cy="10" r="5.5"/>',
  diamond: '<path d="M14 2 25 10 14 18 3 10z"/>',
  hexagon: '<path d="M8 4h12l5 6-5 6H8l-5-6z"/>',
  flag: '<path d="M3 4h22v12H3l5-6z"/>',
  'lean-right': '<path d="M7 4h18l-4 12H3z"/>',
  'lean-left': '<path d="M3 4h18l4 12H7z"/>',
  trapezoid: '<path d="M7 4h14l4 12H3z"/>',
  'trapezoid-alt': '<path d="M3 4h22l-4 12H7z"/>',
};
const LINES = [
  { key: 'solid', name: 'Solid', icon: '<path d="M3 10h22"/>' },
  { key: 'dotted', name: 'Dotted', icon: '<path d="M3 10h22" stroke-dasharray="2.5 3"/>' },
  { key: 'thick', name: 'Thick', icon: '<path d="M3 10h22" stroke-width="3.5"/>' },
  { key: 'invisible', name: 'Hidden (keeps boxes near each other)', icon: '<path d="M3 10h22" stroke-dasharray="1 4" opacity=".45"/>' },
];
const HEADS = [
  { key: 'arrow', name: 'Arrow', icon: '<path d="M3 10h20M18 5.5l5 4.5-5 4.5"/>' },
  { key: 'none', name: 'No end', icon: '<path d="M3 10h22"/>' },
  { key: 'circle', name: 'Circle', icon: '<path d="M3 10h16"/><circle cx="22" cy="10" r="3"/>' },
  { key: 'cross', name: 'Cross', icon: '<path d="M3 10h17M19 6.5l5 7M24 6.5l-5 7"/>' },
];
const DIRS = [
  { key: 'LR', name: 'Left to right', icon: '<path d="M4 10h20M19 5.5l5 4.5-5 4.5"/>' },
  { key: 'TB', name: 'Top to bottom', icon: '<path d="M14 2v16M9.5 13l4.5 5 4.5-5"/>' },
  { key: 'RL', name: 'Right to left', icon: '<path d="M24 10H4M9 5.5 4 10l5 4.5"/>' },
  { key: 'BT', name: 'Bottom to top', icon: '<path d="M14 18V2M9.5 7 14 2l4.5 5"/>' },
];
const svgIcon = (inner) => `<svg viewBox="0 0 28 20" aria-hidden="true">${inner}</svg>`;

export function openDiagramEditor({ code: initial, dark, onChange, onClose }) {
  let code = initial;
  const history = [];
  const future = [];
  let selected = null; // { kind: 'node', id } | { kind: 'edge', from, to, index } | { kind: 'group', id }
  let drawSeq = 0;
  let input = null;
  let press = null;
  let sayTimer = 0;

  const box = document.createElement('div');
  box.id = 'dgedit';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Diagram editor');
  box.innerHTML = `
    <div class="dge-bar">
      <button data-act="add" data-tip="Add a box">+ Box</button>
      <button data-act="group" data-tip="Add a group (around the selected box, if one is selected)">+ Group</button>
      <span class="dge-sep"></span>
      <button data-act="undo" data-tip="Undo" data-keys="⌘Z" disabled>Undo</button>
      <button data-act="redo" data-tip="Redo" data-keys="⇧⌘Z" disabled>Redo</button>
      <span class="dge-hint"></span>
      <button data-act="done" class="dge-done" data-tip="Back to the document" data-keys="Esc">Done</button>
    </div>
    <div class="dge-main">
      <div class="dge-stage"><div class="dge-svg"></div><div class="dge-error" hidden></div></div>
      <aside class="dge-panel"></aside>
    </div>
    <div class="dge-handles" hidden><button class="dge-handle" data-end="from" aria-label="Arrow start"></button><button class="dge-handle" data-end="to" aria-label="Arrow end"></button></div>
    <svg class="dge-wire" hidden><line/></svg>`;
  const $ = (s) => box.querySelector(s);
  const stage = $('.dge-stage');
  const holder = $('.dge-svg');
  const errorEl = $('.dge-error');
  const hint = $('.dge-hint');
  const panel = $('.dge-panel');
  const handles = $('.dge-handles');
  const wire = $('.dge-wire');
  const line = wire.querySelector('line');
  const svg = () => holder.querySelector('svg');
  const show = (el, on) => (on ? el.removeAttribute('hidden') : el.setAttribute('hidden', '')); // <svg> has no .hidden

  // --- Changes ---

  /** Hands the code to the document; on success it becomes the editor's code too. */
  function commit(next) {
    if (!onChange(next)) { say('The document changed outside this editor. Press Done and open the editor again.', true); return false; }
    code = next;
    $('[data-act=undo]').disabled = !history.length;
    $('[data-act=redo]').disabled = !future.length;
    return true;
  }

  /** Runs one edit from lib/flowchart.js, redraws, then selects `next(result)` if given. */
  async function act(edit, next) {
    let result;
    try { result = edit(); } catch (err) { say(err.message, true); return; }
    if (!result || result.code === code) return;
    history.push(code);
    future.length = 0;
    if (!commit(result.code)) { history.pop(); return; }
    if (next) selected = next(result);
    await draw();
    return result;
  }

  function step(from, to) {
    if (!from.length) return;
    const prev = from.pop();
    to.push(code);
    if (!commit(prev)) { from.push(to.pop()); return; }
    draw();
  }
  const undo = () => step(history, future);
  const redo = () => step(future, history);

  // --- Drawing ---

  async function draw() {
    const my = ++drawSeq;
    try {
      const markup = await renderSvg(code, dark);
      if (my !== drawSeq || !box.isConnected) return;
      holder.innerHTML = markup;
      const s = svg();
      if (s?.style.maxWidth) holder.style.setProperty('--natural', s.style.maxWidth);
      decorate(s);
      show(errorEl, false);
      holder.classList.remove('dge-stale');
    } catch (err) {
      if (my !== drawSeq) return;
      errorEl.textContent = `Mermaid can’t draw this: ${String(err?.message || err).trim()}\nPress Undo to go back.`;
      show(errorEl, true);
      holder.classList.add('dge-stale');
    }
    applySelection();
  }

  /** Tags boxes, groups and arrows (path, a wide invisible hit line, label) with what they are in the code. */
  function decorate(s) {
    if (!s) return;
    const nodes = [...s.querySelectorAll('g.node')];
    for (const n of nodes) n.dataset.key = nodeKey(n.id);
    const clusters = [...s.querySelectorAll('g.cluster')];
    for (const c of clusters) c.dataset.group = c.id;
    const ids = new Set([...nodes.map((n) => n.dataset.key), ...clusters.map((c) => c.id)]);
    const labelsById = new Map([...s.querySelectorAll('g.edgeLabel')].map((g) => [g.querySelector('[data-id]')?.dataset.id, g]));
    for (const paths of s.querySelectorAll('g.edgePaths')) {
      const arrows = [...paths.children];
      const labels = [...(paths.parentElement.querySelector(':scope > g.edgeLabels')?.children || [])];
      arrows.forEach((path, i) => {
        const ends = edgeEnds(path.id, ids);
        if (!ends) return;
        const data = { from: ends[0], to: ends[1], index: /_(\d+)$/.exec(path.id)?.[1] ?? '' };
        const hit = path.cloneNode(false);
        for (const a of ['id', 'style', 'marker-start', 'marker-end']) hit.removeAttribute(a);
        hit.setAttribute('class', 'dge-hit');
        path.after(hit);
        const label = labelsById.get(path.id) || (labels.length === arrows.length ? labels[i] : null);
        for (const el of [path, hit, label]) if (el) { el.classList.add('dge-edge'); Object.assign(el.dataset, data); }
      });
    }
  }

  const boxes = () => [...(svg()?.querySelectorAll('g.node') || [])].map((n) => ({ id: n.dataset.key, text: n.textContent.trim() || n.dataset.key }));
  const nodeEl = (id) => [...(svg()?.querySelectorAll('g.node') || [])].find((n) => n.dataset.key === id);
  const groupEl = (id) => [...(svg()?.querySelectorAll('g.cluster') || [])].find((c) => c.dataset.group === id);
  const edgeEls = (e) => [...(svg()?.querySelectorAll('.dge-edge') || [])].filter((el) => el.dataset.from === e.from && el.dataset.to === e.to && Number(el.dataset.index) === e.index);
  const nameOf = (id) => boxes().find((b) => b.id === id)?.text || id;

  // --- Selection ---

  function applySelection() {
    const s = svg();
    s?.querySelectorAll('.dge-sel').forEach((el) => el.classList.remove('dge-sel'));
    let found = [];
    if (selected?.kind === 'node') found = [nodeEl(selected.id)].filter(Boolean);
    if (selected?.kind === 'group') found = [groupEl(selected.id)].filter(Boolean);
    if (selected?.kind === 'edge') {
      found = edgeEls(selected);
      if (!found.length) {
        // After an edit the arrow may have a new number; keep it selected by its ends.
        const same = [...(s?.querySelectorAll('path.dge-edge') || [])].find((el) => el.dataset.from === selected.from && el.dataset.to === selected.to);
        if (same) { selected = { ...selected, index: Number(same.dataset.index) }; found = edgeEls(selected); }
      }
    }
    if (!found.length) selected = null;
    found.forEach((el) => el.classList.add('dge-sel'));
    placeHandles();
    renderPanel();
    if (!sayTimer) showHint();
  }

  function select(sel) { closeInput(); selected = sel; applySelection(); }

  function showHint() {
    hint.classList.remove('dge-bad');
    hint.textContent = {
      node: 'Drag this box onto another box to connect them · double-click to rename · ⌫ deletes',
      edge: 'Drag a blue dot onto another box to re-attach that end · ⌫ deletes',
      group: 'Double-click the group’s title to rename it · ⌫ removes the frame, boxes stay',
    }[selected?.kind] || 'Click a box, arrow or group to change it · drag from box to box to connect';
  }

  function say(message, bad) {
    hint.textContent = message;
    hint.classList.toggle('dge-bad', !!bad);
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { sayTimer = 0; showHint(); }, 5000);
  }

  // --- Side panel ---

  const tiles = (set, items, current, cls = '') => `<div class="dge-tiles ${cls}">${items.map((it) => `<button data-set="${set}" data-value="${it.key}" data-tip="${esc(it.name)}" aria-label="${esc(it.name)}" aria-pressed="${it.key === current}">${svgIcon(it.icon ?? SHAPE_ICONS[it.key])}</button>`).join('')}</div>`;
  const swatches = (set, current, disabled) => `<div class="dge-swatches">
    <button data-set="${set}" data-value="" class="dge-none" data-tip="Default colour" aria-label="Default colour" aria-pressed="${!current}" ${disabled ? 'disabled' : ''}></button>
    ${fc.COLORS.map((c) => `<button data-set="${set}" data-value="${c.key}" data-tip="${c.key[0].toUpperCase() + c.key.slice(1)}" aria-label="${c.key}" aria-pressed="${c.key === current}" style="background:${c.fill};border-color:${c.stroke}" ${disabled ? 'disabled' : ''}></button>`).join('')}
  </div>`;
  const field = (label, body) => `<div class="dge-field"><div class="dge-label">${label}</div>${body}</div>`;
  const options = (items, current, extra = '') => extra + items.map((b) => `<option value="${esc(b.id)}" ${b.id === current ? 'selected' : ''}>${esc(b.text)}</option>`).join('');

  function renderPanel() {
    const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.field : null;
    let html;
    if (selected?.kind === 'node') {
      const id = selected.id;
      const label = attempt(() => fc.boxLabel(code, id));
      const shape = attempt(() => fc.boxShape(code, id));
      const group = attempt(() => fc.boxGroup(code, id));
      const groups = fc.groups(code).map((g) => ({ id: g.id, text: g.title }));
      html = `<h3>Box</h3>
        ${field('Text', label === null ? '<p class="dge-note">This box uses the newer @{ } form; its text can’t be changed here.</p>' : `<input data-field="label" value="${esc(label)}" spellcheck="false">`)}
        ${field('Shape', shape === null && label === null ? '' : tiles('shape', fc.SHAPES, shape))}
        ${field('Colour', swatches('color', fc.boxColor(code, id)))}
        ${field('Group', `<select data-field="group">${options(groups, group, `<option value="" ${group ? '' : 'selected'}>No group</option>`)}</select>`)}
        <div class="dge-row"><button data-act="connected">+ Connected box</button><button data-act="wrap">Put in new group</button></div>
        <button class="dge-danger" data-act="delete">Delete box</button>`;
    } else if (selected?.kind === 'edge') {
      const { from, to, index } = selected;
      const info = attempt(() => fc.arrowInfo(code, from, to, index), { line: 'solid', head: 'arrow', both: false, label: '' });
      const all = boxes().sort((a, b) => a.text.localeCompare(b.text));
      const colorable = fc.parseFlowchart(code).understood;
      html = `<h3>Arrow</h3>
        ${field('Label', `<input data-field="label" value="${esc(info.label)}" placeholder="No label" spellcheck="false" ${info.line === 'invisible' ? 'disabled' : ''}>`)}
        ${field('From', `<select data-field="from">${options(all, from)}</select>`)}
        ${field('To', `<select data-field="to">${options(all, to)}</select>`)}
        <button data-act="reverse">⇄ Reverse direction</button>
        ${field('Line', tiles('line', LINES, info.line))}
        ${field('End', `${tiles('head', HEADS, info.head)}<label class="dge-check"><input type="checkbox" data-field="both" ${info.both ? 'checked' : ''} ${info.head === 'none' || info.line === 'invisible' ? 'disabled' : ''}> Both ends</label>`)}
        ${field('Colour', swatches('color', attempt(() => fc.arrowColor(code, from, to, index)), !colorable))}
        <button class="dge-danger" data-act="delete">Delete arrow</button>`;
    } else if (selected?.kind === 'group') {
      const g = fc.groups(code).find((x) => x.id === selected.id);
      const dir = attempt(() => fc.groupDirection(code, selected.id));
      html = `<h3>Group</h3>
        ${field('Title', `<input data-field="title" value="${esc(g?.title ?? '')}" spellcheck="false">`)}
        ${field('Direction inside', `<div class="dge-tiles"><button data-set="gdir" data-value="" aria-pressed="${!dir}" class="dge-text">Auto</button></div>${tiles('gdir', DIRS, dir)}`)}
        <button class="dge-danger" data-act="delete">Remove frame (keep boxes)</button>`;
    } else {
      html = `<h3>Diagram</h3>
        ${field('Direction', tiles('dir', DIRS, fc.direction(code)))}
        <ul class="dge-help">
          <li><b>Click</b> a box, arrow or group to change it here.</li>
          <li><b>Drag</b> from one box onto another to connect them.</li>
          <li>Select an arrow and <b>drag its blue dot</b> onto another box to re-attach it.</li>
          <li><b>Double-click</b> a box, arrow or group title to rename it.</li>
          <li>Mermaid places the boxes itself; change the direction or groups to rearrange them.</li>
        </ul>`;
    }
    panel.innerHTML = html;
    if (focused) panel.querySelector(`[data-field="${focused}"]`)?.focus();
  }

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const sel = selected;
    const value = b.dataset.value || null;
    switch (b.dataset.set) {
      case 'shape': return act(() => fc.setBoxShape(code, sel.id, value), () => sel);
      case 'color': return sel.kind === 'node'
        ? act(() => fc.setBoxColor(code, sel.id, value), () => sel)
        : act(() => fc.setArrowColor(code, sel.from, sel.to, sel.index, value), () => sel);
      case 'line': return act(() => fc.setArrowStyle(code, sel.from, sel.to, sel.index, { line: value }), () => sel);
      case 'head': return act(() => fc.setArrowStyle(code, sel.from, sel.to, sel.index, { head: value }), () => sel);
      case 'gdir': return act(() => fc.setGroupDirection(code, sel.id, value), () => sel);
      case 'dir': return act(() => fc.setDirection(code, value));
    }
    switch (b.dataset.act) {
      case 'delete': return remove();
      case 'reverse': return act(() => fc.reverseArrow(code, sel.from, sel.to, sel.index), () => ({ ...sel, from: sel.to, to: sel.from }));
      case 'connected': return act(() => fc.addConnectedBox(code, sel.id), (r) => ({ kind: 'node', id: r.id })).then(renameSoon);
      case 'wrap': return addGroup(sel.id);
    }
  });

  panel.addEventListener('change', (e) => {
    const el = e.target;
    const sel = selected;
    if (!sel) return;
    switch (el.dataset.field) {
      case 'label': return sel.kind === 'node'
        ? act(() => fc.setBoxLabel(code, sel.id, el.value), () => sel)
        : act(() => fc.setArrowLabel(code, sel.from, sel.to, sel.index, el.value), () => sel);
      case 'title': return act(() => fc.renameGroup(code, sel.id, el.value), () => sel);
      case 'group': return act(() => fc.moveToGroup(code, sel.id, el.value || null), () => sel);
      case 'both': return act(() => fc.setArrowStyle(code, sel.from, sel.to, sel.index, { both: el.checked }), () => sel);
      case 'from':
      case 'to': {
        const end = el.dataset.field;
        return act(() => fc.reconnectArrow(code, sel.from, sel.to, sel.index, end, el.value), () => ({ ...sel, [end]: el.value }));
      }
    }
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[data-field]')) { e.preventDefault(); e.target.blur(); }
  });

  // --- Actions ---

  function remove() {
    const sel = selected;
    if (sel?.kind === 'node') act(() => fc.deleteBox(code, sel.id), () => null);
    else if (sel?.kind === 'edge') act(() => fc.deleteArrow(code, sel.from, sel.to, sel.index), () => null);
    else if (sel?.kind === 'group') act(() => fc.ungroup(code, sel.id), () => null);
  }

  const renameSoon = () => { if (selected) rename(selected); };

  function addBox() {
    act(() => fc.addBox(code), (r) => ({ kind: 'node', id: r.id })).then(renameSoon);
  }

  function addGroup(boxId) {
    act(() => fc.addGroup(code, 'New group', boxId), (r) => ({ kind: 'group', id: r.id })).then(() => {
      const title = panel.querySelector('[data-field=title]');
      title?.focus();
      title?.select();
    });
  }

  // --- Text fields over the drawing ---

  /** A field centred on point {x, y}; Enter or leaving it saves, Esc cancels. */
  function openInput(at, width, value, save) {
    closeInput();
    input = document.createElement('input');
    input.className = 'dge-input';
    input.value = value;
    input.style.left = `${at.x}px`;
    input.style.top = `${at.y}px`;
    input.style.width = `${Math.max(160, Math.min(Math.max(width + 40, value.length * 8.5 + 60), 520))}px`;
    box.append(input);
    input.focus();
    input.select();
    const el = input;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      const v = el.value;
      el.remove();
      if (input === el) input = null;
      if (ok && v !== value) save(v);
    };
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    el.addEventListener('blur', () => finish(true));
  }
  function closeInput() { input?.blur(); }

  const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const pointOn = (path, at) => {
    const p = path.getPointAtLength(at).matrixTransform(path.getScreenCTM());
    return { x: p.x, y: p.y };
  };

  function rename(sel) {
    const s = svg();
    if (!sel || !s) return;
    if (sel.kind === 'node') {
      const value = attempt(() => fc.boxLabel(code, sel.id));
      const el = nodeEl(sel.id);
      if (value === null || !el) return;
      const r = el.getBoundingClientRect();
      openInput(centre(r), r.width, value, (v) => act(() => fc.setBoxLabel(code, sel.id, v), () => sel));
    } else if (sel.kind === 'edge') {
      const info = attempt(() => fc.arrowInfo(code, sel.from, sel.to, sel.index));
      if (!info || info.line === 'invisible') return;
      const els = edgeEls(sel);
      const label = els.find((el) => el.matches('g.edgeLabel') && el.getBoundingClientRect().width > 2);
      const path = els.find((el) => el.matches('path'));
      const at = label ? centre(label.getBoundingClientRect()) : pointOn(path, path.getTotalLength() / 2);
      openInput(at, 120, info.label, (v) => act(() => fc.setArrowLabel(code, sel.from, sel.to, sel.index, v), () => sel));
    } else if (sel.kind === 'group') {
      const g = fc.groups(code).find((x) => x.id === sel.id);
      const el = groupEl(sel.id);
      if (!g || !el) return;
      const r = (el.querySelector('.cluster-label') || el).getBoundingClientRect();
      openInput({ x: r.left + r.width / 2, y: r.top + Math.min(r.height, 24) / 2 + 4 }, r.width, g.title, (v) => act(() => fc.renameGroup(code, sel.id, v), () => sel));
    }
  }

  // --- Arrow end dots ---

  function placeHandles() {
    const path = selected?.kind === 'edge' ? edgeEls(selected).find((el) => el.matches('path.flowchart-link, path:not(.dge-hit)')) : null;
    show(handles, !!path);
    if (!path) return;
    const len = path.getTotalLength();
    const [a, b] = handles.children;
    const pa = pointOn(path, 0);
    const pb = pointOn(path, len);
    Object.assign(a.style, { left: `${pa.x}px`, top: `${pa.y}px` });
    Object.assign(b.style, { left: `${pb.x}px`, top: `${pb.y}px` });
  }
  stage.addEventListener('scroll', placeHandles);
  window.addEventListener('resize', placeHandles);

  handles.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.dge-handle');
    if (!h || !selected) return;
    e.preventDefault();
    e.stopPropagation();
    const other = h.dataset.end === 'from' ? handles.children[1] : handles.children[0];
    press = { end: h.dataset.end, anchor: centre(other.getBoundingClientRect()), x: e.clientX, y: e.clientY, wiring: true };
    show(handles, false);
  });

  // --- Pointer on the drawing: press to select, drag box to box to connect ---

  const nodeAt = (x, y) => {
    const n = document.elementFromPoint(x, y)?.closest?.('g.node');
    return n && holder.contains(n) ? n : null;
  };

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || holder.classList.contains('dge-stale') || e.target.closest('.dge-error')) return;
    const node = e.target.closest('g.node');
    press = {
      node,
      edge: e.target.closest('.dge-edge'),
      group: e.target.closest('g.cluster'),
      anchor: node ? centre(node.getBoundingClientRect()) : null,
      x: e.clientX,
      y: e.clientY,
      wiring: false,
    };
    if (node) e.preventDefault();
  });

  const clearTargets = () => svg()?.querySelectorAll('.dge-target').forEach((n) => n.classList.remove('dge-target'));

  const onMove = (e) => {
    if (!press?.anchor) return;
    if (!press.wiring && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return;
    press.wiring = true;
    line.setAttribute('x1', press.anchor.x); line.setAttribute('y1', press.anchor.y);
    line.setAttribute('x2', e.clientX); line.setAttribute('y2', e.clientY);
    show(wire, true);
    const target = nodeAt(e.clientX, e.clientY);
    clearTargets();
    if (target && target !== press.node) target.classList.add('dge-target');
  };

  const onUp = (e) => {
    if (!press) return;
    const p = press;
    press = null;
    show(wire, false);
    clearTargets();
    const target = p.wiring ? nodeAt(e.clientX, e.clientY) : null;
    if (p.end) {
      // Dropped an arrow's end dot.
      const sel = selected;
      if (target) {
        const id = target.dataset.key;
        act(() => fc.reconnectArrow(code, sel.from, sel.to, sel.index, p.end, id), () => ({ ...sel, [p.end]: id }));
      } else placeHandles();
      return;
    }
    if (p.wiring) {
      if (target && target !== p.node) {
        const from = p.node.dataset.key;
        const to = target.dataset.key;
        act(() => fc.addArrow(code, from, to), () => ({ kind: 'edge', from, to, index: -1 }));
      }
      return;
    }
    if (p.node) select({ kind: 'node', id: p.node.dataset.key });
    else if (p.edge) select({ kind: 'edge', from: p.edge.dataset.from, to: p.edge.dataset.to, index: Number(p.edge.dataset.index) });
    else if (p.group) select({ kind: 'group', id: p.group.dataset.group });
    else select(null);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  stage.addEventListener('dblclick', (e) => {
    if (!selected) return;
    // The first click of the double-click already selected what is under the pointer.
    rename(selected);
  });

  // --- Buttons and keys ---

  box.querySelector('.dge-bar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    ({ add: addBox, group: () => addGroup(selected?.kind === 'node' ? selected.id : null), undo, redo, done: close })[b.dataset.act]();
  });

  // Capture phase, so the document editor and the page's own keys never see these.
  const onKey = (e) => {
    if (e.target.classList?.contains('dge-input')) return;
    const inField = e.target.closest?.('input, select, textarea');
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (inField) e.target.blur(); else if (selected) select(null); else close();
      return;
    }
    if (inField) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { stop(); remove(); }
    else if (mod && e.key.toLowerCase() === 'z') { stop(); if (e.shiftKey) redo(); else undo(); }
    else if (e.key === 'Enter' && selected) { stop(); rename(selected); }
  };
  document.addEventListener('keydown', onKey, true);

  function close() {
    clearTimeout(sayTimer);
    closeInput();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('resize', placeHandles);
    box.remove();
    onClose?.();
  }

  document.activeElement?.blur?.();
  document.body.append(box);
  showHint();
  renderPanel();
  draw();
  return { close };
}
