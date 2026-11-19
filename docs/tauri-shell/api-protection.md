## API protection

The access rule and login route are in [rust-server.md](../rust-server.md#the-server-process). The shell's side is the login handshake in [Start, login and restart](the-server-child.md#start-login-and-restart): it navigates to `/api/desktop/login?token=<hex>`, the server spends the token and sets the HttpOnly cookie `gs_desktop`, the page loads `/`, and every same-origin request carries the cookie.

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
    "allow-terminal-window-open",
    "allow-terminal-window-close",
    "allow-terminal-window-focus",
    "allow-pick-folder",
    "allow-show-in-folder",
    "allow-open-path",
    "allow-terminal-start",
    "allow-terminal-attach",
    "allow-terminal-detach",
    "allow-terminal-resize",
    "allow-terminal-write",
    "allow-terminal-answer",
    "allow-terminal-paste",
    "allow-terminal-send",
    "allow-terminal-add-file",
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

- `terminal.json` grants the terminal window's webview (`terminal`) only: the `terminal_*` commands, `terminal_window_close`, `terminal_window_focus`, `start_drag` and `title_bar_double_click` (its page draws its Mac title bar; both act on the calling page's own window), `open_link`, `open_path`, `show_in_folder` and the four zoom commands. It has no folder picker, no update, bug report, print, drag path or window-opening command. `command_lists.rs` checks that every name in it is in `main.json` and that none of the main-only commands is.
- `print.json` grants `core:webview:allow-print` to the same webview on `windows` and `linux` only.
- No `windows` key, because a window entry grants every webview in that window.
- No `core:default`. The page uses no Tauri events or plugin JS.
- `local: false` is safe because the app page is never "local". The config sets no `devUrl`, so `tauri dev` serves `boot/` on its own port and the window then moves to the remote app origin.
- A new command needs a line in `generate_handler!` in `main.rs`, in `build.rs` and in `capabilities/main.json`, and in `capabilities/terminal.json` too when the terminal window may call it (its trust check is then `trusted_terminal`).
