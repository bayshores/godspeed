# Development guide

How to set up, run and check godspeed, and where its files live. Read first if you work on godspeed itself.

## What godspeed is

A desktop learning app. Its screens are a React app built with Vite (`src/frontend`), served by a Rust server (`crates/`) inside a Tauri desktop shell. The only model is an outside agent (Claude Code, Codex or any MCP app) connected over MCP: the server parks every model request as a work item and the agent answers it. Lessons belong to **spaces**; each space has its own files, deadlines and knowledge graph.

## Other docs

| Doc | Covers |
|---|---|
| [architecture/README.md](architecture/README.md) | Layers, the import law, the systems and how they talk, the rules that always hold. |
| [plugins/README.md](plugins/README.md) | Writing a plugin: manifest, host tools, look, trying it, getting it listed. |
| [rust-server.md](rust-server.md) | The crates, rules every Rust module follows, locks, the server process and its environment variables. |
| [tauri-shell/README.md](tauri-shell/README.md) | The desktop shell. |
| [desktop-release.md](desktop-release.md) | Builds, CI and releases on all three operating systems. |
| [teaching-methodology.md](teaching-methodology.md) | The theory of teaching the agent prompts are built from. |
| [keyboard.md](keyboard.md) | Keyboard shortcuts. |
| [features.md](features.md) | Every feature, the control that reaches it and who makes it; checked by `tests/shared/features.test.ts`. |
| [compaction-accounting.md](compaction-accounting.md) | How long lessons get shortened, the size meter, usage counts. |
| [tool-content-recovery.md](tool-content-recovery.md) | How broken LaTeX in tool calls is repaired for display. |
| `crates/agent/prompts/README.md` | How the agent prompts are put together. |

## Setup

You need Node, a Rust toolchain (`rust-toolchain.toml` pins it) and `cargo-machete` for the checks.

1. Run `npm install`.
2. Run `node scripts/fetch-model.mjs` to download the space-search model into `models/`.
3. On Linux or an Intel Mac, run `node scripts/fetch-onnxruntime.mjs` to download ONNX Runtime's library into `.stage/`. Search loads it at run time.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite serves the screens at http://localhost:3000; the debug Rust server serves `/api` on port 4000. |
| `npm run dev:fresh` | Fresh instance with empty data at http://localhost:3005, for testing onboarding. Data folder `.fresh-data/`, wiped each launch unless you pass `--keep`. |
| `npm run build` | `vite build`: the screens into `dist-ui/`. |
| `npm run check` | The done gate: typecheck, tests, lint, deadcode and `rust:check`. CI runs the same, plus `layout` on the Mac. |
| `npm test` | Frontend, shared and desktop tests (node:test through tsx). |
| `npm run lint` | ESLint, including the import law. |
| `npm run typecheck` | `tsc --noEmit`. Unused variables and parameters are errors. |
| `npm run deadcode` | knip: unused files, exports, types and npm packages. |
| `npm run rust:check` | `cargo test --workspace`, the shell's `screens` tests, clippy with `-D warnings` (also with the shell's `screens` and `self-test` features), and `cargo machete`. |
| `npm run layout` | Mac only: runs the debug app on made-up data in a window nobody sees (fully transparent, no Dock icon, never the front app) and walks the screens in `scripts/layout-screens.mjs` in two passes, described in the table below. The widths are dealt into up to four parts that run side by side (one on a machine with fewer than 8 cores), each with its own app, home and made-up data in `target/layout/part-N/`, walking every screen in the same order at its own widths. The report is `target/layout/report.txt`, a finding's picture is in its part's folder, and a part's own output is `target/layout/part-N.log`; with `LAYOUT_STATES` set to a folder, every lesson screen is also photographed there as it opens, at each width; with `LAYOUT_ONLY` set to words (`LAYOUT_ONLY="cheat sheet,mock graded"`), only the screens whose name holds them are walked, for a second look at a fix and never in place of the whole run. Not part of `check` (it builds the app and starts it): run it yourself before calling a UI change finished, one run at a time. CI runs it on macOS 15, whose web view is older than a developer's: a screen that needs a newer one (a library built for the latest browsers only) fails there and passes here. |
| `npm run desktop:dev` | Vite, the debug Rust server and the Tauri shell pointed at Vite. |
| `npm run desktop:local` | Unsigned local Mac app in `target/release/bundle/macos/`. |
| `npm run desktop:dist` | Signed, notarized Mac app and DMG. `scripts/mac-dist.sh` says what it needs. |

