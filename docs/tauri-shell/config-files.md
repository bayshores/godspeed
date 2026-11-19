## Config files

tauri-build copies `bundle.externalBin`, `bundle.resources` and `bundle.macOS.frameworks` on every cargo build and fails when they are missing. They are gitignored build outputs, so they live in files only the release build reads (`stage-app.mjs --app`, then `tauri bundle`).

| File | Read by | Holds |
|---|---|---|
| `crates/shell/tauri.conf.json` | every cargo build, test and clippy, and `tauri build` | Names, identifier `com.bayshores.godspeed`, `frontendDist: "boot"`, bundle targets, icons, `minimumSystemVersion: "14.0"`, DMG layout, NSIS settings, the updater block. |
| `tauri.bundle.conf.json` | the release build | `externalBin`, the `ui/`, `models/` and `pdfjs-dist/` resources, `libpdfium.dylib` in Frameworks. |
| `tauri.bundle.macos.conf.json` | the release build on the Mac | The icon list with the compiled `../../.stage/Assets.car`. |
| `tauri.bundle.macos-intel.conf.json` | the release build on Intel Macs | Frameworks `libpdfium.dylib` and `libonnxruntime.dylib`. |
| `tauri.bundle.windows.conf.json` | the release build on Windows | The `pdfium.dll` resource. |
| `tauri.bundle.linux.conf.json` | the release build on Linux | The `libpdfium.so` and `libonnxruntime.so` resources. |

- The CLI merges `--config` files in order as JSON merge patches, so the `resources` maps combine.
- No `tauri.<platform>.conf.json` files, because tauri-build would read those too.
- Every `tauri` CLI call sets `TAURI_APP_PATH=crates/shell`, so the project folder is never found by walking.
- `beforeBuildCommand` runs from the repo root, so its path is `scripts/…`.
- No `devUrl`. The debug shell moves the window to Vite itself.
- No entitlements file.

### NSIS hook

`nsis/hooks.nsh` (`NSIS_HOOK_PREINSTALL`) removes an old electron-builder install. If `$LOCALAPPDATA\Programs\godspeed\Uninstall godspeed.exe` exists, it runs it with `/S _?=$LOCALAPPDATA\Programs\godspeed`, then deletes the uninstaller and the folder.

Without `_?=`, an NSIS uninstaller copies itself to `%TEMP%` and returns at once, then deletes the shortcuts the Tauri installer just made. With `_?=` it cannot delete itself, hence the two lines after. The Tauri copy installs to `$LOCALAPPDATA\godspeed`.
