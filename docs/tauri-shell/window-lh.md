## `window.lh`

The shim (`crates/shell/src/shim.js`) is an initialization script on every app window, the main window and the terminal window. The terminal window's capability grants only some of the commands (see [API protection](api-protection.md#capabilities)); the shim's other calls (`drag_paths`, `toggle_menu`) are refused there. It defines `window.lh` with the members `src/frontend/components/desktop-env.tsx` declares, via `window.__TAURI_INTERNALS__.invoke`. The shell bakes `APP_ORIGIN` and `PLATFORM` into the script text before building the window. The shim does nothing unless `location.origin === APP_ORIGIN`, so the boot page and login redirect get no `window.lh`.

| Member | Command or push | Detail |
|---|---|---|
| `platform` | constant | `"darwin" \| "win32" \| "linux"`. |
| `pickFolder()` | `pick_folder` | The dialog plugin's folder picker on the main window; the absolute path or `null`. |
| `showInFolder(path)` | `show_in_folder` | Absolute path only; `tauri_plugin_opener::reveal_item_in_dir`. |
| `openPath(path)` | `open_path` | Absolute paths only, canonicalized. A bundle folder (`.app` and the other bundle extensions in `open.rs`) is revealed. A folder or a `.pdf` file opens in its default app. Anything else does nothing. |
| `pathForFile(file)` | `drag_paths` (Mac), WebView2 message (Windows) | `Promise<string>`. See [File drops](the-main-window.md#file-drops). Linux resolves `""`. |
| `showWindow()` | `show_window` | Shows and focuses the main window if hidden. |
| `onZoom(cb)` | push `zoom` | The factor, pushed after every change and every page load. |
| `getZoom()` | `get_zoom` | The current factor. |
| `setZoom(factor)` | `set_zoom` | One of the ladder values; any other is ignored. Settings > Appearance "Text size" calls it. |
| `onUpdateStatus(cb)` | push `update` | `{status, version, percent, revision}`. |
| `getUpdateState()` | `update_state` | A snapshot of the same. |
| `checkForUpdates()` | `update_check` | A manual check, ignoring the setting. |
| `installUpdate()` | `update_install` | Restart now; see [Install on quit](updates.md#install-on-quit). |
| `reportBug()` | `report_bug` | Opens the issue page. |
| `listFonts()` | `list_fonts` | Mac: `NSFontManager` families. Windows and Linux: `fontdb` system fonts, each face's first family name. Drops `iconfont`, sorts with `gs_base::locale::compare`, removes repeats. |
| `onOpenSettings(cb)` | push `open-settings` | The Settings section a menu item asked for. |
| `onMenu(cb)` | push `menu` | A Mac File or Go item: a keyboard action id, `go:<path>`, `back` or `forward`. A page the agent opened in a window made again: `go:<path>?space=<id or none>`. |
| `printPdf(path)` | `print_pdf` | Mac only; absent on Windows and Linux. See [Printing](the-main-window.md#printing). |
| `applyAppIcon()` | `apply_app_icon` | Mac only; absent on Windows and Linux. See [App icon](magnifier-menu-bar-and-icon.md#app-icon). |
| `openLink(url)` | `open_link` | A web or mail link, as a link click sends it. |
| `terminalWindow.open(title)` | `terminal_window_open` | Main window only. Opens the terminal window beside the main window, titled `title` (the teacher's name), or brings it forward when open. See [The terminal window](the-main-window.md#the-terminal-window). |
| `terminalWindow.close()`, `terminalWindow.focus()` | `terminal_window_close`, `terminal_window_focus` | Either window. Close ("Put back") closes the window and has the main page show the terminal; focus rejects when it is not open. |
| `terminalWindow.onChange(cb)` | push `terminal-window` | `{open}`, sent to the main window when the window is made or destroyed and after every load of the main page; `{open: false, back: true}` after `terminalWindow.close()`. |
| `terminals.start(role, agent, resume?)` | `terminal_start` | `role` is `"teacher"` or `"helper"`, `agent` is `"claude"` or `"codex"`, and `resume` is the teacher's earlier chat to go back to, when one was picked. Answers `{ id }`. See [Terminals](terminals.md#terminals). |
| `terminals.attach(id)`, `terminals.detach(id)` | `terminal_attach`, `terminal_detach` | Attach pushes a snapshot of the screen, then live output, on `terminal-output`, to the calling window only. See [Which window shows it](terminals.md#which-window-shows-it). |
| `terminals.resize(id, cols, rows)` | `terminal_resize` | Sizes a running terminal to the screen showing it (kept within 40 to 200 columns, 10 to 100 rows). Answers `{ cols, rows }`, the size in force: an ended terminal keeps the size it ended at. |
| `terminals.write(id, data)` | `terminal_write` | Keys typed in the shown terminal. |
| `terminals.answer(id, kind)` | `terminal_answer` | `kind` is `"trust"` or `"enter"`; the shell answers only while it still sees that question (see [What the shell recognises](terminals.md#what-the-shell-recognises)). |
| `terminals.paste(id)` | `terminal_paste` | The shell reads the clipboard and types it. |
| `terminals.send(id, line)` | `terminal_send` | A "Try asking" line: the shell types the line into the teacher's input and sends it. See [While it runs](terminals.md#while-it-runs). |
| `terminals.addFile(id, name, data)` | `terminal_add_file` | `data` is the file in base64. The shell saves it in the godspeed folder and types its path. Answers the path. See [While it runs](terminals.md#while-it-runs). |
| `terminals.stop(id)` | `terminal_stop` | Stops the terminal and everything it started. |
| `terminals.list()` | `terminal_list` | Every terminal, for a page that reloaded. |
| `terminals.onOutput(cb)` | push `terminal-output` | `{id, snapshot}` (base64 escape codes redrawing the screen) or `{id, data}` (base64 raw output). |
| `terminals.onState(cb)` | push `terminal-state` | `{id, ended, prompt, url}`, when one changes. |

The shim also calls commands not on `window.lh`: `open_link` (link clicks), `set_zoom` (also restores zoom at load), `zoom_step` and `zoom_reset` (key fallback), `start_drag` and `title_bar_double_click` (Mac), `toggle_menu` (Windows and Linux).

Pushes arrive as `webview.eval("window.__lhPush(channel, payload)")`, so the page needs no Tauri event permissions. A channel with no listener keeps its last message for the first listener, because a menu's push can arrive before React does.

### Trust check

Every command calls `commands::trusted` first. It refuses with `"Untrusted desktop request."` unless the webview's label is `main` and its URL's origin equals the app origin: `http://127.0.0.1:<port>`, or Vite's origin in `desktop:dev`. The commands the terminal window may call use `commands::trusted_terminal` instead, which also accepts the label `terminal`: the terminal commands, `terminal_window_close`, `terminal_window_focus`, `start_drag`, `title_bar_double_click`, `open_link`, `open_path`, `show_in_folder` and the four zoom commands. `terminal_window_open` and every other command are the main window's alone.
