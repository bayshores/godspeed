# Development guide

How to set up, run and check godspeed, and where its files live. Read this first if you work on godspeed itself.

## What godspeed is

godspeed is a desktop learning app. Its screens are a React app built with Vite (`src/frontend`), served by a Rust server (`crates/`) inside a Tauri desktop shell. The only model is an outside agent (Claude Code, Codex or any MCP app) connected over MCP: the server parks every model request as a work item, and the agent answers it. Lessons belong to **spaces**, and each space has its own files, deadlines and knowledge graph.

## Other docs

| Doc | What it covers |
|---|---|
| [architecture.md](architecture.md) | Layers, the import law, the systems and how they talk, the rules that always hold. |
| [rust-server.md](rust-server.md) | The crates, the rules every Rust module follows, locks, the server process and its environment variables. |
| [tauri-shell.md](tauri-shell.md) | The desktop shell. |
| [desktop-release.md](desktop-release.md) | Builds, CI and releases on all three operating systems. |
| [teaching-methodology.md](teaching-methodology.md) | The theory of teaching the agent prompts are built from. |
| [keyboard.md](keyboard.md) | Keyboard shortcuts. |
| [compaction-accounting.md](compaction-accounting.md) | How long lessons get shortened, the size meter and usage counts. |
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
| `npm run dev` | Vite serves the screens at http://localhost:3000, and the debug Rust server serves `/api` on port 4000. |
| `npm run dev:fresh` | A fresh instance with empty data at http://localhost:3005, for testing onboarding. Its data folder is `.fresh-data/`, wiped each launch unless you pass `--keep`. |
| `npm run build` | `vite build`: the screens into `dist-ui/`. |
| `npm run check` | The done gate: typecheck, tests, lint, deadcode and `rust:check`. CI runs the same. |
| `npm test` | The frontend, shared and desktop tests (node:test through tsx). |
| `npm run lint` | ESLint, including the import law. |
| `npm run typecheck` | `tsc --noEmit`. Unused variables and parameters are errors. |
| `npm run deadcode` | knip: unused files, exports, types and npm packages. |
| `npm run rust:check` | `cargo test --workspace`, the shell's `screens` tests, clippy with `-D warnings` (also with the shell's `screens` and `self-test` features), and `cargo machete`. |
| `npm run desktop:dev` | Vite, the debug Rust server and the Tauri shell pointed at Vite. |
| `npm run desktop:local` | An unsigned local Mac app in `target/release/bundle/macos/`. |
| `npm run desktop:dist` | The signed, notarized Mac app and DMG. `scripts/mac-dist.sh` says what it needs. |

A change is done when `npm run check` passes.

Release builds run on the target OS, not as cross-builds from macOS. See [desktop-release.md](desktop-release.md) for Windows and Linux packages and the release flow.

To import notes while testing, use the app: a space's linked folder or Files page, the Graph's Add files (No space only), or the `import_notes` MCP tool. All extraction runs on the connected agent.

## Environment

- There are no model settings, model keys or sign-ins. The outside agent picks its own model and effort in its own harness. Settings → Connection connects it.
- The one optional key is the learner's own Tavily key, entered in Settings → Connection and kept in `data/search-key` (mode 0600, never in `settings.json`). With it the research job gets a `web_search` tool. Without it the agent may use its own web search.
- The extraction batch size is an app setting, `graph.extractionChunkTokens` (default 4096, floor 500).
- The server makes the access token `data/mcp-token` on the first page load, and again whenever the file is missing.
- The server's environment variables are listed in [rust-server.md](rust-server.md).

## Layout

| Folder | What it holds |
|---|---|
| `src/frontend/` | Everything the browser runs: a Vite and React Router app. |
| `src/shared/` | Pure logic the screens import, with no file or network access. |
| `crates/` | All Rust: the server crates and the Tauri shell. See [rust-server.md](rust-server.md) for the crate list and [tauri-shell.md](tauri-shell.md) for `crates/shell` and `crates/shell-rpc`. |
| `tests/` | TypeScript tests, fixtures and the skill's Python tests. Rust tests sit in each crate. |
| `scripts/` | Download, build, release and dev scripts. |
| `integrations/skills/godspeed/` | The godspeed skill. |
| `docs/` | These docs. Design files live in `docs/design/`. |
| `data/` | Runtime state, ignored by git. |

### src/frontend

