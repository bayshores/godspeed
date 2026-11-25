## Files

| Path | Crate | Holds |
|---|---|---|
| `crates/shell/` | `gs-shell`, binary `godspeed` | The Tauri app: `src/`, `build.rs`, `capabilities/`, `permissions/`, `icons/`, `dmg/`, `boot/index.html`, `nsis/hooks.nsh`, `release/` (Electron feed templates, `electron-requirement.txt`), config files ([Config files](config-files.md#config-files)). |
| `crates/shell-rpc/` | `gs-shell-rpc` | The line protocol: message enums, line reader and writer, `ShellLink` (the server's handle: request ids, a pending map of tokio oneshots, `request(msg).await`). Depends on `gs-base`, serde, serde_json, tokio. |

### Source files in `crates/shell/src/`

| File | Job |
|---|---|
| `main.rs` | Builder: plugins, commands, setup, `RunEvent` handling. Release builds set `windows_subsystem = "windows"`. |
| `paths.rs` | userData, data, logs, resources, pdfium path, updater cache, demo folder, dev variants. |
| `log.rs` | `main.log` writer, rotation, panic hook. |
| `old_app.rs` | Whether Electron runs on this userData; writes and removes `shell.pid`. |
| `first_run.rs` | One-time data backup, cleanup of Electron leftovers. |
| `quit.rs` | The one exit routine: stop the agents' terminals, then the server, clean up, install a downloaded update. |
| `server.rs` | Port choice, secret, spawn, ready wait, login tokens, restarts, stop, `mcp-endpoint.json`. |
| `rpc.rs` | Reads the server's stdout lines, queues demo work, passes notifications, line clears, page opens and the menu bar countdown on, and writes replies to its stdin. |
| `notify.rs` | System notifications the server asks for. |
| `terminal_window.rs` | The terminal window: its place and size, its commands, the `terminal-window` push. |
| `window.rs` | Window labels, the builder every window shares, main window, navigation rules, `open_link`, show fallback, title, downloads, pending `open-settings` push, window commands. |
| `menu.rs` | Application menu, and the handler for every menu click, the menu bar item's too. |
| `menu_bar_countdown.rs` | Mac only: the menu bar item (the g logo, the time left to the nearest deadline, a menu of the coming ones), drawn from the server's `menu_bar_countdown` lines. |
| `zoom.rs` | Zoom ladder, `zoom` push, zoom commands. |
| `commands.rs` | Trust check `trusted()` and OS commands. Mac-only commands sit in its `appkit` module. |
| `fonts.rs` | Installed font families for `list_fonts`. |
| `open.rs` | App bundle checks, open path, show in folder. |
| `terminal/` | The agents' terminals: records and threads (`mod.rs`), commands (`commands.rs`), start script in a pseudo-terminal per OS (`spawn.rs`), screen and what the shell recognises on it (`screen.rs`). See [Terminals](terminals.md#terminals). |
| `bug_report.rs` | Issue URL. |
| `update.rs` | Updater state, checks, download, update commands, the install step `quit.rs` calls. |
| `restarts.rs` | Restart limit. |
| `push.rs` | Shell to page messages through `webview.eval`. |
| `shim.js` | `window.lh`, injected with `include_str!`. |
| `demo.rs` | Shared demo constants and page recorder; `run` and `svg` come from `mac::demo` on the Mac, `demo_webview` elsewhere. |
| `demo_webview.rs` | Windows and Linux demo runner, a hidden Tauri window labeled `demo`. |
| `self_test.rs` | Only with cargo feature `self-test`: `godspeed --self-test`. |
| `screens.rs` | Only with cargo feature `screens`, Mac only: the screenshot lab's control channel, and the lab's unseen window with no Dock icon. |

### Platform folders

| Folder | Holds |
|---|---|
| `mac/` | `app_icon.rs` (the app icon picked in Settings), `clipboard.rs` (Paste text), `demo.rs` (hidden WKWebView demo runner, SVG snapshot), `print.rs` (PDFKit printing), `window.rs` (drag pasteboard paths, title bar double-click setting, WebKit text defaults, traffic-light title fix), `fonts.rs` (`NSFontManager` families), `screens.rs` (lab snapshots, the unseen window). |
| `win/` | `drop.rs` (dropped file paths through WebView2 `WebMessageReceived`), `demo.rs` (demo window's browser arguments, SVG snapshot), `clipboard.rs` (Paste text), `job.rs` (Job Object holding a terminal's processes), `path.rs` (fresh registry `Path` for a terminal). |
| `linux/` | `demo.rs` (WebKitGTK content filter for the demo window, via `webkit2gtk-sys`), `clipboard.rs` (GTK Paste text). |

### Rules

- Workspace keeps `unsafe_code = "deny"`. Only `mac/mod.rs`, `win/mod.rs` and `linux/mod.rs` start with `#![allow(unsafe_code)]`, and every `unsafe` block there has a `// SAFETY:` line.
- The shell uses `gs_base::clock` and `gs_base::fsx` like the server; `clippy.toml` applies.
- It depends on `gs-base` and `gs-shell-rpc`, never on server crates.
- stdout is the protocol channel. The workspace denies `print_stdout`, and `clippy.toml` bans `std::io::stdout`. The server's one writer (`ShellLink::new(std::io::stdout())` in `crates/server/src/main.rs`) carries `#[allow(clippy::disallowed_methods)]`.
- Tauri and plugin versions are pinned exactly (`=x.y.z`) in the root `Cargo.toml`. Check an API name on the docs.rs page of the pinned version first.
