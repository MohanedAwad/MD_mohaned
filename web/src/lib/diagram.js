// Reading mermaid's flowchart SVG: which box an element is, and which two boxes an arrow joins.
// Mermaid names a box `flowchart-<id>-<n>` and an arrow `L_<from>_<to>_<n>`.

/** 'flowchart-AI_gateway-3' → 'AI_gateway' */
export function nodeKey(domId) {
  return String(domId || '').replace(/^flowchart-/, '').replace(/-\d+$/, '');
}

/**
 * 'L_test_cases_runner_4' → ['test_cases', 'runner'], given the ids that exist.
 * Ids may contain underscores themselves, so every split is tried against the known ids.
 */
export function edgeEnds(edgeId, ids) {
  const body = String(edgeId || '').replace(/^L_/, '').replace(/_\d+$/, '');
  for (let i = body.indexOf('_'); i !== -1; i = body.indexOf('_', i + 1)) {
    const from = body.slice(0, i);
    const to = body.slice(i + 1);
    if (ids.has(from) && ids.has(to)) return [from, to];
  }
  return null;
}

// Finding a diagram's code in the Markdown, so an edit to the drawing can be written back.

const FENCE = /^(\s*)(`{3,}|~{3,})\s*mermaid\b/;
const dedent = (line, n) => line.replace(new RegExp(`^ {0,${n}}`), '');

/**
 * The ```mermaid block whose code is `src`, searching from 1-based `fromLine` (then from the top).
 * Returns { start, end, indent }: 0-based lines of the code, end exclusive (the closing fence).
 */
export function findMermaidBlock(text, fromLine, src) {
  const lines = text.split('\n');
  const want = src.replace(/\s+$/, '');
  const scan = (from) => {
    for (let i = Math.max(0, from); i < lines.length; i++) {
      const m = FENCE.exec(lines[i]);
      if (!m) continue;
      const [, indent, fence] = m;
      const close = new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) j++;
      const body = lines.slice(i + 1, j).map((l) => dedent(l, indent.length));
      if (body.join('\n').replace(/\s+$/, '') === want) return { start: i + 1, end: j, indent };
      i = j;
    }
    return null;
  };
  return scan(fromLine - 1) || scan(0);
}

/** The block's current code, or null when the lines no longer form that block. */
export function blockCode(text, block) {
  const lines = text.split('\n');
  if (block.end > lines.length) return null;
  return lines.slice(block.start, block.end).map((l) => dedent(l, block.indent.length)).join('\n');
}

/** Puts `code` in place of the block's code. Returns the new text and the block's new extent. */
export function replaceBlock(text, block, code) {
  const lines = text.split('\n');
  const body = code.split('\n').map((l) => (l ? block.indent + l : l));
  lines.splice(block.start, block.end - block.start, ...body);
  return { text: lines.join('\n'), block: { ...block, end: block.start + body.length } };
}
