// Fuzzy matching for the pickers. Pure: unit-tested in tests/fuzzy.test.js.

/** Score `query` against `text`; null when not all query letters appear in order. */
export function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, hits: [] };
  const hits = [];
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) continue;
    hits.push(i);
    score += i === prev + 1 ? 5 : 1;
    if (i === 0 || /[\s/_.-]/.test(t[i - 1])) score += 4;
    prev = i;
    qi++;
  }
  if (qi < q.length) return null;
  return { score: score - t.length * 0.01, hits };
}

/** Items matching `query`, best first. `key(item)` is the text to match. */
export function fuzzyFilter(query, items, key = (x) => x, limit = 200) {
  const q = query.trim();
  if (!q) return items.slice(0, limit).map((item) => ({ item, score: 0, hits: [] }));
  const out = [];
  for (const item of items) {
    const r = fuzzyScore(q, key(item));
    if (r) out.push({ item, ...r });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** "cmd+shift+p" → "⇧⌘P" on macOS, or "Ctrl+Shift+P" on Windows. */
export function formatKeys(spec, win = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || '')) {
  if (!spec) return '';
  const parts = spec.split('+');
  const key = parts.pop();
  if (win) {
    const order = [['ctrl', 'Ctrl'], ['cmd', 'Ctrl'], ['alt', 'Alt'], ['shift', 'Shift']];
    const mods = [];
    for (const [m, label] of order) {
      if (parts.includes(m) && !mods.includes(label)) mods.push(label);
    }
    const names = { plus: '+', tab: 'Tab', '/': '/', '-': '-' };
    return [...mods, names[key] || key.toUpperCase()].join('+');
  }
  const order = [['ctrl', '⌃'], ['alt', '⌥'], ['shift', '⇧'], ['cmd', '⌘']];
  const names = { plus: '+', tab: '⇥', '/': '/', '-': '−' };
  return order.filter(([m]) => parts.includes(m)).map(([, s]) => s).join('') + (names[key] || key.toUpperCase());
}
