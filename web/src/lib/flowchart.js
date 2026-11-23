// Small edits to mermaid flowchart source, made the way a person would type them: each edit touches
// only the lines it must, and lines this file does not understand are left exactly as they were.
// Every edit returns { code, line } (line = 0-based line to point the reader at) or throws an Error
// whose message is shown to the reader.

const SKIP = /^\s*(?:%%|(?:flowchart|graph|subgraph|direction|classDef|accTitle|accDescr)\b|end\s*;?\s*$)/;
const CLASS_LINE = /^(\s*class\s+)([^\s]+)(\s+.*)$/;
const NODE_LINE = /^\s*(?:style|click)\s+([^\s]+)/;
const LINKSTYLE = /^(\s*linkStyle\s+)([\d,\s]+?)(\s+.*)$/;

const isIdChar = (c) => c !== undefined && /[\p{L}\p{N}_$]/u.test(c);
const OPEN = '[({';
const CLOSE = '])}';

/** Splits one line into `;`-separated statements, ignoring `;` inside quotes or brackets. */
function splitStatements(line) {
  const out = [];
  let depth = 0, quote = false, start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quote = !quote;
    else if (quote) continue;
    else if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) { out.push(line.slice(start, i)); start = i + 1; }
  }
  out.push(line.slice(start));
  return out;
}

const skipSpace = (s, p) => { while (p < s.length && /\s/.test(s[p])) p++; return p; };

function readId(s, p) {
  const start = p;
  while (p < s.length) {
    const c = s[p];
    if (isIdChar(c)) { p++; continue; }
    // A hyphen or dot inside an id (my-node, a.b), but not the start of an arrow (--, -., ==).
    if ((c === '-' || c === '.') && p > start && isIdChar(s[p + 1])) { p++; continue; }
    break;
  }
  return p > start ? p : -1;
}

/** End of a bracketed shape starting at p, honouring quotes and nested brackets; -1 if unclosed. */
function readShape(s, p) {
  if (s[p] === '>') {
    for (let i = p + 1, quote = false; i < s.length; i++) {
      if (s[i] === '"') quote = !quote;
      else if (!quote && s[i] === ']') return i + 1;
    }
    return -1;
  }
  if (s.startsWith('@{', p)) p++;
  let depth = 0, quote = false;
  for (let i = p; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quote = !quote;
    else if (quote) continue;
    else if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c) && --depth === 0) return i + 1;
  }
  return -1;
}

/** Where the label sits inside a shape such as `["text"]`, `((text))` or `[/text\]`. */
function labelRange(shape) {
  if (shape.startsWith('@{')) return null;
  if (shape[0] === '>') return [1, shape.length - 1];
  let open = 0;
  while (open < 3 && OPEN.includes(shape[open])) open++;
  if (shape[open] === '/' || shape[open] === '\\') open++;
  if (shape.length < open * 2) return null;
  return [open, shape.length - open];
}

function parseNode(s, p) {
  const start = skipSpace(s, p);
  const idEnd = readId(s, start);
  if (idEnd < 0) return null;
  let end = idEnd, shape = null;
  if ('[({>'.includes(s[end]) || s.startsWith('@{', end)) {
    const shapeEnd = readShape(s, end);
    if (shapeEnd < 0) return null;
    const range = labelRange(s.slice(end, shapeEnd));
    shape = { start: end, end: shapeEnd, label: range && [end + range[0], end + range[1]] };
    end = shapeEnd;
  }
  const cls = /^:::[\w-]+/.exec(s.slice(end));
  if (cls) end += cls[0].length;
  return { id: s.slice(start, idEnd), start, end, shape };
}

function parseGroup(s, p) {
  const nodes = [];
  let node = parseNode(s, p);
  if (!node) return null;
  nodes.push(node);
  for (;;) {
    const q = skipSpace(s, node.end);
    if (s[q] !== '&') break;
    node = parseNode(s, q + 1);
    if (!node) return null;
    nodes.push(node);
  }
  return { nodes, end: node.end };
}

const TEXT_LINK = /^(<?)(--|==|-\.)\s+(.*?)\s*(-{2,}[>ox]?|={2,}[>ox]?|\.+-[>ox]?)(?=\s|[\p{L}\p{N}_$])/u;
const ARROW = /^[<ox]?(?:-{2,}|={2,}|-\.+-|~{3,})[>ox]?/;
const PIPE = /^\s*\|([^|]*)\|/;

/** The arrow at p: `-->`, `-.->|text|`, `-- text -->`, … with its label and a label-less form. */
function parseLink(s, p) {
  const start = skipSpace(s, p);
  const rest = s.slice(start);
  let m = TEXT_LINK.exec(rest);
  if (m) {
    const [, lt, open, label, close] = m;
    return { start, end: start + m[0].length, label, arrow: lt + (open === '-.' ? '-' + close : close) };
  }
  m = ARROW.exec(rest);
  if (!m) return null;
  const arrow = m[0];
  const pipe = PIPE.exec(rest.slice(arrow.length));
  return {
    start,
    end: start + arrow.length + (pipe ? pipe[0].length : 0),
    label: pipe ? pipe[1] : '',
    arrow,
  };
}

