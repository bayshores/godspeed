# The Tauri shell

How godspeed moves from Electron to Tauri 2 (plan phases 3, 4 and 5, shipped as one release). For the engineers who build it. The Rust server (docs/rust-server.md) is done first and is not changed here except where this page says so.

Versions checked on 2026-11-10 (docs, crates.io and source): tauri 2.12.5, tauri-build 2.7.4, @tauri-apps/cli 2.12.4, tauri-bundler 2.10.4, tauri-plugin-updater 2.14.1, tauri-plugin-single-instance 2.5.5, tauri-plugin-dialog 2.8.4, tauri-plugin-opener 2.7.2 (2.7.3 is one day old), objc2 0.6.5, block2 0.6, objc2-foundation / objc2-app-kit / objc2-web-kit / objc2-pdf-kit 0.3.2, electron-updater 6.8.11 (what every shipped godspeed uses). Pin these exactly (`=x.y.z`). Before relying on any API name below, check it in the docs.rs page of the pinned version: some names were read from the `dev` branch.

## 0. The shape in one picture

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

## 1. Crate layout

| Path | Crate | What |
|---|---|---|
| `crates/shell/` | `gs-shell`, binary `godspeed` | The Tauri app. `tauri.conf.json` (what every cargo build reads), `tauri.bundle.conf.json` + `tauri.bundle.windows.conf.json` + `tauri.bundle.linux.conf.json` (only `tauri build` reads them, section 9), `build.rs`, `capabilities/`, `icons/`, `boot/index.html`, `nsis/hooks.nsh`, `release/` (legacy feed templates, `electron-requirement.txt`). |
| `crates/shell-rpc/` | `gs-shell-rpc` | The shell and server line protocol: message enums (serde), the line reader and writer, and `ShellLink` (the server's handle: request id counter, pending map of tokio oneshots, `request(msg).await`). Depends on serde, serde_json, tokio only. |

`crates/shell/src/`:

| File | Job |
|---|---|
| `main.rs` | Builder: plugins, commands, setup, `RunEvent` handling. Nothing else. Release builds carry `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`. |
| `paths.rs` | userData, data, logs, resources, pdfium path; dev variants. |
| `log.rs` | `main.log` writer, rotation, the panic hook. |
| `old_app.rs` | Is the Electron app running on this userData (section 8); writes and removes `shell.pid`. |
| `first_run.rs` | The one-time data backup and Electron leftovers cleanup. |
| `quit.rs` | The one exit routine: stop the server, then install a downloaded update (section 5, Shutdown). |
| `server.rs` | Spawn, ready wait, port choice, secret, login tokens, restart, stop, `mcp-endpoint.json`. |
| `rpc.rs` | Reads server stdout lines, routes requests to the demo runner, writes replies to stdin. |
| `window.rs` | Builds the main window, navigation guards and the `open_link` command, show fallback, title, downloads (save dialog), the pending `open-settings` push. |
| `menu.rs` | The application menu. |
| `zoom.rs` | The zoom ladder, push and commands (`get_zoom`, `set_zoom`, `zoom_step`, `zoom_reset`). |
| `commands.rs` | The trust check `trusted(&webview)` and the OS commands (`pick_folder`, `show_in_folder`, `open_path`, `open_agent`, `report_bug`, `list_fonts`, `print_pdf`, `drag_paths`, `title_bar_double_click`). Window commands (`show_window`, `start_drag`, `toggle_menu`, `open_link`) live in `window.rs`, zoom commands in `zoom.rs`, update commands in `update.rs`; every command calls `commands::trusted` first. |
| `open.rs` | `isWebLink`, `isAppBundle`, open path, show in folder, the terminal launcher (port of `open-guards.cjs`, `open-terminal.cjs`). |
| `bug_report.rs` | The issue URL (port of `bug-report.cjs`). |
| `update.rs` | Updater state, checks, download, the update commands, and the install step `quit.rs` calls. |
| `restarts.rs` | Restart limit (port of `server-restarts.cjs`). |
| `push.rs` | Shell to page pushes (`webview.eval`). |
| `shim.js` | `window.lh`, injected with `include_str!`. |
| `mac/mod.rs` | `#![allow(unsafe_code)]`. Every `unsafe` block has a `// SAFETY:` line. |
| `mac/demo.rs` | Hidden WKWebView demo runner and SVG snapshot. |
| `mac/print.rs` | PDFKit print. |
| `mac/window.rs` | Drag pasteboard paths, title bar double-click preference, WebKit text defaults. |
| `mac/fonts.rs` | `NSFontManager.sharedFontManager.availableFontFamilies` (what `font-list` ran on the Mac). |
| `win/mod.rs` | `#![allow(unsafe_code)]` (WebView2 COM calls). Same `// SAFETY:` rule. |
| `win/drop.rs` | Dropped file paths through WebView2 `WebMessageReceived` (section 4, file drops). |
| `win/demo.rs` | The demo window's browser arguments (its loopback rules) and its SVG snapshot. |
| `linux/mod.rs`, `linux/demo.rs` | `#![allow(unsafe_code)]`; the WebKitGTK content filter for the demo window through `webkit2gtk-sys` (the `webkit2gtk` crate has no binding for it). |
| `demo.rs` | `run` / `svg` for the queue in `rpc.rs`: `mac::demo` on the Mac, `demo_webview` elsewhere. |
| `demo_webview.rs` | Windows and Linux demo runner (a separate hidden Tauri window labeled `demo`, section 6). |
| `self_test.rs` | Only with cargo feature `self-test`: `godspeed --self-test` (section 11). |
| `screens.rs` | Only with cargo feature `screens` (never in release): the lab's screenshot control channel (section 11). |

Rules:
- The workspace keeps `unsafe_code = "deny"`; `crates/shell/src/mac/mod.rs`, `crates/shell/src/win/mod.rs` and `crates/shell/src/linux/mod.rs` start with `#![allow(unsafe_code)]` and nothing else in the workspace may.
- The shell uses `gs_base::clock` and `gs_base::fsx` like the server (clippy.toml applies to it). It depends on `gs-base` and `gs-shell-rpc`, never on the server crates.
- Add `print_stdout = "deny"` to `[workspace.lints.clippy]`; the one writer in `gs-shell-rpc` carries `#[allow(clippy::print_stdout)]`. stdout is the protocol channel.
- New workspace dependencies (reviewer approval): tauri, tauri-build, tauri-plugin-updater, tauri-plugin-single-instance, tauri-plugin-dialog, tauri-plugin-opener, rfd (`0.17`, the version tauri-plugin-dialog 2.8.4 uses, feature `gtk3`), objc2, block2, objc2-foundation, objc2-app-kit, objc2-web-kit, objc2-pdf-kit, webview2-com 0.39.1 and windows 0.62.2 (Windows only), webkit2gtk 2.0.2 (its `ffi` is webkit2gtk-sys, feature `v2_38`, which includes the `v2_24` filter calls), gtk 0.18.2 and cairo-rs 0.18.5 with `png` (Linux only); all are the versions wry 0.57.2 and tao use, so one copy is linked, fontdb (Windows/Linux only; already in the tree through resvg), os_info, base64.

**Who owns the demo runner.** WKWebView needs the main thread of a process with an `NSApplication`, so the shell owns it. The server asks over the line protocol:

1. `gs_server` main reads `LH_SHELL=1`; when set it builds a `ShellLink` on its stdin/stdout and stores it in `App` (`app.shell: Option<ShellLink>`, new field in `crates/services/src/lib.rs`).
2. `gs_agent::subagents::headless::get_headless(pdf, shell)` takes the link. `run_in_browser` becomes: no link → today's `NO_CHROME_MESSAGE`; link → `link.demo(html, probe)` / `link.svg(svg, width, height)`, each waiting only for an answer of its own kind (one of the other kind is logged and dropped).
3. The shell's `rpc.rs` gets the request, queues it (one demo at a time, like the TS page chain), runs it on the main thread through `app.run_on_main_thread`, replies on the server's stdin. Each run creates its view and window and closes them when it ends (Mac: the objc2 NSWindow; Windows/Linux: the Tauri window `demo`), so no demo window outlives a run.
4. The server waits at most 60 s per request (via `gs_base::clock`), then answers the error `demo check timed out`.
5. Requests in flight when the server dies are dropped by the shell; a restarted server starts a new id space.

## 2. The line protocol (gs-shell-rpc)

One JSON object per line, UTF-8, `\n`-terminated. `t` names the message. The server enables it only with `LH_SHELL=1`; without it (browser mode, contract runs, `npm run dev`) the server behaves as today.

| Direction | Message | Meaning |
|---|---|---|
| server → shell | `{"t":"ready"}` | Listening. Sent once, right after bind. |
| shell → server | `{"t":"login","id":n,"token":"<64 hex>"}` | Accept this one-time login token (expires 60 s by the app clock). |
| server → shell | `{"t":"login_ok","id":n}` | Stored. The shell navigates only after this. |
| server → shell | `{"t":"demo","id":n,"html":"…","probe":"…"\|null}` | Run a demo. |
| server → shell | `{"t":"svg","id":n,"svg":"…","width":w,"height":h}` | Snapshot an SVG resvg could not draw (`svgViewport` sizes). |
| shell → server | `{"t":"demo_done","id":n,"result":{"consoleErrors":[],"pageErrors":[],"failedRequests":[],"probeResult":…,"ok":true}}` or `{"t":"demo_done","id":n,"error":"…"}` | `probeResult` absent when not probed. |
| shell → server | `{"t":"svg_done","id":n,"png":"<base64>"}` or `{"t":"svg_done","id":n,"error":"…"}` | PNG exactly w×h px. |

Server side of the protocol: stdin EOF triggers `shutdown::trigger()` (replaces the FIFO check when `LH_SHELL=1`, and works on Windows). The startup `println!` in `main.rs` becomes `eprintln!`. Unknown lines are logged to stderr and ignored on both sides.

## 3. `window.lh` mapped to Tauri

The shim (`crates/shell/src/shim.js`) is an initialization script (main frame only, Tauri's default) on the main window. It defines `window.lh` with the same members and types as `src/frontend/components/desktop-env.tsx` declares, calling `window.__TAURI_INTERNALS__.invoke`. Pushes come from the shell as `webview.eval("window.__lhPush(channel, payload)")`, so the page needs no Tauri event permissions. The shell bakes the app origin into the script text (`const APP_ORIGIN = "http://127.0.0.1:<port>"`; the port is chosen before the window is built, section 5), and the shim does nothing unless `location.origin === APP_ORIGIN` (so the boot page and the login redirect get no `window.lh`).

| Member | Electron today | Tauri | Detail |
|---|---|---|---|
| `platform` | `process.platform` | shim constant | `"darwin" \| "win32" \| "linux"`, from `std::env::consts::OS`, baked into the script text. |
| `pickFolder()` | `lh:pick-folder` | command `pick_folder` | dialog plugin `file().set_parent(&main).pick_folder(cb)`; resolves the absolute path or `null`. |
| `showInFolder(path)` | `lh:show-in-folder` | command `show_in_folder` | Absolute path only; `tauri_plugin_opener::reveal_item_in_dir`. |
| `openPath(path)` | `lh:open-path` | command `open_path` | `fs::canonicalize`; a directory whose name matches the bundle list → reveal; a directory, or a file ending `.pdf` (case-insensitive) → `tauri_plugin_opener::open_path(p, None)`; anything else → nothing. |
| `openAgent(folder, agent)` | `lh:open-agent` | command `open_agent` | Rust port of `open-terminal.cjs`: same script path, same terminal list per OS, same two messages, spawn detached with null stdio. |
| `pathForFile(file)` | `webUtils.getPathForFile` | shim + command `drag_paths` (Mac), WebView2 message (Windows) | Now returns `Promise<string>` (the one type change). See section 4, file drops. Linux: resolves `""`. |
| `showWindow()` | `lh:show-window` | command `show_window` | Show and focus the main window if hidden. |
| `onZoom(cb)` | push `lh:zoom` | push `zoom` | Payload: the factor. Pushed after every change and after every page load. |
| `getZoom()` | `lh:zoom:get` | command `get_zoom` | The shell's current factor. |
| `onUpdateStatus(cb)` | push `lh:update-status` | push `update` | `{status, version, percent, revision}`. |
| `getUpdateState()` | `lh:update:get` | command `update_state` | Snapshot. |
| `checkForUpdates()` | `lh:update:check` | command `update_check` | Manual check (ignores the setting). |
| `installUpdate()` | `lh:update-install` | command `update_install` | Section 7, install on quit. |
| `reportBug()` | `lh:report-bug` | command `report_bug` | `opener::open_url(bug_report_url(..))`. |
| `listFonts()` | `lh:fonts` | command `list_fonts` | Mac: `mac::fonts` (`NSFontManager availableFontFamilies`, the call `font-list` made). Windows/Linux: `fontdb::Database::load_system_fonts`, every face's first family name. Then drop `iconfont` (font-list's one exception), deduplicate, sort with `gs_base::locale::compare`; `[]` on any error. |
| `onOpenSettings(cb)` | push `lh:open-settings`, buffered | push `open-settings`, buffered twice | The shell keeps one pending section and sends it from `on_page_load` `Finished` when the URL's origin is the app origin and its path is not `/api/desktop/login` (or at once if the main page is already loaded), then clears it. The shim keeps it until a listener subscribes, as `preload.cjs` did. |
| `printPdf(path)` (new, Mac only) | none | command `print_pdf` | Section 4, printing. Absent on Windows/Linux. |

Shim-only commands (not on `window.lh`): `set_zoom(factor)` (restore at load), `zoom_step(dir)` / `zoom_reset` (key fallback), `start_drag`, `title_bar_double_click` (Mac), `toggle_menu` (Windows/Linux).

**Trust check (first line of every command).** The command takes `webview: tauri::Webview`; it refuses with `"Untrusted desktop request."` unless `webview.label() == "main"` and `webview.url()?.origin()` equals the app origin held in managed state (`http://127.0.0.1:<port>`; in `desktop:dev` the Vite origin `http://127.0.0.1:<PORT>`). Tauri itself already refuses invokes from webviews and origins no capability names (section 6), and does not inject the invoke key into subframes.

**React changes (the only ones).**
- `desktop-env.tsx` (`DesktopEnv`): the shell is detected with `!!window.lh` instead of a user agent test, and the class `lh-electron` becomes `lh-desktop` there, in `globals.css` and in comments. The `Window.lh` type gains `printPdf?: (path: string) => Promise<void>`; its doc comment names `crates/shell/src/shim.js`.
- `globals.css`: delete the `-webkit-app-region` rules (WebKit ignores them; the shim does dragging) and the Windows Controls Overlay rules (`--lh-wco-right`, `.lh-wco-gutter` keeps `padding-right: 0.75rem`). Keep the lights gutter rule under `.lh-desktop[data-lh-platform="darwin"]`.
- `cheat-sheet/studio.tsx` print: when `window.lh?.printPdf` exists, get the version's path with the existing `{action: "file", n}` POST (factor it out of `showSheetPdf` into `sheetPdfFile`), then `await window.lh.printPdf(path)`; otherwise today's `printPdf(url)`.
- `artifacts/download.ts`: `downloadFile` becomes `saveBlob(name, blob)` plus the text wrapper; `saveBlob` revokes the object URL 60 s after `click()` (WebKit reads the blob only after the save dialog, Chromium did it at once).
- `lessons/lesson-menu.tsx` Export as Markdown: `fetch("/api/chats/<id>/markdown")` (a fetch carries `Sec-Fetch-Site: same-origin`; a download navigation in WebKit does not, and the server would refuse it), file name from the `Content-Disposition` `filename="…"` (fallback `session.md`), then `saveBlob`. A failed fetch shows nothing new (today a failed download showed nothing either). It is the only `<a download>` or navigation to `/api` in `src/frontend`; the browser-only cheat sheet "Download PDF" link is not shown in the desktop app.
- `onboarding/space-step.tsx` `onDrop`: `await window.lh?.pathForFile?.(file)` (the handler becomes async; `items` and the `File` are taken before the first `await`). When `window.lh` exists and the path is `""` (Linux), the error reads `To link a folder, click this box and choose it.` instead of the browser line (clicking the drop zone opens `pickFolder` in the desktop app).
- Comments that name Electron or `electron/main.cjs` (copy-button, update-settings, update-banner, root.tsx, onboarding, app-bar) are reworded to "the desktop shell".

## 4. The window

| Item | Value |
|---|---|
| Label | `main` (only one at a time). |
| Size | 1440 × 900 logical, centered, min 640 × 600. |
| Colors | `background_color` (window and webview) read from `<data>/settings.json` `appearance.background` for each new window, as `windowColors()` in `main.cjs`: the picked hex, else Paper `#c9c7bd`. Electron's Windows/Linux title bar overlay colors have no counterpart (system title bar, below). |
| Title | `godspeed`, then follows `document.title` (`on_document_title_changed` → `set_title`), like Electron. |
| Mac title bar | `title_bar_style(Overlay)`, `hidden_title(true)`, `traffic_light_position(16, 25)`: tao puts the first light's left edge at x and its center at y - 2, so the three lights span x 16 to 76 with centers on y 23 in the 48 px top bar, as Electron's `trafficLightPosition {x: 16, y: 16}` (measured at 2x in the debug shell). Every title change makes AppKit move the lights back to their default place and tao's own repair does not stick, so the title handler asks tao's content view to draw again (`mac::window::redraw_lights`), which puts them back. Measured in the normal window, after a title change, after a zoom change, after a resize and after leaving full screen. |
| Windows/Linux title bar | System title bar (`decorations(true)`, style Visible). The menu bar is hidden (`hide_menu()` after build); a lone Alt press and release toggles it (shim → `toggle_menu`), like `autoHideMenuBar`. |
| First paint | The port is chosen first (section 5), then the window is created hidden (`visible(false)`) on `boot/index.html` (a blank page with no background, so the window's color shows), so WebKit warms up while the server starts. Navigates to the login URL once the server is ready (section 5). Shown by `show_window`; fallback: 5 s after the first `PageLoadEvent::Finished` on the app origin, show it if still hidden. |
| Other webview settings | `allow_link_preview(false)`, `zoom_hotkeys_enabled(false)`, `disable_drag_drop_handler()` (section below), `devtools` via the cargo feature `devtools` (menu item, like today's View menu). Windows: `additional_browser_args(MAIN_BROWSER_ARGS)` with `const MAIN_BROWSER_ARGS = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required"`. WebView2 refuses a second webview with other arguments in the same data folder, which is why the demo window has its own folder (section 6). |
| Dev window | Debug builds: Mac `data_store_identifier(<fixed 16 bytes>)`, Windows/Linux `data_directory(<userData-dev>/webview)`, so dev never shares localStorage with the installed app. |

**Drag areas (Mac).** WebKit has no `-webkit-app-region`. The shim emulates Chromium's rule exactly: on `mousedown` (primary button, no modifier, `html.lh-desktop[data-lh-platform="darwin"]`), walk `document.querySelectorAll(".lh-drag, .lh-no-drag, .lh-drag :is(button, input, textarea, select, a, summary, [contenteditable])")` in document order; for each element whose `getBoundingClientRect()` contains the point, set `drag = !el.matches(<the no-drag part>)`. If `drag` ends true: `preventDefault()` and invoke `start_drag` (`window.start_dragging()`), except on the second press of a double click (`detail === 2`): tao's `drag_window` tracks the mouse until it is released, so WebKit would never see that mouse-up or send `dblclick` (Tauri's own `drag.js` does the same, tauri issue 8306). That press only remembers its point, and the next `mouseup` with `detail === 2` at the same point invokes `title_bar_double_click`, which reads `NSUserDefaults` `AppleActionOnDoubleClick` (`Minimize` → minimize, `None` → nothing, anything else → zoom/maximize toggle). Windows/Linux: no drag areas (system title bar).

**Zoom.** Ladder `[0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]`, step rules as `zoomStep` in `main.cjs`. `apply(f)`: `webview.set_zoom(f)`, store f, push `zoom`. Menu items own `CmdOrCtrl+0`, `CmdOrCtrl+=`, `CmdOrCtrl+-` (muda has no `Plus` key; Electron showed ⌘+). The shim's `keydown` listener catches the variants the menu does not claim (⌘/Ctrl with `=` or `+` or `-` or `0`), calls `zoom_step` / `zoom_reset` and `preventDefault()`s; menu-claimed keys never reach the page, so exactly one applies. The shim saves each pushed factor in `localStorage["lh-zoom"]` and calls `set_zoom` with it at document start (try/catch around storage).

**Menu** (`menu.rs`, built once at setup). Same items and shortcuts as `installMenu()`:

| Submenu | Items |
|---|---|
| godspeed | About godspeed (`PredefinedMenuItem::about`, name and version), Check for Updates… (custom: reopen the window if gone, unminimize and focus it, set the pending `open-settings` "general" (section 3), manual check), separator, Mac only: Hide (⌘H), Hide Others (⌥⌘H), separator; Quit godspeed (custom item, CmdOrCtrl+Q, calls `app.exit(0)`; not the predefined Quit, which muda does not support on GTK 3; all three OSes share this item). |
| Edit | Mac and Windows: Undo ⌘Z, Redo ⇧⌘Z, separator, Cut, Copy, Paste, Select All (predefined). Linux: Cut, Copy, Paste, Select All only (muda's Undo/Redo are unsupported on GTK 3; a custom item would take Ctrl+Z from CodeMirror and MathLive, so the keys stay with the page). |
| View | Reload (CmdOrCtrl+R, `webview.reload()`), Toggle Developer Tools (⌥⌘I / Ctrl+Shift+I), separator, Actual Size, Zoom In, Zoom Out, separator, Toggle Full Screen (Mac predefined ⌃⌘F; Windows/Linux custom F11 → `set_fullscreen(!is_fullscreen)`). |
| Window | Mac: Minimize ⌘M, Zoom, separator, Bring All to Front (predefined); `set_as_windows_menu_for_nsapp()`. Windows: Minimize, Close Window (predefined). Linux: Minimize and Close Window as custom items calling `main.minimize()` / `main.close()` (predefined ones are unsupported on GTK 3). |
| Help | Report a Bug…; Mac `set_as_help_menu_for_nsapp()`. |

**Single instance.** `tauri_plugin_single_instance::init` registered first (release builds only; dev skips it so `tauri dev` runs beside the installed app). Callback: if the main window exists and is visible: `unminimize()`, `set_focus()`; otherwise nothing (a still-hidden window shows itself once drawn), as today. It does not see a running Electron godspeed; `old_app.rs` does (section 8).

**Window lifecycle.** Mac: closing the window keeps the app running (`RunEvent::ExitRequested { code: None }` → `prevent_exit()`; that is the only prevented case); `RunEvent::Reopen` creates the window again and logs it in (section 5) when `app.get_webview_window("main").is_none()` (never decided by `has_visible_windows`: the alpha-0 demo window counts as visible). Windows/Linux: on the main window's `WindowEvent::Destroyed`, call `app.exit(0)` (a `demo` window that exists at that moment would otherwise keep the process alive). Every way out (Quit item, Dock Quit, logout, shutdown, last window, the stopped dialog, `app.exit`) ends in `RunEvent::Exit`, where `quit.rs` runs (section 5).

**External links and navigation.** WebKit (wry's `navigation_policy` on the Mac, `decide-policy` on Linux) calls `on_navigation` for every frame and Tauri passes no frame, so it only allows or cancels: allow the app origin, the boot page, `about:srcdoc` (a demo card's iframe) and `about:blank`; cancel everything else, and never open the browser from it (a sandboxed demo iframe that sets its own `location` to a web address would otherwise open the learner's browser with no click, in a loop). Web links leave two ways. The shim adds a bubbling `click` listener on `window`: a click not already `defaultPrevented` on an `a[href]` whose URL is http, https or mailto and not on the app origin → `preventDefault()` and invoke `open_link(url)` (window.rs; trust check, then `isWebLink` again, then `opener::open_url`). `on_new_window` (only the page itself: the demo iframe's sandbox has no `allow-popups`): if `isWebLink`, `opener::open_url(url)`; always `NewWindowResponse::Deny`. Do not register the opener plugin itself (its JS link catcher would add a page surface); call its crate functions. Owner to approve: a demo's own links no longer load inside its card (Electron let the iframe navigate).

**Context menus.** Electron shows none. The shim adds a bubbling `contextmenu` listener on `window` that calls `preventDefault()` (the app's own menus already handle the event earlier).

**Spellcheck and text substitution.** Before the window is built, register these app defaults on the Mac (`NSUserDefaults.registerDefaults`): `WebContinuousSpellCheckingEnabled = YES` (red underlines like Chromium), `WebAutomaticSpellingCorrectionEnabled`, `WebAutomaticTextReplacementEnabled`, `WebAutomaticQuoteSubstitutionEnabled`, `WebAutomaticDashSubstitutionEnabled` = `NO` (Chromium never rewrites typing; math and code boxes depend on it).

**File drops.** Tauri's drag-drop handler returns `true` and blocks HTML5 drops (checked in tauri-runtime-wry and wry `drag_drop.rs`), so it is disabled; HTML5 drops work as today. `pathForFile` on the Mac: the shim listens for `drop` (capture, so before the page's own handler) and invokes `drag_paths`, which reads file URLs from `NSPasteboard(name: .drag)` (the drag pasteboard keeps its contents after the drop; a drag released where nothing accepts it fires no `drop`, so it leaves no paths behind); `pathForFile(file)` awaits that read and resolves the path whose last segment equals `file.name`, else `""`. Windows: `pathForFile(file)` sends `chrome.webview.postMessageWithAdditionalObjects(JSON.stringify({lhDrop: <n>}), [file])` and waits up to 2 s for push `drop-path` `{n, path}`; `win/drop.rs` adds a second `WebMessageReceived` handler through `with_webview`, reads the string, takes `ICoreWebView2WebMessageReceivedEventArgs2::AdditionalObjects`, reads `ICoreWebView2File::Path` and pushes it. It must be a string message: wry's own handler (registered first) calls `TryGetWebMessageAsString`, which fails for an object message, and WebView2 then calls no later handler (measured on WebView2 157). wry hands the string to Tauri's IPC, which cannot parse it and writes one `console.error` line into the page. Linux: resolves `""` (WebKitGTK gives pages no path; onboarding shows its Linux line, section 3).

**Startup sound.** wry's `autoplay` defaults to true and Tauri does not change it, so WKWebView gets `mediaTypesRequiringUserActionForPlayback = None` and `new Audio().play()` works without a click (Electron's `autoplayPolicy` equivalent). Windows: the browser argument above. Linux: WebKitGTK's default policy allows it; verify (section 11).

**Downloads** (the blob downloads of demo and visual cards and Export as Markdown). Electron showed a save dialog (no `will-download` handler), so the shell does too. `on_download` on the main window: on `Requested`, show `rfd::FileDialog::new().set_parent(&main).set_directory(<destination's folder, else the OS Downloads folder>).set_file_name(<destination's file name>).save_file()` synchronously (the callback runs on the main thread, where rfd's sync dialog must run; the dialog plugin's `blocking_*` must not be used there); `None` → return false; `Some(p)` → `*destination = p`, return true. Log `Finished` with its success flag.

**Printing.** Mac: `print_pdf(path)`: canonicalize; refuse unless it is a file ending `.pdf` inside the data folder; then on the main thread `PDFDocument(url:)` → `printOperationForPrintInfo:scalingMode:kPDFPrintPageScaleDownToFit autoRotate:YES` with a copy of the shared print info, run as a sheet on the main window (`runOperationModalForWindow`). The spike's `native_print.rs` is the reference (minus its test-only save-to-file paths). Windows/Linux: today's pdf.js + `window.print()` path stays; capability `print` (platforms windows, linux) grants `core:webview:allow-print`.

## 5. The server child

**Finding it.** `bundle.externalBin: ["binaries/godspeed-server"]` (in `tauri.bundle.conf.json`, section 9); the build stages `crates/shell/binaries/godspeed-server-<triple>` (`aarch64-apple-darwin`, `x86_64-unknown-linux-gnu`) or `godspeed-server-x86_64-pc-windows-msvc.exe` (tauri-utils `external_binaries` appends `.exe` on Windows); the triple is `rustc --print host-tuple`. The bundler copies it beside the main executable without the suffix (Mac: `Contents/MacOS/godspeed-server`). The shell finds it at `std::env::current_exe()?.with_file_name("godspeed-server[.exe]")`, which in a debug build is `target/debug/godspeed-server` (cargo puts both binaries there), and spawns it with `std::process::Command` (no shell plugin; it would add a JS surface and lacks the pipe control needed).

**Resources** (`bundle.resources` map, in `tauri.bundle.conf.json`): `../../dist-ui/` → `ui/`, `../../models/` → `models/`, `../../.stage/pdfjs-dist/` → `pdfjs-dist/` (only the files `crates/server/src/http/ui.rs` serves); Windows `../../.stage/pdfium.dll` and Linux `../../.stage/libpdfium.so` → resource root (in `tauri.bundle.windows.conf.json` / `tauri.bundle.linux.conf.json`). Mac: `bundle.macOS.frameworks: ["../../.stage/libpdfium.dylib"]` (copied to `Contents/Frameworks/` and signed by the bundler; resources are not signed, and notarization rejects unsigned Mach-O files). Debug runs use `.dev-resources/` (`scripts/dev-resources.mjs`: links `dist-ui` → `ui`, `models`, `node_modules/pdfjs-dist` → `pdfjs-dist`, and the lab's pdfium library) as the cwd instead of the resource folder.

**Spawn.**

| | Value |
|---|---|
| cwd | `app.path().resource_dir()` (holds `ui/`, `models/`, `pdfjs-dist/`); debug: `<repo>/.dev-resources`. |
| stdin / stdout / stderr | piped / piped / piped. |
| Windows flags | `std::os::windows::process::CommandExt::creation_flags(0x0800_0000)` (`CREATE_NO_WINDOW`): the server is a console program, and without it a GUI parent gives it a visible console window on every start, whose closing kills the server. |
| env | inherited, plus `PORT`, `LH_DATA_DIR=<userData>/data`, `LH_DESKTOP_SERVER=1`, `LH_DESKTOP_API_SECRET=<per-launch 64 hex>`, `LH_SHELL=1`, `LH_PDFIUM_PATH=<library path>` (new: `gs_pdf` uses it instead of the resources folder when set), and `LH_SERVER_RESTARTED=1` on restarts. Remove `LH_DEV_URL`. |
| Port | Release: probe 127.0.0.1:47613 by binding a `TcpListener` and dropping it; taken → bind port 0, read the port, drop. Same race as today. Chosen before the window is built (the shim needs the origin); restarts reuse it. Debug builds never touch 47613, in one of two modes. `LH_PORT` set (the lab, `screens`): the server on that port in desktop mode with the login, the window on its origin, like release (the lab uses 48060-48069). `LH_PORT` unset (`desktop:dev`): the server on `PORT+1000` (`PORT` defaults to 3000, the rule `vite.config.ts` proxies to) in browser mode (no `LH_DESKTOP_SERVER`, no secret, no login), the window on Vite at `http://127.0.0.1:<PORT>/`, opened once a TCP connect to it succeeds (30 s limit); a taken port fails with `port <n> is taken; set PORT to another number`. |
| Secret | 32 bytes from `getrandom`, hex. Lives for the shell's lifetime (restarts reuse it, so the window's cookie stays valid). |

**Readiness.** Wait for `{"t":"ready"}` on stdout, 30 s limit; a process exit first, or no ready in time, fails the start. Then: write `<data>/mcp-endpoint.json` (`{"url":"http://127.0.0.1:<port>/api/mcp"}` + `\n`, `fsx::write_text_atomic`), log `server up: <url>`, log the window in.

**Login.** Mint 32 random bytes as hex, send `login`, wait for `login_ok` (2 s), then `main.navigate("http://127.0.0.1:<port>/api/desktop/login?token=<hex>")`. Done for the first window and every reopened window. Only the first window's failure shows the stopped dialog. A reopened window's failure (for one, a Dock click while a crashed server restarts) is logged and the hidden window is destroyed, so the next click tries again; the server is never stopped from there. `RunEvent::Reopen` does nothing while the server is not managed (the old-app dialog, a failed port choice).

**Crash restart.** On an exit after ready that the shell did not cause: `restarts::record(times, now)` (3 per 60 s, port of `server-restarts.cjs`); allowed → log `restarting server (n in the last minute)`, start again with `LH_SERVER_RESTARTED=1`, wait ready, write the endpoint file, `main.reload()` (the cookie still matches). Not allowed, or the restart fails → the stopped dialog. First start failing → the stopped dialog.

**Stopped dialog.** dialog plugin `message("The app's server stopped running.")`, title `godspeed stopped working`, kind Error, `MessageDialogButtons::YesNoCancelCustom("Relaunch", "Report a bug", "Quit")`; Report a bug opens the issue page and asks again; Relaunch → `app.request_restart()`; Quit → `app.exit(0)`. Never `app.restart()`: on the main thread it restarts at once without `RunEvent::Exit`, so `quit.rs` would not run.

**Shutdown** (`quit.rs`). One routine, guarded by a once-flag (an `AtomicBool` swap), run from `RunEvent::Exit` (every exit path reaches it, section 4, and so does `app.request_restart()`): mark stopping, drop the child's stdin (the server stops on EOF: 2 s grace, then exit 143), wait up to 3 s, then `child.kill()` and wait; remove `shell.pid`; delete the demo data folder (section 6); then, if update bytes are held, install them (section 7), last because the Windows install exits the process. `RunEvent::Exit` blocks until it returns (the Mac's `applicationWillTerminate` and Windows' message loop wait for the callback). No signals are needed, so no unsafe code and the same path on Windows, where the installer could not overwrite a running `godspeed-server.exe`.

**Parent death.** The OS closes the pipe when the shell dies; stdin EOF stops the server (the job `server-parent-guard.cjs` did).

**Server changes for Windows.** After rpc-access has rewritten `main.rs` (stdin EOF, `eprintln!`), the remaining `std::os::unix` use and tokio's unix signals go behind `#[cfg(unix)]`, with `tokio::signal::ctrl_c` on Windows. The data-folder lock stays unix-only (a directory cannot be locked on Windows; the single-instance plugin and `old_app.rs` cover it, as Node had no lock). Port the other unix-only code paths (WP windows-server) to what the TS does on Windows.

**`open_agent` on Windows.** Node passed `windowsVerbatimArguments`; Rust's default quoting would turn `""` into `\"\"`. Build it as `Command::new("cmd.exe").raw_arg(format!("/c start \"\" cmd.exe /k \"{script}\""))` with `creation_flags(0x0000_0008 | 0x0000_0200)` (`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, what Node's `detached: true` sets), null stdio.

**Logs.** `<userData>/logs/main.log`, lines `[<ISO time>] <text>`; opened once the old-app check (section 8) lets the launch go on (the Electron app writes the same file; lines before that go to stderr only); at launch, if over 5 MiB, rename to `main.old.log`. The shell's own lines, `updater: …` lines, and every server stderr line as `server: <line>`. Each line is also written to the shell's stderr, ignoring errors. The lifecycle lines keep Electron's texts: `starting server: <server path>`, `data dir: <data path>`, `server up: <url>`, `server exited (code=<n|null> signal=<SIGNAME|null>)` (signal from `ExitStatusExt::signal()` on unix, named for SIGTERM, SIGKILL, SIGINT, SIGHUP, SIGSEGV, SIGBUS, SIGABRT, else the number; always `null` on Windows), `restarting server (<n> in the last minute)`, `server up again: <url>`, `window open: <app origin>/` (never the login URL; it holds the token). First thing in `main`: `std::panic::set_hook` that writes `uncaught: <panic info>\n<std::backtrace::Backtrace::force_capture()>` through `log.rs`, then calls the default hook. The bug report sends only the app version and OS, as today; logs are for the user to attach.

**Search model.** Unchanged: `scripts/fetch-model.mjs` downloads the pinned revision with sha256 checks into `models/` at build time; it ships in `models/` beside the server. pdfium: new `scripts/fetch-pdfium.mjs`, same pattern (pinned bblanchon/pdfium-binaries release, the 158.0.8125 build the lab uses, sha256 per archive) into `.stage/`. onnxruntime: check `otool -L` / `ldd` / `dumpbin /dependents` on the release server; if it links a shared onnxruntime, bundle it the same way as pdfium.

## 6. API protection

**Handshake.**
1. The shell sends `login` with a fresh token over stdin and waits for `login_ok`.
2. It navigates the main window to `/api/desktop/login?token=<hex>`.
3. The server (new route `crates/server/src/http/login.rs`, exempt from the access check): token known and unexpired → remove it (constant-time compare), answer `303`, `Location: /`, `Cache-Control: no-store`, `Set-Cookie: gs_desktop=<LH_DESKTOP_API_SECRET>; Path=/; HttpOnly; SameSite=Strict`. Otherwise the same 403 JSON as the access check.
4. The page loads `/`; every same-origin request carries the cookie. Page JavaScript cannot read it (HttpOnly), and the token is already spent.

**What `Access::allows` checks** (desktop mode, every path the current `allows` treats as API, except `/api/mcp`, `/api/mcp/forget`, `/api/mcp/compacting` and `/api/desktop/login`): cookie `gs_desktop` equal to the secret (constant time), and header `Sec-Fetch-Site: same-origin`. The `x-godspeed-desktop` header check goes. Browser mode (no `LH_DESKTOP_SERVER`, no secret) allows everything, as today. The Sec-Fetch-Site check replaces Electron's "main frame only": the lesson's demo iframes (`sandbox="allow-scripts"`, opaque origin) send `cross-site`, and their subresource and form requests are refused even where WebKit attaches the cookie.

**Agents.** `/api/mcp`, `/api/mcp/forget` and `/api/mcp/compacting` stay outside the check and keep their bearer-token check in the route. `mcp-endpoint.json` and `mcp-token` stay where the `~/godspeed` scripts read them.

**Dev browser mode.** `npm run dev` starts the server without `LH_DESKTOP_SERVER`, so Vite's proxy and any browser reach `/api` freely, as today. `npm run desktop:dev` (shell in debug, `LH_PORT` unset) also starts the server in browser mode and skips the login step (section 5, Port).

**Demo views cannot reach the API or commands.**
- Mac (objc2 WKWebView): no Tauri bridge at all; `WKWebsiteDataStore.nonPersistentDataStore()` (no cookie); content rule list blocking `127.*`, `localhost`, `[::1]`, `0.0.0.0` (the spike's four rules); origin `https://demo.invalid/`; navigation delegate allows only the first load and `about:blank`; downloads cancelled. The NSWindow (borderless, alpha 0, kept on screen) also gets `setExcludedFromWindowsMenu(true)`, `setIgnoresMouseEvents(true)` and `collectionBehavior` `Transient | IgnoresCycle` (plus the spike's `CanJoinAllSpaces | Stationary | FullScreenAuxiliary`), so it stays out of the Window menu and ⌘\` cycling.
- Windows/Linux: a separate top-level Tauri window labeled `demo` (`WebviewWindowBuilder`, never a child webview of `main`), created per run with `visible(false)`, `focused(false)`, `skip_taskbar(true)`, and closed after it. Settings: `data_directory(<temp>/godspeed-demo-<pid>)` (`~/.cache/godspeed-demo-<pid>` on Linux, because `/tmp` is shared and another user could make the folder first and swap the compiled rules in it; its own WebView2 / WebKitGTK profile: no cookie, no localStorage of the app, and on Windows it may use Tauri's default browser arguments without clashing with `MAIN_BROWSER_ARGS`), `incognito(true)`. The window opens on `about:blank`, its loopback block goes in, then the page loads with an origin that is not the app's, so a request to the app is `cross-site` and carries no cookie: on Windows from a registered URI scheme `demo` (`register_uri_scheme_protocol`, served to the `demo` window only, with `use_https_scheme(true)` so the URL is `https://demo.localhost/`); on Linux with `load_html(html, "https://demo.invalid/")`, the Mac's origin, because Tauri registers a scheme once per profile folder while every incognito view gets a fresh WebKit context, so from the second run on the scheme would be missing. A hidden GTK window sizes nothing, so the Linux view is given its page size with `size_allocate` (otherwise the page lays out at 0 × 0 and draws nothing). `on_navigation` allows only that page and `about:blank` (as the Mac); `on_new_window` → `NewWindowResponse::Deny`; `on_download` → false. Loopback blocking matches the Mac's four rules: Linux (`linux/demo.rs`), through `with_webview`, `webkit_user_content_filter_store_new(<demo folder>)` + `webkit_user_content_filter_store_save` compile the spike's rule JSON and `webkit_user_content_manager_add_filter` adds it to the webview's user content manager before the HTML loads (WebKitGTK ≥ 2.24); Windows (`win/demo.rs`), the demo window's own `additional_browser_args`: wry's default `--disable-features=…` plus `--host-resolver-rules` that map the hosts the Mac's rules block (`127.*`, localhost with subdomains and a trailing dot, IPv6 starting `::`, `0.0.0.0`) to `^NOTFOUND`. Its own profile folder gives the demo window a browser process of its own, so these never reach the main window. The resolver sits under every request the browser makes, WebSockets, workers, out-of-process frames and redirects included, which `WebResourceRequested` does not see (WebSocket handshakes never raise it, and answering a redirected frame navigation there left the page's load unfinished); the page itself is served before the network. The https page origin on all three systems is the other half: a plain-http load to any other name is mixed content, so it is blocked or upgraded to https. Known limit: no rule can see a DNS answer, so a public name that resolves to 127.0.0.1 gets as far as a TLS handshake to a local port (no http request, no chosen path). The SVG snapshot: WebKitGTK's `get_snapshot` drawn into a cairo surface of exactly w × h; WebView2's DevTools protocol (`Emulation.setDeviceMetricsOverride` at scale 1, then `Page.captureScreenshot`), which also works in the hidden window. Tauri injects its invoke bridge into this window too, but no capability names the label `demo` and every app command checks for `main` (below), so every invoke is refused. The demo folder is deleted by `quit.rs`, and at startup every `godspeed-demo-*` beside it left by an earlier run is deleted (errors ignored; single instance means none is in use).
- In-app demo iframes in the main window: no invoke key (init scripts are main-frame only), refused by ACL by origin, refused by the server by Sec-Fetch-Site.

**Capabilities** (`crates/shell/capabilities/`, `build.rs` declares every app command with `AppManifest::new().commands(&[...])`):

```json
{ "identifier": "main", "webviews": ["main"], "local": false,
  "remote": { "urls": ["http://127.0.0.1:*"] },
  "permissions": ["allow-pick-folder", "allow-show-in-folder", "allow-open-path", "allow-open-agent",
    "allow-expand-window", "allow-show-window", "allow-get-zoom", "allow-set-zoom", "allow-zoom-step",
    "allow-zoom-reset", "allow-update-state", "allow-update-check", "allow-update-install",
    "allow-report-bug", "allow-list-fonts", "allow-print-pdf", "allow-start-drag",
    "allow-title-bar-double-click", "allow-drag-paths", "allow-toggle-menu"] }
```
plus `print.json` (`webviews: ["main"]`, `local: false`, `platforms: ["windows","linux"]`, same remote, `core:webview:allow-print`). No `windows` key (a window entry grants every webview in that window) and no `core:default`: the page uses no Tauri events or plugin JS. `local: false` is safe because the app page is never "local": `is_local_url` counts `tauri://localhost`, any registered URI scheme (so the `demo` scheme) and the `devUrl`, and the config sets no `devUrl` (section 9; `tauri dev` then serves `boot/` on its own port, which is local, and the window moves on to the remote `http://127.0.0.1:<PORT>`). A `--self-test` case invokes `get_zoom` from a `demo`-scheme page in the `demo` window and expects it refused.

## 7. Updates

**Config.** `bundle.createUpdaterArtifacts: true`; `plugins.updater.pubkey: "<public key text>"`; `plugins.updater.endpoints: ["https://github.com/bayshores/godspeed/releases/latest/download/latest.json"]`; `plugins.updater.windows.installMode: "passive"`. Keys: the owner runs `npx tauri signer generate -w <private path>` once, adds `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as repo secrets, and the public key goes into `tauri.conf.json` before the first Tauri release (`tauri build` signs without reading it, so `verify-release.ts` refuses a release whose `pubkey` is empty, section 9). The plugin is used from Rust only.

**Statuses**, one to one with today (`update.rs` keeps `{status, version, percent, revision}`, `revision` +1 per change, `downloaded` sticky):

| Status | When |
|---|---|
| `disabled` | Debug builds, a build whose `pubkey` is empty (`updater: disabled (no update signing key in this build)`; it could check but never verify a download), or the updater cannot be built for this install (`app.updater()` error). |
| `checking` | A check starts. |
| `downloading` (version, percent) | `check()` returned an update; `download(on_chunk, on_finish)`: percent = floor(received / total × 100), pushed only on a new whole percent. |
| `downloaded` (version) | Bytes kept in memory with the `Update`. |
| `up-to-date` | `check()` returned `None`. |
| `error` | Any check or download error (logged as `updater error: …`). |
| `idle` | Start state. |

Every change is pushed (`update`) and logged. Checks: at startup and every 24 h (a loop on `gs_base::clock::sleep_until`), each automatic check reading `<data>/settings.json` fresh: only `general.autoUpdate === false` skips (`auto-update: automatic check skipped (turned off in Settings)`); unreadable or missing means on. Manual checks (menu, Settings) always run and also download.

**Install on quit.** In `quit.rs` (section 5, Shutdown), which `RunEvent::Exit` runs on every way out (⌘Q, the Dock's Quit, logout, Ctrl+Q, the last window on Windows/Linux): after the server has stopped, if bytes are held, `update.restart_after_install(restart_requested)` (Windows; false on a plain quit) and `update.install(bytes)`; Windows starts the installer and exits inside `install` (`std::process::exit(0)` in the plugin), the Mac replaces the bundle (admin prompt if the folder is not writable), then the process ends. Install errors are logged (`updater error: …`) and the app still quits. `installUpdate` (Restart now): set `restart_requested`, then `app.request_restart()`; the same routine runs from `RunEvent::Exit`, with `restart_after_install` left on for Windows when `restart_requested` is set (the installer relaunches the app), and on the Mac Tauri relaunches the swapped bundle after `Exit`. `app.restart()` is never used (section 5, Stopped dialog). Installing never happens while the server runs, since the server serves `ui/` from inside the bundle. Electron installed on every quit path too (Squirrel's ShipIt waited for the process to end).

**Local drill builds.** No runtime feed override ships. The drill builds with `tauri build --config '{"plugins":{"updater":{"endpoints":["http://127.0.0.1:48070/latest.json"],"dangerousInsecureTransportProtocol":true}}}'` and a throwaway key pair.

### The Mac hand-over from Electron

What the last Electron install does: electron-updater's GitHub provider reads the latest release's `latest-mac.yml`, checks `version` is newer and `minimumSystemVersion` (compared with `os.release()`, the Darwin version), keeps files whose name contains `arm64`, picks the `.zip`, downloads it (tries a differential download with `<zip>.blockmap`; none exists, so it falls back to the full file), checks its sha512, then hands it to Squirrel.Mac through a local proxy. Squirrel unzips it, finds the `.app` whose bundle id matches, checks its code signature against the running app's designated requirement, and ShipIt swaps the bundle on quit (or on Restart now) and relaunches it.

Why the Tauri bundle passes:
- Bundle id `com.bayshores.godspeed` (`identifier` in `tauri.conf.json`), executable name `godspeed` (`mainBinaryName`), product name `godspeed`.
- Signed with the same Developer ID Application certificate (team `TM8Y622C8X`), hardened runtime, notarized and stapled by `tauri build`. Every nested Mach-O (the sidecar, `libpdfium.dylib`) is signed by the bundler.
- Squirrel validates the new bundle against the running Electron app's own designated requirement (`SecCodeCopyDesignatedRequirement`, then `SecStaticCodeCheckValidity` with `kSecCSCheckNestedCode | kSecCSStrictValidate | kSecCSCheckAllArchitectures`). So the exact text is committed: `crates/shell/release/electron-requirement.txt` holds the expression after `designated => ` in `codesign -d -r- godspeed.app`, read once from the published `0.5.N` app in a lab copy (mounted from its DMG, never `/Applications`). CI asserts on every Mac release, both on the built app and on the app extracted from the zip with `ditto -x -k` into a temp folder: `codesign --verify --deep --strict --all-architectures -R="=$(cat crates/shell/release/electron-requirement.txt)" godspeed.app`; plus `spctl --assess --type execute godspeed.app` and `xcrun stapler validate godspeed.app`.
- The zip is made from the stapled app with `ditto -c -k --sequesterRsrc --keepParent godspeed.app godspeed-<v>-arm64-mac.zip` (keeps symlinks, signatures and the ticket).
- `latest-mac.yml` (written by `scripts/release-feeds.mjs`):

```yaml
version: <v>
files:
  - url: godspeed-<v>-arm64-mac.zip
    sha512: <base64 sha512 of the zip>
    size: <bytes>
  - url: godspeed-mac-apple-silicon.dmg
    sha512: <…>
    size: <…>
path: godspeed-<v>-arm64-mac.zip
sha512: <same as files[0]>
releaseDate: '<ISO time>'
minimumSystemVersion: 23.0.0
stagingPercentage: <10 | 50, first Tauri release only>
```

  `23.0.0` is Darwin for macOS 14; electron-updater compares it with `os.release()`, not the macOS version.
- Staged move (electron-updater 6.8.11 `isStagingMatch`: each install compares a random id stored in `<userData>/.updaterId` with the percentage; no field means everyone). The first Tauri release goes out with `stagingPercentage: 10`. After two days with no new start failures in bug reports, `node scripts/release-feeds.mjs --mac-staging 50 v<v>` rewrites only `latest-mac.yml` and uploads it with `gh release upload --clobber`; then the same with `--mac-staging 100`, which drops the field. Later releases write no field. The Tauri feed (`latest.json`) has no staging and needs none (Tauri installs only update Tauri installs).
- TCC grants (Drive and Desktop folder access) are keyed to the bundle id and designated requirement, which stay the same; the server child is attributed to the app.
- Data: same folder; the first launch backs it up (section 8). localStorage starts empty (owner decision).

**macOS 12 and 13.** `minimumSystemVersion` makes their Electron updater report no update. `LSMinimumSystemVersion` 14.0 (`bundle.macOS.minimumSystemVersion: "14.0"`) stops the app from opening if copied by hand. The last Electron release (WP last-electron, built on main) shows a notice on those Macs (`os.release()` major below 23): a native `dialog.showMessageBox` once per launch, after the startup update check, saying this Mac gets no more updates (the owner words it), with an OK button.

**Windows and Linux Electron installs.** Every Tauri release also publishes `latest.yml` and `latest-linux.yml` that describe the **last Electron release** (`0.5.N`): `version: 0.5.N`, files copied verbatim from that release's own feeds, but each `url` written as `../v0.5.N/<name>` (electron-updater's GitHub provider prefixes `/<owner>/<repo>/releases/download/<latest tag>/`, and URL resolution removes the `..`), plus `newApp: <v>`. Effect: an older Electron install updates to `0.5.N` as a normal Electron update; `0.5.N` sees its own version (`update-not-available`), finds `newApp` in the info, and shows the notice: a native `dialog.showMessageBox` once per launch (the owner words it) with buttons `Download` (opens `https://github.com/bayshores/godspeed/releases/latest`) and `Later`. No Electron install on Windows or Linux ever downloads a Tauri installer. The templates live in `crates/shell/release/legacy-latest.yml` and `legacy-latest-linux.yml`, made once from the `0.5.N` release's files.

**Release order.** Publish `0.5.N` (Electron, last) first, then the Tauri release. Macs on 12/13 that skipped `0.5.N` will not see the notice (the Tauri feed stops them before they reach it); publishing `0.5.N` some days earlier reduces that group.

**Rollback.**
- Squirrel refuses a bundle that fails the signature check and keeps the Electron app (status `error`); fix and re-release.
- During the staged move: set the feed back to `--mac-staging 0` (electron-updater then offers it to no one) and fix forward.
- If the Tauri release is bad: turn the GitHub release back into a draft (or mark it pre-release). `releases/latest` then points at the previous release again, so no further Electron installs move. Users already moved get a fixed Tauri version through the Tauri updater; if the Tauri app cannot start at all, they reinstall `0.5.N` from its release page: the Rust server writes the same files, and `data-backup-<v>` holds the pre-switch copy. The Tauri release notes carry this, written before publishing (the owner words it): if the new version won't open on your Mac, download `godspeed-mac-apple-silicon.dmg` from the `v0.5.N` release (link).
- The rollback drill (section 11) proves a Tauri-touched data folder opens in `0.5.N`.

## 8. Data

| OS | userData (= Electron `app.getPath("userData")` with `app.setName("godspeed")`) | Tauri expression |
|---|---|---|
| macOS | `~/Library/Application Support/godspeed` | `app.path().config_dir()?.join("godspeed")` |
| Windows | `%APPDATA%\godspeed` (`C:\Users\<user>\AppData\Roaming\godspeed`) | same |
| Linux | `$XDG_CONFIG_HOME/godspeed`, else `~/.config/godspeed` | same |

Not `app_config_dir()` (that uses the bundle id). `config_dir` follows Electron's `appData` on all three (checked against both docs). Data = `<userData>/data`; logs = `<userData>/logs`. Dev: `<config_dir>/godspeed-dev` for the shell's logs, and `<cache_dir>/godspeed-dev-updater` as the updater cache the first run removes (so a debug build never removes the installed app's); the dev server's data is the repo's `data/` (as `next dev` used). WebKit's own storage (localStorage, cookies) lives outside userData: Mac `~/Library/WebKit/com.bayshores.godspeed`, Windows `%LOCALAPPDATA%\com.bayshores.godspeed\EBWebView`, Linux `~/.local/share/com.bayshores.godspeed`.

**The old app still open** (`old_app.rs`, the first thing setup does, before the log opens, before `first_run` and before the server starts). Electron's own process lock lives in userData and the Tauri single-instance plugin does not see it; the Node server took no data lock. So:
- Mac/Linux: if `<userData>/SingletonSocket` exists, `std::os::unix::net::UnixStream::connect` it (it is a symlink to the socket Chromium's ProcessSingleton listens on; connecting is how Chromium itself finds a running copy, and closing without a message makes it do nothing). Connected → Electron is running.
- Windows: if `<userData>\lockfile` exists, open it with `OpenOptions::new().write(true)`; Chromium holds it open without write sharing while it runs (and deletes it on close), so an error with `raw_os_error() == Some(32)` (sharing violation) → Electron is running.
- Running → dialog plugin `message("The old godspeed is still open. Quit it, then open godspeed again.")`, title `godspeed`, kind Info, one OK button, then `app.exit(0)`; nothing in userData is touched and no server starts.
- Otherwise write `<userData>/shell.pid` (the shell's pid + `\n`, `fsx::write_text_atomic`); `quit.rs` removes it. The last Electron release (`0.5.N`, WP last-electron) reads it before starting its server: if it exists and `process.kill(pid, 0)` succeeds, it shows `A newer godspeed is already open. Quit it first.` and quits. That covers a kept AppImage, a rollback install and a failed Windows hook.

**First run** (`first_run.rs`, before the server starts, after the check above):
1. Marker: Electron's `Local State` file exists in userData (Chromium writes it on every Electron run).
2. If `<userData>/data` exists and `<userData>/data-backup-<v>` does not: copy `data/` to `<userData>/data-backup-<v>.partial`, skipping `data/models/`, then rename to `data-backup-<v>`. `std::fs::copy` clones on APFS, so the Mac copy is near instant. Log the size and time.
3. Only after a successful backup: delete Electron's leftovers in userData (top level only, fixed list, never a pattern), and the updater cache (`~/Library/Caches/godspeed-updater`, `%LOCALAPPDATA%\godspeed-updater`, `~/.cache/godspeed-updater`). The list: `Cache`, `Code Cache`, `GPUCache`, `DawnCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `GrShaderCache`, `ShaderCache`, `Local Storage`, `Session Storage`, `IndexedDB`, `WebStorage`, `Shared Dictionary`, `SharedStorage`, `SharedStorage-wal`, `Service Worker`, `blob_storage`, `databases`, `Network`, `Cookies`, `Cookies-journal`, `Network Persistent State`, `TransportSecurity`, `Trust Tokens`, `Trust Tokens-journal`, `DIPS`, `DIPS-wal`, `Preferences`, `Crashpad`, `Dictionaries`, `VideoDecodeStats`, `shared_proto_db`, `QuotaManager`, `QuotaManager-journal`, `Partitions`, `SingletonLock`, `SingletonCookie`, `SingletonSocket`, `lockfile`, `compile-cache`, and last `Local State`. Check the list against the userData of a lab Electron run (never the owner's folder) before shipping.
4. A failed backup is logged; leftovers stay, so the next launch tries again. The app starts either way.

Kept: `data/`, `logs/`, `shell.pid`, `.updaterId`, every `data-backup-*`. Fresh installs have no `Local State` and skip all of this.

**Data-folder lock.** The server's advisory lock on the data folder (Mac, Linux), the single-instance plugin (Tauri against Tauri), and `old_app.rs` plus `shell.pid` (Tauri against Electron, both ways). On Windows there is no folder lock; the NSIS hook below also removes the Electron copy.

## 9. Build and release

**Two config layers.** tauri-build copies `bundle.externalBin`, `bundle.resources` and `bundle.macOS.frameworks` on every cargo build and fails when they are missing; they are gitignored build outputs. So `crates/shell/tauri.conf.json` (read by every `cargo build`/`test`/`clippy`, including `npm run check` on a fresh clone) has none of them, and there are no `tauri.<platform>.conf.json` files (tauri-build would read those too). The three keys live in `crates/shell/tauri.bundle.conf.json`, plus `tauri.bundle.windows.conf.json` / `tauri.bundle.linux.conf.json` for the pdfium resource, and only `tauri build` reads them: `-c crates/shell/tauri.bundle.conf.json -c crates/shell/tauri.bundle.<os>.conf.json` (the CLI merges `-c` files in order, JSON merge patch, so the `resources` maps combine, and hands the result to tauri-build through `TAURI_CONFIG`). Every `tauri` CLI call sets `TAURI_APP_PATH=crates/shell` so the project folder is never found by walking (the lab's spikes hold other `tauri.conf.json` files).

`crates/shell/tauri.conf.json`:

```json
{
  "productName": "godspeed", "mainBinaryName": "godspeed", "version": "../../package.json",
  "identifier": "com.bayshores.godspeed",
  "build": { "frontendDist": "boot" },
  "app": { "windows": [], "security": { "csp": null }, "withGlobalTauri": false },
  "bundle": {
    "active": true, "targets": ["app", "dmg", "nsis", "appimage", "deb"], "createUpdaterArtifacts": true,
    "category": "Education",
    "icon": ["icons/icon.icon", "icons/icon.icns", "icons/icon.ico", "icons/icon.png"],
    "macOS": { "minimumSystemVersion": "14.0", "hardenedRuntime": true,
      "dmg": { "background": "dmg/background.tiff", "windowSize": { "width": 540, "height": 380 },
        "appPosition": { "x": 130, "y": 190 }, "applicationFolderPosition": { "x": 410, "y": 190 } } },
    "windows": { "nsis": { "installMode": "currentUser", "installerHooks": "nsis/hooks.nsh" } },
    "linux": { "deb": { "depends": [] } }
  },
  "plugins": { "updater": { "pubkey": "<key>", "endpoints": ["…/latest.json"], "windows": { "installMode": "passive" } } }
}
```

`crates/shell/tauri.bundle.conf.json`:

```json
{
  "build": { "beforeBuildCommand": "node scripts/stage-app.mjs" },
  "bundle": {
    "externalBin": ["binaries/godspeed-server"],
    "resources": { "../../dist-ui/": "ui/", "../../models/": "models/", "../../.stage/pdfjs-dist/": "pdfjs-dist/" },
    "macOS": { "frameworks": ["../../.stage/libpdfium.dylib"] }
  }
}
```

`beforeBuildCommand` runs in the frontend folder, which tauri-cli resolves to the current folder holding `package.json`: the repo root, so the path is `scripts/…`, not `../../scripts/…`. There is no `devUrl`: `tauri dev` then serves `boot/` with its built-in dev server, and the debug shell moves the window to Vite itself (section 5, Port; section 6 says why this keeps the app page out of "local"). No entitlements file: WebKit's JIT runs in Apple's own processes, so `allow-jit` is gone. The `.icon` file becomes `Assets.car` through `actool` ≥ 26 (bundler source checked); the hand-packed `icon.icns` is the pre-Tahoe fallback, so `after-pack.cjs` goes. Tauri's docs warn DMG icon positions may not apply on CI: the release smoke opens the DMG and screenshots it. `dmg/background.tiff` holds the 540 × 380 artwork at 1x and 2x (`tiffutil -cathidpicheck background.png background@2x.png`), the Retina TIFF electron-builder made from the same pair.

**NSIS hook** (`nsis/hooks.nsh`, `NSIS_HOOK_PREINSTALL`): if `$LOCALAPPDATA\Programs\godspeed\Uninstall godspeed.exe` exists: `ExecWait '"$LOCALAPPDATA\Programs\godspeed\Uninstall godspeed.exe" /S _?=$LOCALAPPDATA\Programs\godspeed' $0`, then `Delete "$LOCALAPPDATA\Programs\godspeed\Uninstall godspeed.exe"` and `RMDir /r "$LOCALAPPDATA\Programs\godspeed"`. Without `_?=` an NSIS uninstaller copies itself to `%TEMP%`, relaunches and returns at once, and would then delete `$SMPROGRAMS\godspeed.lnk` and `$DESKTOP\godspeed.lnk` after the Tauri installer made them (electron-builder calls its own old uninstaller with `_?=` for this reason); with `_?=` it cannot delete itself, hence the two lines after. Never pass `--delete-app-data`; electron-builder's uninstaller keeps app data by default (`deleteAppDataOnUninstall` false), and the Tauri copy installs to its own folder (`$LOCALAPPDATA\godspeed`).

**npm scripts.**

| Script | Command |
|---|---|
| `dev` | `node scripts/dev-resources.mjs && concurrently -k -n api,ui "cargo build -p gs-server && cd .dev-resources && PORT=$((${PORT:-3000}+1000)) LH_DATA_DIR=\"${LH_DATA_DIR:-$INIT_CWD/data}\" ../target/debug/godspeed-server" "vite"` |
| `desktop:dev` | `node scripts/dev-resources.mjs && cargo build -p gs-server && concurrently -k -n ui,app "vite --host 127.0.0.1" "TAURI_APP_PATH=crates/shell tauri dev"` (the debug shell spawns `target/debug/godspeed-server` on `PORT+1000` in browser mode with `LH_SHELL=1`, so demos run in dev, and opens `http://127.0.0.1:${PORT:-3000}/`) |
| `build` | `vite build` |
| `desktop:local` | `node scripts/fetch-model.mjs && node scripts/fetch-pdfium.mjs && TAURI_APP_PATH=crates/shell tauri build -c crates/shell/tauri.bundle.conf.json --bundles app --no-sign` (the Mac has no second bundle file) |
| `desktop:dist` | `scripts/mac-dist.sh`: fails unless `APPLE_ID` and `APPLE_TEAM_ID` are set and `APPLE_PASSWORD` can be read with `security find-generic-password -s godspeed-notary -a "$APPLE_ID" -w` (a login-keychain item the owner adds once; tauri-bundler reads only `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` or an API key, has no keychain-profile option, and skips notarization with a warning when they are missing); `APPLE_SIGNING_IDENTITY` from `security find-identity -v -p codesigning` (the `Developer ID Application … (TM8Y622C8X)` line); then the fetch steps, `TAURI_APP_PATH=crates/shell tauri build -c crates/shell/tauri.bundle.conf.json --bundles app,dmg`, then `xcrun stapler validate` and `spctl --assess --type execute` on the app (exit non-zero on failure), then `node scripts/release-assets.mjs mac` |
| `check` | `npm run typecheck && npm test && npm run lint && npm run deadcode && npm run rust:check` (unchanged) |
| `rust:check` | unchanged (`--workspace` now includes the shell) |
| `test` | `NODE_ENV=test tsx --test tests/*/*.test.ts tests/*/*.test.tsx` (unchanged) |
| removed | `golden`, the Next and Electron parts of every script |

`scripts/stage-app.mjs` (beforeBuildCommand, cwd = repo root): `vite build`, `cargo build --release -p gs-server --target <triple>`, copy it to `crates/shell/binaries/godspeed-server-<triple>` (`.exe` added on Windows), copy the served pdf.js files to `.stage/pdfjs-dist/`, check `dist-ui/index.html`, `models/…/model_quantized.onnx` and the pdfium library exist, refuse if `dist-ui` holds `data/` or any secrets file (the guards from `build-server.mjs`). `scripts/smoke-server.mjs` is rewritten to boot `target/<triple>/release/godspeed-server` from a staged folder with a throwaway data folder and probe `/api/boot`, `/api/graph`, `/api/settings` as today (browser mode). `.dev-resources/`, `.stage/` and `crates/shell/binaries/` are gitignored.

**Download names and release assets** (`scripts/release-assets.mjs` renames the bundler's outputs; the bundler has no name setting):

| Asset | From |
|---|---|
| `godspeed-mac-apple-silicon.dmg` | `bundle/dmg/godspeed_<v>_aarch64.dmg` |
| `godspeed-windows-x64-setup.exe` | `bundle/nsis/godspeed_<v>_x64-setup.exe` |
| `godspeed-linux-x64.AppImage` | `bundle/appimage/godspeed_<v>_amd64.AppImage` |
| `godspeed-linux-x64.deb` | `bundle/deb/godspeed_<v>_amd64.deb` |
| `godspeed-mac-apple-silicon.app.tar.gz` | `bundle/macos/godspeed.app.tar.gz` (Tauri updater) |
| `latest.json` | `scripts/release-feeds.mjs`: `version`, `pub_date`, `platforms` with exactly `darwin-aarch64-app`, `windows-x86_64-nsis`, `linux-x86_64-appimage`, `linux-x86_64-deb`, each `{url: "https://github.com/bayshores/godspeed/releases/download/v<v>/<asset>", signature: <.sig file text>}` |
| `godspeed-<v>-arm64-mac.zip` | `ditto` of the stapled app (Electron hand-over) |
| `latest-mac.yml`, `latest.yml`, `latest-linux.yml` | `release-feeds.mjs` (section 7) |

Ten assets. Mac stays Apple Silicon only (`aarch64-apple-darwin`), Windows and Linux x64, as today. The release notes table keeps the four links.

**Workflows.**
- Both: `actions/checkout`, `setup-node` 26, Rust from `rust-toolchain.toml`, `Swatinem/rust-cache@v2`, Linux packages `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf`. Electron and Next caches go.
- Linux builds that ship or self-test run in the container `ubuntu:22.04` (on an ubuntu-24.04 runner), with `libwebkit2gtk-4.1-dev` and the packages above from its own repos, rustup from `rust-toolchain.toml`, Node from `setup-node`, and `APPIMAGE_EXTRACT_AND_RUN=1` (no FUSE in containers). Tauri's AppImage guide says to build on the oldest system supported; Electron runs on Ubuntu 22.04 (glibc 2.35) and Debian 12 (2.36) today, and a 24.04 build would need glibc 2.39. A step then runs `objdump -T` on `godspeed` and `godspeed-server` and fails if any `GLIBC_` version is above 2.35.
- `ci.yml` quality (ubuntu-24.04, no container: it only checks): Linux packages, `npm ci`, `npm run check` (which builds the shell without staged files, section 9 config layers), the Python skill tests. Job `desktop` (macos-15, windows-2025, ubuntu-24.04 + the 22.04 container): fetch model and pdfium, `npm run build`, `cargo build --release -p gs-server`, `node scripts/smoke-server.mjs`, `cargo test -p gs-shell` (the Mac demo and print tests need the macOS runner's GUI session), `cargo build -p gs-shell --features self-test` and run `godspeed --self-test` (`xvfb-run -a` on Linux): the demo runner, its isolation and the capability checks on that OS (section 11).
- `release.yml`: `quality` and `draft` unchanged except quality uses the new check. `package` matrix (macos-26 with Xcode 26, windows-2025, ubuntu-24.04 + the 22.04 container): build as in CI, then `TAURI_APP_PATH=crates/shell npx tauri build -c crates/shell/tauri.bundle.conf.json [-c crates/shell/tauri.bundle.<windows|linux>.conf.json] --target <triple> --bundles <app,dmg | nsis | appimage,deb>` with `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` everywhere and, on the Mac, `APPLE_CERTIFICATE` (= the existing `MAC_CSC_LINK` base64 p12), `APPLE_CERTIFICATE_PASSWORD` (= `MAC_CSC_KEY_PASSWORD`), `APPLE_SIGNING_IDENTITY` (new secret, `Developer ID Application: … (TM8Y622C8X)`), `APPLE_ID`, `APPLE_PASSWORD` (= `APPLE_APP_SPECIFIC_PASSWORD`), `APPLE_TEAM_ID`; then `release-assets.mjs <platform>`, the Mac signature checks of section 7 (on the app and on the zip's extracted app), the glibc check on Linux, the self-test, and `gh release upload v<v> <assets> --clobber` (push runs only). Manual runs build unsigned with `--no-sign` and upload nothing. New job `feeds` (needs package): downloads the three platform artifacts (with `.sig` files and sha512 sizes), runs `release-feeds.mjs`, uploads the four feeds. `verify` needs `quality` and `feeds`.

**`scripts/verify-release.ts`.** Same CLI and draft selection. `expectedAssets(v)` becomes the ten names above. The drift guard reads `crates/shell/tauri.conf.json` (productName `godspeed`, identifier `com.bayshores.godspeed`, `createUpdaterArtifacts: true`, the target list, `minimumSystemVersion: "14.0"`, a non-empty `plugins.updater.pubkey`) instead of `electron-builder.yml`. Feed checks: `latest-mac.yml` as today (zip first, legacy `path`/`sha512` = files[0], sizes match assets) plus `minimumSystemVersion: 23.0.0` and an optional `stagingPercentage` (an integer 0 to 99; the only field allowed beyond today's); `latest.yml` / `latest-linux.yml` must equal the committed templates plus `newApp: <v>`, and their only allowed URL shape is `../v0.5.N/<bare name>`; `latest.json` must have `version: <v>`, exactly the four platform keys, URLs equal to `https://github.com/bayshores/godspeed/releases/download/v<v>/<asset>` for assets the release holds, non-empty signatures. `tests/desktop/verify-release.test.ts` follows.

**AGENTS.md.** "Where code goes": `src/frontend` and `src/shared/core` (only what the frontend uses) for TypeScript; `crates/` for all Rust (`crates/shell` the desktop app, the server crates as in docs/rust-server.md); tests: `tests/frontend`, `tests/shared`, `tests/desktop` (the shim, scripts), Rust tests beside their crate. Delete the Next.js block at the top. "Done means clean" names `npm run check` including `rust:check` (cargo test, clippy, cargo machete). docs/rust-server.md "The server process" gets `LH_SHELL`, the protocol, `LH_PDFIUM_PATH`, the login route and the new access rule (each written by the package that adds it).

## 10. Deleted, kept, moved

**Deleted:** `electron/` (all), `src/backend/` (all), `src/app/`, `src/proxy.ts`, `next.config.ts`, `next-env.d.ts`, `scripts/build-server.mjs`, `scripts/after-pack.cjs`, `scripts/smoke-demo-runtime.mjs`, `scripts/make-icons.mjs` (icons are committed; regenerate with `npx tauri icon`), `scripts/golden.ts`, every `crates/*/tests/golden/*.golden.ts` (the committed `.json` outputs stay as fixtures, like the Node recordings), `tests/backend/` (all), `tests/desktop/` except `verify-release.test.ts`, the `golden` npm script.

**npm packages removed** (confirm each with `knip` after the deletions; anything only tests import moves to devDependencies): `next`, `electron`, `electron-builder`, `app-builder-lib`, `electron-updater`, `font-list`, `@huggingface/transformers`, `@modelcontextprotocol/server`, `@mozilla/readability`, `@napi-rs/canvas`, `@resvg/resvg-js`, `puppeteer-core`, `sharp`, `turndown`, `@types/turndown`, `zod`, and `minisearch`, `mdast-util-from-markdown`, `mdast-util-math`, `micromark-extension-math`, `typebox`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai` unless the frontend still imports them (the pi packages are imported by the frontend today; if only for types, keep them as devDependencies). Added: `@tauri-apps/cli` (devDependency, exact). Kept: everything the frontend, its tests, `verify-release.ts` (`js-yaml`), `fetch-model.mjs` use, plus `concurrently`, `vite`, `tsx`, `eslint`, `knip`, `typescript`.

**`src/shared/core`:** keep only modules `src/frontend` (or its tests) reach; delete the rest with their `tests/shared` tests. The barrel `index.ts` hides usage from knip, so trace imports per module.

**Moved (files the Rust server embeds with `include_str!`):** `src/backend/agent/system-prompt.md` and `src/backend/agent/prompts/**` → `crates/agent/prompts/**` (paths in `crates/agent/src/teacher/prompts.rs`); `src/backend/server/agent-folder-files/*` → `crates/services/folder-files/*` (paths in `crates/services/src/app/folder_files.rs`; these stay Node scripts, owner decision). `src/shared/changelog.json` stays (the frontend uses it). knip's entry list swaps the old folder for the new one.

**Tests after the switch.**

| Old | New |
|---|---|
| `tests/backend/*` (server behaviour) | The contract scenarios in the lab (already the judge) and each crate's Rust tests. |
| `tests/desktop/server-restarts`, `bug-report`, `open-guards`, `automatic-updates` | Unit tests in `restarts.rs`, `bug_report.rs`, `open.rs`, `update.rs` (same cases). |
| `tests/desktop/server-parent-guard`, `server-title-guard`, `browser-service-*`, `demo-runtime-payload`, `desktop-payload`, `provider-tracing`, `mac-signing-toolchain`, `desktop-platform` | `crates/shell` tests: stdin EOF stops the server (spawn the real binary in a temp folder), the protocol round trip, login token once-only, the Mac demo test binary (`harness = false`: planted console error, uncaught error, failed CDN script, loopback fetch blocked, probe value, no access to a cookie-protected test server), the PDFKit print to a file, `first_run` on a temp userData, `old_app` (a test listener on a temp `SingletonSocket` → running; a dangling symlink → not running; Windows: a file held open without write sharing → running), the `quit.rs` once-flag (second call does nothing), `paths` per OS. Release shape checks move into `verify-release.ts`. |
| `crates/server/src/http/access.rs` tests | Rewritten for cookie + Sec-Fetch-Site, login exemption, MCP exemption, browser mode. |
| none | `tests/desktop/shim.test.ts`: loads `shim.js` in a `vm` context with a fake `__TAURI_INTERNALS__`, checks every `window.lh` member's command and arguments, the origin gate (`APP_ORIGIN` differs → no `window.lh`), push buffering, `pathForFile` on each platform value (Windows: the posted string message and the `drop-path` reply; timeout → `""`), the drag-region walk on a fake DOM (linkedom), zoom key fallback, context menu suppression. |

The contract `proxy-desktop` recording (header based) is retired with Electron; the access tests above replace it.

## 11. Risks and how each is tested

**Screens in the real Tauri window (213 states).** The `screens` cargo feature (debug builds only) adds a control channel: the shell reads `LH_SCREENS_CTL` (a file the lab appends lines to: `nav <url>`, `eval <js>` (answers through `eval_with_callback` into `LH_SCREENS_OUT`), `size <w> <h>`, `snap <file>` (WKWebView `takeSnapshot` at 2×, page only), `shot <file>` (`screencapture -l <window id>`, includes the title bar and lights), `quit`; each command gets one answer line in `LH_SCREENS_OUT`, `error: <why>` on failure) and `LH_SCREENS_INIT` (a script file run in the page before the app's own, for the lab's fixed clock and driver). The lab adds `screens/lib/tauri-page.mjs`, a small Page adapter covering what the states use (`goto`, `getByTestId(..).nth(n).click()`, `getByText`, `getByRole`, `locator`, `evaluate`, `waitForFunction`, `waitForTimeout`, `keyboard.press/type` as synthetic events, `route` replaced by the lab server's stubs) and `capture.mjs --engine tauri`. The shell runs with `LH_PORT` in 48060-48069 and `HOME` pointing at a lab run folder (Tauri's `config_dir` follows `HOME`; WebKit's store does not, so `screens` builds use the dev data store identifier). Compare with `compare.mjs baseline/chromium baseline/tauri --flag 0.5`; every flagged state is fixed or explained to the owner. The `shell-*` states use `shot` and are checked against the Electron screenshots for the lights' position. Hover states that synthetic events cannot reproduce are listed and checked by hand.

**WebKit spots** (each a named state or a scripted check in the tauri run, on macOS 14 and the newest macOS): fonts and smoothing, scrollbar styling, `field-sizing` (absent in older WebKit: check the composer grows), blur, KaTeX, MathLive (typing, the virtual keyboard), CodeMirror with Vim, mermaid, the pdf.js canvas, drag and drop (files into the composer and onboarding, a folder on onboarding → path filled on the Mac), pasting a screenshot, the startup sound on first launch without a click, find highlights, printing a cheat sheet (panel shows the PDF's page size), autocorrect off (type `teh` and a straight quote in the lesson box: unchanged), clipboard copy buttons (`navigator.clipboard` on `http://127.0.0.1`), downloads (demo card Download and Export as Markdown: the save dialog opens with the right name, the saved file holds the real content, not a JSON error; cancel saves nothing), `Sec-Fetch-Site: same-origin` on fetch, EventSource, `<img src="/api/…">` (the reading page, sheet pictures) and pdf.js requests (the server logs refusals), and the same set on Windows (WebView2) and Linux (WebKitGTK, including that it sends `Sec-Fetch-Site`, and Export as Markdown) by the self-test plus a manual pass. Folder drop on onboarding: Mac and Windows fill the path; Linux shows its line.

**Demo checking.** The Mac test binary and `--self-test` (CI, all three OSes). The self-test builds the main window first (with `MAIN_BROWSER_ARGS` on Windows), then on each OS: a planted console error, an uncaught error and a probe value come back; every loopback form, as images, frames, fetches, WebSockets and a worker's fetch, is blocked (the test server sees no request), and so are plain-http loads to a name that stands for one whose DNS answer is 127.0.0.1 (on Windows the self-test build maps it to 127.0.0.1; an image upgraded to https may only send a TLS handshake naming it); a blob `<a download>` click and a navigation to another URL from the demo change nothing (no file in the Downloads, home, temp or working folder, the URL stays, and on Windows and Linux one of the demo window's guards refused the download's URL, so a click that never became a download cannot pass); an invoke from the `demo` window is refused; after the run no `demo` window exists. Known limits kept from the spike: animations may stop while the screen is locked or the display sleeps (errors are still caught); errors thrown by cross-origin CDN scripts read "Script error.". WebKit's error texts differ from V8's (`Can't find variable: x` vs `x is not defined`): the agent sees the engine's text.

**Hand-over drill (Mac).** Never on the owner's account: Electron's userData ignores `HOME`, so the drill runs in a macOS 14 VM (tart) or a second user account the owner creates. Steps: install `0.5.N` (signed, notarized) → serve a feed folder with `LH_UPDATE_FEED` (the existing Electron seam) holding the Tauri `latest-mac.yml` + zip → Electron downloads, Restart now → the Tauri app opens with the same classes, `data-backup-<v>` exists, leftovers are gone, the Drive-linked folder reads without a new permission prompt → a staged feed (`stagingPercentage: 0`) offers nothing, `100` offers it → then the Tauri-to-Tauri drill (local `--config` feed build): stage an update and quit once each with ⌘Q, the Dock's Quit and closing the window then ⌘Q; each time the next launch is the new version and no `godspeed-server` process is left → then rollback: install the `0.5.N` DMG over it and open the same data; with the Tauri app open, `0.5.N` shows its "newer godspeed" line, and with `0.5.N` open the Tauri app shows its "old godspeed" line. Repeat on a macOS 13 VM: no update offered, notice shown.

**Windows and Linux moves.** On CI runners: install the `0.5.N` NSIS installer silently, then the Tauri installer, once with Electron closed and once with it open: the Electron copy and its folder are gone, data kept, `$SMPROGRAMS\godspeed.lnk` and `$DESKTOP\godspeed.lnk` exist and point at `$LOCALAPPDATA\godspeed\godspeed.exe` (read with PowerShell `WScript.Shell` `CreateShortcut(..).TargetPath`), the app starts and no console window belongs to `godspeed-server.exe` (no `ConsoleWindowClass` window owned by its pid). Then the Tauri-to-Tauri drill on Windows: stage an update, quit with Ctrl+Q, the next launch is the new version. Linux: `sudo dpkg -i` the `0.5.N` deb, then the Tauri deb: `godspeed` on `PATH` is the Tauri binary after Electron's `postrm` ran (`update-alternatives --remove`), the app starts under `xvfb-run`. Feed check: an Electron `0.5.0`-style config pointed at the legacy `latest.yml` resolves the `../v0.5.N/` URL to the real asset (a script calling electron-updater's `GitHubProvider.resolveFiles` with the template).

**Live run with a real agent.** In the macOS VM (no route to the owner's app, data or agent config): the owner signs Claude Code and Codex in inside the VM; install the Tauri build; onboarding, link a folder of sample files, `~/godspeed` set up, run a lesson, a demo job (demo checked in the hidden view), a cheat sheet and print, Talk, a crash of the server (`kill -9` its pid: restart notice), quit with an update staged.

**Other.** Traffic light semantics differ between Electron and tao: measured (see the Mac title bar row), not assumed. Windows hidden menu bar: check the menu shortcuts still fire while hidden; if they do not, keep the bar visible and tell the owner. onnxruntime linking (section 5). DMG layout on CI.

## 12. Work packages

Order: rpc-access, then shell-core (the app runs end to end on the Mac from `cargo run`, with demo checking answering "not available"), then the packages that hang off it in parallel, deletions once the shell runs, release last.

| id | Model | Depends on | Owns (main files) |
|---|---|---|---|
| rpc-access | opus | none | `crates/shell-rpc/`, `crates/server/src/main.rs`, `crates/server/src/http/{access,login,mod}.rs`, the `ShellLink` field in `crates/services`, `crates/agent/src/subagents/headless.rs` |
| shell-core | opus | rpc-access | `crates/shell/` except the files below (it creates the stubs they replace), `scripts/dev-resources.mjs`, root `Cargo.toml` (shell member, tauri deps) |
| shim-commands | sonnet | shell-core, mac-native (merge order only) | `commands.rs`, `open.rs`, `bug_report.rs`, the `window.lh` part of `shim.js`, the React changes (section 3), `tests/desktop/shim.test.ts` |
| updater | opus | shell-core | `update.rs`, the `plugins.updater` block of `tauri.conf.json` |
| mac-native | opus | shell-core | `crates/shell/src/mac/` |
| demo-win-linux | opus | shell-core, mac-native (merge order, for the Mac part of the self-test) | `demo_webview.rs`, `crates/shell/src/win/`, `crates/shell/src/linux/`, `self_test.rs` |
| windows-server | sonnet | rpc-access | `crates/server/src/main.rs` once rpc-access is merged, and the other unix-only code in the server crates |
| build-scripts | sonnet | shell-core | `scripts/{stage-app,fetch-pdfium,smoke-server,release-assets}.mjs`, `scripts/mac-dist.sh`, `crates/shell/tauri.bundle*.conf.json`, `package.json`, `.gitignore`, `LH_PDFIUM_PATH` in `crates/pdf` |
| deletions | sonnet | shell-core, build-scripts, shim-commands | everything section 10 deletes or moves, `knip` and eslint config, `AGENTS.md` |
| screens-tauri | sonnet | shim-commands, mac-native | `screens.rs`, the lab's tauri engine |
| last-electron | sonnet | none (built on main) | `electron/` on main: the macOS 12/13 notice, the `newApp` notice, the `shell.pid` check |
| release | sonnet | build-scripts, updater, deletions, last-electron published | `.github/workflows/`, `scripts/verify-release.ts` + test, `scripts/release-feeds.mjs`, `crates/shell/release/`, `crates/shell/nsis/hooks.nsh` |
| live-tests | opus | everything | nothing in the repo; the drills of section 11 |

Shared lines: the `generate_handler!` list in `main.rs` and the command list in `build.rs` and `capabilities/main.json`; each package adds one line per command it writes and touches no other line. Instructions per package are in the workflow's package list (the same text); each ends when `npm run check` passes and an Opus review signs off.
