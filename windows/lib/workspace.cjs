const fs = require('node:fs');
const path = require('node:path');

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx']);
const SKIPPED_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'build', 'dist', 'out', 'target',
  'Pods', 'DerivedData', '__pycache__', 'venv', 'coverage', 'storage', 'bower_components',
]);
const FILE_LIMIT = 5000;

/** Nearest Git root above `filePath`, or its containing folder. */
function findRoot(filePath) {
  const start = path.dirname(path.resolve(filePath));
  const root = path.parse(start).root;
  let dir = start;
  while (dir && dir !== root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/** Markdown files under `rootDir` as sorted `/`-separated relative paths. */
async function scanWorkspace(rootDir) {
  const files = [];
  const stack = [rootDir];
  const base = path.resolve(rootDir);

  while (stack.length && files.length < FILE_LIMIT) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile() && MARKDOWN_EXTS.has(path.extname(entry.name).toLowerCase())) {
        files.push(path.relative(base, full).replace(/\\/g, '/'));
        if (files.length >= FILE_LIMIT) break;
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function findReadme(rootDir, files) {
  const hit = files.find((f) => !f.includes('/') && f.toLowerCase() === 'readme.md');
  return hit ? path.join(rootDir, hit) : null;
}

function isMarkdownFile(filePath) {
  return MARKDOWN_EXTS.has(path.extname(filePath).toLowerCase());
}

module.exports = { MARKDOWN_EXTS, findRoot, scanWorkspace, findReadme, isMarkdownFile };
