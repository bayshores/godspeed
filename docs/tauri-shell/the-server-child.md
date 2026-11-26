## The server child

### Finding the server and its files

- The bundle's `externalBin` is `binaries/godspeed-server`. The bundler copies it beside the main executable (Mac: `Contents/MacOS/godspeed-server`).
- The shell finds it at `current_exe().with_file_name("godspeed-server[.exe]")`; in a cargo build, `target/<profile>/godspeed-server`.
- Spawned with `std::process::Command`, not the shell plugin.
- Working directory is the resource folder (`ui/`, `models/`, `pdfjs-dist/`). Debug builds use `<repo>/.dev-resources`, made by `scripts/dev-resources.mjs`.
- pdfium: Mac `Contents/Frameworks/libpdfium.dylib`, Windows `pdfium.dll` and Linux `libpdfium.so` in the resource folder, debug builds `.dev-resources/`.

### Spawn

| Setting | Value |
|---|---|
| stdin, stdout, stderr | All piped. |
| Windows flags | `CREATE_NO_WINDOW` (`0x0800_0000`). Without it the console server gets a visible console window, and closing it kills the server. |
| `PORT` | The chosen port. |
| `LH_DATA_DIR` | `<userData>/data`. Debug builds use `LH_DATA_DIR` if set, else the repo's `data/`. |
| `LH_SHELL` | `1`. |
| `LH_PDFIUM_PATH` | The pdfium library path above. |
| `LH_DESKTOP_SERVER`, `LH_DESKTOP_API_SECRET` | `1` and the secret, in desktop mode. Removed in `desktop:dev` browser mode. |
| `LH_SERVER_RESTARTED` | `1` on a restart after a crash, removed otherwise. |
| `LH_DEV_URL` | Removed. |
| Other env | Inherited. |

The secret is 32 bytes from `getrandom` as hex. It lives as long as the shell, so restarts keep the window's cookie valid.

### Port

The shell chooses the port before building the window, because the shim needs the origin. Restarts reuse it.

| Build | Port |
|---|---|
| Release | 47613 if a bind succeeds, else a free port. The same port each launch keeps the window's browser storage, which belongs to its origin. |
| Debug with `LH_PORT` (the lab) | That port, desktop mode with the login, like release. |
| Debug without `LH_PORT` (`desktop:dev`) | `PORT+1000`, `PORT` defaulting to 3000. Browser mode: no secret, no login. The window opens Vite at `http://127.0.0.1:<PORT>/` once a TCP connect succeeds (30 s limit). A taken port fails with `port <n> is taken; set PORT to another number`. |

### Start, login and restart

1. Wait up to 30 s for `{"t":"ready"}` on stdout. An exit first, or no ready in time, fails the start.
2. Mint 32 random bytes as hex, send `login`, wait 2 s for `login_ok`.
3. Navigate the main window to `http://127.0.0.1:<port>/api/desktop/login?token=<hex>`.

A reopened window logs in the same way. If that fails (for example a Dock click while a crashed server restarts), the shell logs it and destroys the hidden window so the next click tries again.

On an exit after ready that the shell did not cause, `restarts::record` allows 3 restarts per 60 s. An allowed restart starts the server with `LH_SERVER_RESTARTED=1`, waits for ready and reloads the window. A refused restart, a failed restart or a failed first start shows the stopped dialog.

### The stopped dialog

Message `The app's server stopped running.`, title `godspeed stopped working`, kind Error, buttons `Relaunch`, `Report a bug` and `Quit`.

- Relaunch calls `app.request_restart()`.
- Report a bug opens the issue page and asks again.
- Quit calls `app.exit(0)`.

The shell never calls `app.restart()`: on the main thread it restarts at once without `RunEvent::Exit`, so `quit.rs` would not run.

### Shutdown

`quit.rs` runs once (an `AtomicBool` swap) from `RunEvent::Exit`, which waits for it.

1. Close the server's stdin. The server stops on EOF: open requests get 2 s, then it exits with 143.
2. Wait up to 3 s, then kill the child and wait.
3. Remove `shell.pid`, delete the demo folder.
4. Install a held update, last because the Windows install exits the process.

No signals are needed, so the path is the same on Windows, where the installer could not overwrite a running `godspeed-server.exe`. When the shell dies, the OS closes the pipe and stdin EOF stops the server.

### Logs

`<userData>/logs/main.log`, one line per entry as `[<ISO time>] <text>`. Each line also goes to the shell's stderr.

- The log opens after the old-app check lets the launch go on. Earlier lines go to stderr only.
- At launch, a file over 5 MiB is renamed to `main.old.log`.
- Every server stderr line is logged as `server: <line>`.
- Lifecycle lines: `starting server: <server path>`, `data dir: <data path>`, `server up: <url>`, `server exited (code=<n|null> signal=<SIGNAME|null>)`, `restarting server (<n> in the last minute)`, `server up again: <url>`, `window open: <app origin>/`.
- The window line never holds the login URL, because it has the token.
- The first thing in `main` is a panic hook that logs `uncaught: <panic info>` with a backtrace, then runs the default hook.

### Timeouts

Server ready 30 s, login answer 2 s, login token 60 s, server stop grace 3 s, show fallback 5 s, Vite wait 30 s, Windows drop path 2 s, restart limit 3 per 60 s. Each is set where it applies above.
