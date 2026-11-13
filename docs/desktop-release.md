# Desktop builds and releases

godspeed's desktop app is a Tauri shell (`crates/shell`) that starts the Rust server as a sidecar and shows the Vite UI. `tauri build` makes the installers. How the shell works is in [`tauri-shell.md`](tauri-shell.md).

## Platforms

| Platform | Build runner | Downloads | In-app update |
|---|---|---|---|
| macOS 14 or newer, Apple Silicon | `macos-26` with Xcode 26 | signed and notarized DMG | Tauri updater, from `godspeed-mac-apple-silicon.app.tar.gz` |
| Windows, x64 | `windows-2025` | per-user NSIS installer, not code signed | Tauri updater, runs the new installer |
| Linux, x64 | `ubuntu-24.04` runner, `ubuntu:22.04` container | AppImage and `.deb` | Tauri updater, replaces the AppImage or installs the deb |

Windows code signing is off on purpose. SmartScreen may warn about an unknown publisher on the first install.

Linux builds run in an Ubuntu 22.04 container so the app runs on Ubuntu 22.04 and Debian 12. A release step fails if `godspeed`, `godspeed-server`, `libpdfium.so` or `libonnxruntime.so` needs a glibc newer than 2.35 or a libstdc++ newer than GLIBCXX 3.4.30.

The Mac icon is the Icon Composer file `crates/shell/icons/icon.icon`. `node scripts/compile-icon.mjs` compiles it into `.stage/Assets.car` with `actool` from Xcode 26 or newer, which needs macOS 26, and `tauri.bundle.macos.conf.json` ships that file. The bundler can compile the icon itself, but its `actool` call crashes on GitHub's macOS 26 runners. `icon.icns` is the fallback for older macOS. The Windows and Linux icons are committed; `npx tauri icon` makes them again.

## Build pipeline

Each OS builds its own app. Nothing is cross-built.

1. `npm ci`.
2. `node scripts/fetch-model.mjs` downloads the space-search model into `models/`.
3. `node scripts/fetch-pdfium.mjs` downloads pdfium's library into `.stage/` and checks its sha256. On Linux, `node scripts/fetch-onnxruntime.mjs` does the same for Microsoft's ONNX Runtime library, which the Linux server loads at run time from its resources folder. macOS and Windows link ONNX Runtime into the server. On the Mac, `node scripts/compile-icon.mjs` compiles the app icon into `.stage/Assets.car`.
4. `node scripts/stage-app.mjs` builds the UI (`dist-ui/`), builds the release server for this OS's target triple, copies it to `crates/shell/binaries/`, and copies the pdf.js files to `.stage/pdfjs-dist/`. It refuses a UI folder that holds `data/` or a secrets file.
5. `node scripts/smoke-server.mjs` starts that server from a folder of the staged files, with a throwaway home and data folder, and checks `/`, `/api/boot`, `/api/graph`, `/api/settings` and a pdf.js file.
6. `TAURI_APP_PATH=crates/shell npx tauri build --config crates/shell/tauri.bundle.conf.json --config crates/shell/tauri.bundle.<macos|windows|linux>.conf.json --target <triple> --bundles <app,dmg | nsis | appimage,deb>`. Its `beforeBuildCommand` runs step 4 again (fast, everything is built). With `TAURI_SIGNING_PRIVATE_KEY` set, the bundler writes a `.sig` beside each updater file.
7. `node scripts/release-assets.mjs <mac|windows|linux>` copies the bundler's files into `dist/` under the names people download, with their `.sig` files. On the Mac it also zips the app for the Electron hand-over.
8. The release checks (below), then `cargo build -p gs-shell --features self-test` and `godspeed --self-test`, which checks the demo runner in the real app on that OS (`xvfb-run` on Linux).
9. `node scripts/release-feeds.mjs dist --mac-staging <share>` runs once, on all three systems' `dist/` together, and writes the four feeds.

Local builds:

- `npm run desktop:local` makes an unsigned Mac app for trying out.
- `npm run desktop:dist` makes the signed and notarized Mac app and DMG (`scripts/mac-dist.sh` says what it needs in the keychain and the environment).
- Windows or Linux: steps 1 to 3, then step 6 with `--no-sign` added.

## CI and release

`.github/workflows/ci.yml` runs on pushes to main and on pull requests:

- `quality` (Ubuntu): `npm run check` (typecheck, tests, lint, knip, then cargo test, clippy and cargo machete) and the skill's Python tests.
- `desktop` (macOS 15, Windows, Ubuntu 22.04 container): steps 1 to 5 above, `cargo test -p gs-shell`, and the self-test.

`.github/workflows/release.yml` has two modes.

