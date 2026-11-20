# The Rust server

`godspeed-server` serves the UI files, /api routes and MCP endpoint, and reads and writes the data files. Read "Rules for every module" before changing it. Data from earlier versions (including the Node server) keeps working; written files read the same byte for byte.

## Layout

All Rust lives in `crates/`, a Cargo workspace (`Cargo.toml` at repo root, toolchain pinned in `rust-toolchain.toml`). A crate uses only crates above it here; Cargo refuses a cycle. Packages are named `gs-<crate>`. The desktop shell (`crates/shell`) is in [tauri-shell/README.md](tauri-shell/README.md).

| Crate | Holds |
|---|---|
| `json` (gs-json) | `Json`: JSON with JS key order, JS number text, lone surrogates |
| `base` (gs-base) | JS-compatible text, numbers, dates, regex, sorting, ids, hashes, app clock, paths, events, locks, atomic writes, shutdown |
| `core` (gs-core) | pure logic: `contracts`, `records`, `messages`, `session`, `graph`, `spaces`, `study`, `mocks` |
| `shell-rpc` (gs-shell-rpc) | line protocol between server and desktop shell |
| `store` (gs-store) | every data file, read and written byte for byte as earlier versions did |
| `media` | image re-encoding, SVG to PNG, PNG fixes |
| `pdf` | pdfium on one thread: text, shape, search, page images |
| `files` | space files to text, linked folder walks, fingerprints |
| `search` | embedding model (ort), MiniSearch BM25+, fusion, index tables |
| `web` | web page to markdown, PDF downloads, plugin zips, godspeed's plugin list from GitHub |
| `transcribe` | recordings to captions with brew's ffmpeg and whisper |
| `engine` | turn loop, work bridge to the outside agent |
| `agent` | prompts, lesson tools, file tools, background jobs, extraction |
| `services` | `App` (all server state) and the services |
| `server` (gs-server, binary `godspeed-server`) | HTTP layer, /api routes, MCP endpoint |

## Rules for every module

### Records are `Json`, not structs

Data files and API bodies are `gs_json::Json` (`Null | Bool | Num(f64) | Str | Arr | Obj`). `Obj` keeps JS key order (array-index keys ascending, then insertion order). Unknown fields survive a round trip.

- Index with `v["key"]`; a missing key is `Null`. Test with `truthy()`, build with `json!({...})`.
- `stringify`, `stringify_pretty(v, "\t")` and `parse` match `JSON.stringify` and `JSON.parse` exactly, number text included (`js_number`).
- Use a typed struct only inside one function, via `to_json` and `from_json`.

### Text is JS text

`String`s may hold lone UTF-16 halves as stand-ins (`gs_json::lone`). JSON output writes them as `\udxxx` like `JSON.stringify`; UTF-8 output writes U+FFFD.

Where JS counts UTF-16 units (stored offsets, the screens), use `gs_base::text`: `len16`, `slice16`, `index_of16`, `cmp16`, `trim` with JS whitespace, `pad_start`. Never `s.len()` for a JS `.length`.

### Regexes are JS regexes

Use `gs_base::re::Re::new(pattern, flags)` with the pattern as the screens' JS writes it. It runs on UTF-16 units, so `.` and `\w` act like V8. Never use the `regex` crate.

### Numbers, dates, ids and sorting

| Need | Use |
|---|---|
| `Math.round`, `toFixed` (JS tie rule), base 36 | `num::math_round`, `num::to_fixed`, `num::base36` |
| ISO text, `Date.parse`, local time (`TZ`) | `time::iso`, `time::parse_date`, `time::local` |
| ids | `ids::uuid`, `ids::timed(prefix)` and friends, one per id shape |
| `localeCompare` | `locale::compare` (ICU, locale from `LC_ALL`, then `LC_MESSAGES`, then `LANG`) |
| `createHash` | `hash::sha256_text` |

### Time goes through the app clock

