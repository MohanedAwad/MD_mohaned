const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { findReadme, findRoot, isMarkdownFile, scanWorkspace } = require('./lib/workspace.cjs');
const { createPrefsStore } = require('./lib/prefs.cjs');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const webRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar', 'web')
  : path.resolve(__dirname, '..', 'web', 'dist');
const fixtureTour = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar', 'fixtures', 'Feature Tour.md')
  : path.resolve(__dirname, '..', 'fixtures', 'Feature Tour.md');

protocol.registerSchemesAsPrivileged([
  { scheme: 'mdv', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let prefs;
const docs = new Set();
let menuInstalled = false;

function json(v) {
  return JSON.stringify(v);
}

function toAccelerator(spec) {
  if (!spec) return undefined;
  const parts = spec.split('+');
  const key = parts.pop();
  const mods = parts.map((m) => ({ cmd: 'CommandOrControl', alt: 'Alt', shift: 'Shift', ctrl: 'Control' }[m])).filter(Boolean);
  const keyMap = { plus: 'Plus', tab: 'Tab', '/': '/', '-': '-' };
  return [...mods, keyMap[key] || key.toUpperCase()].join('+');
}

function buildMenu(commands) {
  const byGroup = new Map();
  for (const c of commands) {
    if (c.group === 'Zed' || c.id === 'nextTab' || c.id === 'previousTab' || c.id === 'toggleTerminal') continue;
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group).push({
      label: c.title,
      accelerator: toAccelerator(c.keys),
      click: () => {
        const win = BrowserWindow.getFocusedWindow();
        const doc = [...docs].find((d) => d.win === win) || [...docs][0];
        if (!doc) return;
        if (c.native) runNative(c.id, doc);
        else doc.command(c.id);
      },
    });
  }

  const template = [];
  for (const group of ['File', 'Edit', 'View', 'Go', 'Window', 'Help']) {
    const items = byGroup.get(group) || [];
    if (group === 'Edit') {
      items.unshift({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
    }
    if (group === 'File') {
      items.push({ type: 'separator' }, { role: 'close' }, { role: 'quit' });
    }
    if (group === 'Window') {
      items.unshift({ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' });
    }
    if (items.length) template.push({ label: group, submenu: items });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

class DocWindow {
  constructor() {
    this.filePath = null;
    this.workspace = null;
    this.isUntitled = false;
    this.files = [];
    this.diskText = '';
    this.dirty = false;
    this.ready = false;
    this.fileWatcher = null;
    this.folderWatcher = null;
    this.reloadTimer = null;
    this.scanTimer = null;
    this.forceClose = false;

    this.win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 420,
      minHeight: 320,
      title: 'MD Viewer',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1117' : '#ffffff',
      show: false,
      autoHideMenuBar: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    this.win.once('ready-to-show', () => this.win.show());

    docs.add(this);

    this.win.on('close', (e) => {
      if (this.forceClose || !this.dirty) return;
      e.preventDefault();
      this.askToSave(() => {
        this.forceClose = true;
        this.win.close();
      });
    });

    this.win.on('closed', () => {
      this.stopWatchers();
      docs.delete(this);
    });

    this.win.loadURL('mdv://app/index.html');
  }

  call(js) {
    if (!this.win.isDestroyed()) this.win.webContents.executeJavaScript(js).catch(() => {});
  }

  command(name, arg) {
    this.call(`mdv.command(${json(name)}, ${arg === undefined ? 'undefined' : json(arg)})`);
  }

  stopWatchers() {
    clearTimeout(this.reloadTimer);
    clearTimeout(this.scanTimer);
    this.fileWatcher?.close();
    this.folderWatcher?.close();
    this.fileWatcher = null;
    this.folderWatcher = null;
  }

  updateTitle() {
    const name = this.filePath ? path.basename(this.filePath) : (this.isUntitled ? 'Untitled' : (this.workspace ? path.basename(this.workspace) : 'MD Viewer'));
    this.win.setTitle(this.dirty ? `${name} •` : name);
  }

  newUntitled() {
    this.isUntitled = true;
    this.filePath = null;
    this.dirty = false;
    this.updateTitle();
    if (this.ready) this.call('mdv.newDocument()');
  }

  loadFile(filePath, line = 0) {
    const resolved = path.resolve(filePath);
    this.isUntitled = false;
    if (!this.workspace || !resolved.startsWith(this.workspace + path.sep)) {
      this.setWorkspace(findRoot(resolved));
    }
    this.filePath = resolved;
    try {
      this.diskText = fs.readFileSync(resolved, 'utf8');
    } catch {
      this.diskText = '';
    }
    this.dirty = false;
    prefs.setLastSession(this.workspace, resolved);
    this.updateTitle();
    if (this.ready) {
      this.call(`mdv.load(${json({ path: resolved, text: this.diskText, line })})`);
    }
    this.watchFile();
  }

  clearFile() {
    this.filePath = null;
    this.isUntitled = false;
    this.fileWatcher?.close();
    this.fileWatcher = null;
    this.diskText = '';
    this.dirty = false;
    this.updateTitle();
    if (this.ready) this.call('mdv.clear()');
  }

  setWorkspace(rootDir) {
    const resolved = path.resolve(rootDir);
    if (this.workspace === resolved) return;
    this.workspace = resolved;
    this.files = [];
    prefs.noteRecent(resolved);
    for (const d of docs) d.sendRecents();
    this.folderWatcher?.close();
    try {
      this.folderWatcher = fs.watch(resolved, { recursive: true }, () => {
        clearTimeout(this.scanTimer);
        this.scanTimer = setTimeout(() => this.rescan(), 200);
      });
    } catch {
      this.folderWatcher = null;
    }
    this.rescan();
    this.updateTitle();
  }

  async rescan(then) {
    const root = this.workspace;
    if (!root) return;
    const found = await scanWorkspace(root);
    if (this.workspace !== root) return;
    if (JSON.stringify(found) !== JSON.stringify(this.files)) {
      this.files = found;
      this.sendWorkspace();
    }
    if (then) then(found);
  }

  sendRecents() {
    if (this.ready) this.call(`mdv.setRecents(${json(prefs.recents)})`);
  }

  sendWorkspace() {
    if (!this.ready || !this.workspace) return;
    this.call(`mdv.setWorkspace(${json({ root: this.workspace, name: path.basename(this.workspace), files: this.files })})`);
  }

  watchFile() {
    this.fileWatcher?.close();
    this.fileWatcher = null;
    if (!this.filePath) return;
    const target = this.filePath;
    try {
      this.fileWatcher = fs.watch(target, () => {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.reloadFromDisk(), 50);
      });
    } catch {
      this.fileWatcher = null;
    }
  }

  reloadFromDisk() {
    if (!this.filePath) return;
    try {
      const text = fs.readFileSync(this.filePath, 'utf8');
      if (text === this.diskText) return;
      this.diskText = text;
      this.call(`mdv.diskChanged(${json(text)})`);
    } catch {
      // File may be mid-atomic-replace; retry shortly.
      setTimeout(() => this.watchFile(), 150);
    }
  }

  async save(done) {
    if (!this.filePath) {
      if (this.isUntitled) return this.saveAs(done);
      if (done) done(false);
      return;
    }
    try {
      const text = await this.win.webContents.executeJavaScript('mdv.getText()');
      fs.writeFileSync(this.filePath, text, 'utf8');
      this.diskText = text;
      this.dirty = false;
      this.updateTitle();
      this.call(`mdv.saved(${json(text)})`);
      this.watchFile();
      if (done) done(true);
    } catch (err) {
      dialog.showErrorBox('Save Failed', err.message);
      if (done) done(false);
    }
  }

  async saveAs(done) {
    const res = await dialog.showSaveDialog(this.win, {
      defaultPath: this.workspace ? path.join(this.workspace, 'Untitled.md') : 'Untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] }],
    });
    if (res.canceled || !res.filePath) {
      if (done) done(false);
      return;
    }
    try {
      const text = await this.win.webContents.executeJavaScript('mdv.getText()');
      fs.writeFileSync(res.filePath, text, 'utf8');
      this.loadFile(res.filePath);
      this.rescan();
      if (done) done(true);
    } catch (err) {
      dialog.showErrorBox('Save Failed', err.message);
      if (done) done(false);
    }
  }

  async exportPDF() {
    const res = await dialog.showSaveDialog(this.win, {
      defaultPath: (this.filePath ? path.basename(this.filePath, path.extname(this.filePath)) : 'Document') + '.pdf',
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return;
    try {
      await this.win.webContents.executeJavaScript('mdv.preparePrint()');
      const data = await this.win.webContents.printToPDF({ printBackground: true, margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
      fs.writeFileSync(res.filePath, data);
    } catch (err) {
      dialog.showErrorBox('Export PDF Failed', err.message);
    } finally {
      this.call('mdv.endPrint()');
    }
  }

  async askToSave(then) {
    const name = this.filePath ? path.basename(this.filePath) : 'this file';
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Save changes to ${name}?`,
      detail: "Your edits will be lost if you don't save them.",
    });
    if (response === 0) this.save((ok) => { if (ok) then(); });
    else if (response === 1) { this.dirty = false; then(); }
  }

  handleMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        if (!menuInstalled && Array.isArray(msg.commands)) {
          menuInstalled = true;
          buildMenu(msg.commands);
        }
        this.sendRecents();
        this.sendWorkspace();
        if (this.filePath) {
          this.call(`mdv.load(${json({ path: this.filePath, text: this.diskText, line: 0 })})`);
        } else if (this.isUntitled) {
          this.call('mdv.newDocument()');
        }
        break;
      case 'openFile':
        if (msg.path) {
          const target = path.resolve(msg.path);
          const openElsewhere = [...docs].some((d) => d !== this && d.filePath === target);
          if (msg.newTab || !this.dirty || openElsewhere) {
            openFile(target, { preferred: this, newWindow: Boolean(msg.newTab) });
          } else {
            this.askToSave(() => openFile(target, { preferred: this }));
          }
        }
        break;
      case 'openWorkspace':
        if (msg.path) openWorkspace(msg.path, { preferred: this, newWindow: Boolean(msg.newTab) });
        break;
      case 'native':
        if (msg.id) runNative(msg.id, this);
        break;
      case 'dirty':
        this.dirty = Boolean(msg.value);
        this.updateTitle();
        break;
      case 'pref':
        if (msg.key) prefs.setFromWeb(msg.key, msg.value);
        break;
      case 'chrome':
        nativeTheme.themeSource = msg.dark ? 'dark' : 'light';
        break;
      case 'copy':
        clipboard.writeText(String(msg.text ?? ''));
        break;
      case 'link':
        if (msg.href) openLink(msg.href, this, Boolean(msg.newTab));
        break;
      case 'log':
        console.error('[web]', msg.message);
        break;
    }
  }
}

function openLink(href, doc, newWindow) {
  try {
    const u = new URL(href);
    if (u.protocol === 'mdv:' && u.hostname === 'doc') {
      let local = decodeURIComponent(u.pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(local)) local = local.slice(1);
      if (isMarkdownFile(local)) openFile(local, { preferred: doc, newWindow });
      else shell.showItemInFolder(path.resolve(local));
    } else if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
      shell.openExternal(href);
    }
  } catch {
    // Ignore malformed URLs.
  }
}

function openFile(filePath, { preferred = null, newWindow = false } = {}) {
  const resolved = path.resolve(filePath);
  const existing = [...docs].find((d) => d.filePath === resolved);
  if (existing) {
    existing.win.focus();
    return existing;
  }
  let target = null;
  if (!newWindow) {
    if (preferred && !preferred.dirty) target = preferred;
    else target = [...docs].find((d) => !d.filePath && !d.isUntitled);
  }
  const doc = target || new DocWindow();
  doc.loadFile(resolved);
  doc.win.focus();
  return doc;
}

function openWorkspace(rootDir, { preferred = null, newWindow = false } = {}) {
  const resolved = path.resolve(rootDir);
  const doc = (!newWindow && preferred && !preferred.dirty)
    ? preferred
    : (newWindow ? new DocWindow() : ([...docs].find((d) => !d.filePath && !d.isUntitled) || new DocWindow()));
  doc.setWorkspace(resolved);
  doc.clearFile();
  doc.rescan((files) => {
    const readme = findReadme(resolved, files);
    if (readme && !doc.filePath) doc.loadFile(readme);
  });
  doc.win.focus();
  return doc;
}

async function openPanel(doc) {
  const res = await dialog.showOpenDialog(doc?.win, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx', 'txt'] }],
  });
  if (res.canceled) return;
  for (const p of res.filePaths) {
    if (fs.statSync(p).isDirectory()) openWorkspace(p, { preferred: doc });
    else openFile(p, { preferred: doc });
  }
}

function runNative(id, doc) {
  switch (id) {
    case 'openAny': openPanel(doc); break;
    case 'newTab': {
      const next = new DocWindow();
      if (doc?.workspace) next.setWorkspace(doc.workspace);
      next.newUntitled();
      next.win.focus();
      break;
    }
    case 'save': doc?.save(); break;
    case 'exportPDF': doc?.exportPDF(); break;
    case 'revealInFinder': {
      const target = doc?.filePath || doc?.workspace;
      if (target) shell.showItemInFolder(target);
      break;
    }
    case 'zoomIn':
      if (doc) {
        const z = Math.min(doc.win.webContents.getZoomFactor() + 0.1, 3);
        doc.win.webContents.setZoomFactor(z);
        doc.call(`mdv.setZoom(${z})`);
      }
      break;
    case 'zoomOut':
      if (doc) {
        const z = Math.max(doc.win.webContents.getZoomFactor() - 0.1, 0.5);
        doc.win.webContents.setZoomFactor(z);
        doc.call(`mdv.setZoom(${z})`);
      }
      break;
    case 'zoomReset':
      if (doc) {
        doc.win.webContents.setZoomFactor(1);
        doc.call('mdv.setZoom(1)');
      }
      break;
    case 'featureTour':
      if (fs.existsSync(fixtureTour)) openFile(fixtureTour, { newWindow: true });
      break;
  }
}

function handleArgs(argv) {
  const target = argv.slice(1).find((a) => !a.startsWith('-') && fs.existsSync(a));
  if (!target) return false;
  if (fs.statSync(target).isDirectory()) openWorkspace(target);
  else openFile(target);
  return true;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!handleArgs(argv) && docs.size) [...docs][0].win.focus();
  });

  app.whenReady().then(() => {
    prefs = createPrefsStore(path.join(app.getPath('userData'), 'prefs.json'));

    protocol.handle('mdv', async (request) => {
      const u = new URL(request.url);
      if (u.hostname === 'app') {
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
        const file = path.resolve(webRoot, rel);
        if (!file.startsWith(path.resolve(webRoot))) return new Response('Forbidden', { status: 403 });
        try {
          const data = await fs.promises.readFile(file);
          const mime = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
          const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store';
          return new Response(data, { status: 200, headers: { 'Content-Type': mime, 'Cache-Control': cache } });
        } catch {
          return new Response('Not Found', { status: 404 });
        }
      }
      if (u.hostname === 'doc') {
        let local = decodeURIComponent(u.pathname);
        if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(local)) local = local.slice(1);
        const file = path.resolve(local);
        if (!IMAGE_EXTS.has(path.extname(file).toLowerCase())) return new Response('Forbidden', { status: 403 });
        try {
          const data = await fs.promises.readFile(file);
          const mime = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
          return new Response(data, { status: 200, headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' } });
        } catch {
          return new Response('Not Found', { status: 404 });
        }
      }
      return new Response('Not Found', { status: 404 });
    });

    ipcMain.on('mdv:get-prefs', (e) => { e.returnValue = prefs.web; });
    ipcMain.on('mdv:message', (e, msg) => {
      const doc = [...docs].find((d) => d.win.webContents === e.sender);
      doc?.handleMessage(msg);
    });

    if (!handleArgs(process.argv)) {
      const { workspace, file } = prefs.lastSession;
      if (file && fs.existsSync(file)) {
        const doc = new DocWindow();
        if (workspace && fs.existsSync(workspace)) doc.setWorkspace(workspace);
        doc.loadFile(file);
      } else if (workspace && fs.existsSync(workspace)) {
        openWorkspace(workspace);
      } else {
        new DocWindow();
      }
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