/** `A & B --> C -- text --> D` → { groups: [[A, B], [C], [D]], links: [..] }, or null if not understood. */
function parseStatement(s) {
  if (!s.trim()) return null;
  const first = parseGroup(s, 0);
  if (!first) return null;
  const groups = [first.nodes];
  const links = [];
  let p = first.end;
  for (;;) {
    const link = parseLink(s, p);
    if (!link) break;
    const next = parseGroup(s, link.end);
    if (!next) return null;
    links.push(link);
    groups.push(next.nodes);
    p = next.end;
  }
  return skipSpace(s, p) === s.length ? { text: s, groups, links } : null;
}

/**
 * The source as lines, each statement parsed where possible, and every arrow in the order mermaid
 * numbers them (the N in an arrow's SVG id `L_from_to_N`, and the index `linkStyle` uses).
 */
export function parseFlowchart(code) {
  const lines = code.split('\n').map((text) => {
    if (!text.trim() || SKIP.test(text) || CLASS_LINE.test(text) || NODE_LINE.test(text) || /^\s*linkStyle\b/.test(text)) {
      return { text, statements: null };
    }
    return { text, statements: splitStatements(text).map((raw) => ({ raw, parsed: parseStatement(raw) })) };
  });
  const edges = [];
  let understood = true;
  lines.forEach((line, li) => {
    line.statements?.forEach((st, si) => {
      if (!st.parsed) { if (st.raw.trim()) understood = false; return; }
      st.parsed.links.forEach((link, k) => {
        for (const a of st.parsed.groups[k]) {
          for (const b of st.parsed.groups[k + 1]) edges.push({ from: a.id, to: b.id, line: li, statement: si, link: k, index: edges.length });
        }
      });
    });
  });
  return { lines, edges, understood };
}


// --- Helpers shared by the edits ---

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, id) => new RegExp(`(^|[^\\p{L}\\p{N}_$-])${escapeRe(id)}(?![\\p{L}\\p{N}_$]|-[\\p{L}\\p{N}_$])`, 'u').test(text);
const indentOf = (text) => /^\s*/.exec(text)[0];
/** The statement lines other than line `skip`: where boxes are drawn (style / class / click lines draw none). */
const statementText = (model, skip) => model.lines.filter((l, i) => i !== skip && l.statements).map((l) => l.text).join('\n');
const SUBGRAPH = /^(\s*)subgraph\s+(.*?)\s*$/;
const END = /^\s*end\s*;?\s*$/;

/** The indent of top-level statements, so new lines line up with the reader's own. */
function topIndent(lines) {
  let depth = 0;
  for (const text of lines.slice(1)) {
    if (SUBGRAPH.test(text)) { if (depth === 0) return indentOf(text); depth++; continue; }
    if (END.test(text)) { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && text.trim()) return indentOf(text);
  }
  return '    ';
}

/** Adds lines at the end of the diagram (before trailing blank lines), at the top-level indent. */
function appendLines(lines, texts) {
  const out = [...lines];
  let at = out.length;
  while (at > 1 && !out[at - 1].trim()) at--;
  const indent = topIndent(out);
  out.splice(at, 0, ...texts.map((t) => indent + t));
  return { lines: out, at };
}

const groupText = (nodes) => nodes.map((n) => n.text).join(' & ');
const chainText = (groups, links) => groups.map((g, i) => (i ? `${links[i - 1]} ` : '') + groupText(g)).join(' ');

/**
 * Rewrites one statement from its groups (arrays of { id, text }) and link texts. A chain broken by
 * an empty group splits into pieces; a lone box is kept only if the line defines it (shape or class)
 * or nothing else mentions it, so a box never disappears because an arrow went.
 */
function rebuild(groups, links, elsewhere) {
  const pieces = [];
  let run = [], runLinks = [];
  const flush = () => {
    if (run.length > 1) pieces.push(chainText(run, runLinks));
    else if (run.length === 1) {
      for (const n of run[0]) if (n.text !== n.id || !elsewhere(n.id)) pieces.push(n.text);
    }
    run = []; runLinks = [];
  };
  groups.forEach((g, i) => {
    if (!g.length) { flush(); return; }
    if (run.length) runLinks.push(links[i - 1]);
    run.push(g);
  });
  flush();
  return pieces;
}

const tokenText = (st, n) => st.raw.slice(n.start, n.end);
/** A box's token without its shape: `GH[GitHub]:::cls` → `GH:::cls`. */
const bareText = (st, n) => n.id + st.raw.slice(n.shape ? n.shape.end : n.start + n.id.length, n.end);
const nodeTexts = (st) => st.groups.map((g) => g.map((n) => ({ id: n.id, text: st.text.slice(n.start, n.end) })));
const linkTexts = (st) => st.links.map((l) => st.text.slice(l.start, l.end).trim());

