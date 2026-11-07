// Pure text helpers. No DOM: unit-tested in tests/text.test.js.

// Letters only: Arabic-Indic digits and Arabic punctuation are not strong (Unicode bidi).
const STRONG = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u05D0-\u05EA\u0620-\u064A\u066E-\u06D3\u06D5\u06FA-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const RTL = /[\u05D0-\u05EA\u0620-\u064A\u066E-\u06D3\u06D5\u06FA-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;

/** 'rtl' | 'ltr' from the first strong letter, or null when there is none. */
export function textDirection(text) {
  const m = text.match(STRONG);
  if (!m) return null;
  return RTL.test(m[0]) ? 'rtl' : 'ltr';
}

/** GitHub-style heading slug that keeps Arabic letters. */
export function slugify(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
}

/** Splits a leading `---` YAML block. Only flat `key: value` lines are read. */
export function splitFrontMatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { meta: [], body: src, lineOffset: 0 };
  const meta = [];
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.+)$/);
    if (kv) meta.push([kv[1], kv[2].trim().replace(/^(["'])(.*)\1$/, '$2')]);
  }
  return { meta, body: src.slice(m[0].length), lineOffset: (m[0].match(/\n/g) || []).length };
}

export function countWords(markdown) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*_~|[\]()!-]+/g, ' ')
    .trim();
  return text ? text.split(/\s+/).length : 0;
}

export const readingMinutes = (words) => Math.max(1, Math.round(words / 200));

export const ALERT_TITLES = {
  note: { ltr: 'Note', rtl: 'ملاحظة' },
  tip: { ltr: 'Tip', rtl: 'نصيحة' },
  important: { ltr: 'Important', rtl: 'مهم' },
  warning: { ltr: 'Warning', rtl: 'تحذير' },
  caution: { ltr: 'Caution', rtl: 'تنبيه' },
};

/** GitHub alert marker at the start of a blockquote: `[!NOTE]` → 'note'. */
export function alertType(text) {
  const m = text.match(/^\s*\[!(note|tip|important|warning|caution)\]/i);
  return m ? m[1].toLowerCase() : null;
}
