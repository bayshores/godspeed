# The Rust server

`godspeed-server` is the Rust program that replaces the Node/Next server (docs/rust-rewrite-plan.md, Phase 2). It must answer every HTTP request, MCP call and file write exactly like the Node server did. The contract recordings in the lab (`/Users/seane/Code/learnharness/.claude/rewrite-lab/contract`) are the judge: when the TS code and a recording disagree, the recording wins.

This page is for whoever ports a piece of it. Read "Rules for every port" before writing code.

## Layout

All Rust lives in `crates/` (a Cargo workspace; `Cargo.toml` at the repo root, toolchain pinned in `rust-toolchain.toml`). Lower crates never import higher ones.

| Crate | What it holds | Ported from |
|---|---|---|
| `json` (gs-json) | `Json`: JSON with JS key order, JS number text, lone surrogates | `JSON.parse` / `JSON.stringify` |
| `base` (gs-base) | JS-compatible text, numbers, dates, regex, sorting, ids, hashes, the app clock, paths, events, locks, atomic writes, shutdown | Node and V8 behaviour, `src/backend/config.ts`, `src/shared/core/events.ts` |
| `core` (gs-core) | pure logic: `contracts`, `records`, `messages`, `session`, `graph`, `spaces`, `study` | `src/shared/core` |
| `store` (gs-store) | every data file, read and written byte for byte like Node | `src/backend/store` |
| `files` | space files to text, linked folder walks, fingerprints | `office-text.ts`, `space-files.ts` |
| `pdf` | pdfium on one thread: text, shape, search, page images | `workers/pdf-text-worker.mjs`, `pdf-ops.ts`, page renders |
| `search` | embedding model (ort), MiniSearch BM25+, fusion, index tables | `src/shared/core/search.ts`, `search-index.ts`, `embed-worker.mjs` |
| `media` | image re-encoding, SVG to PNG, PNG fixes | `attachments.ts` (images), `headless.ts` (svg, png) |
| `web` | web page to markdown, PDF downloads | `agent/tools/web.ts` |
| `transcribe` | recordings to captions with brew's ffmpeg and whisper | `transcribe.ts` |
| `engine` | the turn loop (replaces pi-agent-core and pi-ai) and the work bridge | `agent-bridge.ts`, `models.ts`, `engine-load.ts`, `tool-execute.ts`, `server/pi/*`, the pi packages |
| `agent` | prompts, lesson tools, file tools, helper jobs, extraction | `src/backend/agent` |
| `services` | `App` (all server state) and the server's services | `src/backend/server` |
| `server` (gs-server, binary `godspeed-server`) | the HTTP layer Next gave us, the /api routes, the MCP endpoint | `src/proxy.ts`, `src/app`, `mcp.ts` |

A module is named after its TS file in snake_case (`file-series.ts` is `spaces::file_series`). A TS export `fooBar` becomes `foo_bar` in that module; `FOO_BAR` stays `FOO_BAR`. Other packages call your code by these names, so keep them.

## Rules for every port

**Records are `Json`, not structs.** Data files and API bodies are `gs_json::Json` (`Null | Bool | Num(f64) | Str | Arr | Obj`). `Obj` keeps JS key order (array-index keys first, ascending, then insertion order) and unknown fields survive a round trip. Index with `v["key"]` (missing reads as `Null`), test with `truthy()`, build with `json!({...})`. `stringify`, `stringify_pretty(v, "\t")` and `parse` match `JSON.stringify` / `JSON.parse` exactly, number text included (`js_number`). Use a typed struct only inside one function, through `to_json` / `from_json`.

**Text is JS text.** Rust `String`s may hold lone UTF-16 halves as stand-ins (`gs_json::lone`); JSON output writes them as `\udxxx` like Node, UTF-8 output writes U+FFFD. Where TS measures or slices strings, use `gs_base::text` (`len16`, `slice16`, `index_of16`, `cmp16`, `trim` with JS whitespace, `pad_start`). Never `s.len()` for a JS `.length`.

