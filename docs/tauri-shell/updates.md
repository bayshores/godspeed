## Updates

| Config key | Value |
|---|---|
| `bundle.createUpdaterArtifacts` | `true` |
| `plugins.updater.endpoints` | `["https://github.com/bayshores/godspeed/releases/latest/download/latest.json"]` |
| `plugins.updater.windows.installMode` | `"passive"` |
| `plugins.updater.pubkey` | The public half of the update signing key. |

The plugin is used from Rust only. Signing secrets are in [desktop-release.md](../desktop-release.md#secrets).

### Statuses

`update.rs` keeps `{status, version, percent, revision}`. `revision` goes up by one on each change, and every change is pushed as `update` and logged.

| Status | When |
|---|---|
| `idle` | The start state. |
| `disabled` | Debug builds, a build with an empty `pubkey`, or `app.updater()` failed. Logged as `updater: disabled (<why>)`. A debug build driven by the screens lab (`npm run layout`) starts at `up-to-date` instead, so Settings draws the whole Updates row. |
| `checking` | A check starts. |
| `downloading` | `check()` found an update. `percent` is pushed only on a new whole percent. |
| `downloaded` | The bytes are held in memory. Sticks until a newer download replaces it. |
| `up-to-date` | `check()` found nothing. |
| `error` | A check or download failed. Logged as `updater error: …`; the page gets no reason. |

### When it checks

- At startup and every 24 h, in a loop on `gs_base::clock::sleep_until`.
- Each automatic check reads `<data>/settings.json` fresh. Only `general.autoUpdate === false` skips it, logged as `auto-update: automatic check skipped (turned off in Settings)`. A missing or unreadable file means on.
- Manual checks (the menu, Settings) always run and also download.
- One check at a time.

### Install on quit

`quit.rs` installs a held update after the server has stopped, on every way out. Installing never happens while the server runs, because the server serves `ui/` from inside the bundle.

- Windows starts the installer and exits inside `install`. The Mac replaces the bundle (with an admin prompt if the folder is not writable), then the process ends.
- Install errors are logged as `updater error: …`, and the app still quits.
- Restart now (`update_install`) calls `app.request_restart()` when bytes are held. The restart exit code marks the exit as a restart, so Windows relaunches the app after installing and the Mac relaunches the new bundle.

### Local drill builds

No runtime feed override ships. A drill builds with `tauri build --config '{"plugins":{"updater":{"endpoints":["http://127.0.0.1:48070/latest.json"],"dangerousInsecureTransportProtocol":true}}}'` and a throwaway key pair.