- **Manual run (Run workflow).** A rehearsal. It builds all three systems without Apple signing and signs the updater files with a throwaway key it makes in the run. It saves `dist/` and the four feeds as workflow artifacts for 7 days. It never creates a release or uploads to one, and the verify job is skipped. The `staging_percentage` input sets the share written into the rehearsal's `latest-mac.yml`.
- **Push the tag `v<package.json version>`.** The gates run (the tag must match `package.json`, then `npm run check`). One job makes or reuses a **single draft release** with the download table and the notes from `src/shared/changelog.json`. The three OS jobs build, sign, check and upload their downloads to that draft. The `feeds` job then writes the four feeds from all downloads and uploads them. Last, the read-only `verify` job checks the draft. The workflow never publishes. A published or doubled release fails the draft job instead of being changed.

On a tag push the Mac job also checks the app, and the app unzipped from the hand-over zip, three ways:

- `codesign --verify --deep --strict --all-architectures -R "=<crates/shell/release/electron-requirement.txt>"`: the new app meets the designated requirement of the published 0.5.51 Electron app, which Squirrel.Mac checks before it swaps the app.
- `spctl --assess --type execute`: Gatekeeper accepts it.
- `xcrun stapler validate`: the notarization ticket is stapled.

`MAC_STAGING_PERCENTAGE` near the top of `release.yml` is the share of Electron Macs that a tag push's `latest-mac.yml` offers the new app to. It is `10` for the first Tauri release. Change it to `100` (no field, everyone) once the move below is done.

### The verify job

`verify` runs only on tag pushes, after `quality` and `feeds`. It checks out the tagged revision without keeping credentials and runs `scripts/verify-release.ts`. GitHub lists draft releases only to tokens with push access, so the job has `contents: write`, but every call it makes is a GET, and only the two steps that read the API see the token. The gate:

- finds the draft whose tag is `v<version>` or the bare `<version>`. No match, two matches or an already published match fail. A bare-version match passes with a warning to rename it.
- checks `crates/shell/tauri.conf.json` still has the shape the names come from (product name, binary name, identifier, bundle targets, updater artifacts, `minimumSystemVersion` 14.0, the update endpoint) and a `pubkey` that is not empty. The bundler signs without reading `pubkey`, so an app built without one could never check an update.
- fails unless the draft holds exactly these ten assets, each non-empty and fully uploaded:

| Asset | What it is |
|---|---|
| `godspeed-mac-apple-silicon.dmg` | Mac download |
| `godspeed-windows-x64-setup.exe` | Windows download, also the Windows update |
| `godspeed-linux-x64.AppImage` | Linux download, also its update |
| `godspeed-linux-x64.deb` | Linux download for Ubuntu and Debian, also its update |
| `godspeed-mac-apple-silicon.app.tar.gz` | Mac update for Tauri installs |
| `latest.json` | Tauri updater feed |
| `godspeed-<v>-arm64-mac.zip` | the new Mac app for Electron installs |
| `latest-mac.yml` | Electron Mac feed, points at the zip |
| `latest.yml` | Electron Windows feed, points at 0.5.51 |
| `latest-linux.yml` | Electron Linux feed, points at 0.5.51 |

  The four downloads carry no version in their names, so the README and the website link to `releases/latest/download/<name>`.
- downloads the four feeds and checks them:
  - `latest.json`: the version, a valid `pub_date`, exactly the keys `darwin-aarch64-app`, `windows-x86_64-nsis`, `linux-x86_64-appimage` and `linux-x86_64-deb`, each URL `https://github.com/bayshores/godspeed/releases/download/v<v>/<asset>` for an asset the draft holds, and each signature one the bundler wrote for this version.
  - `latest-mac.yml`: the version, the zip first and the DMG second, bare names only, sizes equal to the uploaded sizes, the top-level `path` and `sha512` equal to the zip's, `minimumSystemVersion: 23.0.0`, and either no `stagingPercentage` or a whole number from 0 to 99. No other fields.
  - `latest.yml` and `latest-linux.yml`: exactly the committed templates in `crates/shell/release/` plus `newApp: <v>`, and the templates point only at `../v0.5.51/<file>`.

## Secrets

Add these under the repository's **Settings → Secrets and variables → Actions**. The workflow gives each one to the bundler under the name in the second column, and only in the build step that needs it.

