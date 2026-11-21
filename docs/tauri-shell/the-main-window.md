## The main window

| Item | Value |
|---|---|
| Label | `main`, one at a time. |
| Size | 1440 × 900 logical, centered, minimum 640 × 600. |
| Color | `appearance.background` from `<data>/settings.json`, read for each new window, else Graphite `#161616`. |
| Title | `godspeed`, then the page's `document.title` (empty and unchanged titles skipped). |
| Mac title bar | `TitleBarStyle::Overlay`, `hidden_title(true)`, `traffic_light_position(16, 25)`. |
| Windows and Linux title bar | The system title bar. The menu bar is hidden after build; a lone Alt press and release toggles it. |
| First paint | Starts hidden on `boot/index.html`, a blank page with no background. Moves to the app once the server is ready; `show_window` shows it. |
| Show fallback | 5 s after the first finished load of an app page, the shell shows a window still hidden. |
| Other settings | `zoom_hotkeys_enabled(false)`, `disable_drag_drop_handler()`, and on the Mac `allow_link_preview(false)`. |
| Windows browser arguments | `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required`. WebView2 refuses a second webview with other arguments in the same profile, which is why the demo window has its own. |
| Debug builds | Mac: `data_store_identifier(*b"godspeed-dev-web")`. Windows and Linux: `data_directory(<userData>/webview)`. A debug build never shares localStorage or cookies with the installed app. |

Every app window, the terminal window too, is built from `window::base_builder`: the shim, the navigation and new-window rules, downloads, the window color, the page's own drops, the Windows browser arguments and the debug profile above, and `allow_link_preview(false)` on the Mac.

### Mac traffic lights

tao puts the first light's left edge at x and its center at y - 2, so the lights span x 16 to 76 with centers on y 23 in the 48 px top bar. AppKit moves the lights back to their default place on every title change and when a hidden window first shows. So the title handler sets the title through `mac::window::set_title`, and `show` sets it again after showing.

### Drag areas (Mac)

WebKit has no `-webkit-app-region`, so the shim copies Chromium's rule.

1. On a plain primary `mousedown` while `html.lh-desktop[data-lh-platform="darwin"]` matches, the shim walks `.lh-drag, .lh-no-drag, .lh-drag :is(button, input, textarea, select, a, summary, [contenteditable])` in document order.
2. The last element under the point decides: drag unless it matches the no-drag part.
3. On a drag, the shim calls `preventDefault()` and invokes `start_drag`. It drags the window the page is in (main, or the terminal window, whose head is a drag area too).
4. The second press of a double click starts no drag, because the drag would swallow the mouse-up and WebKit would never send `dblclick`. That press remembers its point instead.
5. A `mouseup` with `detail === 2` at the same point invokes `title_bar_double_click`. It reads `AppleActionOnDoubleClick`: `Minimize` minimizes, `None` does nothing, anything else toggles zoom.

Windows and Linux have no drag areas.

### Zoom

Ladder: `[0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]`. Applying a factor sets the webview zoom of every open app window, stores it and pushes `zoom` to each. A terminal window made later starts at the stored factor.

