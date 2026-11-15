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
    "allow-pick-folder",
    "allow-show-in-folder",
    "allow-open-path",
    "allow-terminal-start",
    "allow-terminal-attach",
    "allow-terminal-detach",
    "allow-terminal-write",
    "allow-terminal-answer",
    "allow-terminal-paste",
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

- `print.json` grants `core:webview:allow-print` to the same webview on `windows` and `linux` only.
- No `windows` key, because a window entry grants every webview in that window.
- No `core:default`. The page uses no Tauri events or plugin JS.
- `local: false` is safe because the app page is never "local". The config sets no `devUrl`, so `tauri dev` serves `boot/` on its own port and the window then moves to the remote app origin.
- A new command needs a line in `generate_handler!` in `main.rs`, in `build.rs` and in `capabilities/main.json`.