`clock::now_ms()` is the time in ms; `clock::sleep(ms)` and `clock::sleep_until(t)` wait. The contract suite moves this clock (`GODSPEED_CONTRACT_NOW`, `GODSPEED_CONTRACT_CLOCK_FILE`); a real-time timer would miss the jump. `clippy.toml` refuses `SystemTime::now`, tokio's `sleep`, `sleep_until`, `interval` and `timeout`, `fs::write` and `stdout`. A repeating timer loops over `sleep_until(due)` with `due += period`.

### Files

- Write only with `fsx::write_atomic`, `fsx::write_text_atomic` or `fsx::write_atomic_pair`. Each writes temp file `<name>.tmp-<8 hex>`, then renames, like `write-file-atomic`. `write_atomic_pair` streams two files that go together and renames only once both are written.
- A data file the app rewrites is read with `fsx::read_json_or_set_aside`: one that is not valid JSON is kept as `<name>.corrupt-<ms>`, so the next save cannot replace it. `fsx::read_json` is only for a file the app does not rewrite (a plugin's `manifest.json`) or a read that must not rename (`list_mocks_unlocked`). Other unreadable records go aside with `fsx::set_aside_corrupt`.
- Error texts the learner or outside agent sees come from `fsx::node_error_message`, which spells libuv's messages as Node did (`ENOENT: no such file or directory, open '<path>'`).
- Directory and file order must not depend on the file system. Sort explicitly.

### No globals

Everything lives in `App` (`crates/services/src/lib.rs`): `paths`, `events`, `locks`, `stores`, `pdf`, `search`, `bridge`, `shell` and one state struct per service package. Routes and MCP tools get `Arc<App>`. Service state is a field of its package's state struct, behind a `parking_lot::Mutex`.

### Events, errors and concurrency

- Emit with `app.events.emit(EventKind::X, json!({...}))`. Payload is the event minus `type`.
- A fallible function returns `Result<T, String>`, or a small error enum when callers match on kind.
- A route returns `Result<Response, Unhandled>`; `?` on any error answers an empty 500. A handler panic also answers an empty 500 and the server keeps running, but do not rely on it.
- A background task nobody awaits starts with `tasks::detach(label, future)`, which prints `[label] task panicked: ...` if it panics. Keep a plain `tokio::spawn` only where the handle is awaited, stored or aborted.
- Never hold a lock across `.await`. See [Locks](#locks).

### Tests

Every module gets unit tests. Route and MCP work is checked with contract scenarios (see [Checking against the recordings](#checking-against-the-recordings)).

Where output must equal the original TypeScript's (formatting, ranking, merging, texts), a golden case replays a recorded output. `crates/<crate>/tests/golden/<name>.json` holds the cases; a Rust test in `crates/<crate>/tests/` replays them (see `crates/base/tests/golden.rs`). The `.json` files are recordings, not hand-written; change one only when behaviour is meant to change.

### Style and done

- Short files with one job, short comments that say why, no history or phase notes in comments, no dead code.
- No `unsafe`, except the shell's platform modules ([tauri-shell/files.md](tauri-shell/files.md#rules)).
- Workspace dependencies are listed in root `Cargo.toml`. Indent with tabs.
- Done means `npm run rust:check` passes: cargo test, clippy with `-D warnings` (also with the shell's `screens` and `self-test` features) and cargo-machete. Remove an unused dependency; do not ignore it.

## What every module can use

- `gs_json`: `Json`, `Obj`, `json!`, `parse`, `stringify`, `stringify_pretty`, `js_number`, `quote`, `to_json`, `from_json`, `lone`.
- `gs_base`: `base64`, `clock`, `config` (`Paths`, `GraphFiles`, `resolve`, `VERSION`), `events` (`Events`, `EventKind`, `Event::sse_frame`), `fsx`, `hash`, `ids`, `locale`, `locks`, `num`, `posix`, `re`, `regexp`, `shutdown`, `tasks`, `text`, `time`.
- `gs_core`: `contracts::{chat, space, graph}` (ids, versions, guards, space icons, deadline sort, scope parsing) and the pure logic above them.
- `gs_store`: `Stores::new` with every store's constructor. `AgentSeenStore` implements `gs_core::records::agent_seen::SeenStore`.
- `gs_services`: `App::new(paths, shell)`.

### `gs_server::http`

The `access` unit tests and `crates/server/tests/shell.rs` cover the desktop access rule.

- `front` runs before routing. Backslashes, `//` and trailing slashes redirect 308 with the path as body; `.`, `..` and `%2e` segments resolve. Then the desktop access check runs. A segment that will not decode answers Next's 500 page.
- `route::ApiRoute::new().get(h).post(h).put(h).patch(h).delete(h).into_route()` builds one route path; register every route with it. OPTIONS answers 204 with Next's sorted `Allow`, other methods an empty 405, HEAD runs GET without the body, a panic an empty 500.
- `reply`: `json(status, &v)`, `json_no_store`, `text`, `empty`, `no_store`, `not_found`, `Unhandled`, `json_body(body)` (`await req.json()`, None where it throws), `read_body` (cut at 210 MiB like `proxyClientMaxBodySize`), `body_text`.
- `paths::search_params(query)` and `paths::param` read a query like `URLSearchParams`. `paths::decode_component` decodes one segment.
- `ui` serves `ui/` and `/pdfjs/*`. `plugin_files` serves `/plugin-files/<id>/<path>` with the plugin's CSP, only for a Host of 127.0.0.1, localhost or [::1]. `events` is `GET /api/events`.

Handlers take axum extractors: `State<Arc<App>>`, `Path<String>` (or `Path<(String, String)>`), `Uri` for the query, `HeaderMap`, `Body` last. Path params decode per segment like Next. Shared prefixes use the same names: `{id}` for a space or chat, `{deadline_id}`, `{file_id}`, `{section}`, `{*segment}`, `{n}`, `{file}`.

## Locks

Requests run in parallel, so every read-modify-write of a file takes a lock from `app.locks` (`gs_base::locks`).

| Key | Covers |
|---|---|
| `LockKey::Space(id)` | a space record, its files and cheat sheets |
| `LockKey::Chat(id)` | a lesson record and its folder |
| `LockKey::Graph(scope)` | one graph family; `None` is "No space" |
| `LockKey::AppFile(name)` | one file under data/, like `"settings.json"` or `"agent-notes.json"`; `"plugins/<id>"` is one plugin's folder |

### Order

- Take at most one lock, or several in this order: space, chat, graph, app file.
- Tests check this order (gs-base feature `lock-order-check`, turned on by the dev-dependencies of store, services, server and agent; no built server has it): `Locks::lock` panics when the thread already holds a lock that comes later (taking the same key again is fine; `try_lock` never waits, so it is not checked). Settings count as an app file that comes before the other app files.
- Several of one kind go in id order. A space delete holds each of its lessons, then its graph, so a graph write in flight finishes before the folder goes. This is not checked.
- Of two app files, `settings.json` comes first. Reading settings takes its lock, so code holding another app file must not read settings unless it took `settings.json` first.
- Locks are re-entrant on one thread, so a store may take the lock its caller holds.
- A read that saves on the side while its caller may hold a later lock uses `try_lock`; if it gets the lock it leaves the save to a later read (a space's first color, `SpaceStore::get_space`).
- Code under a chat lock never waits for a space lock. Progress (`progress_for`) runs under a lesson's lock, so it reads mocks with `MockStore::list_mocks_unlocked`; mock writes are a temp file and a rename, so no half-written mock is read.

Locks outside `LockKey`, each guarding one piece of memory or one task:

| Lock | Guards | Taken |
|---|---|---|
| `SpaceStore::coloring` | picking and saving a space's color, so two spaces never get the same one | Inside the space lock (`get_space` holds it through `try_lock`); nothing else is locked while it is held |
| `McpTokenStore::writing` | the token file's read-then-write | Alone |
| `SpacesState::shortcut_sync` | one shortcut sync at a time (it rewrites the manifest) | Never while a `LockKey` is held; the sync reads spaces inside it, which takes `LockKey::Space` briefly |
| `ExtractionState::graph_lock` | one graph extraction at a time (async mutex) | Never while a `LockKey` is held (a guard cannot cross an `.await`); the extraction takes graph and chat locks inside it |
| `ONE_AT_A_TIME` in `reindex_kept_pages` | one kept-page re-index at a time (async mutex) | Never while a `LockKey` is held; the index reads spaces inside it |

### Holding a lock

- The guard is not `Send`. Hold it only in synchronous code.
- Read, change and write inside the guard. Do slow work (PDF, model, network, agent) outside, and check again after retaking the lock, as after any wait.
- A store method that does its own read-modify-write takes the lock itself. A service that reads a record, decides, then writes locks around all of it.

### Lessons and spaces

- A turn begins under its lesson's lock (the write-ahead), and an extraction reads its lesson under it. So a check under that lock that no turn or extraction runs holds until the lock is released.
- Deleting or moving a lesson checks again under the lock after waiting out its work (`rewrite_blocker`).
- A lesson enters a space (created in or moved to it) under the space's lock. A space delete holds that lock, so it sees every lesson in the space.

## The server process

### Working directory and files

- The working directory sits beside `ui/`, `models/` (`Snowflake/snowflake-arctic-embed-xs`) and `pdfjs-dist/` (`Paths::resources`).
- pdfium's library sits there too (package pdf decides the file name) unless `LH_PDFIUM_PATH` names the file. The Mac app keeps it in `Contents/Frameworks`, where the bundler signs it. `scripts/fetch-pdfium.mjs` downloads the pinned library into `.stage/`.
- A debug build (`cargo build`) keeps the godspeed folder in `<data>/godspeed-folder` until the learner picks one, so a dev run never rewrites the real `~/godspeed`. A release build uses `~/godspeed`.
- The app version is package.json's, baked in at build time (`config::VERSION`).

### Environment

| Variable | Meaning |
|---|---|
| `PORT` | Port. Bind is always 127.0.0.1. Default 3000. |
| `LH_DATA_DIR` | Data folder. Unset, `data/` in the working directory. |
| `HOME`, `TMPDIR`, `TZ` | Home folder, temp folder, time zone. |
| `LH_DESKTOP_SERVER`, `LH_DESKTOP_API_SECRET` | `1` and the window's secret, set by the shell. See [Access](#access). |
| `LH_SHELL` | `1` when the desktop shell started the server. Turns on the line protocol. |
| `LH_PDFIUM_PATH` | pdfium's library file, when not in the working directory. |
| `LH_SERVER_RESTARTED` | `1` after the shell restarted a crashed server. The first page then skips the welcome screen and shows the notice "godspeed restarted after a problem" in the strip's peek. |
| `LH_TERMINALS` | The desktop app's live terminal ids and the teacher's, `{"live":[…],"teacher":…}`. The shell's `terminals` message updates them. |
| `LH_PLUGIN_LIST` | Debug builds only: a file read as godspeed's plugin list, each time the list is asked for, in place of GitHub's (`npm run layout` names `tests/fixtures/plugins/layout-list.json`). |
| `GODSPEED_CONTRACT_NOW`, `GODSPEED_CONTRACT_CLOCK_FILE` | The contract suite's clock. |
| `CLAUDE_CONFIG_DIR`, `CODEX_HOME` | Read where the TypeScript read them. |

### Start-up and writes

- At start-up the server writes only a missing data folder, made empty so its lock is held from the start. The shell writes `mcp-endpoint.json`.
- With a shell, the deadline reminder check writes `reminders.json`: 10 seconds after start, then every 10 minutes.
- Reading `settings.json` can rewrite an old one or set aside one that does not parse.
- Data from before spaces were called spaces moves just before the first request that reaches an /api route (not a 404 or refused request): `data/classes` to `data/spaces`, and a saved `shared/12-class-context.md` to `12-space-context.md` (`Stores::adopt_old_names`).
- `class.json`, v1 chats and v2 settings are read in their old shape and written in the new one.

### One server per data folder

On Mac and Linux, an advisory lock on the data folder itself (no lock file) keeps a second server off the same data. A new server waits up to 3 s for one still stopping. Windows cannot lock a directory, so there the desktop app's single-instance check and old-app check do this job (`crates/server/src/data_lock.rs`).

### Stopping

- The server stops on SIGTERM or SIGINT (Ctrl-C on Windows), and at the end of stdin: always with `LH_SHELL=1`, otherwise when stdin is a pipe.
- `gs_base::shutdown::wait()` ends long waits (event streams, `wait_for_work`). Open requests get 2 s, then the process exits with 143.
- Log lines go to stderr; stdout belongs to the shell protocol.

### Shell protocol

With `LH_SHELL=1` the server speaks the line protocol of `gs-shell-rpc` ([tauri-shell/the-line-protocol.md](tauri-shell/the-line-protocol.md#the-line-protocol)). `App::shell` holds the `ShellLink`. `get_headless` sends demo runs and the SVGs resvg cannot draw through it and waits at most 60 s (`demo check timed out`). Without a link they answer the no-browser error.

### Login

`GET /api/desktop/login?token=<64 hex>` lets the desktop window in.

- A token the shell sent in `login` within the last 60 s (app clock) works once.
- It answers 303 to `/` with `Cache-Control: no-store` and `Set-Cookie: gs_desktop=<secret>; Path=/; HttpOnly; SameSite=Strict`.
- Anything else gets the access check's 403.

### Access

`http/access.rs` guards /api when a secret is set.

- Every /api path needs cookie `gs_desktop` equal to the secret and exactly one `Sec-Fetch-Site: same-origin`.
- Exempt: `/api/mcp`, `/api/mcp/forget`, `/api/mcp/compacting`, `/api/mcp/line` and `/api/mcp/agent-event` (each checks the bearer token in its route), and `/api/desktop/login`.
- Refusals are 403 `{"error":"Desktop API access requires the trusted godspeed window."}`.
- `LH_DESKTOP_SERVER=1` without a secret refuses all. Browser mode (neither set) allows all.

Demo iframes and plugin frames send `Sec-Fetch-Site: cross-site`, so their requests are refused even where WebKit attaches the cookie. `/plugin-files/` is outside /api, so a plugin frame loads its own files.

## Checking against the recordings

The contract lab replays recorded HTTP and MCP traffic from the last Node build against a server. It lives outside this repository, with its own README.

1. Build a release server: `cargo build --release -p gs-server`.
2. Run a scenario on it from the lab:

```sh
CONTRACT_SERVER_CMD="/bin/sh <lab>/contract/lib/rust-server.sh" CONTRACT_PORTS=48060-48069 node <lab>/contract/run.mjs check <scenario>
```

- Recordings hold only for a release server. A debug build keeps its own godspeed folder, answers the spaces-folder checks differently, and is too slow for some scenarios' timing.
- Each scenario gets its own copy of the seed data and its own home, tmp, Claude and Codex folders. The launcher stops the server afterwards.
- On failure the full result is in `out/<scenario>.actual.json`.
- **Never point a server at real data**, `~/godspeed`, `~/.claude`, `~/.codex` or a cloud-synced folder.

## Known gaps and decisions

- The server copies the Node server's recorded behaviour exactly, odd parts included (for example an empty 500 for a `null` JSON body). Fixing those is separate work.
- Range and conditional requests: the recordings show the Node server answers both with the full file (200), so the Rust server does too.
- Source marks read Markdown with the `markdown` crate (CommonMark plus math), whose code offsets match mdast-util-from-markdown's. A web mark is checked with the `url` crate in place of `URL.canParse`.
- Unicode's last 2048 private-use code points (U+10F800 to U+10FFFF) are the lone-surrogate stand-ins and cannot appear as real text.
- A mock's Run examples runs JavaScript with the computer's own `node` (PATH, then Homebrew's folders), since the desktop app has no Node. Without one it answers "godspeed couldn't find Node.js on this computer. Install Node.js, or answer in Python.". Python is found as Node is.
- Search vectors: if Rust's vectors do not match the stored ones exactly, the tables are rebuilt from saved text.
- PDFs read before the switch keep their saved text. Only new PDFs go through the Rust reader.
- ONNX Runtime's KleidiAI kernels stay on. Turning them off (`mlas.disable_kleidiai`) saved about 200 MB but changed the vectors by up to 0.014.
- The search model is dropped after 5 quiet minutes and loaded again on the next search (about 40 ms). On a Mac this frees about 15 MB; ONNX Runtime keeps the rest of its memory for the life of the process.
