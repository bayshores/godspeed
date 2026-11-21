# The desktop shell

How the Tauri desktop app (`crates/shell`) works: window, server child, page bridge, updates, data. Building and releasing is in [desktop-release.md](../desktop-release.md), the server in [rust-server.md](../rust-server.md). Read only the files your task touches.

| File | Read when |
|---|---|
| [the-shape-in-one-picture.md](the-shape-in-one-picture.md) | You want the overview first. |
| [files.md](files.md) | You look for a shell source file or its rules. |
| [the-line-protocol.md](the-line-protocol.md) | You change messages between shell and server. |
| [demo-checks.md](demo-checks.md) | You run or add a shell demo check. |
| [window-lh.md](window-lh.md) | You change the `window.lh` bridge the page uses. |
| [terminals.md](terminals.md) | You change the agent terminals the shell owns. |
| [the-main-window.md](the-main-window.md) | You change window behavior: zoom, menu, single instance, links, file drops, startup sound, downloads or printing. |
| [magnifier-menu-bar-and-icon.md](magnifier-menu-bar-and-icon.md) | You change the page magnifier under a pinch, the Mac menu bar countdown or the app icon. |
| [the-server-child.md](the-server-child.md) | You change how the shell finds, starts, logs in to, restarts, stops or logs the server child. |
| [api-protection.md](api-protection.md) | You change who may call the server. |
| [updates.md](updates.md) | You change update statuses, when it checks, install on quit or local drill builds. |
| [data.md](data.md) | You need where app data lives per OS. |
| [config-files.md](config-files.md) | You change bundled files, build config or the Windows installer hook. |
