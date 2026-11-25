const fs = require('node:fs');
const path = require('node:path');

const WEB_KEYS = new Set(['theme', 'sync', 'sidebar', 'sidebarHidden', 'vim']);

function createPrefsStore(filePath) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    data = {};
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
      // Ignore write failures in restricted environments.
    }
  }

  return {
    get web() {
      const out = {};
      for (const k of WEB_KEYS) if (k in data) out[k] = data[k];
      return out;
    },
    setFromWeb(key, value) {
      if (!WEB_KEYS.has(key)) return;
      data[key] = value;
      save();
    },
    get recents() {
      return (Array.isArray(data.recentWorkspaces) ? data.recentWorkspaces : []).filter((p) => fs.existsSync(p));
    },
    noteRecent(rootDir) {
      const list = this.recents.filter((p) => p !== rootDir);
      list.unshift(rootDir);
      data.recentWorkspaces = list.slice(0, 15);
      save();
    },
    get lastSession() {
      return { workspace: data.lastWorkspace || null, file: data.lastFile || null };
    },
    setLastSession(workspace, file) {
      data.lastWorkspace = workspace || null;
      data.lastFile = file || null;
      save();
    },
  };
}

module.exports = { createPrefsStore };