**Regexes are JS regexes.** Use `gs_base::re::Re::new(pattern, flags)` with the TS pattern copied verbatim (it runs on UTF-16 units, so `.` and `\w` behave like V8). Never the `regex` crate.

**Numbers, dates, ids, sorting.** `num::math_round`, `num::to_fixed` (JS tie rule), `num::base36`; `time::iso`, `time::parse_date` (`Date.parse`), `time::local` (the machine's zone, `TZ`); `ids::uuid`, `ids::timed(prefix)` and friends for each TS id shape; `locale::compare` for `localeCompare` (ICU, locale from `LC_ALL` > `LC_MESSAGES` > `LANG`). `hash::sha256_text` hashes like `createHash`.

**Time goes through the app clock.** `clock::now_ms()` is `Date.now()`; `clock::sleep(ms)` / `clock::sleep_until(t)` replace `setTimeout`. The contract suite moves this clock (`GODSPEED_CONTRACT_NOW`, `GODSPEED_CONTRACT_CLOCK_FILE`), so a real-time timer would miss the jump. `clippy.toml` refuses `SystemTime::now`, tokio's `sleep`/`interval`/`timeout` and `fs::write`. A repeating timer is a loop over `sleep_until(due)`, `due += period`.

**Files.** Write only with `fsx::write_atomic` / `fsx::write_text_atomic` (temp file `<name>.tmp-<8 hex>` then rename, like `write-file-atomic.ts`). Unreadable records go aside with `fsx::set_aside_corrupt`. Error texts the user or agent sees come from `fsx::node_error_message`, which spells libuv's messages (`ENOENT: no such file or directory, open '<path>'`). Directory and file order must match what Node gives (`readdirSync` is sorted on APFS; sort explicitly when the TS sorts).

**No globals.** Everything lives in `App` (`crates/services/src/lib.rs`): `paths`, `events`, `locks`, `stores`, `pdf`, `search`, `bridge` and one state struct per service package. Routes and MCP tools get `Arc<App>`. Module-level state in TS (`globalThis`, module `let`s, Maps) becomes a field of your package's state struct, behind a `parking_lot::Mutex`.

**Events.** `app.events.emit(EventKind::X, json!({...}))` replaces `emit({ type, ... })`. The payload is the event minus `type`.

**Errors.** A TS function that throws becomes `Result<T, String>` (or a small error enum when callers match on the kind). A route returns `Result<Response, Unhandled>`; `?` on any error answers the empty 500 that Next gives for a throw. A panic in a handler also answers an empty 500 and the server keeps running, but do not rely on it.

**Concurrency.** See "Locks" below. Never hold a lock across `.await`.

**Tests.** Every module gets unit tests. Where the output must equal the TS output (formatting, ranking, merging, texts), add golden cases: `crates/<crate>/tests/golden/<name>.golden.ts` default-exports `{ "case name": () => output }` calling the real TS function; `npm run golden -- <name>` writes `<name>.json` beside it; a Rust test in `crates/<crate>/tests/` replays it (see `crates/base/tests/golden.rs`). Commit the `.json`. Route and MCP work is checked with the contract scenarios (below).

**Style.** Short files with one job, short comments that say why, no history or phase notes in comments, no dead code, no `unsafe`, no new crates without the reviewer (workspace dependencies are listed in the root `Cargo.toml`; a package never edits that list). Tabs, like the TS.

**Done means** `npm run rust:check` passes (cargo test, clippy with `-D warnings`, cargo-machete). Each crate's `[package.metadata.cargo-machete] ignored` lists dependencies declared ahead of use: delete a name from it once your code uses that dependency, and leave the list empty (then delete the section) when all are used.

**Edges between packages.** Packages run in parallel. A function another package needs is called by its convention name (module and snake_case name above). When the foundations already declared it as a stub with `todo!("package X")`, keep its signature and replace the body. Do not edit files you do not own; if you need a change there, say so in your report.

## Foundations (built, tested)

- `gs_json`: `Json`, `Obj`, `json!`, `parse`, `stringify`, `stringify_pretty`, `js_number`, `quote`, `to_json`, `from_json`, `lone`.
- `gs_base`: `clock`, `config` (`Paths`, `GraphFiles`, `resolve`, `VERSION`), `events` (`Events`, `EventKind`, `Event::sse_frame`), `fsx`, `hash`, `ids`, `locale`, `locks`, `num`, `re`, `shutdown`, `text`, `time`.
- `gs_core`: `contracts::{chat, space, graph}` (ids, versions, guards, space icons, deadline sort, scope parsing) and the edge functions other packages call first, each marked in its file.
- `gs_store`: `Stores::new` with every store's constructor; `AgentSeenStore` implements `gs_core::records::agent_seen::SeenStore` (bodies to fill).
- `gs_services`: `App::new(paths, shell)`.
- `gs_server::http` (done, checked against `ui-serving` and `pdfjs-assets`; the desktop access rule by the `access` unit tests and `tests/shell.rs`):
  - `front` runs before routing: backslashes, `//` and trailing slashes redirect 308 with the path as body; `.`/`..`/`%2e` segments resolve; then the desktop access check (`access`), then a segment that will not decode answers Next's 500 page.
  - `route::ApiRoute::new().get(h).post(h).put(h).delete(h).into_route()` builds one route path: OPTIONS answers 204 with Next's sorted `Allow`, other methods an empty 405, HEAD runs GET without the body, a panic answers an empty 500. Register every route with it.
  - `reply`: `json(status, &v)`, `json_no_store`, `text`, `empty`, `no_store`, `not_found`, `Unhandled`, `json_body(body)` (`await req.json()`, None where it throws), `read_body` (cut at 210 MB like `proxyClientMaxBodySize`), `body_text`.
  - `paths::search_params(query)` and `paths::param` read a query like `URLSearchParams`; `paths::decode_component`.
  - `ui` serves `ui/` and `/pdfjs/*`; `events` is `GET /api/events`.
- Handlers take axum extractors: `State<Arc<App>>`, `Path<String>` (or `Path<(String, String)>`), `Uri` for the query, `HeaderMap`, and `Body` last. Path params are decoded per segment like Next. Use the same param names on shared prefixes: `{id}` for a space or chat, `{deadline_id}`, `{file_id}`, `{section}`, `{*segment}`, `{n}`, `{file}`.

## Locks

Node ran each read-modify-write of a file without an `await` inside, so nothing interleaved. Rust runs requests in parallel, so every such section takes a lock from `app.locks` (`gs_base::locks`):

- Keys: `LockKey::Space(id)` (a space record, its files and cheat sheets), `Chat(id)` (a lesson or Talk record and its folder), `Graph(scope)` (one graph family, `None` is "No space"), `AppFile(name)` (one file under data/, like `"settings.json"` or `"agent-notes.json"`).
- Take at most one, or several in this order: space, then chat, then graph, then app file. Several of one kind go in id order (a space delete holds each of its lessons). Of two app files, `settings.json` comes first: reading settings takes its lock, so code holding another app file must not read settings unless it took `settings.json` before. Locks are re-entrant on one thread, so a store may take the lock its caller already holds.
- A turn begins under its lesson's lock (the write-ahead), and an extraction reads its lesson under it, so a check that no turn or extraction runs, made under that lock, holds until the lock is let go. Deleting or moving a lesson checks again under it after waiting out its work (`rewrite_blocker`). A lesson enters a space (created in it or moved to it) under the space's lock, which a space delete holds, so the delete sees every lesson in the space.
- The guard is not `Send`: hold it only in synchronous code. Read, change and write inside the guard; do slow work (PDF, model, network, agent) outside and re-check after taking the lock again, as the TS does after an `await`.
- A store method that does its own read-modify-write takes the lock itself. A service that reads a record, decides, then writes takes the lock around all of it.

## The server process

- Started with its working directory beside `ui/`, `models/` (`Snowflake/snowflake-arctic-embed-xs`) and `pdfjs-dist/` (`Paths::resources`). pdfium's library also goes there (package pdf decides the file name), unless `LH_PDFIUM_PATH` names the library file: the Mac app keeps it in `Contents/Frameworks`, where the bundler signs it. `scripts/fetch-pdfium.mjs` downloads the pinned library into `.stage/`.
- A debug build (`cargo build`) keeps the godspeed folder in `<data>/godspeed-folder` until the learner picks one, as `next dev` does, so a dev run never rewrites the real `~/godspeed`. A release build uses `~/godspeed`.
- Env: `PORT` (bind is always 127.0.0.1), `LH_DATA_DIR` (unset: `data/` in the working directory), `HOME`, `TMPDIR`, `TZ`, `LH_DESKTOP_SERVER=1` + `LH_DESKTOP_API_SECRET` in the app, `LH_SHELL=1` when the desktop shell started it, `GODSPEED_CONTRACT_NOW` / `GODSPEED_CONTRACT_CLOCK_FILE` in tests. `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are read where the TS reads them.
- Writes nothing at start-up (the shell writes `mcp-endpoint.json`). Data from before spaces were called spaces moves on first use instead, as Node moved it when the store modules loaded: `data/classes` to `data/spaces` (space store) and a saved `shared/12-class-context.md` to `12-space-context.md` (prompt overrides); `class.json`, v1 chats and v2 settings are read in their old shape and written in the new one. An advisory lock on the data folder itself keeps a second server off the same data (no lock file); a new server waits up to 3 s for one that is still stopping.
- Stops on SIGTERM or SIGINT, and at the end of stdin: always with `LH_SHELL=1`, otherwise when stdin is a pipe. `gs_base::shutdown::wait()` ends long waits (event streams, `wait_for_work`); open requests get 2 s, and the process exits with 143.
- Log lines go to stderr. stdout belongs to the shell protocol (clippy `print_stdout` is denied).
- **Shell protocol** (`LH_SHELL=1`, crate `gs-shell-rpc`, spelled out in docs/tauri-shell.md section 2): one JSON object per line, `t` naming it. stdout: `ready` once right after the bind, `login_ok`, and `demo` / `svg` requests; stdin: `login`, `demo_done`, `svg_done`. Bad or unknown lines are logged and skipped. `App::shell` holds the `ShellLink`; `get_headless` sends demo runs and SVGs resvg cannot draw through it and waits at most 60 s (`demo check timed out`). Without a link they answer the no-browser error.
- **Login** `GET /api/desktop/login?token=<64 hex>`: a token the shell sent in `login` within the last 60 s (app clock) works once and answers 303 to `/` with `Cache-Control: no-store` and `Set-Cookie: gs_desktop=<secret>; Path=/; HttpOnly; SameSite=Strict`. Anything else gets the access check's 403.
- **Access** (`http/access.rs`): with a secret, every /api path except `/api/mcp`, `/api/mcp/forget` (bearer token in the route) and `/api/desktop/login` needs cookie `gs_desktop` equal to the secret and exactly `Sec-Fetch-Site: same-origin`; refusals are 403 `{"error":"Desktop API access requires the trusted godspeed window."}`. `LH_DESKTOP_SERVER=1` without a secret refuses them all. Browser mode (neither set) allows everything.
- The app version is package.json's, baked in at build time (`config::VERSION`).

## Checking against the recordings

Build a release server, then run any scenario on it from the lab (ports 48060-48069 are this rewrite's range; never 47613):

```sh
cd /Users/seane/Code/learnharness/.claude/worktrees/rust-rewrite && cargo build --release -p gs-server
cd /Users/seane/Code/learnharness/.claude/rewrite-lab/contract
CONTRACT_SERVER_CMD="/bin/sh $PWD/lib/rust-server.sh" CONTRACT_PORTS=48060-48069 node run.mjs check <scenario>
```

The recordings come from a production Node build, so they hold only for a release server: a debug build keeps its own godspeed folder (see above) and answers the spaces-folder checks differently, and it is too slow for the timing in some scenarios. `lib/rust-server.sh` makes `rewrite-lab/rust-stage/` with links to the phase 1 build's `ui/`, `models/` and pdf.js, and starts `target/release/godspeed-server` there (`RUST_SERVER_BIN` picks another build). Each scenario gets its own copy of the seed data, its own home, tmp, Claude and Codex folders, and the env above; the launcher stops the server afterwards. On a failure the full result is in `out/<scenario>.actual.json`. `--keep` keeps the run folder. Never point a server at the real data, `~/godspeed`, `~/.claude`, `~/.codex` or Google Drive.

## Work packages

Wave A ports the bottom layers in parallel; wave B builds the services, tools and routes on top. Every Sonnet package gets an Opus review. Each wave ends with a review that greps for `todo!`, builds the whole workspace, fixes call mismatches between packages and empties the machete lists.

| Package | Wave | Model | Owns |
|---|---|---|---|
| store-records | A | sonnet | `crates/core/src/records/`, `crates/store/src/` except chats, spaces, cheat_sheets |
| messages | A | sonnet | `crates/core/src/messages/`, `crates/store/src/chats.rs` |
| session | A | sonnet | `crates/core/src/session/` |
| graph-core | A | sonnet | `crates/core/src/graph/` |
| spaces-core | A | sonnet | `crates/core/src/spaces/`, `crates/store/src/spaces.rs` |
| study-progress | A | sonnet | `crates/core/src/study/`, `crates/store/src/cheat_sheets.rs` |
| space-files | A | sonnet | `crates/files/` |
| pdf | A | sonnet | `crates/pdf/` |
| search | A | opus | `crates/search/` |
| media | A | sonnet | `crates/media/` |
| web | A | sonnet | `crates/web/` |
| transcribe | A | sonnet | `crates/transcribe/` |
| engine | A | opus | `crates/engine/` |
| mcp | B | opus | `crates/server/src/mcp/`, `crates/server/src/routes/mcp.rs` |
| lesson-tools | B | sonnet | `crates/agent/src/teacher/`, `crates/agent/src/tools/` |
| file-tools | B | sonnet | `crates/agent/src/fs_tools/` |
| subagents | B | opus | `crates/agent/src/subagents/` |
| extraction | B | opus | `crates/agent/src/extraction/`, `crates/services/src/graph/`, `crates/server/src/routes/graph.rs` |
| turns | B | opus | `crates/services/src/turns/`, `crates/server/src/routes/chats.rs` |
| jobs | B | opus | `crates/services/src/jobs/`, `crates/server/src/routes/jobs.rs` |
| spaces-service | B | opus | `crates/services/src/spaces/`, `crates/server/src/routes/spaces.rs` |
| cheat-sheets | B | sonnet | `crates/services/src/cheat_sheets/`, `crates/server/src/routes/cheat_sheets.rs` |
| app-misc | B | sonnet | `crates/services/src/app/`, `crates/server/src/routes/app.rs` |

The full instructions per package (TS sources, what to provide to whom, scenarios to pass) come with each package's task. The parts every package needs to know about the others:

- **engine** (wave A) publishes the API wave B builds on, documented in `crates/engine/src/lib.rs`: the tool trait (name, label, description, JSON Schema parameters as TypeBox emits them, `execute(args, ctx)` with the call id and an abort handle, results as pi content parts plus `details`, `is_error`, `terminate`), the result helpers from `tool-execute.ts` (`server_execute` with the 30 s timeout, `to_tool_result`, `invalid_input_result`, `question_result`, `problem_result`, `conclude_result`), the agent loop (prompt, steer, follow-up, abort, the event stream, messages as pi message `Json`), the outside-agent "engine" (`agent_engine`) and the bridge (`Bridge` methods named after `agent-bridge.ts` exports).
- **Wave B provides to wave B.** Where one wave B package calls another, the callee provides these names (snake_case of the TS), in the module named after the TS file, with `app: &Arc<App>` (or `&App`) as the first parameter when the TS reached module state:
  - turns: `chat_handler::handle_chat_input`, `agent_catch_up::catch_up_for_agent`, `turn_liveness::is_turn_running`, `turn_runs::clear_turn_failure`, `chats::{quiesce_chat_for_rewrite, running_work_blocker}`, `lessons::create_lesson`, `attachments::store_attachments`.
  - jobs: `jobs::{deliver_job_result, discard_chat_deliveries, note_steers_durable, reconcile_user_steers, register_live_agent, unregister_live_agent, set_job_respawn, set_turn_runner, settle_steers}`.
  - spaces-service: `spaces::{add_copied_file, replace_copied_file, unlink_folder, update_space_deadline, source_id_for, AGENT_FILE_READING_REFUSAL}`, `space_actions::{space_actions, folder_name, READING_NOTE}` (one method per space tool, `&Json` args in, `ToolOutcome` out), `space_card::{space_card_for, space_file_path}`, `space_shortcuts::{sync_shortcuts_safely, watch_shortcuts}`.
  - extraction: `extraction::extraction` (the registry), `extraction_runs::{abort_extraction, extraction_statuses, runs}`, `topics::{schedule_topic_grouping, cancel_topic_grouping}`, `progress::{progress_for, space_order_for, space_mistakes, hinted_problems, deadline_study_for, study_topics_for, topic_study_for}`, `graph::graph_revision`, `extraction::NotesImportError` (agent side), `submit_agent::run_submit_agent`.
  - app-misc: `agent_actions::{note_agent_action, record_folder_files, record_answer}`, `agent_memory::current_agent_briefing`, `agent_rules::save_rule_by_agent`, `agent_folder::{cheat_sheets_dir, shortcut_path_problem}`, `today_note::{current_today_note, today_note_for}`.
  - subagents: `runner::create_job_runner`, `pi_run::run_subagent`, `aborts::{fire_job_abort, is_job_live}`, `bg_llm_semaphore::with_bg_llm_slot`, `headless::get_headless`, `cheat_sheet_writer::reply_on_sheet`.
  - lesson-tools: `teacher::teacher_agent::{compose_instructions, create_prober_agent, create_teacher_agent, create_practice_agent, create_study_agent, create_homework_agent, create_talk_agent}`, `tools::heal::heal_tool_record`, `tools::space::search_tools`.
  - file-tools: `fs_tools::{read::read_tool, ls::ls_tool, find::find_tool, grep::grep_tool, fs_shared::resolve_source_path, web::web_tools, pdf_read::create_pdf_read_tools}`.
  Write these first, as signatures with `todo!("package <you>")` bodies, so the others can compile against them; then fill them.
- **Routes** go in the package's `routes/*.rs` as `ApiRoute`s; `routes/mod.rs` already merges every module.
- **MCP tools** are registered in `crates/server/src/mcp/` by the mcp package only; they call the services above.

## Known gaps and decisions

- Range and conditional requests: the recordings show today's server answers both with the full file (200), so the Rust server does too.
- Demo checking (headless.ts) ran JavaScript in Electron's browser service through puppeteer. The Rust server asks the desktop shell instead (the shell protocol above); a server without the shell answers the no-browser error.
- Characters in Unicode's last 2048 private-use code points (U+10F800 to U+10FFFF) are the lone-surrogate stand-ins and cannot appear as real text.
- Search vectors: if Rust's vectors do not match the stored ones exactly, the tables are rebuilt from saved text (plan decision 8).
