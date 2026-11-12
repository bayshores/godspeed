# godspeed on Rust: the rewrite plan

Status: approved 2026-11-09 with the recommended defaults, macOS 14+, and Windows and Linux kept with the system title bar. Work happens on branch worktree-rust-rewrite; merging to main and publishing releases wait for the owner.

Test tooling, seed data copies and measurements live outside the repo in `/Users/seane/Code/learnharness/.claude/rewrite-lab` (gitignored).

## What changes and what stays

- **Stays:** every screen. The React UI in `src/frontend` keeps its code, look and behavior.
- **Replaced:** the Node/Next.js server becomes one Rust program (`godspeed-server`). Electron becomes Tauri 2, a small Rust shell that opens a window with the Mac's built-in Safari engine (WKWebView) instead of shipping its own Chrome.
- **Same files:** the Rust server reads and writes the exact same data files, so your spaces, chats, graph and settings carry over untouched.
- **Same agents:** the MCP tools, texts and the `~/godspeed` folder stay word for word, so Claude Code and Codex see no difference.

Expected result (estimates; Phase 0 measures them before anything big is built):

| | Today (after the cheap fixes) | Rust + Tauri |
|---|---|---|
| Idle memory | about 440 MB | about 150 to 300 MB |
| App on disk | about 467 MB | about 100 to 130 MB |
| Startup | window 0.4 s, page about 1.1 s | about 0.1 to 0.3 s sooner, measured |
| Lesson speed | waits on the agent | same: it still waits on the agent |

It makes the app much lighter. It does not make lessons or screens noticeably faster.

## How the screens stay identical

- The UI keeps its React code. Only how it is served changes: Next.js page building becomes plain static files (Vite), because Rust cannot run Next's server rendering.
- Before any engine change, a script screenshots every screen and state (Home, Overview, lesson, Talk, Graph, deadline page, homework, cheat sheet studio, Settings, onboarding, dialogs, overlays) in today's app. The same script runs on every phase's build, and differences are compared side by side. Anything that looks different gets fixed before the phase ships.
- Known Safari-engine spots to check: fonts and font smoothing, scrollbar styling, `field-sizing`, blur, KaTeX, MathLive, CodeMirror with Vim, mermaid, the pdf.js canvas, drag and drop, pasting images, the startup sound, find highlights, printing a cheat sheet.

## Phases (each one ends with a working app)