- The menu owns `CmdOrCtrl+0`, `CmdOrCtrl+=` and `CmdOrCtrl+-`. muda has no Plus key.
- The shim's `keydown` listener catches the keys the menu does not claim (⌘ or Ctrl with `=`, `+`, `-` or `0`) and calls `zoom_step` or `zoom_reset`. Menu keys never reach the page, so exactly one applies.
- A trackpad pinch, or a scroll with ⌘ or Ctrl held, does not change the factor: the shim sends it to the page as an `lh-pinch` event on `window` (`{ by, x, y }`: how much bigger, and the pointer's point), and the page magnifies there (Magnifier below). One mouse notch is a quarter at most. Its listeners are in the capture phase, before the terminal takes the wheel.
  - A pinch reaches it as `wheel` events with Ctrl held, and in WebKit on the Mac as `gesturestart`, `gesturechange` and `gestureend` too. A pinch counted from its gesture events is not counted again from its wheels.
  - Wheels less than 100 ms apart are one run, and the keys at its start decide for all of it, so a key pressed while a scroll coasts does not magnify.
  - A view that zooms itself (the graph, a cheat sheet, a diagram or plan in focus) takes its wheel with `ownWheel` in `src/frontend/lib/own-wheel.ts`, which marks it `data-lh-own-zoom`. The shim leaves a wheel or pinch over that mark alone.
  - A wheel inside a demo or plugin frame never reaches the shim. Linux's web view keeps a pinch to itself.
- While the factor is not 1 the top bar shows it ("125%", `BarZoom` in `src/frontend/components/top-bar/bar-zoom.tsx`); a click calls `set_zoom` with 1. While the page is magnified the same word shows the magnifier's size instead, and a click ends it. The page reads the factor through `useZoom` (`src/frontend/components/use-zoom.ts`) only.
- Settings > Appearance "Text size" is a slider over the ladder. It calls `set_zoom` and follows every `zoom` push, so the keys and the menu move it too. The browser build has no slider.
- The shim saves each pushed factor in `localStorage["lh-zoom"]` and calls `set_zoom` with it at document start.

### Magnifier

`src/frontend/components/magnifier/`. The page (inside `main#lh-page`) magnifies under an `lh-pinch` at its point, from 100% to 400%; the top bar, the teacher's panel and the strip stay as they are. The page keeps its layout: one `transform` on a box around it, none at 100%.

- The point under the pointer stays under it. The shown part never leaves the page's room. Pinching out to 100% ends it.
- While magnified, a scroll moves the shown part. At the room's edge in that direction the scroll is the page's own.
- A mini map in the page's bottom-left corner shows the shown part as a box. A press or drag on it moves the part there.
- It ends on a page change and with a click on the bar word. The terminal window has no magnifier.

### Menu

`menu.rs` builds it once at setup.

| Submenu | Items |
|---|---|
| godspeed | About godspeed, Mac only: Settings… (⌘,); Check for Updates…, separator, Mac only: Hide, Hide Others, separator; Quit godspeed (a custom item on every OS, CmdOrCtrl+Q, `app.exit(0)`; GTK 3 has no predefined Quit). |
| File | Mac only: Study (⌘N), Search Lessons (⌘⇧F), separator, Open godspeed Folder (asks the server for the folder off the menu's thread, then opens it in Finder). |
| Edit | Mac and Windows: Undo, Redo, separator, Cut, Copy, Paste, Select All. Linux: Cut, Copy, Paste, Select All. GTK 3 has no Undo or Redo item, and a custom one would take Ctrl+Z from the page's editors. |
| View | Reload (CmdOrCtrl+R), Toggle Developer Tools (⌥⌘I or Ctrl+Shift+I; works in debug builds or with cargo feature `devtools`), separator, Actual Size, Zoom In, Zoom Out, separator, Toggle Full Screen (Mac predefined; Windows and Linux a custom F11). |
| Go | Mac only: Back (⌘[), Forward (⌘]), separator, Home, Graph (⌘G), Progress, Files, Deadlines. |
| Window | Mac: Minimize, Zoom, separator, Bring All to Front, set as the windows menu. Windows: Minimize, Close Window. Linux: custom Minimize and Close Window. |
| Help | Report a Bug…; on the Mac set as the help menu. |

The bar's order on the Mac is godspeed, File, Edit, View, Go, Window, Help. Windows and Linux have no File or Go menu: their keys would be Ctrl keys, which the agent's terminal needs (Ctrl+[ is Esc).

Settings…, Check for Updates… and every File and Go item except Open godspeed Folder reopen the window if gone, unminimize and focus it. Check for Updates… then pushes `open-settings` with `general` and starts a manual check. Settings… and a File or Go item push `menu` with the item's id: a keyboard action id (`open-settings`, `new-session`, `sessions-search`, `jump-graph`), `go:<path>`, `back` or `forward`. The page runs it (`keyboard-shortcuts.tsx`). Menu keys never reach the page, so each runs once.

### Menu bar countdown

On the Mac, `menu_bar_countdown.rs` draws a menu bar item from the server's `menu_bar_countdown` lines ([The line protocol](the-line-protocol.md#the-line-protocol)). The server decides every word ([architecture/06.1](../architecture/06.1-spaces.md#menu-bar-countdown)); the shell only draws them.

| Part | What it is |
|---|---|
| Item | The g logo (`icons/menu-bar-countdown.png`, a template image so macOS tints it) and the title beside it, for example "3d". Made under the fixed id `menu-bar-countdown` on the first line, then only its title and menu change. `menu_bar_countdown_off` removes it, and so does a server that stopped for good (`Server::stopped`), so an old countdown never stays. |
| Deadline rows | One item per row, id `page:go:<page>`, so `menu::handle` runs them like the Go menu's items. A single "&" in the text is written "&&", since the Mac drops a lone one. |
| Open godspeed | Id `open-window`: `window::bring_forward` with no page. |
| Quit godspeed | The app menu's `quit` id and label. |

A left click shows the menu (the tray's default). Its clicks reach `menu::handle` through `RunEvent::MenuEvent` like the app menu's, so the item registers no menu handler of its own; one would run each click twice. Tauri's `tray-icon` feature is on for the Mac only, so Linux never builds libappindicator.

Every item acts on the main window, except Close Window (Windows and Linux), which closes the window that has the focus. The Mac has no Close Window item, so ⌘W does nothing in either window.

A push sent before the page has loaded waits in one slot (`window::push_when_loaded`) and goes out when it loads; a later one replaces it.

`ToShell::ShowWindow { page }` (a page the agent opened, [architecture/08.1.3](../architecture/08.1.3-agent-tools-and-notes.md#opening-a-page)) runs the same `window::bring_forward` as the menu on the main thread, and on the Mac first shows a hidden app (⌘H). A page that hasn't loaded (a window made again, or one reloading) gets `menu` `go:<path>?space=<id or none>`, and the page switches to that space the way Follow does (`followMoves`) before it goes. A loaded page goes there itself from the activity event, so its holds (unsent lesson text, a mock, a dialog) still count.

| Limit | Why |
|---|---|
| Windows may only flash the taskbar button | Its focus lock keeps another app's window in front. |
| Wayland may not focus | The compositor decides. |
| The screens lab never focuses | `window::focus` and the app show skip it, so a check never takes the learner's screen. |
| Browser mode has no shell | The page goes there; nothing brings a browser tab forward. |

### Single instance

Release builds register `tauri_plugin_single_instance` first. Debug builds skip it, so `tauri dev` runs beside the installed app. A second launch unminimizes and focuses the main window if visible, otherwise does nothing; the terminal window is never brought forward by it. The plugin does not see a running Electron godspeed; see [The old app still open](data.md#the-old-app-still-open).

### Window lifecycle

- Mac: closing the window keeps the app running. `RunEvent::ExitRequested` with no code is the only prevented exit.
- Mac: `RunEvent::Reopen` creates the window again and logs it in when no `main` window exists. It does nothing while the server is not managed yet (the old-app dialog, a failed port choice).
- Destroying the main window destroys the terminal window too (`RunEvent::WindowEvent`, `terminal_window::close`). On the Mac the last window is then gone, so the app keeps running as above.
- Windows and Linux: when the main window is destroyed, the shell calls `app.exit(0)`. A `demo` window would otherwise keep the process alive.
- A server restart reloads every open app window.
- Every way out ends in `RunEvent::Exit`, where `quit.rs` runs. See [Shutdown](the-server-child.md#shutdown).

### The terminal window

The teacher's terminal popped out beside the main window. The page is `/terminal-window` (`routes/terminal-window.tsx`: the providers the main window has, from `routes/app-providers.tsx`, and no app frame, top bar or teacher provider); the shell only makes the window. The page is the teacher panel's head with the status line and "Put back", and the screen with its row. On the Mac the head is the title bar: it has the shim's drag class and the traffic lights' gutter.

| Item | Value |
|---|---|
| Label | `terminal` (`window::TERMINAL`), one at a time, never open at launch. |
| Made by | `terminal_window_open(title)` from the main window only. When the window exists, the call brings it forward instead (unminimize, show, focus). |
| Place | Its left edge on the main window's right edge, its top on the main window's top, on the screen the main window is on, inside that screen's work area. With no room at the right, it moves left until it fits and covers the main window's right part. Not remembered. |
| Size | 720 × 900 logical, never taller than the main window's frame or the screen; minimum 400 × 300. The title bar's height is taken off the inner height after the build, so the frame is as tall as placed. Not remembered. |
| Title | The name the page passes: control characters dropped, cut at 60 characters, `godspeed` when nothing is left. The page's own title is not followed. Windows and Linux show it in the system title bar. On the Mac the title bar is the page's, as main's is (overlay style, title hidden, the traffic lights centered on the page's head row at `{16, 28}`), and the name shows in Mission Control and the Window menu. |
| Not always on top | It is an ordinary window. |
| Built like main | `base_builder`, so the shim, the navigation rules, the color, the Windows browser arguments and the debug profile are main's; the menu bar is hidden after the build on Windows and Linux. |
| Shown | Hidden until its first app page has loaded (then focused), or 5 s after it was made. In the screens lab it goes through `screens::appear` like main: unseen, never focused. |
| Zoom | Shares main's factor (see Zoom). |
| Focus | The app counts as focused when either window is: `notify.rs` shows no notification then. |
| Closing | Its close button, `terminal_window_close` from either window ("Put back"), or the main window being destroyed. Nothing is remembered and nothing asks. |

The shell owns whether it is open. It pushes `terminal-window` `{open}` to the main window when the window is made, when it is destroyed and after every load of the main page, so a reloaded main page knows. `terminal_window_close` also pushes `{open: false, back: true}`: a page asked to put the terminal back, so the main page opens its panel on the screen, which the close button does not ask. When the window is destroyed the shell also detaches every terminal it showed (`Terminals::window_closed`), because its page cannot say so; the main page attaches again when its panel mounts the screen's view. Its page never starts the helper or wakes the teacher, so two windows never start two agents.

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

### App icon

Mac only. Settings, Appearance, App icon offers the app's own icon (Graphite) and the pictures in `crates/shell/icons/choices/`. The pick is `appearance.appIcon` in `settings.json`: `null` for the app's own, else the picture's name.

| When | What `mac/app_icon.rs` does |
|---|---|
| A pick in Settings | The page saves the setting, then calls `apply_app_icon()`. The Dock takes the picture at once (`NSApplication.applicationIconImage`), and the app's bundle gets it as a custom icon (`NSWorkspace.setIcon`, what Finder's Get Info does), so the Dock, Finder and Spotlight keep it after quit. Graphite removes the custom icon. |
| Every start | With a picture picked, the Dock takes it, and a bundle with no custom icon gets it back: an update replaces the bundle. With Graphite picked nothing is touched, so an icon the learner pasted in Finder stays. |

- A custom icon adds the file `Icon\r` and a Finder flag to the bundle. `codesign --verify --deep` still passes; `--strict` does not.
- A build run from `target/` has no bundle: only the Dock changes, until quit.
- A bundle that cannot be written (a read-only disk) keeps its icon. The pick shows an error line in Settings; at start the failure goes to the log.
- macOS draws a custom icon as it is: no Dark, Clear or Tinted look.
