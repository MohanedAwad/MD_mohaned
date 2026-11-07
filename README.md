# MD Viewer

A small native macOS Markdown viewer with correct Arabic / right-to-left text, mermaid diagrams, math, code highlighting, an outline, find, and an optional editor.

## Build and install

```sh
./scripts/install.sh
```

Needs Docker (builds `web/`) and Apple's Command Line Tools (`swiftc`, `codesign`). Installs to `~/Applications/MD Viewer.app`.

## Use

- Open a file: `⌘O`, drag it onto the window, `open -a "MD Viewer" file.md`, or `⌥⇧P` in Zed.
- `⌘E` editor · `⇧⌘O` outline · `⌘F` find · `⌘S` save · `⌘P` export PDF · `⌘T` new tab · `⌘+`/`⌘-` zoom.
- The view reloads when the file changes on disk.

## Check rendering without the UI

```sh
"build/MD Viewer.app/Contents/MacOS/MDViewer" --snapshot file.md out.png [--dark] [--editor] [--width N] [--height N]
```
