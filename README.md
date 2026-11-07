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
  "args": ["--zed", "$ZED_FILE", "$ZED_ROW"],
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

`⌥⇧P` then shows the file beside Zed, scrolled to the cursor line, without taking focus. The viewer re-renders on every save and comes forward whenever Zed does (menu **Zed → Come Forward With Zed**). Each request is logged to `~/Library/Logs/MD Viewer/zed.log`.

## Keys

`⌘O` open · `⌘T` new tab · `⌘E` editor · `⇧⌘O` outline · `⌘F` find · `⌘S` save · `⌘P` export PDF · `⇧⌘C` copy Markdown · `⌘+`/`⌘−` zoom · `⌥⌘Z` place beside Zed. **Help → Feature Tour** shows everything it renders.

## Layout

| Path | What |
|---|---|
| `mac/Sources/` | Swift app: windows and tabs (`DocWindow`), app and URL handling (`App`), menus, Zed companion, snapshot mode |
| `web/src/lib/` | Pure text helpers (direction, slugs, front matter) |
| `web/src/render/` | Markdown → HTML with source-line blocks, DOM enhancements (RTL, alerts, code blocks), mermaid |
| `web/src/ui/` | Editor, outline, find, icons |
| `web/src/styles/` | Colour tokens, window chrome, document typography |
| `fixtures/` | Documents used for snapshot checks; `Feature Tour.md` ships in the app |

## Check

```sh
./scripts/test.sh
```

Runs the unit tests in Docker, then renders every fixture with the real app into `build/snapshots/` (light, and dark with the editor open).
