## The shape in one picture

```
godspeed (Tauri shell, crates/shell)                         godspeed-server (crates/server)
  main window: WKWebView / WebView2 / WebKitGTK                 127.0.0.1:<port>, cwd = resources
    loads http://127.0.0.1:<port>/  (cookie gs_desktop)  ───►   /api/* (cookie + Sec-Fetch-Site)
    window.lh shim ──invoke──► shell commands
  hidden demo view (objc2 WKWebView on the Mac, a `demo` window elsewhere)
  stdin  ────────── JSON lines: login, demo results ──────────►  stdin  (EOF = stop)
  stdout ◄───────── JSON lines: ready, demo/svg requests ─────── stdout (protocol only)
  logs/main.log ◄── "server: …" ──────────────────────────────── stderr (log lines)
```

The shell is one window and a guard. All app logic runs in `godspeed-server`, a child process the shell starts and stops.