### Phase 0: measure and prove (no visible change)
1. Benchmark script: total footprint of every process (including the `com.apple.WebKit.*` helpers and the agents' Node scripts), idle CPU over 30 s, time to first paint and first API answer, app size.
2. Screenshot baseline of every screen (above).
3. A throwaway Tauri window loading a **production** build of today's UI. Measure memory on Home, a lesson with math and a diagram, and the cheat sheet studio. **Go/no-go:** the whole app must come in at least 100 MB under today's 440 MB. If not, I stop and report back.
4. Spikes that decide open technical questions: demo checking in a hidden WebKit view (does it paint, run animations, catch errors?), cheat-sheet printing in WebKit, and the Rust MCP library (rmcp) against recorded agent traffic.
5. Contract recordings from today's Node server, used to check the Rust server later: every HTTP route, the turn stream events, MCP sessions (both protocol versions, including error cases and the exact texts the `~/godspeed` scripts read), data files round trip, search ranks and vectors.

### Phase 1: the UI stops needing Next.js (still Electron, still Node)
- Next.js pages become Vite + React Router; `next/link`, `next/navigation`, `next/dynamic` and page metadata get plain replacements.
- A new `/api/boot` returns what the root layout reads today (onboarding, What's new, welcome screen, active space, spaces, teacher name, sounds), and the lesson and deadline pages get the endpoints they need (homework view, deadline by id).
- Fonts are stored in the app instead of coming through `next/font`.
- Ships as a normal release. Screens must match the baseline.

### Phase 2: the Rust server, built beside the app
Built in `src/backend` as a Rust crate while the shipping app keeps running Node. Order:
1. Data files: read and write every file exactly as today (tabs, key order, JS-style numbers and timestamps, unknown fields kept, half-emoji text that JS can write), with the same upgrade-on-read.
2. Pure logic the server needs (graph, coverage, progress, compaction, briefings, settings, work pages, cheat sheet, deadline texts), checked against the TypeScript output.
3. File reading and search: Word/PowerPoint text, PDF text and page images (pdfium), the same search model through onnxruntime (ort), keyword ranking ported from MiniSearch, image resizing, SVG rendering, web page to markdown, transcription through brew's whisper as today.
4. HTTP routes, the live event stream, the MCP endpoint and the work bridge.
5. The turn engine that today comes from the pi-agent-core library: tool calls, steering, aborts, the same stream events and the same made-up token counts the context meter reads.
6. Jobs, extraction, topic grouping, compaction, catch-up, Talk, cheat sheets, the linked-folder scanner and the `~/godspeed` folder writer.
Every part passes the Phase 0 recordings before the next one starts.

### Phase 3: switch the server (still Electron)
- Catch-up: port whatever changed on main since Phase 0, re-record, re-check.
- Electron starts the Rust server instead of Node. The server keeps today's crash restart and "restarted" notice.
- Delete Node, Next and every server-only npm package in the same change. The Node recordings stay as test fixtures.
- First run backs up your data folder once (`data-backup-<version>`, without the models).
- Live test with real Claude Code and Codex in a sandbox that cannot reach your real app, data or agent config.
- Ships as a normal release.

### Phase 4: Electron becomes Tauri
- The window keeps its size, colors, traffic light position and drag areas. `window.lh` stays as a small shim so the React code barely changes.
- Same menu, single instance, logs, zoom, folder picker, Show in Finder, open agent in terminal, report a bug, font list, updates (download, install on quit, the same statuses and the auto-update setting).
- The data folder stays at today's path on every platform.
- Local API protection: a one-time token sets a cookie for the window only; demos run with no access to the API or app commands.
- Ships after every screen matches the baseline.

### Phase 5: releases and moving users
- `tauri build` replaces electron-builder. Signing, notarizing and the 4 download file names stay the same, so the site links keep working.
- Every release after the switch also publishes the old update files, so Electron installs that skipped updates still find the new app.
- One last Electron update tells users on unsupported macOS versions that they will stop getting updates.
- AGENTS.md and the checks get Rust rules (`cargo test`, `clippy`, unused dependencies) inside `npm run check`.
- I tell you what the site (godspeed-site) needs: size, minimum macOS.

## Who does the work (cost control)

- **Opus:** plans, the turn engine, the MCP bridge and work handoff, locks and concurrency, the Tauri shell and security, every review, and fixing anything a cheaper agent got wrong.
- **Sonnet 5.5 (high):** well-specified ports checked by recorded tests (data files, pure logic, office text, keyword ranking, routes that follow a pattern), test fixtures, screenshots, build and CI config, measurement runs.
- Every Sonnet change gets an Opus review before it counts as done.
- Rough size: about 40 to 50k lines of Rust plus tests. This will use a lot of tokens over many sessions; most of the volume goes to Sonnet.

## Decisions (recommended defaults)

1. **Keeping up with main:** build Rust beside the app, then pause backend changes on main only for the short Phase 3 catch-up and switch (days, not weeks). UI work never pauses.
2. **Server process:** keep the server as its own process inside the app (a crash restarts it with the "restarted" notice, as today) instead of running inside the window process.
3. **Minimum macOS:** 14 (Sonoma). Users on macOS 12 and 13 stay on the last Electron version.
4. **Windows and Linux:** keep them, with the normal system title bar there. The Mac keeps the merged top bar.
5. **Moving users:** the Mac updates straight into the Tauri app; Windows and Linux get a notice with a download link.
6. **`~/godspeed` scripts:** stay Node scripts, unchanged, so nothing changes for agents.
7. **Transcription:** keep using brew's whisper and ffmpeg.
8. **Search vectors:** if Rust's vectors don't match the stored ones exactly, rebuild the search tables automatically from saved text (CPU only, no agent work).
9. **Already-read PDFs:** keep their saved text; only new PDFs use the new reader.
10. **Small window settings saved in the browser** (unsent drafts, Vim on/off, pane widths, snoozed notices): reset once at the Tauri switch, mentioned in What's new.
11. **Releases:** one release per phase (1, 3, 4).
12. **Demo checking:** decided after the Phase 0 spike (hidden WebKit view if it works, otherwise use an installed Chrome).

## Phase 0 results (2026-11-10)

- **Memory, measured on the same screens (whole app, MiB):** Home 248 → 189, lesson with math and a diagram 480 → 363, cheat sheet studio 424 → 357. The Rust server counts as an estimated 45. About three quarters of the saving comes from replacing the Node server. The owner chose to continue with the full rewrite.
- **Demo checking:** a hidden WKWebView built directly with objc2 (no Tauri bridge), with a throwaway data store, local addresses blocked, an `https://demo.invalid/` base, and an alpha-0 window kept on screen so animations run. No Chrome needed.
- **Cheat sheet printing:** print the stored PDF natively with PDFKit. `window.print()` in WebKit ignores the page size.
- **Phases 3 and 4 ship together:** nothing is released until the owner merges, so the in-between Electron + Rust build is skipped. The Rust server is proven against the contract recordings and the screenshots in Chromium instead, and demo checking is built once, on the hidden WKWebView, rather than twice.
- **Server quirks:** the recordings captured about 40 odd behaviours of today's server (for example an empty 500 for a `null` JSON body). The Rust server copies recorded behaviour exactly. Fixing them is separate work after the switch.

## Windows and Linux status (2026-11-11)

- **Built and checked on all three systems:** `cargo build`, `cargo test` and `cargo clippy` on the whole workspace, and `godspeed --self-test` (demo checking, its isolation from the app and this machine, and the refused app commands from a demo). Windows and Linux demos run in a hidden demo window of their own; the Windows installer removes an old Electron install first and builds, and a folder dropped on Windows onboarding fills in its path.
- **Server recordings:** the file, search and path recordings are checked in their Windows or case-sensitive form where the system differs from the Mac.
- **Not yet checked by a person on Windows or Linux:** dropping a real folder on onboarding, running the installer, the Linux menu bar (no "godspeed" first menu showed), installing the deb or AppImage, Ctrl-C stop on Windows, symlink fallback on an account without Developer Mode, hard links across drives, and the updater feeds (they need signed builds).
- **Rebuilt after the catch-up (2026-11-12):** on Windows and on Linux (WSL), `cargo build --workspace`, `cargo test --workspace` (Linux 1053 tests in 79 binaries; Windows 1019 plus the Store-Python test added after), clippy with `-D warnings` on the workspace and on the shell with `screens` and with `self-test`, and `godspeed --self-test` all pass on the branch tip. The first Windows run found three failing tests, all in how the tests read Windows paths and Python's line endings: the mock runner now drops Python's CRLF on Windows, and a new test checks that the Store's python.exe is never taken. The mock runner's process-tree test, which had only a Windows version written, passes there.

## Catch-up with the Node side (2026-11-12)

The Phase 3 catch-up is done on this branch: integrate/prep (release 0.5.50, the redesign with "class" renamed to "space" everywhere, the Change command setting, the backup teacher during compaction, instant shortening, study by material and standing, source citing, the teacher at work on a space, space colors, preps and timed mocks) is merged, its screens run in the Vite app, and the Rust server and the Tauri shell follow it.

- **Checks on the branch tip:** `npm run check` passes (3288 Node tests; 1054 Rust tests in 79 test binaries plus the 4 screens tests; clippy with `-D warnings`; knip; cargo-machete). The contract suite passes all 131 scenarios on the merged Node build and on the Rust release server (`proxy-desktop` is retired for Rust, which uses the window cookie; `job-pdf-reader` and `job-visual-demo-tools` use their recorded allowed differences).
- **Desktop shell:** debug Tauri runs on a copy of the seed data showed Today, a space with each tab, a lesson with math, deadline pages, Settings with the Change command box open, the prep start screen, a new prep's sheet and Mocks tab with no page errors. A mock page needs a written prep sheet, so it was not reached without an agent.
- **Privacy:** the lab's scan of every file version added since the fork finds nothing new beyond what was already on main or reviewed before.
- **Still open:** a live run with real Claude Code and Codex, a mock taken from start to grade in the desktop app, the Windows and Linux builds, and the owner decisions the catch-up picked (the computer's own `node` for a mock's Run examples, the `markdown` and `url` crates, `appearance` in `/api/boot`).
