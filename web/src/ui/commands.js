// Every command, once. The palette, the help sheet, and the native menu bar
// (built by the Swift side from this list) all read it.
// `native: true` commands run in Swift; the rest run in this page.
export const COMMANDS = [
  { id: 'openAny', title: 'Open File or Folder…', keys: 'cmd+o', group: 'File', native: true },
  { id: 'switchProject', title: 'Switch Project…', keys: 'cmd+alt+o', group: 'File' },
  { id: 'newTab', title: 'New Tab', keys: 'cmd+t', group: 'File', native: true },
  { id: 'save', title: 'Save', keys: 'cmd+s', group: 'File', native: true },
  { id: 'exportPDF', title: 'Export PDF…', keys: 'cmd+alt+p', group: 'File', native: true },
  { id: 'revealInFinder', title: 'Reveal in Finder', keys: 'cmd+alt+r', group: 'File', native: true },

  { id: 'copyMarkdown', title: 'Copy Markdown', keys: 'cmd+shift+c', group: 'Edit' },
  { id: 'find', title: 'Find…', keys: 'cmd+f', group: 'Edit' },
  { id: 'findNext', title: 'Find Next', keys: 'cmd+g', group: 'Edit' },
  { id: 'findPrevious', title: 'Find Previous', keys: 'cmd+shift+g', group: 'Edit' },

  { id: 'goToFile', title: 'Go to File…', keys: 'cmd+p', group: 'Go' },
  { id: 'goToHeading', title: 'Go to Heading…', keys: 'cmd+shift+o', group: 'Go' },
  { id: 'palette', title: 'Command Palette…', keys: 'cmd+shift+p', group: 'Go' },

  { id: 'toggleSidebar', title: 'Toggle Sidebar', keys: 'cmd+b', group: 'View' },
  { id: 'showFiles', title: 'Files Panel', keys: 'cmd+shift+e', group: 'View' },
  { id: 'showOutline', title: 'Outline Panel', keys: 'cmd+shift+b', group: 'View' },
  { id: 'showBoth', title: 'Files and Outline Together', keys: 'cmd+alt+b', group: 'View' },
  { id: 'toggleEditor', title: 'Toggle Editor', keys: 'cmd+e', group: 'View' },
  { id: 'toggleSync', title: 'Toggle Sync Scroll', keys: '', group: 'View' },
  { id: 'themeAuto', title: 'Theme: Auto (follow macOS)', keys: '', group: 'View' },
  { id: 'themeLight', title: 'Theme: Light', keys: '', group: 'View' },
  { id: 'themeDark', title: 'Theme: Dark', keys: '', group: 'View' },
  { id: 'zoomIn', title: 'Zoom In', keys: 'cmd+plus', group: 'View', native: true },
  { id: 'zoomOut', title: 'Zoom Out', keys: 'cmd+-', group: 'View', native: true },
  { id: 'zoomReset', title: 'Actual Size', keys: 'cmd+0', group: 'View', native: true },

  { id: 'placeBesideZed', title: 'Place Beside Zed', keys: 'cmd+alt+z', group: 'Zed', native: true },
  { id: 'followZed', title: 'Come Forward With Zed', keys: '', group: 'Zed', native: true },

  { id: 'nextTab', title: 'Next Tab', keys: 'ctrl+tab', group: 'Window', native: true },
  { id: 'previousTab', title: 'Previous Tab', keys: 'ctrl+shift+tab', group: 'Window', native: true },

  { id: 'shortcuts', title: 'Keyboard Shortcuts', keys: 'cmd+/', group: 'Help' },
  { id: 'featureTour', title: 'Feature Tour', keys: '', group: 'Help', native: true },
];
