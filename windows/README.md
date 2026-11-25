# MD Viewer for Windows

The Windows host wraps the shared `web/` UI in Electron using the exact same `mdv://` protocol and command bridge as the macOS Swift app.

## Build on Windows

```powershell
cd web
npm ci
npm run build

cd ..\windows
npm ci
npm run dist
```

Installers (`.exe` NSIS setup + portable `.exe`) are written to `build/windows/`.

## Publish automatically (no Windows machine needed)

Push a tag (for example `v1.0.0`) or run the **Build & Release** workflow in GitHub Actions (`.github/workflows/build.yml`). It builds both:
- `MD Viewer Setup *.exe` + portable `.exe` on `windows-latest`
- `MD Viewer.app` on `macos-latest`
