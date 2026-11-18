# Desktop builds and releases

How the desktop app is built, checked in CI and released, and how Electron installs move to it. Read before cutting a release or changing a build script or workflow. The shell itself is in [tauri-shell/README.md](tauri-shell/README.md).

## Platforms

| Platform | Build runner | Downloads | In-app update |
|---|---|---|---|
| macOS 14 or newer, Apple Silicon | `macos-26` with Xcode 26 | signed and notarized DMG | Tauri updater, from `godspeed-mac-apple-silicon.app.tar.gz` |
| macOS 14 or newer, Intel | `macos-26-intel` with Xcode 26 | signed and notarized DMG | Tauri updater, from `godspeed-mac-intel.app.tar.gz` |
| Windows, x64 | `windows-2025` | per-user NSIS installer, not code signed | Tauri updater, runs the new installer |
| Linux, x64 | `ubuntu-24.04` runner, `ubuntu:22.04` container | AppImage and `.deb` | Tauri updater, replaces the AppImage or installs the deb |

- Each OS and each Mac chip builds its own app. Nothing is cross-built.
- Windows code signing is off on purpose. SmartScreen may warn about an unknown publisher on first install.
- Linux builds run in an Ubuntu 22.04 container so the app runs on Ubuntu 22.04 and Debian 12. A release step fails if `godspeed`, `godspeed-server`, `libpdfium.so` or `libonnxruntime.so` needs glibc newer than 2.35 or libstdc++ newer than GLIBCXX 3.4.30.
- The Linux release job sets `APPIMAGE_EXTRACT_AND_RUN=1` (containers have no FUSE).

### Mac icon

The Mac icon is the Icon Composer file `crates/shell/icons/icon.icon`. `node scripts/compile-icon.mjs` compiles it into `.stage/Assets.car` with `actool` from Xcode 26 or newer (needs macOS 26). `tauri.bundle.macos.conf.json` ships that file. The bundler can compile the icon itself, but its `actool` call crashes on GitHub's macOS 26 runners. `icon.icns` is the fallback for older macOS. Windows and Linux icons are committed; `npx tauri icon` regenerates them.

### Not yet checked by a person on Windows and Linux

CI builds and self-tests both systems. Nobody has tried these by hand:

- dropping a real folder on onboarding
- running the Windows installer
- the Linux menu bar (no "godspeed" first menu showed)
- installing the deb or the AppImage
- stopping the server with Ctrl-C on Windows
- the symlink fallback on a Windows account without Developer Mode, and hard links across drives

## Build pipeline

The release workflow's package job runs these steps on each OS.

1. `npm ci`.
2. `node scripts/fetch-model.mjs` downloads the space-search model into `models/`.
3. `node scripts/fetch-pdfium.mjs` downloads pdfium's library into `.stage/` and checks its sha256.
4. Linux and Intel Macs: `node scripts/fetch-onnxruntime.mjs` downloads Microsoft's ONNX Runtime library (from its NuGet package) into `.stage/` the same way.
5. Mac: `node scripts/compile-icon.mjs` compiles the icon into `.stage/Assets.car`.
6. `node scripts/stage-app.mjs` builds the UI (`dist-ui/`), builds the release server for this OS's target triple into `crates/shell/binaries/`, and copies the pdf.js files to `.stage/pdfjs-dist/`. It refuses a UI folder holding `data/` or a secrets file.
7. `node scripts/smoke-server.mjs` starts that server from a folder of the staged files, with a throwaway home and data folder, and checks `/`, `/api/boot`, `/api/graph`, `/api/settings` and a pdf.js file.
8. `TAURI_APP_PATH=crates/shell npx tauri build --config crates/shell/tauri.bundle.conf.json --config crates/shell/tauri.bundle.<macos|windows|linux>.conf.json --target <triple> --bundles <app,dmg | nsis | appimage,deb>`. The Intel Mac build adds `--config crates/shell/tauri.bundle.macos-intel.conf.json`.
9. `node scripts/release-assets.mjs <mac|mac-intel|windows|linux>` copies the bundler's files into `dist/` under the download names, with their `.sig` files. For `mac` it also zips the app for Electron installs.
10. `node scripts/smoke-app.mjs <the app's binary>` starts the packaged app once and waits for its "window open" log line.
11. Mac, tag push only: the signature checks (below). Linux: the glibc check.
12. `node scripts/release-feeds.mjs dist --mac-staging <share>` runs once, on every package job's `dist/` together, and writes the four feeds.