/** Writes back the lines, replacing a statement's text with pieces (several pieces → several lines). */
function writeLines(model, changes) {
  const out = [];
  model.lines.forEach((line, li) => {
    if (!line.statements || !changes.has(li)) { out.push(line.text); return; }
    const indent = indentOf(line.text);
    const kept = [];
    line.statements.forEach((st, si) => {
      const pieces = changes.get(li).get(si);
      if (pieces === undefined) { if (st.raw.trim()) kept.push(st.raw.trim()); } else kept.push(...pieces);
    });
    for (const k of kept) out.push(indent + k);
  });
  return out;
}

function change(changes, li, si, pieces) {
  if (!changes.has(li)) changes.set(li, new Map());
  changes.get(li).set(si, pieces);
}

/** Every parsed statement, with where it is. */
function* statements(model) {
  for (const [li, line] of model.lines.entries()) {
    for (const [si, st] of (line.statements || []).entries()) if (st.parsed) yield { li, si, st, p: st.parsed };
  }
}

const LINKSTYLE_ALL = /^\s*linkStyle\s+[\d,\s]+?\s+/;

/**
 * `linkStyle N` points at arrows by number, and edits renumber arrows. This matches each old arrow
 * to its new number (by its two ends, in order) and rewrites the numbers; styles of removed arrows go.
 */
function remapLinkStyles(lines, oldEdges, newEdges, removed, renamed) {
  if (!lines.some((t) => LINKSTYLE_ALL.test(t))) return lines;
  const key = (f, t) => `${f}\u0000${t}`;
  const queues = new Map();
  for (const e of newEdges) {
    const k = key(e.from, e.to);
    if (!queues.has(k)) queues.set(k, []);
    queues.get(k).push(e.index);
  }
  const map = new Map();
  for (const e of oldEdges) {
    if (removed.includes(e.index)) continue;
    const [f, t] = renamed.get(e.index) || [e.from, e.to];
    const q = queues.get(key(f, t));
    if (q?.length) map.set(e.index, q.shift());
  }
  return lines.flatMap((text) => {
    const m = LINKSTYLE.exec(text);
    if (!m) return [text];
    const kept = m[2].split(',').map((n) => Number(n.trim())).filter((n) => map.has(n)).map((n) => map.get(n));
    return kept.length ? [m[1] + kept.join(',') + m[3]] : [];
  });
}

function firstChangedLine(before, after) {
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  return Math.min(i, Math.max(0, after.length - 1));
}

/** Every edit ends here: arrow styles follow their arrows, and the first changed line is reported. */
function finish(oldCode, lines, { removed = [], renamed = new Map(), line, ...extra } = {}) {
  const before = parseFlowchart(oldCode);
  let out = lines;
  const after = parseFlowchart(out.join('\n'));
  if (before.understood && after.understood) out = remapLinkStyles(out, before.edges, after.edges, removed, renamed);
  return { code: out.join('\n'), line: line ?? firstChangedLine(oldCode.split('\n'), out), ...extra };
}

/** The next free id with this prefix: n1, n2, … */
export function freeId(code, prefix = 'n') {
  for (let i = 1; ; i++) if (!mentions(code, `${prefix}${i}`)) return `${prefix}${i}`;
}

// --- Labels ---

