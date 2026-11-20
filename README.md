# MD Viewer

A small native macOS Markdown viewer built for Arabic and other right-to-left text, with mermaid diagrams, math, code highlighting, an outline, find, an optional editor, and a companion mode for the Zed editor.

## Install

```sh
./scripts/install.sh
```

Needs Docker (builds `web/`) and Apple's Command Line Tools (`swift`, `swiftc`, `codesign`, `iconutil`). Installs to `~/Applications/MD Viewer.app`.

## Use with Zed

Add this task to `~/.config/zed/tasks.json`:

```json
{
  "label": "Markdown: Open in MD Viewer",
  "command": "/Users/<you>/.local/bin/mdviewer",
  "args": ["--zed", "$ZED_FILE", "$ZED_ROW", "$ZED_WORKTREE_ROOT"],
  "reveal": "never",
  "hide": "on_success"
}
```

and bind it in `~/.config/zed/keymap.json`:

```json
{
  "context": "Editor && extension == md",
  "bindings": { "alt-shift-p": ["task::Spawn", { "task_name": "Markdown: Open in MD Viewer" }] }
}
```

`⌥⇧P` then shows the file beside Zed, scrolled to the cursor line, with the Zed project as its workspace, without taking focus. The viewer re-renders on every save and comes forward whenever Zed does (menu **Zed → Come Forward With Zed**). Each request is logged to `~/Library/Logs/MD Viewer/zed.log`.

## Workspaces and keys

Opening a file also opens its project: the Zed project, else the nearest Git root, else its folder. The **Files** panel lists every Markdown file in it and updates live; **Outline** lists the headings; both can be shown together. The app reopens the last project and file on launch.

Shortcuts follow Zed where Zed has one (`⌘P` go to file, `⇧⌘P` command palette, `⌥⌘O` switch project, `⇧⌘O` go to heading, `⌘B` sidebar, `⇧⌘E` files, `⇧⌘B` outline). Press `⌘/` for the full list. Every command and shortcut is defined once, in `web/src/ui/commands.js`; the menu bar, palette and help are built from it.

The editor (`⌘E`) uses Vim keys, with the mode shown under it; `:w` saves, `:q` closes the editor, and **Toggle Vim Mode in Editor** in the command palette turns them off. The document fills the window. `⌘+` / `⌘−` zoom the page: text and diagrams grow, the side gutters do not, and a diagram wider than the window scrolls sideways. Text inside a diagram can be selected; the button in its corner opens the full-window view. In a flowchart, pressing a box keeps it, its arrows and the boxes they reach bright and dims the rest; press it again or an empty spot to clear.

A file picked inside the window (Files panel, `⌘P`) opens in the same tab, asking first if that tab has unsaved edits; `⌘`-click opens a new tab. Files opened from outside (Finder, the command line) get their own tab.

## Layout

| Path | What |
|---|---|
| `mac/Sources/` | Swift app: windows and tabs (`DocWindow`), opening and URL handling (`App`), project scan and watch (`Workspace`), menu bar from the command list, Zed companion, snapshot mode |
| `web/src/lib/` | Pure helpers: text direction, slugs, front matter, fuzzy matching |
| `web/src/render/` | Markdown → HTML with source-line blocks, DOM enhancements (RTL, alerts, code blocks), mermaid |
| `web/src/ui/` | Command list, pickers, file tree, outline, editor, find, icons |
| `web/src/styles/` | Colour tokens, window chrome, document typography |
| `fixtures/` | Documents used for snapshot checks; `Feature Tour.md` ships in the app |

## Check

```sh
./scripts/test.sh
```

Runs the unit tests in Docker, then renders every fixture with the real app into `build/snapshots/` (light, and dark with the editor open).