The checks job runs beside it on each OS, on its own runner, because its builds are debug builds:

1. Intel Macs: `cargo test -p gs-search`. No other job runs the search model on the ONNX Runtime Intel Macs load.
2. `cargo build -p gs-shell --features self-test`, then `godspeed --self-test` (`xvfb-run -a` on Linux).

Notes:

- ONNX Runtime: Apple Silicon Macs and Windows link it into the server. Linux loads it from the resources folder, the Intel Mac app from `Contents/Frameworks`. Intel Macs get 1.23.2, the last version Microsoft released for them, and `ort` asks for no newer API there (`crates/search/Cargo.toml`).
- `tauri build` runs `stage-app.mjs` again as its `beforeBuildCommand`; it is fast since everything is built.
- With `TAURI_SIGNING_PRIVATE_KEY` set, the bundler writes a `.sig` beside each updater file.
- `smoke-app.mjs` starts the installed setup on Windows, the installed `.deb` and the AppImage on Linux, and the `.app` on the Mac. It refuses to run outside CI, because a packaged app uses the real godspeed data of whoever runs it. It reads the app's output through pipes and stops the app with its whole process tree, so nothing the app started can keep the step open. The smoke and check steps have limits of 5 to 10 minutes.
- The self-test runs the demo runner in the real app on that OS. Planted errors and a probe value come back, every loopback request is blocked, downloads and navigations from a demo change nothing, and an invoke from the demo window is refused.

### Download names

`scripts/release-assets.mjs` renames the bundler's outputs (the bundler has no name setting). Paths are under `target/<triple>/release/bundle/`.

| Download | Bundler file |
|---|---|
| `godspeed-mac-apple-silicon.dmg` | `dmg/godspeed_<v>_aarch64.dmg` |
| `godspeed-mac-apple-silicon.app.tar.gz` | `macos/godspeed.app.tar.gz` |
| `godspeed-mac-intel.dmg` | `dmg/godspeed_<v>_x64.dmg` |
| `godspeed-mac-intel.app.tar.gz` | `macos/godspeed.app.tar.gz` |
| `godspeed-windows-x64-setup.exe` | `nsis/godspeed_<v>_x64-setup.exe` |
| `godspeed-linux-x64.AppImage` | `appimage/godspeed_<v>_amd64.AppImage` |
| `godspeed-linux-x64.deb` | `deb/godspeed_<v>_amd64.deb` |
| `godspeed-<v>-arm64-mac.zip` | `ditto -c -k --sequesterRsrc --keepParent` of `macos/godspeed.app` |

The zip keeps symlinks, signatures and the notarization ticket.

### Local builds

- `npm run desktop:local`: unsigned Apple Silicon Mac app for trying out.
- `npm run desktop:dist`: runs `scripts/mac-dist.sh`, which makes the signed and notarized Mac app and DMG.
- Windows or Linux: steps 1 to 4, then step 8 with `--no-sign` added.

`scripts/mac-dist.sh` needs:

| Input | Source |
|---|---|
| `APPLE_ID` | environment |
| `APPLE_TEAM_ID` | environment |
| `TAURI_SIGNING_PRIVATE_KEY` | environment (the key or its file's path) |
| `APPLE_PASSWORD` | login keychain item `godspeed-notary` for `$APPLE_ID` |
| `APPLE_SIGNING_IDENTITY` | the `Developer ID Application: … (<team>)` certificate in the keychain |

It then fetches the model and pdfium, compiles the icon, runs `tauri build` with the bundle and macOS configs for `app,dmg`, checks the app with `xcrun stapler validate` and `spctl --assess`, and runs `release-assets.mjs mac`.

## CI

`.github/workflows/ci.yml` runs on pushes to main and on pull requests. Changes to only `docs/**` and `README.md` skip it.

- `quality` (Ubuntu 24.04): fetches the model and ONNX Runtime, runs `npm run check` (typecheck, tests, lint, knip, then cargo test, clippy and cargo machete) and the skill's Python tests.
- `desktop` (macOS 15, Windows, Ubuntu 22.04 container): build pipeline steps 1 to 4, then `stage-app.mjs` and `smoke-server.mjs`, and on Windows and Linux `cargo test -p gs-shell` and the self-test. It does not compile the Mac icon.
- `window` (macOS 15): `cargo test -p gs-shell`, the self-test and `npm run layout` (the screens in the real app window, see [development.md](development.md)), beside the Mac desktop job.
- `release-cache`: on a push to main that changes `Cargo.lock`, a `Cargo.toml`, `rust-toolchain.toml` or `release.yml`, starts a release rehearsal on main (see [Build caches](#build-caches)).

The Ubuntu job keeps the downloaded Linux packages in the cache, because the runner's package mirror is sometimes very slow. Pull requests restore caches but save none.

## Release workflow

`.github/workflows/release.yml` has two modes.

### Manual run (rehearsal)

Start it from **Run workflow**. A weekly scheduled run and the CI `release-cache` job start one on main too. It builds all four apps without Apple signing, signs the updater files with a throwaway key made in the run, and saves `dist/` and the four feeds as workflow artifacts for 7 days. It never creates or uploads to a release, and the verify job is skipped. Input `staging_percentage` (default `10`) sets the share written into the rehearsal's `latest-mac.yml`.

### Tag push

Push tag `v<package.json version>`.

1. `quality` checks the tag matches `package.json`, then runs `npm run check`.
2. `draft` makes or reuses a **single draft release** with the alpha line, the download table and the notes from `src/shared/changelog.json`. A version with no notes, a published release or two matching releases fail it.
3. The four `package` jobs check every secret is set, then build, sign, check and upload their downloads to the draft.
4. The four `checks` jobs run the debug checks beside them.
5. `feeds` writes the four feeds from all downloads and uploads them.
6. `verify` checks the draft, read-only, after `quality`, `checks` and `feeds`.

The workflow never publishes. Uploads use `--clobber`, so a rerun replaces same-named assets.

### Build caches

A run can restore a cache saved on its own branch or tag, or on main. A cache saved on a tag can never be restored by another run, so tag runs save none. The Mac and Windows `package` jobs restore the Rust cache a rehearsal on main saved, so a release compiles only the workspace crates instead of every dependency. Linux keeps no cache: built from nothing it still finishes first.

| When the rehearsal on main runs | Why |
|---|---|
| A push to main changes the Rust dependencies, the toolchain or `release.yml` | The cache key changes; CI's `release-cache` job starts it. |
| Every Monday at 13:30 UTC | GitHub deletes caches unused for 7 days. |
| By hand, **Run workflow** on main | Whenever the cache is cold. |

The cache is cold when a release's `Swatinem/rust-cache` step says "No cache found", or when it restores an older key (the dependencies changed since the last rehearsal). The release still works; it is just slower (about 50 minutes on the Intel Mac instead of about 20). To warm it, run the rehearsal on main and wait for it to finish before pushing the tag.

The repository has 10 GB of cache space. When it is full GitHub deletes the caches used longest ago, so the release caches can be pushed out by CI's.

### Mac checks

On a tag push each Mac job checks its app three ways. The Apple Silicon job also checks the app unzipped from the hand-over zip with `ditto -x -k`.

| Command | Proves |
|---|---|
| `codesign --verify --deep --strict --all-architectures -R "=<crates/shell/release/electron-requirement.txt>"` | The app meets the designated requirement of the published 0.5.51 Electron app, which Squirrel.Mac checks before swapping the app. |
| `spctl --assess --type execute` | Gatekeeper accepts it. |
| `xcrun stapler validate` | The notarization ticket is stapled. |

### Mac staging share

`MAC_STAGING_PERCENTAGE` near the top of `release.yml` is the share of Electron Macs `latest-mac.yml` offers the new app to. On a tag push it is `100`, which writes no field, so every Electron Mac is offered it.

### The verify job

`verify` runs only on tag pushes, after `quality` and `feeds`. It checks out the tagged revision without keeping credentials and runs `scripts/verify-release.ts`. GitHub lists drafts only to tokens with push access, so the job has `contents: write`. Every call is a GET, and only the two steps that read the API see the token.

It finds the draft whose tag is `v<version>` or the bare `<version>`. No match, two matches or an already published match fail; a bare-version match passes with a warning to rename it.

It checks `crates/shell/tauri.conf.json` still has the shape the names come from: product name, binary name, identifier, bundle targets, updater artifacts, `minimumSystemVersion` 14.0, the update endpoint, and a non-empty `pubkey`. The bundler signs without reading `pubkey`, so an app built without one could never check an update.

It fails unless the draft holds exactly these twelve assets, each non-empty and fully uploaded:

| Asset | What it is |
|---|---|
| `godspeed-mac-apple-silicon.dmg` | Mac download, Apple Silicon |
| `godspeed-mac-intel.dmg` | Mac download, Intel |
| `godspeed-windows-x64-setup.exe` | Windows download, also the Windows update |
| `godspeed-linux-x64.AppImage` | Linux download, also its update |
| `godspeed-linux-x64.deb` | Linux download for Ubuntu and Debian, also its update |
| `godspeed-mac-apple-silicon.app.tar.gz` | Apple Silicon Mac update for Tauri installs |
| `godspeed-mac-intel.app.tar.gz` | Intel Mac update |
| `latest.json` | Tauri updater feed |
| `godspeed-<v>-arm64-mac.zip` | new Apple Silicon app for Electron installs |
| `latest-mac.yml` | Electron Mac feed, points at the zip |
| `latest.yml` | Electron Windows feed, points at 0.5.51 |
| `latest-linux.yml` | Electron Linux feed, points at 0.5.51 |

The five downloads carry no version in their names, so the README and website link to `releases/latest/download/<name>`.

It then downloads and checks the four feeds:

| Feed | Rules |
|---|---|
| `latest.json` | The version, a valid `pub_date`, exactly the keys `darwin-aarch64-app`, `darwin-x86_64-app`, `windows-x86_64-nsis`, `linux-x86_64-appimage` and `linux-x86_64-deb`. Each URL is `https://github.com/bayshores/godspeed/releases/download/v<v>/<asset>` for an asset the draft holds, and each signature is one the bundler wrote for this version. |
| `latest-mac.yml` | The version, zip first and DMG second, bare names only, sizes equal to the uploaded sizes, top-level `path` and `sha512` equal to the zip's, `minimumSystemVersion: 23.0.0`, and either no `stagingPercentage` or a whole number from 0 to 99. No other fields. |
| `latest.yml`, `latest-linux.yml` | Exactly the committed templates in `crates/shell/release/` plus `newApp: <v>`. The templates point only at `../v0.5.51/<file>`. |

### Reading a crash log

Mac release binaries ship without symbols, so a panic in `logs/main.log` lists raw addresses after a `load address` line. The panic's message, file and line stay readable. Each package job keeps the symbols for 90 days as artifact `symbols-<platform>`: a `.dSYM` on Mac, a `.pdb` on Windows. Linux binaries keep their symbols.

| Step | Command |
|---|---|
| 1. Download the artifact for that version and platform | `gh run download <run id> -n symbols-mac -R bayshores/godspeed` |
| 2. Find the symbol file | `find godspeed.dSYM -path '*DWARF*' -type f` |
| 3. Turn the addresses into names | `atos -o <that file> -l <load address> <address> <address> ...` |

## Secrets

Add these under the repository's **Settings → Secrets and variables → Actions**. The workflow gives each to the bundler under the name in the second column, only in the build step that needs it.

| Secret | Bundler reads it as | Value |
|---|---|---|
| `MAC_CSC_LINK` | `APPLE_CERTIFICATE` | the Developer ID Application `.p12` with its private key, base64 |
| `MAC_CSC_KEY_PASSWORD` | `APPLE_CERTIFICATE_PASSWORD` | that `.p12`'s password |
| `APPLE_SIGNING_IDENTITY` | `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <name> (TM8Y622C8X)` |
| `APPLE_ID` | `APPLE_ID` | the Apple ID that notarizes |
| `APPLE_APP_SPECIFIC_PASSWORD` | `APPLE_PASSWORD` | an app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | `APPLE_TEAM_ID` | `TM8Y622C8X` |
| `TAURI_SIGNING_PRIVATE_KEY` | `TAURI_SIGNING_PRIVATE_KEY` | the update signing key (`npx tauri signer generate`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

- The update key's public half is `plugins.updater.pubkey` in `crates/shell/tauri.conf.json`.
- The bundler only warns and skips notarization when the Apple ID secrets are missing, so a tag push checks every secret is set before building.
- GitHub's own `GITHUB_TOKEN` uploads to the draft. No other GitHub token is needed.
- Never commit a certificate, key or password.

## Release runbook

1. If the change touches `crates/shell`, the bundle config, the updater or the workflows, run the manual Desktop release workflow first.
2. Install the Windows and Linux artifacts by hand and open them. Check window buttons and dragging, the top bar at narrow widths, zoom, onboarding and the agent connection, a lesson and resume, and a demo.
3. Bump `package.json` and the lockfile to the release version.
4. Add its notes to `src/shared/changelog.json`.
5. Run `npm run check`.
6. Push a matching `v...` tag.
7. Wait for all four package jobs, the feeds job and the verify job. If one fails, fix the cause and rerun the workflow on the tag. The gate rejects leftover assets.
8. The owner reads the draft, adds anything the notes still need, and publishes it.
9. Check the real update path from an installed older version.

## Electron installs

Electron godspeed ended at 0.5.51, on `main` at tag `v0.5.51`; its own code teaches Electron installs to hand over. Every Tauri release still publishes the Electron feeds below, so older Electron installs find the new app.

### How an Electron Mac moves

1. electron-updater reads the latest release's `latest-mac.yml`, checks `version` is newer, and compares `minimumSystemVersion` with `os.release()`, the Darwin version.
2. It keeps files whose name contains `arm64`, downloads the `.zip` and checks its sha512.
3. Squirrel.Mac unzips it, finds the `.app` whose bundle id matches, and checks its signature against the running app's designated requirement.
4. ShipIt swaps the bundle on quit (or on Restart now) and relaunches it.

The Tauri app passes because it keeps bundle id `com.bayshores.godspeed`, executable name `godspeed` and the Developer ID Application certificate of team `TM8Y622C8X`. `crates/shell/release/electron-requirement.txt` holds the requirement text after `designated => ` in `codesign -d -r- godspeed.app`, read from the published Electron app. Electron godspeed never ran on Intel Macs, so `mac-intel` has no zip.

`stagingPercentage` works per install: electron-updater compares a random id stored in `<userData>/.updaterId` with the percentage. No field means every Mac.

### Moving Electron Macs in steps

To hold a release back to a share of Electron Macs, rewrite its feed:

```sh
gh release download v<version> -R bayshores/godspeed -p latest-mac.yml -D feed
node scripts/release-feeds.mjs feed --mac-staging 50 --mac-only
gh release upload v<version> feed/latest-mac.yml --clobber -R bayshores/godspeed
```

`--mac-only` rewrites only the share in `latest-mac.yml`. `--mac-staging 100` drops the field (every Mac). `latest.json` has no share, because Tauri installs only update Tauri installs.

### Rollback

- Squirrel.Mac refuses a new app whose signature does not meet the old app's requirement and keeps the Electron app. Fix it and release again.
- To stop Electron Macs moving, run the commands above with `--mac-staging 0`. electron-updater then offers the new app to no Electron Mac. Fix forward.
- If a Tauri release is bad, turn its GitHub release back into a draft or mark it pre-release. `releases/latest` then points at the release before it, so no more Electron installs move.
- Installs that already moved get a fixed version through the Tauri updater.
- If the Tauri app cannot start at all, people reinstall 0.5.51 from its release page. The Rust server writes the same files, and `<userData>/data-backup-<v>` holds the copy from before the switch.

### The last Electron release (0.5.51)

0.5.51 has three notices for the hand-over.

Macs on macOS 12 and 13 stay on 0.5.51. The new `latest-mac.yml` says `minimumSystemVersion: 23.0.0` (Darwin for macOS 14), so electron-updater reports no update there. 0.5.51 tells them once per launch, after the startup update check, with an OK button: "This Mac will not get new versions of godspeed. The next version needs macOS 14 or newer. This version keeps working." `LSMinimumSystemVersion` 14.0 stops the Tauri app opening there if someone copies it by hand.

Windows and Linux installs get a download link, because the Tauri app cannot install over an Electron install.

- Each Tauri release publishes `latest.yml` and `latest-linux.yml` that still describe 0.5.51, plus `newApp: <new version>`.
- Each `url` there is `../v0.5.51/<name>`, which electron-updater's GitHub provider resolves into the 0.5.51 release.
- Older Electron installs update to 0.5.51 as usual. 0.5.51 then sees its own version, reads `newApp`, and shows once per launch "A new godspeed is ready." with Download (opens the latest release page) and Later.
- The templates are `crates/shell/release/legacy-latest.yml` and `legacy-latest-linux.yml`, made once from 0.5.51's own feeds.
- On Windows, the Tauri installer's NSIS hook removes the Electron copy first ([tauri-shell/config-files.md](tauri-shell/config-files.md#nsis-hook)).

When the Tauri app is open, 0.5.51 does not start. The Tauri app writes its pid to `<userData>/shell.pid` while running. Before starting its server, 0.5.51 checks that pid; if it still runs, it says "A newer godspeed is already open. Quit it first." and quits without touching data.
