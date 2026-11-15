## Demo checks

WKWebView needs the main thread of a process with an `NSApplication`, so the shell runs demos and the server asks over the protocol.

1. With `LH_SHELL=1` the server builds a `ShellLink` on its stdin and stdout, kept in `App::shell`.
2. `get_headless(pdf, shell)` sends demo runs and SVG snapshots through it. Without a link: the no-browser error.
3. The shell's `rpc.rs` queues requests and runs one at a time on the main thread.
4. Each run creates its own view and closes it at the end, so no demo window outlives a run.

| Limit | Value |
|---|---|
| Demo page size | 800 × 600 |
| Page load | 30 s, then page error `Navigation timeout of 30000 ms exceeded` |
| Settle time before the page is read | 2 s |
| Page answer or SVG snapshot | 15 s |

### The Mac demo view

A WKWebView built with objc2, no Tauri bridge.

- `WKWebsiteDataStore.nonPersistentDataStore()`, so no cookie.
- A content rule list blocks `127.*`, `localhost`, `[::1]` and `0.0.0.0`.
- Page origin `https://demo.invalid/`.
- The navigation delegate allows only the first load and `about:blank`, and cancels downloads.
- The NSWindow is borderless, alpha 0, kept on screen so animations run, ignores the mouse, and stays out of the Window menu and ⌘\` cycling (`Transient | IgnoresCycle | CanJoinAllSpaces | Stationary | FullScreenAuxiliary`).

### The Windows and Linux demo window

A separate top-level Tauri window labeled `demo`, never a child webview of `main`. Created per run with `visible(false)`, `focused(false)`, `skip_taskbar(true)` and `incognito(true)`, closed after the run.

- Own profile folder (`data_directory`): `<temp>/godspeed-demo-<pid>` on Windows, `~/.cache/godspeed-demo-<pid>` on Linux. `/tmp` is shared, and another user could make the folder first and swap the compiled rules in it.
- It opens on `about:blank`, gets its loopback block, then loads the page with an origin that is not the app's, so a request to the app is `cross-site` and carries no cookie.
- Windows: the page comes from the registered URI scheme `demo` with `use_https_scheme(true)`, URL `https://demo.localhost/`.
- Linux: `load_html(html, "https://demo.invalid/")`. Tauri registers a scheme once per profile folder, and every incognito view gets a fresh WebKit context.
- A hidden GTK window sizes nothing, so the Linux view gets its page size with `size_allocate`.
- `on_navigation` allows only that page and `about:blank`. `on_new_window` answers `NewWindowResponse::Deny`; `on_download` refuses.

Loopback blocking matches the Mac's four rules:

- Linux (`linux/demo.rs`): compiles the rule JSON with `webkit_user_content_filter_store_new` and `webkit_user_content_filter_store_save`, adds it with `webkit_user_content_manager_add_filter` before the HTML loads (WebKitGTK 2.24 or newer).
- Windows (`win/demo.rs`): the demo window's own `additional_browser_args` hold `--host-resolver-rules` mapping `127.*`, localhost (with subdomains and a trailing dot), IPv6 starting `::` and `0.0.0.0` to `^NOTFOUND`. The resolver sits under every request, WebSockets, workers and redirects included.
- The https page origin blocks or upgrades any plain-http load to another name as mixed content.
- Known limit: no rule sees a DNS answer, so a public name resolving to 127.0.0.1 gets as far as a TLS handshake to a local port.

SVG snapshots: WebKitGTK's `get_snapshot` into a cairo surface of exactly w × h; on Windows the DevTools protocol (`Emulation.setDeviceMetricsOverride` at scale 1, then `Page.captureScreenshot`).

Tauri injects its invoke bridge into the `demo` window too, but no capability names that label and every command checks for `main`, so every invoke is refused. `quit.rs` deletes the demo folder, and at startup the shell deletes every `godspeed-demo-*` folder left beside it.

Demo iframes inside the main window get no invoke key (init scripts run in the main frame only). The capability refuses them by origin, the server by `Sec-Fetch-Site`.
