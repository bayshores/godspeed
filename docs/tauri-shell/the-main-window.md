## The main window

| Item | Value |
|---|---|
| Label | `main`, one at a time. |
| Size | 1440 × 900 logical, centered, minimum 640 × 600. |
| Color | `appearance.background` from `<data>/settings.json`, read for each new window, else Paper `#c9c7bd`. |
| Title | `godspeed`, then the page's `document.title` (empty and unchanged titles skipped). |
| Mac title bar | `TitleBarStyle::Overlay`, `hidden_title(true)`, `traffic_light_position(16, 25)`. |
| Windows and Linux title bar | The system title bar. The menu bar is hidden after build; a lone Alt press and release toggles it. |
| First paint | Starts hidden on `boot/index.html`, a blank page with no background. Moves to the app once the server is ready; `show_window` shows it. |
| Show fallback | 5 s after the first finished load of an app page, the shell shows a window still hidden. |
| Other settings | `zoom_hotkeys_enabled(false)`, `disable_drag_drop_handler()`, and on the Mac `allow_link_preview(false)`. |
| Windows browser arguments | `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required`. WebView2 refuses a second webview with other arguments in the same profile, which is why the demo window has its own. |
| Debug builds | Mac: `data_store_identifier(*b"godspeed-dev-web")`. Windows and Linux: `data_directory(<userData>/webview)`. A debug build never shares localStorage or cookies with the installed app. |

### Mac traffic lights

tao puts the first light's left edge at x and its center at y - 2, so the lights span x 16 to 76 with centers on y 23 in the 48 px top bar. AppKit moves the lights back to their default place on every title change and when a hidden window first shows. So the title handler sets the title through `mac::window::set_title`, and `show` sets it again after showing.

### Drag areas (Mac)

WebKit has no `-webkit-app-region`, so the shim copies Chromium's rule.

1. On a plain primary `mousedown` while `html.lh-desktop[data-lh-platform="darwin"]` matches, the shim walks `.lh-drag, .lh-no-drag, .lh-drag :is(button, input, textarea, select, a, summary, [contenteditable])` in document order.
2. The last element under the point decides: drag unless it matches the no-drag part.
3. On a drag, the shim calls `preventDefault()` and invokes `start_drag`.
4. The second press of a double click starts no drag, because the drag would swallow the mouse-up and WebKit would never send `dblclick`. That press remembers its point instead.
5. A `mouseup` with `detail === 2` at the same point invokes `title_bar_double_click`. It reads `AppleActionOnDoubleClick`: `Minimize` minimizes, `None` does nothing, anything else toggles zoom.

Windows and Linux have no drag areas.

### Zoom

Ladder: `[0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]`. Applying a factor sets the webview zoom, stores it and pushes `zoom`.

- The menu owns `CmdOrCtrl+0`, `CmdOrCtrl+=` and `CmdOrCtrl+-`. muda has no Plus key.
- The shim's `keydown` listener catches the keys the menu does not claim (⌘ or Ctrl with `=`, `+`, `-` or `0`) and calls `zoom_step` or `zoom_reset`. Menu keys never reach the page, so exactly one applies.
- The shim saves each pushed factor in `localStorage["lh-zoom"]` and calls `set_zoom` with it at document start.

### Menu

`menu.rs` builds it once at setup.

