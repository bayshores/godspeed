# The desktop shell

This page explains how the Tauri desktop app (`crates/shell`) works: its window, the server it starts, the bridge the page calls, updates and data. Read it before you change the shell. Building and releasing the app is in [desktop-release.md](desktop-release.md), and the server itself is in [rust-server.md](rust-server.md).

## The shape in one picture

```
godspeed (Tauri shell, crates/shell)                         godspeed-server (crates/server)
  main window: WKWebView / WebView2 / WebKitGTK                 127.0.0.1:<port>, cwd = resources
    loads http://127.0.0.1:<port>/  (cookie gs_desktop)  ───►   /api/* (cookie + Sec-Fetch-Site)
    window.lh shim ──invoke──► shell commands                    /api/mcp (bearer token, agents)
  hidden demo view (objc2 WKWebView on the Mac, a `demo` window elsewhere)
  stdin  ────────── JSON lines: login, demo results ──────────►  stdin  (EOF = stop)
  stdout ◄───────── JSON lines: ready, demo/svg requests ─────── stdout (protocol only)
  logs/main.log ◄── "server: …" ──────────────────────────────── stderr (log lines)
```

The shell is one window and a guard. All app logic runs in `godspeed-server`, a child process the shell starts and stops.

## Files

| Path | Crate | What it holds |
|---|---|---|
| `crates/shell/` | `gs-shell`, binary `godspeed` | The Tauri app: `src/`, `build.rs`, `capabilities/`, `permissions/`, `icons/`, `dmg/`, `boot/index.html`, `nsis/hooks.nsh`, `release/` (the Electron feed templates and `electron-requirement.txt`) and the config files (see [Config files](#config-files)). |
| `crates/shell-rpc/` | `gs-shell-rpc` | The line protocol: the message enums, the line reader and writer, and `ShellLink`, the server's handle (request ids, a pending map of tokio oneshots, `request(msg).await`). It depends on `gs-base`, serde, serde_json and tokio. |

### Source files in `crates/shell/src/`

| File | Job |
|---|---|
| `main.rs` | The builder: plugins, commands, setup and `RunEvent` handling. Release builds set `windows_subsystem = "windows"`. |
| `paths.rs` | userData, data, logs, resources, the pdfium path, the updater cache and the demo folder, with dev variants. |
| `log.rs` | The `main.log` writer, rotation and the panic hook. |
| `old_app.rs` | Whether the Electron app runs on this userData; writes and removes `shell.pid`. |
| `first_run.rs` | The one-time data backup and the cleanup of Electron leftovers. |
| `quit.rs` | The one exit routine: stop the agents' terminals, then the server, clean up, then install a downloaded update. |
| `server.rs` | Port choice, the secret, spawn, the ready wait, login tokens, restarts, stop and `mcp-endpoint.json`. |
| `rpc.rs` | Reads the server's stdout lines, queues demo work, writes replies to the server's stdin. |
| `notify.rs` | Shows the system notifications the server asks for. |
| `window.rs` | The main window, navigation rules, `open_link`, the show fallback, the title, downloads, the pending `open-settings` push and the window commands. |
| `menu.rs` | The application menu. |
| `zoom.rs` | The zoom ladder, the `zoom` push and the zoom commands. |
| `commands.rs` | The trust check `trusted()` and the OS commands. Mac-only commands sit in its `appkit` module. |
| `fonts.rs` | The installed font families for `list_fonts`. |
| `open.rs` | App bundle checks, open path, show in folder. |
| `terminal/` | The agents' terminals: the records and their threads (`mod.rs`), the commands (`commands.rs`), the start script in a pseudo-terminal for each OS (`spawn.rs`), the screen and what the shell recognises on it (`screen.rs`). See [Terminals](#terminals). |
| `bug_report.rs` | The issue URL. |
| `update.rs` | Updater state, checks, download, the update commands, and the install step `quit.rs` calls. |
| `restarts.rs` | The restart limit. |
| `push.rs` | Shell to page messages through `webview.eval`. |
| `shim.js` | `window.lh`, injected with `include_str!`. |
| `demo.rs` | Shared demo constants and the page recorder; `run` and `svg` come from `mac::demo` on the Mac and `demo_webview` elsewhere. |
| `demo_webview.rs` | The Windows and Linux demo runner, a hidden Tauri window labeled `demo`. |
| `self_test.rs` | Only with cargo feature `self-test`: `godspeed --self-test`. |
| `screens.rs` | Only with cargo feature `screens`, Mac only: the screenshot lab's control channel. |

### Platform folders

| Folder | What it holds |
|---|---|
| `mac/` | `clipboard.rs` (the clipboard's text for Paste), `demo.rs` (the hidden WKWebView demo runner and SVG snapshot), `print.rs` (PDFKit printing), `window.rs` (drag pasteboard paths, the title bar double-click setting, WebKit text defaults, the title fix for the traffic lights), `fonts.rs` (`NSFontManager` font families), `screens.rs` (snapshots for the lab). |
| `win/` | `drop.rs` (dropped file paths through WebView2 `WebMessageReceived`), `demo.rs` (the demo window's browser arguments and SVG snapshot), `clipboard.rs` (the clipboard's text for Paste), `job.rs` (the Job Object that holds a terminal's processes), `path.rs` (a fresh `Path` from the registry for a terminal). |
| `linux/` | `demo.rs` (the WebKitGTK content filter for the demo window, through `webkit2gtk-sys`), `clipboard.rs` (GTK's clipboard text for Paste). |

### Rules

- The workspace keeps `unsafe_code = "deny"`. Only `mac/mod.rs`, `win/mod.rs` and `linux/mod.rs` start with `#![allow(unsafe_code)]`, and every `unsafe` block there has a `// SAFETY:` line.
- The shell uses `gs_base::clock` and `gs_base::fsx` like the server, and `clippy.toml` applies to it.
- The shell depends on `gs-base` and `gs-shell-rpc`, never on the server crates.
- stdout is the protocol channel. The workspace denies `print_stdout`, and `clippy.toml` bans `std::io::stdout`. The server's one writer (`ShellLink::new(std::io::stdout())` in `crates/server/src/main.rs`) carries `#[allow(clippy::disallowed_methods)]`.
- Tauri and plugin versions are pinned exactly (`=x.y.z`) in the root `Cargo.toml`. Check an API name in the docs.rs page of the pinned version before you rely on it.

## The line protocol

One JSON object per line, UTF-8, ending in `\n`. The field `t` names the message. The server speaks it only when `LH_SHELL=1`.

| Direction | Message | Meaning |
|---|---|---|
| server to shell | `{"t":"ready"}` | Listening. Sent once, right after the bind. |
| shell to server | `{"t":"login","id":n,"token":"<64 hex>"}` | Accept this one-time login token. It expires after 60 s by the app clock. |
| server to shell | `{"t":"login_ok","id":n}` | Stored. The shell opens the login URL only after this. |
| server to shell | `{"t":"demo","id":n,"html":"…","probe":"…"\|null}` | Run a demo. |
| server to shell | `{"t":"svg","id":n,"svg":"…","width":w,"height":h}` | Snapshot an SVG that resvg could not draw. |
| server to shell | `{"t":"notify","id":n,"title":"…","body":"…"}` | Show a system notification (a deadline reminder). |
| shell to server | `{"t":"demo_done","id":n,"result":{"consoleErrors":[],"pageErrors":[],"failedRequests":[],"probeResult":…,"ok":true}}` or `{"t":"demo_done","id":n,"error":"…"}` | `probeResult` is absent when no probe ran. |
| shell to server | `{"t":"svg_done","id":n,"png":"<base64>"}` or `{"t":"svg_done","id":n,"error":"…"}` | A PNG of exactly w × h px. |
| shell to server | `{"t":"notify_done","id":n,"shown":true\|false}` | False while the main window has the focus, or when the plugin refused it. |
| shell to server | `{"t":"terminals","live":["<32 hex>",…]}` | The ids of the agents' terminals that run now. Sent after every start, Stop and end. |

- Unknown lines are logged to stderr and skipped on both sides.
- stdin EOF stops the server. This works on every OS.
- The server waits at most 60 s for an answer, then fails with `demo check timed out`.
- An answer meant for a server that has since died is dropped. A restarted server starts a new id space.

## Demo checks

WKWebView needs the main thread of a process with an `NSApplication`, so the shell runs demos and the server asks for them over the protocol.

1. The server builds a `ShellLink` on its stdin and stdout when `LH_SHELL=1` and keeps it in `App::shell`.
2. `get_headless(pdf, shell)` sends demo runs and SVG snapshots through the link. Without a link it answers the no-browser error.
3. The shell's `rpc.rs` queues each request and runs one at a time on the main thread.
4. Each run creates its own view and closes it when it ends, so no demo window outlives a run.

| Limit | Value |
|---|---|
| Demo page size | 800 × 600 |
| Page load | 30 s, then the page error `Navigation timeout of 30000 ms exceeded` |
| Settle time before the page is read | 2 s |
| Page answer or SVG snapshot | 15 s |
| Server wait per request | 60 s |

### The Mac demo view

The Mac uses a WKWebView built with objc2, with no Tauri bridge at all.

- `WKWebsiteDataStore.nonPersistentDataStore()`, so it has no cookie.
- A content rule list blocks `127.*`, `localhost`, `[::1]` and `0.0.0.0`.
- The page origin is `https://demo.invalid/`.
- The navigation delegate allows only the first load and `about:blank`, and cancels downloads.
- The NSWindow is borderless, alpha 0 and kept on screen so animations run. It ignores the mouse and stays out of the Window menu and ⌘\` cycling (`Transient | IgnoresCycle | CanJoinAllSpaces | Stationary | FullScreenAuxiliary`).

### The Windows and Linux demo window

Windows and Linux use a separate top-level Tauri window labeled `demo`, never a child webview of `main`. The shell creates it for each run with `visible(false)`, `focused(false)`, `skip_taskbar(true)` and `incognito(true)`, and closes it after the run.

- It has its own profile folder (`data_directory`): `<temp>/godspeed-demo-<pid>` on Windows and `~/.cache/godspeed-demo-<pid>` on Linux. `/tmp` is shared, and another user could make the folder first and swap the compiled rules in it.
- The window opens on `about:blank`, gets its loopback block, then loads the page with an origin that is not the app's. A request to the app is then `cross-site` and carries no cookie.
- On Windows the page comes from the registered URI scheme `demo` with `use_https_scheme(true)`, so the URL is `https://demo.localhost/`.
- On Linux the page loads with `load_html(html, "https://demo.invalid/")`. Tauri registers a scheme once per profile folder, and every incognito view gets a fresh WebKit context.
- A hidden GTK window sizes nothing, so the Linux view gets its page size with `size_allocate`.
- `on_navigation` allows only that page and `about:blank`. `on_new_window` answers `NewWindowResponse::Deny`, and `on_download` refuses.

Loopback blocking matches the Mac's four rules:

- Linux (`linux/demo.rs`) compiles the rule JSON with `webkit_user_content_filter_store_new` and `webkit_user_content_filter_store_save`, then adds it with `webkit_user_content_manager_add_filter` before the HTML loads (WebKitGTK 2.24 or newer).
- Windows (`win/demo.rs`) gives the demo window its own `additional_browser_args`: `--host-resolver-rules` that map `127.*`, localhost (with subdomains and a trailing dot), IPv6 starting `::` and `0.0.0.0` to `^NOTFOUND`. The resolver sits under every request, WebSockets, workers and redirects included.
- The https page origin blocks or upgrades any plain-http load to another name as mixed content.
- Known limit: no rule sees a DNS answer, so a public name that resolves to 127.0.0.1 gets as far as a TLS handshake to a local port.

SVG snapshots use WebKitGTK's `get_snapshot` drawn into a cairo surface of exactly w × h, and on Windows the DevTools protocol (`Emulation.setDeviceMetricsOverride` at scale 1, then `Page.captureScreenshot`).

Tauri injects its invoke bridge into the `demo` window too. No capability names that label and every command checks for `main`, so every invoke is refused. `quit.rs` deletes the demo folder, and at startup the shell deletes every `godspeed-demo-*` folder left beside it.

Demo iframes inside the main window get no invoke key (init scripts run in the main frame only). The capability refuses them by origin, and the server refuses them by `Sec-Fetch-Site`.

## `window.lh`

The shim (`crates/shell/src/shim.js`) is an initialization script on the main window. It defines `window.lh` with the members `src/frontend/components/desktop-env.tsx` declares and calls `window.__TAURI_INTERNALS__.invoke`.

The shell bakes `APP_ORIGIN` and `PLATFORM` into the script text before the window is built. The shim does nothing unless `location.origin === APP_ORIGIN`, so the boot page and the login redirect get no `window.lh`.

| Member | Command or push | Detail |
|---|---|---|
| `platform` | constant | `"darwin" \| "win32" \| "linux"`. |
| `pickFolder()` | `pick_folder` | The dialog plugin's folder picker on the main window; the absolute path or `null`. |
| `showInFolder(path)` | `show_in_folder` | Absolute path only; `tauri_plugin_opener::reveal_item_in_dir`. |
| `openPath(path)` | `open_path` | Absolute paths only, canonicalized. A bundle folder (`.app` and the other bundle extensions in `open.rs`) is revealed. A folder or a `.pdf` file opens in its default app. Anything else does nothing. |
| `pathForFile(file)` | `drag_paths` (Mac), WebView2 message (Windows) | Returns `Promise<string>`. See [File drops](#file-drops). Linux resolves `""`. |
| `showWindow()` | `show_window` | Shows and focuses the main window if it is hidden. |
| `onZoom(cb)` | push `zoom` | The factor, pushed after every change and every page load. |
| `getZoom()` | `get_zoom` | The current factor. |
| `onUpdateStatus(cb)` | push `update` | `{status, version, percent, revision}`. |
| `getUpdateState()` | `update_state` | A snapshot of the same. |
| `checkForUpdates()` | `update_check` | A manual check, which ignores the setting. |
| `installUpdate()` | `update_install` | Restart now; see [Install on quit](#install-on-quit). |
| `reportBug()` | `report_bug` | Opens the issue page. |
| `listFonts()` | `list_fonts` | Mac: `NSFontManager` families. Windows and Linux: `fontdb` system fonts, each face's first family name. Drops `iconfont`, sorts with `gs_base::locale::compare`, removes repeats. |
| `onOpenSettings(cb)` | push `open-settings` | The Settings section a menu item asked for. |
| `printPdf(path)` | `print_pdf` | Mac only; absent on Windows and Linux. See [Printing](#printing). |
| `openLink(url)` | `open_link` | A web or mail link, as a link click sends it. |
| `terminals.start(role, agent, folder)` | `terminal_start` | `role` is `"teacher"` or `"helper"`, `agent` is `"claude"` or `"codex"`. Answers `{ id }`. See [Terminals](#terminals). |
| `terminals.attach(id)`, `terminals.detach(id)` | `terminal_attach`, `terminal_detach` | Attach pushes a snapshot of the screen, then the live output, on `terminal-output`. |
| `terminals.write(id, data)` | `terminal_write` | Keys typed in the shown terminal. |
| `terminals.answer(id, kind)` | `terminal_answer` | `kind` is `"trust"` or `"enter"`: the shell sends Enter only while it still sees that question. |
| `terminals.paste(id)` | `terminal_paste` | The shell reads the clipboard and types it. |
| `terminals.stop(id)` | `terminal_stop` | Stops the terminal and everything it started. |
| `terminals.list()` | `terminal_list` | Every terminal, for a page that reloaded. |
| `terminals.onOutput(cb)` | push `terminal-output` | `{id, snapshot}` (base64 escape codes that redraw the screen) or `{id, data}` (base64 raw output). |
| `terminals.onState(cb)` | push `terminal-state` | `{id, ended, prompt, url}`, when one of them changes. |

The shim also calls commands that are not on `window.lh`: `open_link` (link clicks), `set_zoom` (restores the zoom at load), `zoom_step` and `zoom_reset` (key fallback), `start_drag` and `title_bar_double_click` (Mac), and `toggle_menu` (Windows and Linux).

Pushes arrive as `webview.eval("window.__lhPush(channel, payload)")`, so the page needs no Tauri event permissions. A channel with no listener keeps its last message for the first listener that subscribes, because a menu's `open-settings` can arrive before React does.

### Trust check

Every command calls `commands::trusted` first. It refuses with `"Untrusted desktop request."` unless the webview's label is `main` and its URL's origin equals the app origin. The app origin is `http://127.0.0.1:<port>`, or Vite's origin in `desktop:dev`.

## Terminals

The learner's agents (Claude Code or Codex) run in terminals the shell owns, shown in the window. `crates/shell/src/terminal/` keeps them in memory only: at most one live record per role (teacher, helper), each with a 32-hex id. An ended record keeps its screen until the next start for its role.

### Starting one

1. The page names a role, an agent and the godspeed folder. The shell builds everything else, so the page can never name a program or an argument.
2. The script must be `<folder>/.godspeed/start-<agent>[-helper].<command|cmd|sh>`, the start scripts the server writes. Anything else answers "The godspeed folder isn't set up yet."
3. The command runs it through the learner's login shell, as Terminal does with a `.command` file, so PATH from `.zprofile` and `.zshrc` both count: `<shell> -l -i -c 'exec "$0"' <script>`. `<shell>` is `$SHELL` when it is zsh, bash, sh, dash or ksh, else `/bin/zsh` (Mac) or `/bin/bash` (Linux). Windows runs `%ComSpec% /d /c <script>`.
4. `portable-pty` opens a pseudo-terminal of a fixed 100 × 30 (ConPTY on Windows). There is no resize command.

| Environment | Value |
|---|---|
| Base | The app's own, without `LH_*`, `TAURI_*` and, on Linux, the AppImage variables (`APPDIR`, `APPIMAGE`, `ARGV0`, `OWD`, `LD_LIBRARY_PATH`, `LD_PRELOAD`, `GDK_PIXBUF_MODULE_FILE`, `GIO_EXTRA_MODULES`, `GSETTINGS_SCHEMA_DIR`, `GTK_PATH`, `GTK_EXE_PREFIX`, `GTK_DATA_PREFIX`). |
| `TERM`, `COLORTERM`, `LANG` | `xterm-256color`, `truecolor` and `en_US.UTF-8`, each only when unset. |
| `GODSPEED_TERMINAL` | The terminal's id. The folder's connector and waiter send it as the header `x-godspeed-terminal` (only a 32 lowercase hex value); Codex forwards it to the connector through `env_vars`. |
| `GODSPEED_DATA_DIR` | This app's data folder, so the agent finds this app's `mcp-endpoint.json` and token. |
| `Path` (Windows) | The system's and the account's from the registry, so an agent installed after godspeed opened is found. |

### While it runs

Each terminal has four threads: output, input, its exit, and a 250 ms clock.

- **Output** goes through a `vt100` screen (1000 lines of scrollback) and to the page as `terminal-output` only while attached. The shell answers the questions a program asks its terminal (cursor position, device attributes, status), because a hidden terminal has no page and ConPTY waits for the cursor position before the program starts. The page's own answers to those are dropped.
- **Input** is queued and written in order on its own thread, so a terminal that reads nothing never holds the window up. `terminal_write`, `terminal_answer` and `terminal_paste` run without `async`, so keys keep their order.
- **Typing** (`write`, `paste`) is refused unless that terminal is attached and the main window has the focus. Paste drops escape characters and is bracketed when the program asked for bracketed paste.
- **The clock** pushes `terminal-state` when the recognised question or the web address on the screen changes.

### What the shell recognises

By shape, since the agents reword their screens. Screen text is only matched, never run, logged or stored past the next start.

| `prompt` | Shape |
|---|---|
| `"trust"` | A menu (below) whose highlighted row starts with "Yes", with "trust" on the screen. Claude Code's two wordings and Codex's match. |
| `"menu"` | Numbered rows from 1 up, at least two, exactly one highlighted (a pointer such as `❯` or `›` before it, or inverse video). |
| `"enter"` | One of the last three lines opens with "Press Enter", or a sentence in it does. |

A question counts once it has stayed the same for 2 s. `url` is true while the screen shows an `http` or `https` address. The trust and Enter buttons send Enter only if the shell sees that question on its screen at that moment.

### Stop, quit and the server

| Event | What happens |
|---|---|
| Stop | The record is marked stopping and the server hears the new live set at once. Mac and Linux send SIGHUP to the script's process group (`portable-pty` makes it a session leader), then SIGKILL 2 s later; Windows ends the Job Object. |
| The script exits | `ended` is `{stopped: false, code}`; whatever it left running is hung up the same way. Exit 3 means the agent was not found and 4 that Node.js is missing. |
| The teacher ends | However it ended (Stop, exit or crash), the shell stops the helper as above. The page may be gone by then, so it does not do this itself. |
| Quit | `quit.rs` stops every terminal before the server: all hang up at once, and what runs after 2 s is killed. |
| Server crash | The terminals live on. The restarted server gets `LH_TERMINALS`, and the reloaded page calls `terminal_list`. |
| A child that left the group | It still sends the ended id, so the server refuses it. On Windows the job holds it unless it breaks away. |

The Job Object has kill-on-close and takes the script right after it starts, so closing the app kills the tree too.

The server side: `refuse()` in `crates/server/src/mcp/mod.rs` answers 403 `{"error": "This terminal was closed in godspeed."}` to a request whose terminal id is not live (no header means an agent outside the app). `Bridge::set_live_terminals` wakes every waiter, a wait of an ended terminal ends with the same error, and the items that terminal claimed go back at once instead of after the 10 minute hold.

## The main window

| Item | Value |
|---|---|
| Label | `main`, one at a time. |
| Size | 1440 × 900 logical, centered, minimum 640 × 600. |
| Color | `appearance.background` from `<data>/settings.json`, read for each new window, else Paper `#c9c7bd`. |
| Title | `godspeed`, then the page's `document.title` (empty titles and unchanged titles are skipped). |
| Mac title bar | `TitleBarStyle::Overlay`, `hidden_title(true)`, `traffic_light_position(16, 25)`. |
| Windows and Linux title bar | The system title bar. The menu bar is hidden after build, and a lone Alt press and release toggles it. |
| First paint | The window starts hidden on `boot/index.html`, a blank page with no background. It moves to the app once the server is ready, and `show_window` shows it. |
| Show fallback | 5 s after the first finished load of an app page, the shell shows a window that is still hidden. |
| Other settings | `zoom_hotkeys_enabled(false)`, `disable_drag_drop_handler()`, and on the Mac `allow_link_preview(false)`. |
| Windows browser arguments | `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required`. WebView2 refuses a second webview with other arguments in the same profile, which is why the demo window has its own. |
| Debug builds | Mac: `data_store_identifier(*b"godspeed-dev-web")`. Windows and Linux: `data_directory(<userData>/webview)`. A debug build never shares localStorage or cookies with the installed app. |

### Mac traffic lights

tao puts the first light's left edge at x and its center at y - 2, so the lights span x 16 to 76 with centers on y 23 in the 48 px top bar. AppKit moves the lights back to their default place on every title change and when a hidden window first shows. The title handler therefore sets the title through `mac::window::set_title`, and `show` sets the title again after showing.

### Drag areas (Mac)

WebKit has no `-webkit-app-region`, so the shim copies Chromium's rule.

1. On a plain primary `mousedown` while `html.lh-desktop[data-lh-platform="darwin"]` matches, the shim walks `.lh-drag, .lh-no-drag, .lh-drag :is(button, input, textarea, select, a, summary, [contenteditable])` in document order.
2. The last element under the point decides: drag unless it matches the no-drag part.
3. On a drag, the shim calls `preventDefault()` and invokes `start_drag`.
4. The second press of a double click starts no drag, because the drag would swallow the mouse-up and WebKit would never send `dblclick`. That press remembers its point instead.
5. A `mouseup` with `detail === 2` at the same point invokes `title_bar_double_click`. It reads `AppleActionOnDoubleClick`: `Minimize` minimizes, `None` does nothing, anything else toggles zoom.

Windows and Linux have no drag areas.

### Zoom

The ladder is `[0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]`. Applying a factor sets the webview zoom, stores it and pushes `zoom`.

- The menu owns `CmdOrCtrl+0`, `CmdOrCtrl+=` and `CmdOrCtrl+-`. muda has no Plus key.
- The shim's `keydown` listener catches the keys the menu does not claim (⌘ or Ctrl with `=`, `+`, `-` or `0`) and calls `zoom_step` or `zoom_reset`. Menu keys never reach the page, so exactly one applies.
- The shim saves each pushed factor in `localStorage["lh-zoom"]` and calls `set_zoom` with it at document start.

### Menu

`menu.rs` builds it once at setup.

| Submenu | Items |
|---|---|
| godspeed | About godspeed, Check for Updates…, separator, Mac only: Hide, Hide Others, separator; Quit godspeed (a custom item on every OS, CmdOrCtrl+Q, `app.exit(0)`; GTK 3 has no predefined Quit). |
| Edit | Mac and Windows: Undo, Redo, separator, Cut, Copy, Paste, Select All. Linux: Cut, Copy, Paste, Select All. GTK 3 has no Undo or Redo item, and a custom one would take Ctrl+Z from the page's editors. |
| View | Reload (CmdOrCtrl+R), Toggle Developer Tools (⌥⌘I or Ctrl+Shift+I; works in debug builds or with cargo feature `devtools`), separator, Actual Size, Zoom In, Zoom Out, separator, Toggle Full Screen (Mac predefined; Windows and Linux a custom F11). |
| Window | Mac: Minimize, Zoom, separator, Bring All to Front, set as the windows menu. Windows: Minimize, Close Window. Linux: Minimize and Close Window as custom items. |
| Help | Report a Bug…; on the Mac set as the help menu. |

Check for Updates… reopens the window if it is gone, unminimizes and focuses it, asks the page to open Settings, General, and starts a manual check.

### Single instance

Release builds register `tauri_plugin_single_instance` first. Debug builds skip it, so `tauri dev` runs beside the installed app. A second launch unminimizes and focuses the main window if it is visible, and otherwise does nothing. The plugin does not see a running Electron godspeed; see [The old app still open](#the-old-app-still-open).

### Window lifecycle

- Mac: closing the window keeps the app running. `RunEvent::ExitRequested` with no code is the only prevented exit.
- Mac: `RunEvent::Reopen` creates the window again and logs it in when no `main` window exists. It does nothing while the server is not managed yet (the old-app dialog, a failed port choice).
- Windows and Linux: when the main window is destroyed, the shell calls `app.exit(0)`. A `demo` window would otherwise keep the process alive.
- Every way out ends in `RunEvent::Exit`, where `quit.rs` runs. See [Shutdown](#shutdown).

### Links and navigation

WebKit asks `on_navigation` about every frame without saying which frame. So the shell only allows or cancels and never opens the browser from there. A demo iframe that set its own `location` to a web address would otherwise open the learner's browser with no click.

- Allowed: the app origin, the boot page (`tauri://localhost`, or `http://tauri.localhost` on Windows), `about:srcdoc` and `about:blank`.
- A click on an `a[href]` with an http, https or mailto URL off the app origin: the shim calls `preventDefault()` and invokes `open_link`, which checks the URL again and opens it with `tauri_plugin_opener::open_url`.
- `on_new_window` comes only from the page itself, because the demo iframe's sandbox has no `allow-popups`. A web or mail link opens in the browser, and the answer is always `NewWindowResponse::Deny`.
- The opener plugin is not registered (its page script would add a surface). The shell calls its crate functions.

### Context menus

The shim adds a `contextmenu` listener on `window` that calls `preventDefault()`. The app's own menus handle the event earlier.

### Spellcheck and text substitution

Before the window is built, the Mac registers app defaults: `WebContinuousSpellCheckingEnabled` is `YES`. `WebAutomaticSpellingCorrectionEnabled`, `WebAutomaticTextReplacementEnabled`, `WebAutomaticQuoteSubstitutionEnabled` and `WebAutomaticDashSubstitutionEnabled` are `NO`, because math and code boxes depend on typing staying as typed.

### File drops

Tauri's drag-drop handler blocks HTML5 drops, so it is disabled and the page's own drop handlers work.

- Mac: the shim listens for `drop` in the capture phase and invokes `drag_paths`, which reads file URLs from the drag pasteboard. `pathForFile(file)` resolves the path whose last segment equals `file.name`, else `""`.
- Windows: `pathForFile(file)` sends `chrome.webview.postMessageWithAdditionalObjects(JSON.stringify({lhDrop: <n>}), [file])` and waits up to 2 s for the push `drop-path` `{n, path}`. `win/drop.rs` adds a second `WebMessageReceived` handler that reads `ICoreWebView2File::Path`.
- The Windows message must be a string. wry's own handler runs first and calls `TryGetWebMessageAsString`, and WebView2 calls no later handler when that fails.
- Linux resolves `""`, because WebKitGTK gives pages no path. Onboarding then asks the learner to click the box and choose the folder.

### Startup sound

wry's `autoplay` defaults to true, so WKWebView plays `new Audio().play()` without a click. Windows gets the same from the browser argument above.

### Downloads

Blob downloads (demo and visual cards, Export as Markdown) show a save dialog. On `Requested`, `on_download` shows `rfd::FileDialog` with the destination's folder (else the Downloads folder) and file name, synchronously on the main thread. Cancel returns false. A pick replaces the destination. `Finished` is logged with its success flag.

### Printing

Mac: `print_pdf(path)` canonicalizes the path and refuses anything that is not a `.pdf` file inside the data folder. It then prints the PDF with PDFKit as a sheet on the main window, scaled down to fit, on a copy of the shared print info. Windows and Linux keep the page's pdf.js and `window.print()` path; the `print` capability grants `core:webview:allow-print` there.

## The server child

### Finding the server and its files

- The bundle's `externalBin` is `binaries/godspeed-server`. The bundler copies it beside the main executable (Mac: `Contents/MacOS/godspeed-server`).
- The shell finds it at `current_exe().with_file_name("godspeed-server[.exe]")`. In a cargo build that is `target/<profile>/godspeed-server`.
- The shell spawns it with `std::process::Command`, not the shell plugin.
- The working directory is the resource folder (`ui/`, `models/`, `pdfjs-dist/`). Debug builds use `<repo>/.dev-resources`, which `scripts/dev-resources.mjs` makes.
- pdfium: Mac `Contents/Frameworks/libpdfium.dylib`, Windows `pdfium.dll` and Linux `libpdfium.so` in the resource folder, debug builds `.dev-resources/`.

### Spawn

| Setting | Value |
|---|---|
| stdin, stdout, stderr | All piped. |
| Windows flags | `CREATE_NO_WINDOW` (`0x0800_0000`). Without it the console server gets a visible console window, and closing it kills the server. |
| `PORT` | The chosen port. |
| `LH_DATA_DIR` | `<userData>/data`. Debug builds use `LH_DATA_DIR` if set, else the repo's `data/`. |
| `LH_SHELL` | `1`. |
| `LH_PDFIUM_PATH` | The pdfium library path above. |
| `LH_DESKTOP_SERVER`, `LH_DESKTOP_API_SECRET` | `1` and the secret, in desktop mode. Removed in `desktop:dev` browser mode. |
| `LH_SERVER_RESTARTED` | `1` on a restart after a crash, removed otherwise. |
| `LH_TERMINALS` | The live terminal ids as a JSON list, so a restarted server refuses a stopped terminal's agent at once. |
| `LH_DEV_URL` | Removed. |
| Other env | Inherited. |

The secret is 32 bytes from `getrandom` as hex. It lives as long as the shell, so restarts keep the window's cookie valid.

### Port

The shell chooses the port before it builds the window, because the shim needs the origin. Restarts reuse it.

| Build | Port |
|---|---|
| Release | 47613 if a bind to it succeeds, else a free port. The real one is always in `<data>/mcp-endpoint.json`. |
| Debug with `LH_PORT` (the lab) | That port, desktop mode with the login, like release. |
| Debug without `LH_PORT` (`desktop:dev`) | `PORT+1000`, with `PORT` defaulting to 3000. Browser mode: no secret and no login. The window opens Vite at `http://127.0.0.1:<PORT>/` once a TCP connect succeeds (30 s limit). A taken port fails with `port <n> is taken; set PORT to another number`. |

### Start, login and restart

1. The shell waits for `{"t":"ready"}` on stdout for up to 30 s. An exit first, or no ready in time, fails the start.
2. It writes `<data>/mcp-endpoint.json` (`{"url":"http://127.0.0.1:<port>/api/mcp"}` plus `\n`) with `fsx::write_text_atomic`.
3. It mints 32 random bytes as hex, sends `login` and waits 2 s for `login_ok`.
4. It navigates the main window to `http://127.0.0.1:<port>/api/desktop/login?token=<hex>`.

A reopened window logs in the same way. If that fails (for example a Dock click while a crashed server restarts), the shell logs it and destroys the hidden window so the next click tries again.

On an exit after ready that the shell did not cause, `restarts::record` allows 3 restarts per 60 s. An allowed restart starts the server again with `LH_SERVER_RESTARTED=1`, waits for ready, writes the endpoint file and reloads the window. A refused restart, a failed restart or a failed first start shows the stopped dialog.

### The stopped dialog

Message `The app's server stopped running.`, title `godspeed stopped working`, kind Error, buttons `Relaunch`, `Report a bug` and `Quit`.

- Relaunch calls `app.request_restart()`.
- Report a bug opens the issue page and asks again.
- Quit calls `app.exit(0)`.

The shell never calls `app.restart()`: on the main thread it restarts at once without `RunEvent::Exit`, so `quit.rs` would not run.

### Shutdown

`quit.rs` runs once (an `AtomicBool` swap) from `RunEvent::Exit`, and `RunEvent::Exit` waits for it.

1. Stop every terminal: each hangs up at once, and what still runs after 2 s is killed (see [Terminals](#terminals)). First, so no agent outlives the app.
2. Close the server's stdin. The server stops on EOF: open requests get 2 s, then it exits with 143.
3. Wait up to 3 s, then kill the child and wait.
4. Remove `shell.pid` and delete the demo folder.
5. Install a held update, last because the Windows install exits the process.

No signals are needed, so the path is the same on Windows, where the installer could not overwrite a running `godspeed-server.exe`. When the shell dies, the OS closes the pipe and stdin EOF stops the server.

### Logs

`<userData>/logs/main.log`, one line per entry as `[<ISO time>] <text>`. Each line also goes to the shell's stderr.

- The log opens after the old-app check lets the launch go on. Earlier lines go to stderr only.
- At launch, a file over 5 MiB is renamed to `main.old.log`.
- Every server stderr line is logged as `server: <line>`.
- Lifecycle lines: `starting server: <server path>`, `data dir: <data path>`, `server up: <url>`, `server exited (code=<n|null> signal=<SIGNAME|null>)`, `restarting server (<n> in the last minute)`, `server up again: <url>`, `window open: <app origin>/`.
- The window line never holds the login URL, because that has the token.
- Terminal lines: `terminal started: <role> <agent> pid <n>`, `terminal ended: <role> <agent> pid <n> code <n>` (or `stopped`), and `terminal could not start: <role> <agent>: <error>`. Nothing from a terminal's screen, its environment or the clipboard is ever logged.
- The first thing in `main` is a panic hook that logs `uncaught: <panic info>` with a backtrace, then runs the default hook.

### Timeouts

| What | Limit |
|---|---|
| Server ready | 30 s |
| Login answer | 2 s |
| Login token life | 60 s (app clock) |
| Server stop grace | 3 s, then kill |
| Show fallback | 5 s after the first app page load |
| Vite wait in `desktop:dev` | 30 s |
| Windows drop path | 2 s |
| Restart limit | 3 per 60 s |

## API protection

The access rule and the login route are in [rust-server.md](rust-server.md#the-server-process). The shell's side is the handshake:

1. The shell sends `login` with a fresh token and waits for `login_ok`.
2. It navigates the main window to `/api/desktop/login?token=<hex>`.
3. The server spends the token and sets the HttpOnly cookie `gs_desktop`.
4. The page loads `/`, and every same-origin request carries the cookie.

`npm run dev` and `npm run desktop:dev` start the server without `LH_DESKTOP_SERVER`, so Vite's proxy and any browser reach `/api` freely.

### Capabilities

`crates/shell/capabilities/main.json` grants the main webview every app command. `build.rs` declares each command with `AppManifest::new().commands(&[...])`.

```json
{
  "identifier": "main",
  "webviews": ["main"],
  "local": false,
  "remote": { "urls": ["http://127.0.0.1:*"] },
  "permissions": [
    "allow-show-window",
    "allow-get-zoom",
    "allow-set-zoom",
    "allow-zoom-step",
    "allow-zoom-reset",
    "allow-update-state",
    "allow-update-check",
    "allow-update-install",
    "allow-start-drag",
    "allow-toggle-menu",
    "allow-open-link",
    "allow-pick-folder",
    "allow-show-in-folder",
    "allow-open-path",
    "allow-terminal-start",
    "allow-terminal-attach",
    "allow-terminal-detach",
    "allow-terminal-write",
    "allow-terminal-answer",
    "allow-terminal-paste",
    "allow-terminal-stop",
    "allow-terminal-list",
    "allow-report-bug",
    "allow-list-fonts",
    "allow-print-pdf",
    "allow-drag-paths",
    "allow-title-bar-double-click"
  ]
}
```

- `print.json` grants `core:webview:allow-print` to the same webview on `windows` and `linux` only.
- There is no `windows` key, because a window entry grants every webview in that window.
- There is no `core:default`. The page uses no Tauri events or plugin JS.
- `local: false` is safe because the app page is never "local". The config sets no `devUrl`, so `tauri dev` serves `boot/` on its own port and the window then moves to the remote app origin.
- A new command needs a line in `generate_handler!` in `main.rs`, in `build.rs` and in `capabilities/main.json`.

## Updates

| Config key | Value |
|---|---|
| `bundle.createUpdaterArtifacts` | `true` |
| `plugins.updater.endpoints` | `["https://github.com/bayshores/godspeed/releases/latest/download/latest.json"]` |
| `plugins.updater.windows.installMode` | `"passive"` |
| `plugins.updater.pubkey` | The public half of the update signing key. |

The plugin is used from Rust only. The signing secrets are in [desktop-release.md](desktop-release.md#secrets).

### Statuses

`update.rs` keeps `{status, version, percent, revision}`. `revision` goes up by one on each change, and every change is pushed as `update` and logged.

| Status | When |
|---|---|
| `idle` | The start state. |
| `disabled` | Debug builds, a build with an empty `pubkey`, or `app.updater()` failed. Logged as `updater: disabled (<why>)`. |
| `checking` | A check starts. |
| `downloading` | `check()` found an update. `percent` is pushed only on a new whole percent. |
| `downloaded` | The bytes are held in memory. This status sticks until a newer download replaces it. |
| `up-to-date` | `check()` found nothing. |
| `error` | A check or download failed. The reason is logged as `updater error: …`; the page gets no reason. |

### When it checks

- At startup and every 24 h, in a loop on `gs_base::clock::sleep_until`.
- Each automatic check reads `<data>/settings.json` fresh. Only `general.autoUpdate === false` skips it, logged as `auto-update: automatic check skipped (turned off in Settings)`. A missing or unreadable file means on.
- Manual checks (the menu, Settings) always run and also download.
- One check runs at a time.

### Install on quit

`quit.rs` installs a held update after the server has stopped, on every way out. Installing never happens while the server runs, because the server serves `ui/` from inside the bundle.

- Windows starts the installer and exits inside `install`. The Mac replaces the bundle (with an admin prompt if the folder is not writable), then the process ends.
- Install errors are logged as `updater error: …`, and the app still quits.
- Restart now (`update_install`) calls `app.request_restart()` when bytes are held. The restart exit code marks the exit as a restart, so Windows relaunches the app after installing and the Mac relaunches the new bundle.

### Local drill builds

No runtime feed override ships. A drill builds with `tauri build --config '{"plugins":{"updater":{"endpoints":["http://127.0.0.1:48070/latest.json"],"dangerousInsecureTransportProtocol":true}}}'` and a throwaway key pair.

## Data

| OS | userData |
|---|---|
| macOS | `~/Library/Application Support/godspeed` |
| Windows | `%APPDATA%\godspeed` |
| Linux | `$XDG_CONFIG_HOME/godspeed`, else `~/.config/godspeed` |

- userData is `app.path().config_dir()` joined with `godspeed`, the same folder Electron used. It is not `app_config_dir()`, which uses the bundle id.
- Data is `<userData>/data` and logs are `<userData>/logs`.
- Debug builds use `godspeed-dev` instead of `godspeed`, and the repo's `data/` (or `LH_DATA_DIR`) for data.
- WebKit's own storage lives outside userData: Mac `~/Library/WebKit/com.bayshores.godspeed`, Windows `%LOCALAPPDATA%\com.bayshores.godspeed\EBWebView`, Linux `~/.local/share/com.bayshores.godspeed`.

### The old app still open

`old_app.rs` runs first in setup, before the log opens and before the server starts. Electron's process lock lives in userData, and the single-instance plugin does not see it.

- Mac and Linux: the shell connects to `<userData>/SingletonSocket`. A connection means Electron is running.
- Windows: the shell opens `<userData>\lockfile` for writing. Error 32 (sharing violation) means Electron is running.
- If Electron runs, the shell shows `The old godspeed is still open. Quit it, then open godspeed again.` (title `godspeed`, one OK button) and exits. Nothing in userData is touched and no server starts.
- Otherwise it writes `<userData>/shell.pid` (its pid and `\n`), and `quit.rs` removes it. The last Electron release reads that file; see [desktop-release.md](desktop-release.md#the-last-electron-release-0551).

### First run after Electron

`first_run.rs` runs before the server starts. Its marker is Electron's `Local State` file in userData; a fresh install has none and skips all of this.

1. If `<userData>/data` exists and `data-backup-<v>` does not, copy `data/` to `data-backup-<v>.partial` without `data/models/`, then rename it to `data-backup-<v>`.
2. Only after a good backup, delete Electron's leftovers from the top level of userData (the fixed list `LEFTOVERS` in `first_run.rs`, `Local State` last) and the old updater cache (`godspeed-updater` in the OS cache folder).
3. A failed backup is logged and leaves everything for the next launch. The app starts either way.

Kept: `data/`, `logs/`, `shell.pid`, `.updaterId` and every `data-backup-*`.

### One server per data folder

- The server holds an advisory lock on the data folder on Mac and Linux.
- The single-instance plugin keeps a second Tauri app off.
- `old_app.rs` and `shell.pid` keep Tauri and Electron apart in both directions.
- Windows has no folder lock. The NSIS hook removes the Electron copy on install.

## Config files

tauri-build copies `bundle.externalBin`, `bundle.resources` and `bundle.macOS.frameworks` on every cargo build and fails when they are missing. They are gitignored build outputs, so they live in files only `tauri build` reads.

| File | Read by | Holds |
|---|---|---|
| `crates/shell/tauri.conf.json` | every cargo build, test and clippy, and `tauri build` | Names, identifier `com.bayshores.godspeed`, `frontendDist: "boot"`, bundle targets, icons, `minimumSystemVersion: "14.0"`, the DMG layout, NSIS settings, the updater block. |
| `tauri.bundle.conf.json` | `tauri build` | `beforeBuildCommand: "node scripts/stage-app.mjs"`, `externalBin`, the `ui/`, `models/` and `pdfjs-dist/` resources, `libpdfium.dylib` in Frameworks. |
| `tauri.bundle.macos.conf.json` | `tauri build` on the Mac | The icon list with the compiled `../../.stage/Assets.car`. |
| `tauri.bundle.macos-intel.conf.json` | `tauri build` on Intel Macs | Frameworks `libpdfium.dylib` and `libonnxruntime.dylib`. |
| `tauri.bundle.windows.conf.json` | `tauri build` on Windows | The `pdfium.dll` resource. |
| `tauri.bundle.linux.conf.json` | `tauri build` on Linux | The `libpdfium.so` and `libonnxruntime.so` resources. |

- The CLI merges `--config` files in order as JSON merge patches, so the `resources` maps combine.
- There are no `tauri.<platform>.conf.json` files, because tauri-build would read those too.
- Every `tauri` CLI call sets `TAURI_APP_PATH=crates/shell`, so the project folder is never found by walking.
- `beforeBuildCommand` runs from the repo root, so its path is `scripts/…`.
- There is no `devUrl`. The debug shell moves the window to Vite itself.
- There is no entitlements file.

### NSIS hook

`nsis/hooks.nsh` (`NSIS_HOOK_PREINSTALL`) removes an old electron-builder install. If `$LOCALAPPDATA\Programs\godspeed\Uninstall godspeed.exe` exists, it runs it with `/S _?=$LOCALAPPDATA\Programs\godspeed`, then deletes the uninstaller and the folder.

Without `_?=`, an NSIS uninstaller copies itself to `%TEMP%` and returns at once, then deletes the shortcuts the Tauri installer just made. With `_?=` it cannot delete itself, hence the two lines after. The Tauri copy installs to `$LOCALAPPDATA\godspeed`.