A change is done when `npm run check` passes.

The two passes of `npm run layout`:

| Pass | Which screens, which widths | Fails on |
|---|---|---|
| Opening | The first screen at each address, at its widest and narrowest width. With motion on, the page is opened from Home (Home itself from Progress) as a link opens it, not by a full load, and watched for 1.5 s from its first paint, each frame read as it is drawn. | A sheet or a bar's word or key that moves, changes size or leaves after the first paint, a sheet that arrives later, the screen scrolling by itself, and an animation or transition on what was there at the first paint. The page's travel, its words fading into the top bar, the lit tab's marker sliding and the pencil that writes while the teacher works are the motion rule's own and pass. |
| Still | Every screen at 1440, 1100 and 640 points wide (640 is the narrowest window), a lesson at 1320 (just past the room where a short question is set larger) and 800 too, and a screen with `widths` of its own only at those, 680 high. A screen with a `height` of its own, as the lessons in a tall window, is left out with a warning where the display is too low for it. Motion off, each as it opens, scrolled 80 px, scrolled to the end and, where it opened scrolled (a lesson at its rest), at its top. | Text drawn over text, text or a control another box is drawn over, a box spilling out of its parent, sideways scrolling, text or a control a clipping box hides (also before a scrolling box's left or top edge, or outside the window, where no scrolling reaches it), letters it cuts off, a question in "Your turn" that opens scrolled past its first line, and a sheet with a tall empty band between two things it holds (over 160 px and over 35% of the sheet), unless the sheet carries `data-fills` with its reason. Also: a marked line cut by the edge of a box that scrolls it (cut tail), a picture that did not load (broken picture), a scrolling page that ends below the last thing it holds (empty room), a sheet or well over 160 by 120 px with nothing in it (empty box), a key in a bar (bar key), the lesson's writing row outside the lesson's window (turn foot), a notice out by itself on a lesson page (lesson notice), two neighbouring sheets apart by other than the shared gap, or a heading that is not the page's title (spacing), a key too wide or too tight for its words (wide key, tight key), three or more keys stacked on three or more lines (key pile) and a title cut with "..." (cut title). |

To check a new screen or state with `npm run layout`:

1. Add one entry to `scripts/layout-screens.mjs`: a name, its `url`, and a `ready` selector for something drawn from the screen's data (not its frame, which shows before the data).
2. For a state the URL does not reach, add `setup` (a page script that clicks) and `shows` (the selector it waits for), or `before` (a page script that changes the data first).
3. Every menu and pop-up gets its own entry that opens it, with `[data-state=open]` in `shows`: a `MenuShell` menu carries it once it is placed. At each width the walk brings the key that opened a menu or pop-up back into the window, so a row a narrower window pushed down is not reported as a menu outside the window.
4. If the state needs data that is not there, have the stand-in agent in `scripts/layout-seed.mjs` write it through MCP.

Release builds run on the target OS, not as cross-builds from macOS. See [desktop-release.md](desktop-release.md) for Windows and Linux packages and the release flow.

To import notes while testing, use the app: a space's linked folder or Files page, the Graph's Add files (No space only), or the `import_notes` MCP tool. All extraction runs on the connected agent.

## Environment

- No model settings, model keys or sign-ins. The outside agent picks its own model and effort in its own harness. Settings → Connection connects it.
- The one optional key is the learner's own Tavily key, entered in Settings → Teaching → Facts and research and kept in `data/search-key` (mode 0600, never in `settings.json`). With it the research job gets a `web_search` tool; without it the agent may use its own web search.
- Extraction batch size is fixed at 4096 tokens (`graph.extractionChunkTokens` in `factory_settings`). It is not a setting; a value in an old `settings.json` is ignored.
- The server makes the access token `data/mcp-token` on the first page load, and again whenever the file is missing.
- The server's environment variables are in [rust-server.md](rust-server.md).

## Layout

| Folder | Holds |
|---|---|
| `src/frontend/` | Everything the browser runs: a Vite and React Router app. |
| `src/shared/` | Pure logic the screens import, no file or network access. |
| `crates/` | All Rust: server crates and the Tauri shell. Crate list in [rust-server.md](rust-server.md); `crates/shell` and `crates/shell-rpc` in [tauri-shell/README.md](tauri-shell/README.md). |
| `tests/` | TypeScript tests, fixtures and the skill's Python tests. Rust tests sit in each crate. |
| `scripts/` | Download, build, release and dev scripts. |
| `integrations/skills/godspeed/` | The godspeed skill. |
| `docs/` | These docs. Design files in `docs/design/`. |
| `data/` | Runtime state, ignored by git. |

### src/frontend

| Path | Holds |
|---|---|
| `index.html` | The page. |
| `main.tsx` | The entry. Waits for `/api/boot` and the first screen's data, then renders. |
| `routes/router.tsx` | Every screen (routes below). |
| `routes/root.tsx`, `routes/space-layout.tsx` | The app frame; the space head and tabs. |
| `routes/lesson.tsx`, `deadline.tsx`, `mock.tsx` | Screens with their own loaders. |
| `routes/settings.tsx`, `routes/plugin-tab.tsx` | Settings, which opens on the section the address names; a plugin's own tab in a space. |
| `routes/not-found.tsx`, `routes/page-title.tsx` | The not-found page; the window title. |
| `components/` | Everything the screens render (below). |
| `lib/` | `utils.ts` (the shadcn `cn` helper), `api.ts` (the JSON request helpers), `lazy-component.tsx`, `plural.ts`, `storage.ts`, `read-base64.ts`, `use-stable-value.ts`, the plugin helpers (`plugins-api.ts`, `plugin-host-api.ts`, `use-plugins-at.ts`) and the calculator (`calculate.ts`, `calculate.worker.ts`, `calculator-client.ts`). |
| `globals.css` | Tailwind and the theme. |
| `fonts/` | The woff2 files and `fonts.css`. |

Routes:

| Route | Screen |
|---|---|
| `/` | Home |
| `/new` | Study: start a study session |
| `/settings` | Settings |
| `/graph` | Graph |
| `/space` | Progress: what to do (next deadline, unfinished lessons, path, Most needed) in a side column, and the teacher's note, the finished lessons, the facts and the confidence chart in the wide one |
| `/space/files`, `/space/deadlines` | The space's tabs |
| `/space/plugin/:id` | A plugin's own tab in a space |
| `/space/deadline/:id` | A deadline |
| `/space/deadline/:id/cheat-sheet` | A deadline's cheat sheet |
| `/space/mock/:spaceId/:mockId` | A mock |
| `/chat/:id` | A lesson |

Component folders:

| Folder | Holds |
|---|---|
| `top-bar/`, `home-page/`, `study-page/` | Top bar, Home, the Study page. |
| `space-page/`, `overview/`, `lessons/`, `files/`, `graph/`, `deadline/`, `cheat-sheet/`, `mock/` | Space pages, deadlines, cheat sheets, mocks. |
| `lesson/`, `work/`, `teacher/`, `terminal/` | Lesson screen, work frame, teacher panel, the agent's terminal screen. |
| `settings/`, `agent-folder/`, `onboarding/`, `welcome/`, `plugins/` | Settings, agent launcher, onboarding, welcome screen, a plugin's sandboxed frame. |
| `citations/`, `artifacts/` | Source marks; renderers for job results (registry in `artifacts/`). |
| `ai-elements/`, `ui/` | Shared message and UI pieces. |

Single files in `components/` include `boot.tsx` (boot info for the whole app), `question-dock.tsx`, `plan-block.tsx`, `activity-dock.tsx` and `keyboard-shortcuts.tsx`.

### src/shared

| Path | Holds |
|---|---|
| `changelog.json` | Release notes shown in What's new. |
| `core/contracts/` | Contracts the screens read, one file per domain: `boot`, `chat`, `space`, `graph`, `jobs`, `plan`, `probe`. |
| `core/` | Pure logic, all exported through `index.ts`. For example `native-messages.ts` (the record), `input-events.ts` (what `POST /api/chat` accepts), `question-grading.ts`, `code-question.ts`, `plan-step-bar.ts`, `progress.ts`, `study.ts`, `citations.ts`, `attachments.ts`, `tool-parts.ts`, `mock.ts` and `mock-run.ts`. |

### tests

| Path | Holds |
|---|---|
| `tests/frontend/` | Screen tests, many through React server-side rendering. |
| `tests/shared/` | Tests for `src/shared/core`. |
| `tests/desktop/` | The shell shim, release scripts and layout check. |
| `tests/fixtures/` | Fixtures. `golden-data/` is a real data folder, never edited by hand. |
| `tests/skills/` | The skill's Python tests. |
| `tests/perf/` | The lesson-stream benchmark. |

Shared helpers sit in `tests/` itself.

### scripts

| Script | Does |
|---|---|
| `fetch-model.mjs` | Downloads the space-search embedding model into `models/`. |
| `fetch-pdfium.mjs` | Downloads pdfium's library for this OS into `.stage/`. |
| `fetch-onnxruntime.mjs` | Downloads ONNX Runtime's library into `.stage/` (Linux and Intel Macs). |
| `fetch-library.mjs` | Shared download and checksum code for the two above. |
| `make-icons.mjs` | Draws every app icon file. Run it after changing an icon drawing and commit what it writes. See [The app icon](desktop-release.md#the-app-icon). |
| `compile-icon.mjs` | Compiles the Mac app icon into `.stage/Assets.car`. |
| `dev-resources.mjs` | Makes `.dev-resources/`, the folder a debug server runs in. |
| `dev-fresh.sh` | The `dev:fresh` instance. |
| `stage-app.mjs` | Builds what `tauri bundle` packs: the UI, the pdf.js files, the release server and, with `--app`, the app's binary beside it. |
| `smoke-server.mjs`, `smoke-app.mjs` | Start the release server, or the packaged app, once to prove it runs. |
| `mac-dist.sh` | Builds, signs and notarizes the Mac app and DMG. |
| `release-assets.mjs` | Gives the bundler's outputs their download names. |
| `release-feeds.mjs` | Writes the update feeds a release publishes. |
| `verify-release.ts` | The last check in the release workflow. |
| `layout.mjs`, `layout-page.mjs`, `layout-screens.mjs`, `layout-seed.mjs`, `layout-agent.mjs` | `npm run layout`: the walk, the in-page check, the screen list, the stand-in agent that writes the made-up data, and the stand-in `claude` and `codex` a Start runs in the check. |

## Where to read about what

Each is described in [architecture/README.md](architecture/README.md), in the section named:

| Topic | Section |
|---|---|
| The outside agent, work items, the helper, when an agent counts as connected or teaching | 8.1 |
| Question tools, side questions, attachments, the plan tree | 5 |
| Background jobs and the wake pipeline | 5 and 5.1 |
| Compaction | 5, details in [compaction-accounting.md](compaction-accounting.md) |
| The knowledge graph and extraction | 6 |
| Spaces, linked folders, deadlines, source marks, problem lists, cheat sheets | 6.1 and 6.4 to 6.7 |
| Interviews and mocks | 6.2 |
| Study sessions | 7 |

## Testing

| Command | Runs |
|---|---|
| `npm test` | `tests/frontend`, `tests/shared` and `tests/desktop`. |
| `cargo test --workspace` (part of `npm run rust:check`) | Rust unit tests in each module and each crate's `tests/` folder. |
| `python3 -B -m unittest discover -s tests/skills -v` | The skill's Python tests. |

All tests are deterministic: no LLM, no network. The engine is scripted per test with the faux provider (`crates/engine/src/turn/faux.rs`); web and agent calls are stubbed.

- Golden cases: `crates/<crate>/tests/golden/*.json` hold recorded outputs of the original TypeScript functions; a Rust test beside each replays them (see `crates/base/tests/golden.rs`).
- Fixtures: an on-disk format change updates `tests/fixtures/golden-data/` in the same commit. Its README says how.
- Contract scenarios replay recorded HTTP and MCP traffic against a release `godspeed-server`. The lab lives outside this repository (see [rust-server.md](rust-server.md)).

## Data

Everything under `data/` is plain JSON or JSONL, never tracked by git. Read these files freely; `mcp-token` is a secret, so don't share it. The desktop app moves the whole folder with `LH_DATA_DIR`.

| Path | Holds |
|---|---|
| `chats/` | Lesson records, one JSON file each, and an older build's Talk chat, kept as it was. `chats/<id>/` holds a lesson's attached PDFs. |
| `graph/` | The "No space" graph: `nodes.jsonl`, `chains.jsonl`, `sessions.jsonl`, `coverage.jsonl`, `topics.jsonl`, `sources.json`, `format.json`. |
| `spaces/<id>/` | `space.json`, `files/` (with `texts/` and `transcripts/`), `graph/`, `search/`, `cheat-sheets/` (one record per deadline, with its versions), `mocks/` (one file per mock). |
| `search/` | Search index for "No space" facts. |
| `jobs/` | One file per background job. |
| `prompts/` | System prompts the learner edited. |
| `models/` | The downloaded speech model. |
| `settings.json` | The settings record. |
| `mcp-token` | MCP access token (mode 0600). |
| `search-key` | Optional Tavily key (mode 0600). |
| `mcp-endpoint.json` | Where the MCP server listens. Desktop only, written by the shell. |
| `agent-notes.json` | Notes agents saved with `remember`. |
| `agent-seen.json` | What each agent has seen of each lesson. |
| `agent-rules.json` | Which teaching rules an agent saved. |
| `agent-actions.json` | The activity log. |
| `agent-folder.json` | The godspeed folder, and whether its notice was seen. |
| `reminders.json` | The day the last deadline reminder went out. |
| `godspeed-folder/` | A debug build's godspeed folder, so a dev run never touches `~/godspeed`. |

### Record versions

| Record | Current version | Where |
|---|---|---|
| Chat | 3 | `CURRENT_CHAT_VERSION`, `crates/core/src/contracts/chat.rs` |
| Space | 12 | `CURRENT_SPACE_VERSION`, `crates/core/src/contracts/space.rs` |
| Settings | 3 | `CURRENT_SETTINGS_VERSION`, `crates/core/src/records/settings.rs` |
| Graph family (`graph/format.json`) | 1 | `CURRENT_GRAPH_FORMAT_VERSION`, `crates/core/src/contracts/graph.rs` |

- Every write stamps the current version. A chat with no version reads as version 1.
- Older records are upgraded when read. For example, a record from before the rename to "space" may say `classId`, or live in `class.json` or a `classes/` folder, and a space closed before the rename to "close" says `archived: true`.
- A chat, space or graph stamped newer than the running build is refused on read, because a store never rewrites what it does not understand.
- The graph family's `format.json` is written with its first write.
