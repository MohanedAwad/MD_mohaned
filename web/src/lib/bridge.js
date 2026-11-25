// Platform bridge between the web UI and the native host (macOS WKWebView or Windows Electron).

export const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || '');
export const isMac = !isWindows;

/** Reads initial preferences injected by either Swift (MDV_PREFS) or Electron preload (mdvHost.prefs). */
export function getInitialPrefs() {
  return window.mdvHost?.prefs || window.MDV_PREFS || {};
}

/** Sends a structured message to the active native host. */
export function postToHost(msg) {
  if (window.webkit?.messageHandlers?.mdv) {
    window.webkit.messageHandlers.mdv.postMessage(msg);
  } else if (window.mdvHost?.postMessage) {
    window.mdvHost.postMessage(msg);
  }
}

/** True when the platform's primary action modifier is pressed (⌘ on macOS, Ctrl on Windows/Linux). */
export function isPrimaryMod(event) {
  return isMac ? event.metaKey : event.ctrlKey;
}

/** Normalizes Windows backslashes to forward slashes for consistent comparisons and URLs. */
export function normalizePath(p) {
  return typeof p === 'string' ? p.replace(/\\/g, '/') : p;
}

/** Encodes a local filesystem path into an `mdv://doc/...` base URL. */
export function docBaseHref(fileOrDirPath) {
  const norm = normalizePath(fileOrDirPath).replace(/^\/+/, '');
  return 'mdv://doc/' + norm.split('/').map(encodeURIComponent).join('/') + '/';
}