| Secret | Bundler reads it as | Value |
|---|---|---|
| `MAC_CSC_LINK` | `APPLE_CERTIFICATE` | the Developer ID Application `.p12` with its private key, base64 |
| `MAC_CSC_KEY_PASSWORD` | `APPLE_CERTIFICATE_PASSWORD` | the password of that `.p12` |
| `APPLE_SIGNING_IDENTITY` | `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <name> (TM8Y622C8X)` |
| `APPLE_ID` | `APPLE_ID` | the Apple ID that notarizes |
| `APPLE_APP_SPECIFIC_PASSWORD` | `APPLE_PASSWORD` | an app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | `APPLE_TEAM_ID` | `TM8Y622C8X` |
| `TAURI_SIGNING_PRIVATE_KEY` | `TAURI_SIGNING_PRIVATE_KEY` | the update signing key (`npx tauri signer generate`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

The public half of the update key is `plugins.updater.pubkey` in `crates/shell/tauri.conf.json`. The bundler only warns and skips notarization when the Apple ID secrets are missing, so a tag push checks that every secret is set before it builds. GitHub's own `GITHUB_TOKEN` uploads to the draft; no other GitHub token is needed. Never commit a certificate, a key or a password.

## Release runbook

1. If the change touches `crates/shell`, the bundle config, the updater or the workflows, run the manual Desktop release workflow first. Install the Windows and Linux artifacts by hand and open them: window buttons and dragging, the top bar at narrow widths, zoom, onboarding and the agent connection, a lesson and resume, a demo.
2. Bump `package.json` and the lockfile to the release version, add its notes to `src/shared/changelog.json`, run `npm run check`, and push a matching `v...` tag.
3. Wait for all three package jobs, the feeds job and the verify job. If one fails, fix the cause and run the workflow again on the tag. Uploads replace assets of the same name, and the gate rejects leftovers.
4. The owner reads the draft, adds anything the notes still need, and publishes it.
5. Check the real update path from an installed older version.

### The first Tauri release: moving Electron Macs in steps

The first Tauri release goes out with `stagingPercentage: 10`, so one in ten Electron Macs gets the new app. electron-updater picks the Macs by a random id each install keeps. After two days with no new start failures in bug reports, raise it to 50, and later to 100:

```sh
gh release download v<version> -R bayshores/godspeed -p latest-mac.yml -D feed
node scripts/release-feeds.mjs feed --mac-staging 50 --mac-only
gh release upload v<version> feed/latest-mac.yml --clobber -R bayshores/godspeed
```

`--mac-only` rewrites only the share in `latest-mac.yml` and keeps everything else. `--mac-staging 100` drops the field, which means every Mac. After that, set `MAC_STAGING_PERCENTAGE` in `release.yml` to `100` so later releases write no field. `latest.json` has no share: Tauri installs only update Tauri installs.

### Rollback

- Squirrel.Mac refuses a new app whose signature does not meet the old app's requirement and keeps the Electron app. Fix it and release again.
- During the staged move, run the commands above with `--mac-staging 0`. electron-updater then offers the new app to no Electron Mac. Fix forward.
- If the Tauri release itself is bad, turn its GitHub release back into a draft (or mark it pre-release). `releases/latest` then points at the release before it, so no more Electron installs move. Installs that already moved get a fixed version through the Tauri updater. If the Tauri app cannot start at all, people reinstall 0.5.51 from its release page. The Rust server writes the same files, and `<userData>/data-backup-<v>` holds the copy from before the switch.
- The owner writes the rollback line into the first Tauri release's notes before publishing: where to download `godspeed-mac-apple-silicon.dmg` from the `v0.5.51` release if the new version won't open.

## The last Electron release (0.5.51)

0.5.51 is the last Electron godspeed. It is on `main` at the tag `v0.5.51`, and its own code teaches Electron installs to hand over. Publish it first and the Tauri app some days later, so more Macs on macOS 12 and 13 get the notice below before the new feed stops them.

- **macOS 12 and 13.** The new `latest-mac.yml` says `minimumSystemVersion: 23.0.0` (Darwin for macOS 14), so electron-updater reports no update on those Macs. 0.5.51 tells them once per launch, after the startup update check, with an OK button: "This Mac will not get new versions of godspeed. The next version needs macOS 14 or newer. This version keeps working."
- **Windows and Linux.** The Tauri app cannot install over an Electron install. Each Tauri release publishes `latest.yml` and `latest-linux.yml` that still describe 0.5.51 (each `url` written as `../v0.5.51/<name>`, which electron-updater's GitHub provider resolves into the 0.5.51 release) plus `newApp: <new version>`. Older Electron installs update to 0.5.51 as usual. 0.5.51 then sees its own version, reads `newApp` from the feed, and shows once per launch "A new godspeed is ready." with Download (opens the latest release page) and Later. The templates are `crates/shell/release/legacy-latest.yml` and `legacy-latest-linux.yml`, made once from 0.5.51's own feeds.
- **The Tauri app already open.** The Tauri app writes its pid to `<userData>/shell.pid` while it runs. Before starting its server, 0.5.51 checks that pid, and if it still runs it says "A newer godspeed is already open. Quit it first." and quits without touching any data.