/** Label text as the reader sees it: outer quotes off, `#quot;` back to `"`. */
export function decodeLabel(raw) {
  const t = raw.trim();
  const quoted = t.length > 1 && t.startsWith('"') && t.endsWith('"');
  return { text: (quoted ? t.slice(1, -1) : t).replace(/#quot;/g, '"'), quoted };
}

/** Label text ready for the code: quoted when it holds characters mermaid would read as syntax. */
export function encodeLabel(text, quoted = false) {
  const t = text.trim();
  return quoted || /["[\](){}<>|;]/.test(t) ? `"${t.replace(/"/g, '#quot;')}"` : t;
}

// --- Boxes ---

/** The 14 classic flowchart shapes, as written around a label. */
export const SHAPES = [
  { key: 'rect', open: '[', close: ']', name: 'Rectangle' },
  { key: 'round', open: '(', close: ')', name: 'Rounded' },
  { key: 'stadium', open: '([', close: '])', name: 'Pill' },
  { key: 'subroutine', open: '[[', close: ']]', name: 'Subroutine' },
  { key: 'database', open: '[(', close: ')]', name: 'Database' },
  { key: 'circle', open: '((', close: '))', name: 'Circle' },
  { key: 'double-circle', open: '(((', close: ')))', name: 'Double circle' },
  { key: 'diamond', open: '{', close: '}', name: 'Decision' },
  { key: 'hexagon', open: '{{', close: '}}', name: 'Hexagon' },
  { key: 'flag', open: '>', close: ']', name: 'Flag' },
  { key: 'lean-right', open: '[/', close: '/]', name: 'Input / output' },
  { key: 'lean-left', open: '[\\', close: '\\]', name: 'Output / input' },
  { key: 'trapezoid', open: '[/', close: '\\]', name: 'Trapezoid' },
  { key: 'trapezoid-alt', open: '[\\', close: '/]', name: 'Upside-down trapezoid' },
];

/** Where a box is defined: the first occurrence with a shape, else the first bare one. */
function findBox(model, id) {
  let bare = null;
  for (const { li, si, st, p } of statements(model)) {
    for (const n of p.groups.flat()) {
      if (n.id !== id) continue;
      if (n.shape) return { li, si, st, node: n };
      bare ??= { li, si, st, node: n };
    }
  }
  if (!bare) throw new Error(`Box “${id}” is not written in this diagram’s code.`);
  return bare;
}

const noObjectShape = (node, id) => {
  if (node.shape && !node.shape.label) throw new Error(`Box “${id}” uses the newer @{ } form, which the editor can’t change yet.`);
};

function replaceInStatement(model, li, si, start, end, insert) {
  const line = model.lines[li];
  const lines = model.lines.map((l) => l.text);
  let offset = 0;
  for (let i = 0; i < si; i++) offset += line.statements[i].raw.length + 1;
  lines[li] = line.text.slice(0, offset + start) + insert + line.text.slice(offset + end);
  return lines;
}

/** The box's label as written. */
export function boxLabel(code, id) {
  const { st, node } = findBox(parseFlowchart(code), id);
  noObjectShape(node, id);
  return node.shape ? decodeLabel(st.raw.slice(...node.shape.label)).text : id;
}

/** The box's shape key (see SHAPES); 'rect' for a bare id. */
export function boxShape(code, id) {
  const { st, node } = findBox(parseFlowchart(code), id);
  if (!node.shape) return 'rect';
  if (!node.shape.label) return null;
  const open = st.raw.slice(node.shape.start, node.shape.label[0]);
  const close = st.raw.slice(node.shape.label[1], node.shape.end);
  return SHAPES.find((s) => s.open === open && s.close === close)?.key ?? null;
}

/** Changes the text inside a box: `GH[GitHub]` → `GH[GitHub App]`. A bare `GH` gains `[…]`. */
export function setBoxLabel(code, id, text) {
  const model = parseFlowchart(code);
  const { li, si, st, node } = findBox(model, id);
  noObjectShape(node, id);
  if (!node.shape) {
    return finish(code, replaceInStatement(model, li, si, node.start, node.start + id.length, `${id}[${encodeLabel(text)}]`), { line: li });
  }
  const [a, b] = node.shape.label;
  return finish(code, replaceInStatement(model, li, si, a, b, encodeLabel(text, decodeLabel(st.raw.slice(a, b)).quoted)), { line: li });
}

/** Changes a box's shape, keeping its label: `D[D1]` → `D[(D1)]`. */
export function setBoxShape(code, id, key) {
  const shape = SHAPES.find((s) => s.key === key);
  if (!shape) throw new Error(`Unknown shape “${key}”.`);
  const model = parseFlowchart(code);
  const { li, si, st, node } = findBox(model, id);
  noObjectShape(node, id);
  if (!node.shape) {
    const at = node.start + id.length;
    return finish(code, replaceInStatement(model, li, si, at, at, shape.open + encodeLabel(id) + shape.close), { line: li });
  }
  const { text, quoted } = decodeLabel(st.raw.slice(...node.shape.label));
  return finish(code, replaceInStatement(model, li, si, node.shape.start, node.shape.end, shape.open + encodeLabel(text, quoted) + shape.close), { line: li });
}

/** Adds a box at the end of the diagram and returns its id. */
export function addBox(code, label = 'New box') {
  const id = freeId(code);
  const { lines, at } = appendLines(code.split('\n'), [`${id}[${encodeLabel(label)}]`]);
  return finish(code, lines, { line: at, id });
}

/** Adds a new box with an arrow to it from `from`. */
export function addConnectedBox(code, from, label = 'New box') {
  const id = freeId(code);
  const { lines, at } = appendLines(code.split('\n'), [`${from} --> ${id}[${encodeLabel(label)}]`]);
  return finish(code, lines, { line: at, id });
}

/** Lines without any mention of `id` in statements, plus its class / style / click lines gone. */
function dropNode(code, id) {
  const model = parseFlowchart(code);
  const changes = new Map();
  let found = false;
  for (const { li, si, p } of statements(model)) {
    if (!p.groups.some((g) => g.some((n) => n.id === id))) continue;
    found = true;
    const groups = nodeTexts(p).map((g) => g.filter((n) => n.id !== id));
    const rest = statementText(model, li);
    change(changes, li, si, rebuild(groups, linkTexts(p), (other) => mentions(rest, other)));
  }
  const lines = writeLines(model, changes).flatMap((text) => {
    const cls = CLASS_LINE.exec(text);
    if (cls && !/^\s*classDef\b/.test(text)) {
      const ids = cls[2].split(',').filter((x) => x !== id);
      return ids.length ? [cls[1] + ids.join(',') + cls[3]] : [];
    }
    const own = NODE_LINE.exec(text);
    return own && own[1] === id ? [] : [text];
  });
  return { lines, found, removed: model.edges.filter((e) => e.from === id || e.to === id).map((e) => e.index) };
}

/** Removes a box: its definition, every arrow touching it, and its class / style / click lines. */
export function deleteBox(code, id) {
  const { lines, found, removed } = dropNode(code, id);
  if (!found) throw new Error(`Box “${id}” is not written in this diagram’s code.`);
  return finish(code, lines, { removed });
}

// --- Colours (style lines) ---

/** Box colours offered by the editor: soft fill, strong border, dark text that reads in both themes. */
export const COLORS = [
  { key: 'blue', fill: '#dbeafe', stroke: '#2563eb', text: '#0b1220' },
  { key: 'purple', fill: '#ede9fe', stroke: '#7c3aed', text: '#0b1220' },
  { key: 'green', fill: '#dcfce7', stroke: '#059669', text: '#0b1220' },
  { key: 'amber', fill: '#fef3c7', stroke: '#d97706', text: '#0b1220' },
  { key: 'red', fill: '#fee2e2', stroke: '#dc2626', text: '#0b1220' },
  { key: 'gray', fill: '#f1f5f9', stroke: '#64748b', text: '#0b1220' },
];
const STYLE_OF = (id) => new RegExp(`^\\s*style\\s+${escapeRe(id)}\\s+(.*)$`);
const props = (s) => Object.fromEntries(s.split(',').map((p) => p.split(':').map((x) => x.trim())).filter((p) => p.length === 2));

/** The colour key of a box's `style` line, or null (no style, or one the editor did not write). */
export function boxColor(code, id) {
  const line = code.split('\n').map((t) => STYLE_OF(id).exec(t)).find(Boolean);
  if (!line) return null;
  const p = props(line[1]);
  return COLORS.find((c) => c.fill === p.fill && c.stroke === p.stroke)?.key ?? 'custom';
}

/** Sets a box's colour (a COLORS key) or clears it (null). */
export function setBoxColor(code, id, key) {
  const color = key && COLORS.find((c) => c.key === key);
  if (key && !color) throw new Error(`Unknown colour “${key}”.`);
  const lines = code.split('\n').filter((t) => !STYLE_OF(id).test(t));
  if (!color) return finish(code, lines);
  const { lines: out, at } = appendLines(lines, [`style ${id} fill:${color.fill},stroke:${color.stroke},color:${color.text}`]);
  return finish(code, out, { line: at });
}

// --- Arrows ---

/**
 * The arrow `from → to` whose number is `index` (from its SVG id). When the code holds just one
 * arrow between those boxes the number is not needed, which also covers lines this file cannot read.
 */
function findEdge(model, from, to, index) {
  const same = model.edges.filter((e) => e.from === from && e.to === to);
  const edge = same.length === 1 ? same[0] : same.find((e) => e.index === index);
  if (!edge) throw new Error(`The arrow ${from} → ${to} is not written in this diagram’s code.`);
  return edge;
}

function edgeAt(code, from, to, index) {
  const model = parseFlowchart(code);
  const edge = findEdge(model, from, to, index);
  const st = model.lines[edge.line].statements[edge.statement];
  return { model, edge, st, p: st.parsed, link: st.parsed.links[edge.link] };
}

/** Removes one arrow. Its boxes stay. */
export function deleteArrow(code, from, to, index) {
  const { model, edge, p } = edgeAt(code, from, to, index);
  const groups = nodeTexts(p);
  const links = linkTexts(p);
  const k = edge.link;
  const rest = statementText(model, edge.line);
  // Left chain up to the arrow's start group, right chain from its end group, and any other
  // arrows the same `&` link drew, written out one by one.
  const pairs = [];
  for (const a of groups[k]) for (const b of groups[k + 1]) if (a.id !== from || b.id !== to) pairs.push(`${a.id} ${links[k]} ${b.id}`);
  const elsewhere = (x) => mentions(rest, x) || pairs.some((t) => mentions(t, x));
  const left = rebuild(groups.slice(0, k + 1), links.slice(0, k), elsewhere);
  const right = rebuild(groups.slice(k + 1), links.slice(k + 1), elsewhere);
  const changes = new Map();
  change(changes, edge.line, edge.statement, [...left, ...pairs, ...right]);
  return finish(code, writeLines(model, changes), { removed: [edge.index] });
}

/** Adds an arrow `from --> to`. */
export function addArrow(code, from, to) {
  const { lines, at } = appendLines(code.split('\n'), [`${from} --> ${to}`]);
  return finish(code, lines, { line: at });
}

/** The arrow's label text. */
export function arrowLabel(code, from, to, index) {
  return decodeLabel(edgeAt(code, from, to, index).link.label).text;
}

const pipeLabel = (raw) => (raw.trim() ? `|${encodeLabel(decodeLabel(raw).text, decodeLabel(raw).quoted)}|` : '');

/** Sets or clears an arrow's label, written as `-->|label|`. */
export function setArrowLabel(code, from, to, index, text) {
  const { model, edge, link } = edgeAt(code, from, to, index);
  const label = text.trim() ? `|${encodeLabel(text, decodeLabel(link.label).quoted)}|` : '';
  return finish(code, replaceInStatement(model, edge.line, edge.statement, link.start, link.end, link.arrow + label), { line: edge.line });
}

/** { line: solid|dotted|thick|invisible, head: arrow|none|circle|cross, both } from an arrow like `<-.->`. */
export function readArrow(arrow) {
  const line = arrow.includes('~') ? 'invisible' : arrow.includes('=') ? 'thick' : arrow.includes('.') ? 'dotted' : 'solid';
  const head = { '>': 'arrow', o: 'circle', x: 'cross' }[arrow.at(-1)] || 'none';
  return { line, head, both: head !== 'none' && /^[<ox]/.test(arrow) };
}

/** The arrow text for a style: { line: 'dotted', head: 'arrow', both: true } → `<-.->`. */
export function writeArrow({ line, head, both }) {
  if (line === 'invisible') return '~~~';
  const end = { arrow: '>', circle: 'o', cross: 'x' }[head] || '';
  if (!end) return { thick: '===', dotted: '-.-' }[line] || '---';
  const body = { thick: '==', dotted: '-.-' }[line] || '--';
  return (both ? (head === 'arrow' ? '<' : end) : '') + body + end;
}

/** The arrow's line type, ends and label. */
export function arrowInfo(code, from, to, index) {
  const { link } = edgeAt(code, from, to, index);
  return { ...readArrow(link.arrow), label: decodeLabel(link.label).text };
}

/** Changes how an arrow is drawn: any of { line, head, both }. The label stays (hidden arrows have none). */
export function setArrowStyle(code, from, to, index, style) {
  const { model, edge, link } = edgeAt(code, from, to, index);
  const next = { ...readArrow(link.arrow), ...style };
  const label = next.line === 'invisible' ? '' : pipeLabel(link.label);
  return finish(code, replaceInStatement(model, edge.line, edge.statement, link.start, link.end, writeArrow(next) + label), { line: edge.line });
}

/** Points an arrow at other boxes, keeping its style and label. Boxes it leaves keep their definitions. */
function rewire(code, from, to, index, newFrom, newTo) {
  const { model, edge, st, p, link } = edgeAt(code, from, to, index);
  const linkText = link.arrow + pipeLabel(link.label);
  const renamed = new Map([[edge.index, [newFrom, newTo]]]);
  const simple = p.links.length === 1 && p.groups[0].length === 1 && p.groups[1].length === 1;
  if (!simple) {
    // Part of a chain or an & group: take the arrow out, then write it again on its own line.
    const out = deleteArrow(code, from, to, index);
    const { lines, at } = appendLines(out.code.split('\n'), [`${newFrom} ${linkText} ${newTo}`]);
    return finish(code, lines, { line: at, removed: [edge.index] });
  }
  const [a] = p.groups[0];
  const [b] = p.groups[1];
  let pieces;
  if (newFrom === b.id && newTo === a.id) pieces = [`${tokenText(st, b)} ${linkText} ${tokenText(st, a)}`];
  else {
    const rest = statementText(model, edge.line);
    const left = newFrom === a.id ? tokenText(st, a) : newFrom;
    const right = newTo === b.id ? tokenText(st, b) : newTo;
    pieces = [`${left} ${linkText} ${right}`];
    for (const [kept, n] of [[newFrom === a.id, a], [newTo === b.id, b]]) {
      if (!kept && (tokenText(st, n) !== n.id || !mentions(rest, n.id))) pieces.push(tokenText(st, n));
    }
  }
  const changes = new Map();
  change(changes, edge.line, edge.statement, pieces);
  return finish(code, writeLines(model, changes), { renamed, line: edge.line });
}

/** Turns an arrow around: `A --> B` → `B --> A`. */
export const reverseArrow = (code, from, to, index) => rewire(code, from, to, index, to, from);

/** Moves one end of an arrow to another box. `end` is 'from' or 'to'. */
export function reconnectArrow(code, from, to, index, end, id) {
  return end === 'from' ? rewire(code, from, to, index, id, to) : rewire(code, from, to, index, from, id);
}

const LINKSTYLE_LINE = /^(\s*linkStyle\s+)([\d,\s]+?)(\s+.*)$/;

/** The colour key of an arrow's own `linkStyle` line, or null. */
export function arrowColor(code, from, to, index) {
  const { model, edge } = edgeAt(code, from, to, index);
  if (!model.understood) return null;
  for (const text of code.split('\n')) {
    const m = LINKSTYLE_LINE.exec(text);
    if (m && m[2].split(',').map((n) => Number(n.trim())).includes(edge.index)) {
      const stroke = props(m[3].trim()).stroke;
      return COLORS.find((c) => c.stroke === stroke)?.key ?? 'custom';
    }
  }
  return null;
}

/** Colours an arrow (a COLORS key) or clears it (null), through `linkStyle <number>`. */
export function setArrowColor(code, from, to, index, key) {
  const color = key && COLORS.find((c) => c.key === key);
  if (key && !color) throw new Error(`Unknown colour “${key}”.`);
  const { model, edge } = edgeAt(code, from, to, index);
  if (!model.understood) throw new Error('This diagram has lines the editor can’t read, so arrows can’t be coloured safely.');
  const lines = code.split('\n').flatMap((text) => {
    const m = LINKSTYLE_LINE.exec(text);
    if (!m) return [text];
    const nums = m[2].split(',').map((n) => Number(n.trim()));
    if (!nums.includes(edge.index)) return [text];
    const rest = nums.filter((n) => n !== edge.index);
    return rest.length ? [m[1] + rest.join(',') + m[3]] : [];
  });
  if (!color) return { code: lines.join('\n'), line: Math.min(edge.line, lines.length - 1) };
  const { lines: out, at } = appendLines(lines, [`linkStyle ${edge.index} stroke:${color.stroke},stroke-width:2px,color:${color.stroke}`]);
  return { code: out.join('\n'), line: at };
}

// --- Direction ---

const HEADER = /^(\s*)(flowchart|graph)\b[ \t]*([A-Za-z]{2})?(.*)$/;
export const DIRECTIONS = ['LR', 'TB', 'RL', 'BT'];

/** The diagram's direction: LR, TB, RL or BT. */
export function direction(code) {
  const m = code.split('\n').map((t) => HEADER.exec(t)).find(Boolean);
  const d = (m?.[3] || 'TB').toUpperCase();
  return d === 'TD' ? 'TB' : d;
}

/** Sets the diagram's direction. */
export function setDirection(code, dir) {
  const lines = code.split('\n');
  const i = lines.findIndex((t) => HEADER.test(t));
  if (i < 0) throw new Error('This is not a flowchart.');
  const [, indent, kw, , rest] = HEADER.exec(lines[i]);
  lines[i] = `${indent}${kw} ${dir}${rest}`;
  return { code: lines.join('\n'), line: i };
}

// --- Groups (subgraphs) ---

/**
 * The subgraphs: { id, title, line, end, indent, form, order } and, per line, the subgraph it sits in.
 * A subgraph without an id gets mermaid's `subGraph<N>`, N counting subgraphs in the order they close.
 */
function subgraphs(lines) {
  const list = [];
  const stack = [];
  const owner = [];
  let closed = 0;
  lines.forEach((text, i) => {
    owner[i] = stack.length ? stack.at(-1) : -1;
    const m = SUBGRAPH.exec(text);
    if (m) {
      const rest = m[2];
      const head = /^([^\s[\]"]+)\s*\[(.*)\]$/.exec(rest);
      const sg = head ? { id: head[1], title: decodeLabel(head[2]).text, quoted: decodeLabel(head[2]).quoted, form: 'bracket' }
        : !/\s/.test(rest) ? { id: rest, title: rest, form: 'plain' }
        : { id: null, title: decodeLabel(rest).text, form: 'auto' };
      list.push({ ...sg, line: i, indent: m[1], parent: stack.at(-1) ?? -1 });
      stack.push(list.length - 1);
    } else if (END.test(text) && stack.length) {
      const k = stack.pop();
      list[k].end = i;
      list[k].order = closed++;
    }
  });
  for (const sg of list) sg.id ??= `subGraph${sg.order}`;
  return { list, owner };
}

/** The groups as { id, title }. */
export function groups(code) {
  return subgraphs(code.split('\n')).list.filter((g) => g.end !== undefined).map(({ id, title }) => ({ id, title }));
}

function findGroup(code, id) {
  const { list, owner } = subgraphs(code.split('\n'));
  const index = list.findIndex((g) => g.id === id && g.end !== undefined);
  if (index < 0) throw new Error(`Group “${id}” is not written in this diagram’s code.`);
  return { list, owner, index, group: list[index] };
}

/** The group a box sits in, by mermaid's rule: the first group to close whose own lines mention it. */
export function boxGroup(code, id) {
  const model = parseFlowchart(code);
  const { list, owner } = subgraphs(model.lines.map((l) => l.text));
  let best = null;
  for (const { li, p } of statements(model)) {
    const k = owner[li];
    if (k < 0 || !p.groups.flat().some((n) => n.id === id)) continue;
    if (!best || list[k].order < best.order) best = list[k];
  }
  return best?.id ?? null;
}

/** The indent for lines inside a group: its first child's, else two spaces deeper than its header. */
function childIndent(lines, group) {
  for (let i = group.line + 1; i < group.end; i++) if (lines[i].trim()) return indentOf(lines[i]);
  return `${group.indent}  `;
}

/**
 * Moves a box into group `groupId`, or out of every group (null). Mermaid puts a box in a group when
 * the group's own lines mention it, so: its definition goes into the target group, other groups stop
 * mentioning it (their arrows to it move to the top level), and its shape is written only once.
 */
export function moveToGroup(code, id, groupId) {
  const model = parseFlowchart(code);
  const { owner } = subgraphs(model.lines.map((l) => l.text));
  if (groupId) findGroup(code, groupId);
  let def = null;
  let seen = false;
  for (const { st, p } of statements(model)) {
    for (const n of p.groups.flat()) {
      if (n.id !== id) continue;
      seen = true;
      if (n.shape && !def) def = tokenText(st, n);
    }
  }
  if (!seen) throw new Error(`Box “${id}” is not written in this diagram’s code.`);
  def ??= id;
  // Which ids each group mentions, statement by statement, to know what a moved arrow leaves behind.
  const mentionedIn = (k, other, skip) => [...statements(model)].some(({ li, si, p }) => owner[li] === k && !(li === skip.li && si === skip.si) && p.groups.flat().some((n) => n.id === other));
  const changes = new Map();
  const moved = [];
  for (const { li, si, st, p } of statements(model)) {
    if (!p.groups.flat().some((n) => n.id === id)) continue;
    const bare = p.groups.map((g) => g.map((n) => ({ id: n.id, text: n.id === id ? bareText(st, n) : tokenText(st, n) })));
    if (!p.links.length) {
      // Other boxes on the same line stay unless this line was their only place in that group.
      const elsewhere = (other) => owner[li] < 0 || mentionedIn(owner[li], other, { li, si });
      change(changes, li, si, rebuild(bare.map((g) => g.filter((n) => n.id !== id)), [], elsewhere));
    } else if (owner[li] >= 0) {
      // An arrow inside another group would keep the box there: it moves to the top level, and the
      // other boxes on it stay in their group through a line of their own.
      moved.push(chainText(p.groups.map((g) => g.map((n) => ({ id: n.id, text: n.id === id ? bareText(st, n) : n.id }))), linkTexts(p)));
      const stay = new Map();
      for (const n of p.groups.flat()) {
        if (n.id === id || stay.has(n.id)) continue;
        if (n.shape || !mentionedIn(owner[li], n.id, { li, si })) stay.set(n.id, tokenText(st, n));
      }
      change(changes, li, si, [...stay.values()]);
    } else if (p.groups.flat().some((n) => n.id === id && n.shape)) {
      change(changes, li, si, [chainText(bare, linkTexts(p))]);
    }
  }
  let lines = writeLines(model, changes);
  if (groupId) {
    const { group } = findGroup(lines.join('\n'), groupId);
    lines.splice(group.end, 0, childIndent(lines, group) + def);
  } else if (def !== id || !mentions(statementText(parseFlowchart(lines.join('\n')), -1), id)) {
    lines = appendLines(lines, [def]).lines;
  }
  if (moved.length) lines = appendLines(lines, moved).lines;
  return finish(code, lines);
}

/** Adds a group. With a box id, that box moves into it; without, the group starts with a new box. */
export function addGroup(code, title = 'New group', boxId = null) {
  const id = freeId(code, 'g');
  const { lines } = appendLines(code.split('\n'), [`subgraph ${id}[${encodeLabel(title)}]`, 'end']);
  let out = lines.join('\n');
  let box = boxId;
  if (box) out = moveToGroup(out, box, id).code;
  else {
    box = freeId(out);
    const { group } = findGroup(out, id);
    const ls = out.split('\n');
    ls.splice(group.end, 0, `${group.indent}  ${box}[New box]`);
    out = ls.join('\n');
  }
  return { ...finish(code, out.split('\n')), id, box };
}

/** Renames a group's title (its id stays, so arrows to it keep working). */
export function renameGroup(code, id, title) {
  const { group } = findGroup(code, id);
  const lines = code.split('\n');
  lines[group.line] = `${group.indent}subgraph ${group.id}[${encodeLabel(title, group.quoted)}]`;
  return finish(code, lines, { line: group.line });
}

/** The direction set inside a group, or null when it follows the diagram. */
export function groupDirection(code, id) {
  const { owner, index, group } = findGroup(code, id);
  const lines = code.split('\n');
  for (let i = group.line + 1; i < group.end; i++) {
    const m = /^\s*direction\s+(\w+)/.exec(lines[i]);
    if (m && owner[i] === index) return m[1].toUpperCase();
  }
  return null;
}

/** Sets (or clears, with null) the direction inside a group. */
export function setGroupDirection(code, id, dir) {
  const { owner, index, group } = findGroup(code, id);
  const lines = code.split('\n');
  let at = -1;
  for (let i = group.line + 1; i < group.end; i++) if (/^\s*direction\s+\w+/.test(lines[i]) && owner[i] === index) at = i;
  if (at >= 0) {
    if (dir) lines[at] = `${indentOf(lines[at])}direction ${dir}`; else lines.splice(at, 1);
    return finish(code, lines, { line: at });
  }
  if (!dir) return { code, line: group.line };
  lines.splice(group.line + 1, 0, `${childIndent(lines, group)}direction ${dir}`);
  return finish(code, lines, { line: group.line + 1 });
}

/** Removes a group's frame. Its boxes and arrows stay, one level out; arrows to the group itself go. */
export function ungroup(code, id) {
  const { group } = findGroup(code, id);
  let lines = code.split('\n');
  const inner = childIndent(lines, group);
  const cut = inner.length - group.indent.length;
  const body = lines.slice(group.line + 1, group.end).map((t) => (t.startsWith(' '.repeat(cut)) ? t.slice(cut) : t.trimStart() ? group.indent + t.trimStart() : t));
  lines = [...lines.slice(0, group.line), ...body, ...lines.slice(group.end + 1)];
  let out = lines.join('\n');
  let removed = [];
  if (group.id && [...statements(parseFlowchart(out))].some(({ p }) => p.groups.flat().some((n) => n.id === group.id))) {
    const dropped = dropNode(out, group.id);
    lines = dropped.lines;
    // Arrow numbers here are those of the frameless code, which match the original's.
    removed = dropped.removed;
  }
  return finish(code, lines, { removed, line: Math.min(group.line, lines.length - 1) });
}
