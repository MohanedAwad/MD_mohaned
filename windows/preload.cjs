const { contextBridge, ipcRenderer } = require('electron');

const initialPrefs = ipcRenderer.sendSync('mdv:get-prefs');

contextBridge.exposeInMainWorld('mdvHost', {
  platform: process.platform,
  prefs: initialPrefs,
  postMessage(msg) {
    ipcRenderer.send('mdv:message', msg);
  },
});
