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
