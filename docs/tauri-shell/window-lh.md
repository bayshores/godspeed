## `window.lh`

The shim (`crates/shell/src/shim.js`) is an initialization script on every app window, the main window and the chat window. The chat window's capability grants only some of the commands (see [API protection](api-protection.md#capabilities)); the shim's other calls (`drag_paths`, `toggle_menu`) are refused there. It defines `window.lh` with the members `src/frontend/components/desktop-env.tsx` declares, via `window.__TAURI_INTERNALS__.invoke`. The shell bakes `APP_ORIGIN` and `PLATFORM` into the script text before building the window. The shim does nothing unless `location.origin === APP_ORIGIN`, so the boot page and login redirect get no `window.lh`.

| Member | Command or push | Detail |
|---|---|---|
| `platform` | constant | `"darwin" \| "win32" \| "linux"`. |
| `pickFolder()` | `pick_folder` | The dialog plugin's folder picker on the main window; the absolute path or `null`. |
| `showInFolder(path)` | `show_in_folder` | Absolute path only; `tauri_plugin_opener::reveal_item_in_dir`. |
| `openPath(path)` | `open_path` | Absolute paths only, canonicalized. A bundle folder (`.app` and the other bundle extensions in `open.rs`) is revealed. A folder or a `.pdf` file opens in its default app. Anything else does nothing. |
| `openInObsidian(path)` | `open_in_obsidian` | Main window only. An absolute path to a file that exists; the shell builds `obsidian://open?path=` with the path percent-encoded and opens it, so the `obsidian:` scheme is never allowed in `open_link`. Anything else does nothing. |
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
| `chatWindow.open(title)` | `chat_window_open` | Main window only. Opens the chat window beside the main window, titled `title` (the teacher's name), or brings it forward when open. See [The chat window](the-main-window.md#the-chat-window). |
| `chatWindow.close()`, `chatWindow.focus()` | `chat_window_close`, `chat_window_focus` | Either window. Close ("Put back") closes the window and has the main page show the chat in the teacher panel; focus rejects when it is not open. |
| `chatWindow.onChange(cb)` | push `chat-window` | `{open}`, sent to the main window when the window is made or destroyed and after every load of the main page; `{open: false, back: true}` after `chatWindow.close()`. |

The shim also calls commands not on `window.lh`: `open_link` (link clicks), `set_zoom` (also restores zoom at load), `zoom_step` and `zoom_reset` (key fallback), `start_drag` and `title_bar_double_click` (Mac), `toggle_menu` (Windows and Linux).

Pushes arrive as `webview.eval("window.__lhPush(channel, payload)")`, so the page needs no Tauri event permissions. A channel with no listener keeps its last message for the first listener, because a menu's push can arrive before React does.

### Trust check

Every command calls `commands::trusted` first. It refuses with `"Untrusted desktop request."` unless the webview's label is `main` and its URL's origin equals the app origin: `http://127.0.0.1:<port>`, or Vite's origin in `desktop:dev`. The commands the chat window may call use `commands::trusted_any` instead, which also accepts the label `chat`: `chat_window_close`, `chat_window_focus`, `start_drag`, `title_bar_double_click`, `open_link`, `open_path`, `show_in_folder` and the four zoom commands. `chat_window_open` and every other command are the main window's alone.