| Submenu | Items |
|---|---|
| godspeed | About godspeed, Check for Updates…, separator, Mac only: Hide, Hide Others, separator; Quit godspeed (a custom item on every OS, CmdOrCtrl+Q, `app.exit(0)`; GTK 3 has no predefined Quit). |
| File | Mac only: Study (⌘N), Search Lessons (⌘⇧F), separator, Open godspeed Folder (asks the server for the folder off the menu's thread, then opens it in Finder). |
| Edit | Mac and Windows: Undo, Redo, separator, Cut, Copy, Paste, Select All. Linux: Cut, Copy, Paste, Select All. GTK 3 has no Undo or Redo item, and a custom one would take Ctrl+Z from the page's editors. |
| View | Reload (CmdOrCtrl+R), Toggle Developer Tools (⌥⌘I or Ctrl+Shift+I; works in debug builds or with cargo feature `devtools`), separator, Actual Size, Zoom In, Zoom Out, separator, Toggle Full Screen (Mac predefined; Windows and Linux a custom F11). |
| Go | Mac only: Back (⌘[), Forward (⌘]), separator, Today, Graph (⌘G), Progress, Files, Deadlines, Cheat Sheets. |
| Window | Mac: Minimize, Zoom, separator, Bring All to Front, set as the windows menu. Windows: Minimize, Close Window. Linux: custom Minimize and Close Window. |
| Help | Report a Bug…; on the Mac set as the help menu. |

The bar's order on the Mac is godspeed, File, Edit, View, Go, Window, Help. Windows and Linux have no File or Go menu: their keys would be Ctrl keys, which the agent's terminal needs (Ctrl+[ is Esc).

Check for Updates… and every File and Go item except Open godspeed Folder reopen the window if gone, unminimize and focus it. Check for Updates… then pushes `open-settings` with `general` and starts a manual check. A File or Go item pushes `menu` with its id: a keyboard action id (`new-session`, `sessions-search`, `jump-graph`), `go:<path>`, `back` or `forward`. The page runs it (`keyboard-shortcuts.tsx`). Menu keys never reach the page, so each runs once.

A push sent before the page has loaded waits in one slot (`window::push_when_loaded`) and goes out when it loads; a later one replaces it.

`ToShell::ShowWindow { page }` (a page the agent opened, [architecture/08.1.3](../architecture/08.1.3-agent-tools-and-notes.md#opening-a-page)) runs the same `window::bring_forward` as the menu on the main thread, and on the Mac first shows a hidden app (⌘H). A page that hasn't loaded (a window made again, or one reloading) gets `menu` `go:<path>?space=<id or none>`, and the page switches to that space the way Follow does (`followMoves`) before it goes. A loaded page goes there itself from the activity event, so its holds (unsent lesson text, a mock, a dialog) still count.

| Limit | Why |
|---|---|
| Windows may only flash the taskbar button | Its focus lock keeps another app's window in front. |
| Wayland may not focus | The compositor decides. |
| The screens lab never focuses | `window::focus` and the app show skip it, so a check never takes the learner's screen. |
| Browser mode has no shell | The page goes there; nothing brings a browser tab forward. |

### Single instance

Release builds register `tauri_plugin_single_instance` first. Debug builds skip it, so `tauri dev` runs beside the installed app. A second launch unminimizes and focuses the main window if visible, otherwise does nothing. The plugin does not see a running Electron godspeed; see [The old app still open](data.md#the-old-app-still-open).

### Window lifecycle

- Mac: closing the window keeps the app running. `RunEvent::ExitRequested` with no code is the only prevented exit.
- Mac: `RunEvent::Reopen` creates the window again and logs it in when no `main` window exists. It does nothing while the server is not managed yet (the old-app dialog, a failed port choice).
- Windows and Linux: when the main window is destroyed, the shell calls `app.exit(0)`. A `demo` window would otherwise keep the process alive.
- Every way out ends in `RunEvent::Exit`, where `quit.rs` runs. See [Shutdown](the-server-child.md#shutdown).

### Links and navigation

WebKit asks `on_navigation` about every frame without saying which. So the shell only allows or cancels and never opens the browser from there. A demo iframe that set its own `location` to a web address would otherwise open the learner's browser with no click.

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

Blob downloads (demo and visual cards, Export as Markdown) show a save dialog. On `Requested`, `on_download` shows `rfd::FileDialog` with the destination's folder (else Downloads) and file name, synchronously on the main thread. Cancel returns false. A pick replaces the destination. `Finished` is logged with its success flag.

### Printing

Mac: `print_pdf(path)` canonicalizes the path and refuses anything that is not a `.pdf` file inside the data folder. It prints the PDF with PDFKit as a sheet on the main window, scaled to fit, on a copy of the shared print info. Windows and Linux keep the page's pdf.js and `window.print()` path; the `print` capability grants `core:webview:allow-print` there.