| Path | What it holds |
|---|---|
| `index.html` | The page. |
| `main.tsx` | The entry. It waits for `/api/boot` and the first screen's data, then renders. |
| `routes/router.tsx` | Every screen (see the table below). |
| `routes/root.tsx`, `routes/space-layout.tsx` | The app frame, and the space head and tabs. |
| `routes/lesson.tsx`, `deadline.tsx`, `mock.tsx`, `settings.tsx` | Screens with their own loaders. |
| `routes/not-found.tsx`, `routes/page-title.tsx` | The not-found page and the window title. |
| `components/` | Everything the screens render (see below). |
| `lib/` | `utils.ts` (the shadcn `cn` helper), `lazy-component.tsx`, and the calculator (`calculate.ts`, `calculate.worker.ts`, `calculator-client.ts`). |
| `globals.css` | Tailwind and the theme. |
| `fonts/` | The woff2 files and `fonts.css`. |

Routes:

| Route | Screen |
|---|---|
| `/` | Today |
| `/new` | Study: start a study session |
| `/settings` | Settings |
| `/archived` | Archived spaces |
| `/graph` | Graph |
| `/space` | Progress |
| `/space/lessons`, `/space/files`, `/space/cheat-sheets`, `/space/deadlines` | The space's tabs |
| `/space/deadline/:id` | A deadline |
| `/space/deadline/:id/cheat-sheet` | A deadline's cheat sheet |
| `/space/mock/:spaceId/:mockId` | A mock |
| `/chat/:id` | A lesson |

Component folders:

| Folder | What it holds |
|---|---|
| `top-bar/`, `home-page/`, `home/` | The top bar, Today and the study page. |
| `space-page/`, `overview/`, `lessons/`, `files/`, `graph/`, `deadline/`, `cheat-sheet/`, `mock/` | The space pages, deadlines, cheat sheets and mocks. |
| `lesson/`, `work/`, `teacher/` | The lesson screen, the work frame and the teacher panel. |
| `settings/`, `agent-folder/`, `onboarding/`, `welcome/` | Settings, the agent launcher, onboarding and the welcome screen. |
| `citations/`, `artifacts/` | Source marks, and the renderers for job results (registry in `artifacts/`). |
| `ai-elements/`, `ui/` | Shared message and UI pieces. |

Single files in `components/` include `boot.tsx` (the boot info for the whole app), `question-dock.tsx`, `plan-block.tsx`, `activity-dock.tsx` and `keyboard-shortcuts.tsx`.

### src/shared

| Path | What it holds |
|---|---|
| `changelog.json` | Release notes shown in What's new. |
| `core/contracts/` | The contracts the screens read, one file per domain: `boot`, `chat`, `space`, `graph`, `jobs`, `plan`, `probe`. |
| `core/` | The pure logic, all exported through `index.ts`. For example `native-messages.ts` (the record), `input-events.ts` (what `POST /api/chat` accepts), `question-core.ts`, `code-question.ts`, `plan-tree.ts`, `plan-step-bar.ts`, `progress.ts`, `study.ts`, `citations.ts`, `attachments.ts`, `tool-parts.ts`, `mock.ts` and `mock-run.ts`. |

### tests

| Path | What it holds |
|---|---|
| `tests/frontend/` | Screen tests, many through React server-side rendering. |
| `tests/shared/` | Tests for `src/shared/core`. |
| `tests/desktop/` | The shell shim and the release scripts. |
| `tests/fixtures/` | Fixtures. `golden-data/` is a real data folder, never edited by hand. |
| `tests/skills/` | The skill's Python tests. |
| `tests/perf/` | The lesson-stream benchmark. |

Shared helpers sit in `tests/` itself.

### scripts

| Script | What it does |
|---|---|
| `fetch-model.mjs` | Downloads the space-search embedding model into `models/`. |
| `fetch-pdfium.mjs` | Downloads pdfium's library for this OS into `.stage/`. |
| `fetch-onnxruntime.mjs` | Downloads ONNX Runtime's library into `.stage/` (Linux and Intel Macs). |
| `fetch-library.mjs` | The shared download and checksum code for the two above. |
| `compile-icon.mjs` | Compiles the Mac app icon into `.stage/Assets.car`. |
| `dev-resources.mjs` | Makes `.dev-resources/`, the folder a debug server runs in. |
| `dev-fresh.sh` | The `dev:fresh` instance. |
| `stage-app.mjs` | Puts together what `tauri build` bundles. |
| `smoke-server.mjs`, `smoke-app.mjs` | Start the release server, or the packaged app, once to prove it runs. |
| `mac-dist.sh` | Builds, signs and notarizes the Mac app and DMG. |
| `release-assets.mjs` | Gives the bundler's outputs the file names people download. |
| `release-feeds.mjs` | Writes the update feeds a release publishes. |
| `verify-release.ts` | The last check in the release workflow. |

