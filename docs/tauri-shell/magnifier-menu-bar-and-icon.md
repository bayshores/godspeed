# Magnifier, menu bar countdown and app icon

How the page magnifies under a pinch, how the Mac menu bar item is drawn, and how the app icon is changed.

## Magnifier

`src/frontend/components/magnifier/`. The page (inside `main#lh-page`) magnifies under an `lh-pinch` at its point, from 100% to 400%; the top bar, the teacher's panel and the strip stay as they are. The page keeps its layout: one `transform` on a box around it, none at 100%.

- The point under the pointer stays under it. The shown part never leaves the page's room. Pinching out to 100% ends it.
- While magnified, a scroll moves the shown part. At the room's edge in that direction the scroll is the page's own.
- A mini map in the page's bottom-left corner shows the shown part as a box. A press or drag on it moves the part there.
- It ends on a page change and with a click on the bar word. The chat window has no magnifier.

## Menu bar countdown

On the Mac, `menu_bar_countdown.rs` draws a menu bar item from the server's `menu_bar_countdown` lines ([The line protocol](the-line-protocol.md#the-line-protocol)). The server decides every word ([architecture/06.6](../architecture/06.6-deadline-reminders-and-the-menu-bar.md#menu-bar-countdown)); the shell only draws them.

| Part | What it is |
|---|---|
| Item | The g logo (`icons/menu-bar-countdown.png`, a template image so macOS tints it) and the title beside it, for example "3d". Made under the fixed id `menu-bar-countdown` on the first line, then only its title and menu change. `menu_bar_countdown_off` removes it, and so does a server that stopped for good (`Server::stopped`), so an old countdown never stays. |
| Deadline rows | One item per row, id `page:go:<page>`, so `menu::handle` runs them like the Go menu's items. A single "&" in the text is written "&&", since the Mac drops a lone one. |
| Open godspeed | Id `open-window`: `window::bring_forward` with no page. |
| Quit godspeed | The app menu's `quit` id and label. |

A left click shows the menu (the tray's default). Its clicks reach `menu::handle` through `RunEvent::MenuEvent` like the app menu's, so the item registers no menu handler of its own; one would run each click twice. Tauri's `tray-icon` feature is on for the Mac only, so Linux never builds libappindicator.

## App icon

Mac only. Settings, Appearance, App icon offers the app's own icon (Graphite) and the pictures in `crates/shell/icons/choices/`. The pick is `appearance.appIcon` in `settings.json`: `null` for the app's own, else the picture's name.

| When | What `mac/app_icon.rs` does |
|---|---|
| A pick in Settings | The page saves the setting, then calls `apply_app_icon()`. The Dock takes the picture at once (`NSApplication.applicationIconImage`), and the app's bundle gets it as a custom icon (`NSWorkspace.setIcon`, what Finder's Get Info does), so the Dock, Finder and Spotlight keep it after quit. Graphite removes the custom icon. |
| Every start | With a picture picked, the Dock takes it, and a bundle with no custom icon gets it back: an update replaces the bundle. With Graphite picked nothing is touched, so an icon the learner pasted in Finder stays. |

- A custom icon adds the file `Icon\r` and a Finder flag to the bundle. `codesign --verify --deep` still passes; `--strict` does not.
- A build run from `target/` has no bundle: only the Dock changes, until quit.
- A bundle that cannot be written (a read-only disk) keeps its icon. The pick shows an error line in Settings; at start the failure goes to the log.
- macOS draws a custom icon as it is: no Dark, Clear or Tinted look.
