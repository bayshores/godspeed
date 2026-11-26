## 8. Process boundaries

The shell is launcher and security guard. All app logic runs in `godspeed-server`, a child process the shell starts. Design: [tauri-shell/README.md](../tauri-shell/README.md). Server process, environment variables, access gate: [rust-server.md](../rust-server.md).

| Part | What it does |
|---|---|
| Shell (`crates/shell`) | single-instance lock; trust check on every command (main window on app's own origin only); navigation pinned to app origin; web links open in browser |
| Starting server | shell picks port 47613 if free, else any free port; starts server with `PORT`, `LH_DATA_DIR`, `LH_SHELL=1`, `LH_DESKTOP_SERVER=1`, `LH_DESKTOP_API_SECRET`. Server binds 127.0.0.1 only |
| Line protocol (`crates/shell-rpc`) | one JSON object per line on server's stdin and stdout. Server sends `ready` and `demo`, `svg`, `notify` requests; shell sends one-time `login` tokens and answers. Request timeout 60 s |
| Access gate (`server::http::access`) | every `/api` path needs `gs_desktop` cookie and `Sec-Fetch-Site: same-origin`, except `/api/desktop/login` |
| Data lock | advisory lock on data folder (`server::data_lock`) keeps a second server off same data |
| Shutdown | closing server's stdin stops it, so a dying shell never leaves a server behind |
| Crashes | shell restarts server max 3 times a minute with `LH_SERVER_RESTARTED=1` and reloads window. After that, a "godspeed stopped working" dialog offers Relaunch, Report a bug, Quit |

The window stays hidden until the app drew its first screen. It reports that via `window.lh.showWindow` once `/api/boot` answered and React rendered, or is shown 5 seconds after first paint. First screen is the welcome screen (`src/frontend/components/welcome/welcome.tsx`, chosen by `first_load_screen` in `services::app::welcome`), which plays the startup sound (behind its own Startup sound switch); after a crash restart, a "godspeed restarted after a problem" notice instead.

The page reaches the shell through `window.lh`, typed in `src/frontend/components/desktop-env.tsx` and defined by `crates/shell/src/shim.js` (calls the shell's Tauri commands). Kept in step by hand.
