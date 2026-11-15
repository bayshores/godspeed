## Data

| OS | userData |
|---|---|
| macOS | `~/Library/Application Support/godspeed` |
| Windows | `%APPDATA%\godspeed` |
| Linux | `$XDG_CONFIG_HOME/godspeed`, else `~/.config/godspeed` |

- userData is `app.path().config_dir()` joined with `godspeed`, the folder Electron used. Not `app_config_dir()`, which uses the bundle id.
- Data is `<userData>/data`, logs `<userData>/logs`.
- Debug builds use `godspeed-dev` instead of `godspeed`, and the repo's `data/` (or `LH_DATA_DIR`) for data.
- WebKit's own storage is outside userData: Mac `~/Library/WebKit/com.bayshores.godspeed`, Windows `%LOCALAPPDATA%\com.bayshores.godspeed\EBWebView`, Linux `~/.local/share/com.bayshores.godspeed`.

### The old app still open

`old_app.rs` runs first in setup, before the log opens and the server starts. Electron's process lock lives in userData, and the single-instance plugin does not see it.

- Mac and Linux: connect to `<userData>/SingletonSocket`. A connection means Electron is running.
- Windows: open `<userData>\lockfile` for writing. Error 32 (sharing violation) means Electron is running.
- If Electron runs, the shell shows `The old godspeed is still open. Quit it, then open godspeed again.` (title `godspeed`, one OK button) and exits. Nothing in userData is touched, no server starts.
- Otherwise it writes `<userData>/shell.pid` (its pid and `\n`), which `quit.rs` removes. The last Electron release reads that file; see [desktop-release.md](../desktop-release.md#the-last-electron-release-0551).

### First run after Electron

`first_run.rs` runs before the server starts. Its marker is Electron's `Local State` file in userData; a fresh install has none and skips all of this.

1. If `<userData>/data` exists and `data-backup-<v>` does not, copy `data/` to `data-backup-<v>.partial` without `data/models/`, then rename it to `data-backup-<v>`.
2. Only after a good backup, delete Electron's leftovers from the top level of userData (the fixed list `LEFTOVERS` in `first_run.rs`, `Local State` last) and the old updater cache (`godspeed-updater` in the OS cache folder).
3. A failed backup is logged and leaves everything for the next launch. The app starts either way.

Kept: `data/`, `logs/`, `shell.pid`, `.updaterId` and every `data-backup-*`.

### One server per data folder

- The server holds an advisory lock on the data folder on Mac and Linux.
- The single-instance plugin keeps a second Tauri app off.
- `old_app.rs` and `shell.pid` keep Tauri and Electron apart in both directions.
- Windows has no folder lock. The NSIS hook removes the Electron copy on install.