## Where to read about what

Each of these is described in [architecture.md](architecture.md), in the section named here:

| Topic | Section |
|---|---|
| The outside agent, work items, the helper, and when an agent counts as connected or teaching | 8.1 |
| Question tools, side questions, attachments, the plan tree | 5 |
| Background jobs and the wake pipeline | 5 and 5.1 |
| Compaction | 5, with details in [compaction-accounting.md](compaction-accounting.md) |
| The knowledge graph and extraction | 6 |
| Spaces, linked folders, deadlines, source marks | 6.1 |
| Interviews and mocks | 6.2 |
| Study sessions | 7 |

## Testing

| Command | What it runs |
|---|---|
| `npm test` | `tests/frontend`, `tests/shared` and `tests/desktop`. |
| `cargo test --workspace` (part of `npm run rust:check`) | Rust unit tests in each module and the `tests/` folder of each crate. |
| `python3 -B -m unittest discover -s tests/skills -v` | The skill's Python tests. |

All tests are deterministic, with no LLM and no network. The engine is scripted per test with the faux provider (`crates/engine/src/turn/faux.rs`), and web and agent calls are stubbed.

- Golden cases: `crates/<crate>/tests/golden/*.json` hold recorded outputs of the original TypeScript functions, and a Rust test beside each replays them (see `crates/base/tests/golden.rs`).
- Fixtures: an on-disk format change updates `tests/fixtures/golden-data/` in the same commit. Its README says how.
- Contract scenarios replay recorded HTTP and MCP traffic against a release `godspeed-server`. The lab lives outside this repository (see [rust-server.md](rust-server.md)).

## Data

Everything under `data/` is plain JSON or JSONL and is never tracked by git. You can read these files freely. `mcp-token` is a secret, so don't share it. The desktop app moves the whole folder with `LH_DATA_DIR`.

| Path | What it holds |
|---|---|
| `chats/` | Lesson and Talk records, one JSON file each. `chats/<id>/` holds a lesson's attached PDFs. |
| `graph/` | The "No space" graph: `nodes.jsonl`, `chains.jsonl`, `sessions.jsonl`, `coverage.jsonl`, `topics.jsonl`, `sources.json` and `format.json`. |
| `spaces/<id>/` | `space.json`, `files/` (with `texts/` and `transcripts/`), `graph/`, `search/`, `cheat-sheets/` (one record per deadline, with its versions) and `mocks/` (one file per mock). |
| `search/` | The search index for "No space" facts. |
| `jobs/` | One file per background job. |
| `prompts/` | System prompts the learner edited. |
| `models/` | The downloaded speech model. |
| `settings.json` | The settings record. |
| `mcp-token` | The MCP access token (mode 0600). |
| `search-key` | The optional Tavily key (mode 0600). |
| `mcp-endpoint.json` | Where the MCP server listens. Desktop only, written by the shell. |
| `agent-notes.json` | Notes agents saved with `remember`. |
| `agent-seen.json` | What each agent has seen of each lesson. |
| `agent-rules.json` | Which teaching rules an agent saved. |
| `agent-actions.json` | The activity log. |
| `agent-folder.json` | The godspeed folder, and whether its notice was seen. |
| `reminders.json` | The day the last deadline reminder went out. |
| `godspeed-folder/` | The godspeed folder of a debug build, so a dev run never touches `~/godspeed`. |

### Record versions

| Record | Current version | Where |
|---|---|---|
| Chat | 3 | `CURRENT_CHAT_VERSION`, `crates/core/src/contracts/chat.rs` |
| Space | 10 | `CURRENT_SPACE_VERSION`, `crates/core/src/contracts/space.rs` |
| Settings | 3 | `CURRENT_SETTINGS_VERSION`, `crates/core/src/records/settings.rs` |
| Graph family (`graph/format.json`) | 1 | `CURRENT_GRAPH_FORMAT_VERSION`, `crates/core/src/contracts/graph.rs` |

- Every write stamps the current version. A chat with no version reads as version 1.
- Older records are upgraded when read. For example, a record from before the rename to "space" may still say `classId`, or live in `class.json` or a `classes/` folder.
- A chat, space or graph stamped with a newer version than the running build is refused on read, because a store never rewrites what it does not understand.
- The graph family's `format.json` is written with its first write.
