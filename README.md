# MD_mohaned

Fast native Markdown viewer & Vim editor for **macOS** (Swift + `WKWebView`) and **Windows** (Electron) with RTL/Arabic support, Mermaid diagrams, flowchart visual editor, KaTeX math, and live sync.

## Build & Install (macOS)

```sh
./scripts/install.sh stable
```

Needs Node.js (or Docker) for `web/` and Apple's Command Line Tools (`swift`, `swiftc`, `codesign`, `iconutil`). Installs to `~/Applications/MD_mohaned.app` (`~/.local/bin/md-mohaned`).

## Windows

See [windows/README.md](windows/README.md) or push a `v*` tag to build Windows `.exe` installers and macOS `.app` automatically via GitHub Actions.

## Zed integration

In `~/.config/zed/tasks.json`:

```json
[
  {
    "label": "Markdown: Open in MD_mohaned",
    "command": "/Users/<you>/.local/bin/md-mohaned",
    "args": ["--zed", "$ZED_FILE", "$ZED_ROW", "$ZED_WORKTREE_ROOT"],
    "reveal": "never",
    "hide": "always"
  }
]
```

In `~/.config/zed/keymap.json`:

```json
[
  {
    "context": "Editor",
    "bindings": { "alt-shift-p": ["task::Spawn", { "task_name": "Markdown: Open in MD_mohaned" }] }
  }
]
```
