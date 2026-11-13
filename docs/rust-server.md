# The Rust server

`godspeed-server` is the Rust program behind the app: it serves the UI files, the /api routes and the MCP endpoint, and it reads and writes the data files. Data written by earlier versions (including the Node server that came before) keeps working, and the files it writes read the same byte for byte.

This page is for whoever changes it. Read "Rules for every module" before writing code.

## Layout

All Rust lives in `crates/` (a Cargo workspace; `Cargo.toml` at the repo root, toolchain pinned in `rust-toolchain.toml`). Lower crates never import higher ones. The desktop shell (`shell`, `shell-rpc`) is described in [tauri-shell.md](tauri-shell.md).

| Crate | What it holds |
|---|---|
| `json` (gs-json) | `Json`: JSON with JS key order, JS number text, lone surrogates |
| `base` (gs-base) | JS-compatible text, numbers, dates, regex, sorting, ids, hashes, the app clock, paths, events, locks, atomic writes, shutdown |
| `core` (gs-core) | pure logic: `contracts`, `records`, `messages`, `session`, `graph`, `spaces`, `study`, `preps` |
| `store` (gs-store) | every data file, read and written byte for byte the way earlier versions did |
| `files` | space files to text, linked folder walks, fingerprints |
| `pdf` | pdfium on one thread: text, shape, search, page images |
| `search` | embedding model (ort), MiniSearch BM25+, fusion, index tables |
| `media` | image re-encoding, SVG to PNG, PNG fixes |
| `web` | web page to markdown, PDF downloads |
| `transcribe` | recordings to captions with brew's ffmpeg and whisper |
| `engine` | the turn loop and the work bridge to the outside agent |
| `agent` | prompts, lesson tools, file tools, helper jobs, extraction |
| `services` | `App` (all server state) and the server's services |
| `server` (gs-server, binary `godspeed-server`) | the HTTP layer, the /api routes, the MCP endpoint |

## Rules for every module

**Records are `Json`, not structs.** Data files and API bodies are `gs_json::Json` (`Null | Bool | Num(f64) | Str | Arr | Obj`). `Obj` keeps JS key order (array-index keys first, ascending, then insertion order) and unknown fields survive a round trip. Index with `v["key"]` (missing reads as `Null`), test with `truthy()`, build with `json!({...})`. `stringify`, `stringify_pretty(v, "\t")` and `parse` match `JSON.stringify` / `JSON.parse` exactly, number text included (`js_number`). Use a typed struct only inside one function, through `to_json` / `from_json`.

**Text is JS text.** Rust `String`s may hold lone UTF-16 halves as stand-ins (`gs_json::lone`); JSON output writes them as `\udxxx` like `JSON.stringify`, UTF-8 output writes U+FFFD. Where a length or a slice is counted in UTF-16 units like JS (stored offsets, the screens), use `gs_base::text` (`len16`, `slice16`, `index_of16`, `cmp16`, `trim` with JS whitespace, `pad_start`). Never `s.len()` for a JS `.length`.

**Regexes are JS regexes.** Use `gs_base::re::Re::new(pattern, flags)` with the pattern as the screens' JS would write it (it runs on UTF-16 units, so `.` and `\w` behave like V8). Never the `regex` crate.

**Numbers, dates, ids, sorting.** `num::math_round`, `num::to_fixed` (JS tie rule), `num::base36`; `time::iso`, `time::parse_date` (`Date.parse`), `time::local` (the machine's zone, `TZ`); `ids::uuid`, `ids::timed(prefix)` and friends for each id shape; `locale::compare` for `localeCompare` (ICU, locale from `LC_ALL` > `LC_MESSAGES` > `LANG`). `hash::sha256_text` hashes like `createHash`.

**Time goes through the app clock.** `clock::now_ms()` is the current time in ms; `clock::sleep(ms)` / `clock::sleep_until(t)` wait. The contract suite moves this clock (`GODSPEED_CONTRACT_NOW`, `GODSPEED_CONTRACT_CLOCK_FILE`), so a real-time timer would miss the jump. `clippy.toml` refuses `SystemTime::now`, tokio's `sleep`/`interval`/`timeout` and `fs::write`. A repeating timer is a loop over `sleep_until(due)`, `due += period`.

**Files.** Write only with `fsx::write_atomic` / `fsx::write_text_atomic` / `fsx::write_atomic_pair` (temp file `<name>.tmp-<8 hex>` then rename, like the `write-file-atomic` package; the last streams two files that go together and renames them only once both are written). Unreadable records go aside with `fsx::set_aside_corrupt`. Error texts the user or agent sees come from `fsx::node_error_message`, which spells libuv's messages, as Node did (`ENOENT: no such file or directory, open '<path>'`). Directory and file order must not depend on the file system: sort explicitly.

**No globals.** Everything lives in `App` (`crates/services/src/lib.rs`): `paths`, `events`, `locks`, `stores`, `pdf`, `search`, `bridge` and one state struct per service package. Routes and MCP tools get `Arc<App>`. State a service keeps lives in a field of its package's state struct, behind a `parking_lot::Mutex`.

**Events.** `app.events.emit(EventKind::X, json!({...}))`. The payload is the event minus `type`.

**Errors.** A function that can fail returns `Result<T, String>` (or a small error enum when callers match on the kind). A route returns `Result<Response, Unhandled>`; `?` on any error answers an empty 500. A panic in a handler also answers an empty 500 and the server keeps running, but do not rely on it.

**Concurrency.** See "Locks" below. Never hold a lock across `.await`.

**Tests.** Every module gets unit tests. Where the output must equal what the original TypeScript produced (formatting, ranking, merging, texts), a golden case replays a recorded output: `crates/<crate>/tests/golden/<name>.json` holds the cases and a Rust test in `crates/<crate>/tests/` replays them (see `crates/base/tests/golden.rs`). The `.json` files are recordings, not hand-written: change one only when the behaviour is meant to change. Route and MCP work is checked with the contract scenarios (below).

**Style.** Short files with one job, short comments that say why, no history or phase notes in comments, no dead code, no `unsafe`, workspace dependencies are listed in the root `Cargo.toml`. Tabs.

**Done means** `npm run rust:check` passes (cargo test, clippy with `-D warnings`, cargo-machete). A dependency a crate does not use is removed, not ignored.

## What every module can use

- `gs_json`: `Json`, `Obj`, `json!`, `parse`, `stringify`, `stringify_pretty`, `js_number`, `quote`, `to_json`, `from_json`, `lone`.
- `gs_base`: `clock`, `config` (`Paths`, `GraphFiles`, `resolve`, `VERSION`), `events` (`Events`, `EventKind`, `Event::sse_frame`), `fsx`, `hash`, `ids`, `locale`, `locks`, `num`, `re`, `shutdown`, `text`, `time`.
- `gs_core`: `contracts::{chat, space, graph}` (ids, versions, guards, space icons, deadline sort, scope parsing) and the pure logic above them.
- `gs_store`: `Stores::new` with every store's constructor; `AgentSeenStore` implements `gs_core::records::agent_seen::SeenStore`.
- `gs_services`: `App::new(paths, shell)`.
- `gs_server::http` (the desktop access rule is covered by the `access` unit tests and `tests/shell.rs`):
  - `front` runs before routing: backslashes, `//` and trailing slashes redirect 308 with the path as body; `.`/`..`/`%2e` segments resolve; then the desktop access check (`access`), then a segment that will not decode answers Next's 500 page.
  - `route::ApiRoute::new().get(h).post(h).put(h).delete(h).into_route()` builds one route path: OPTIONS answers 204 with Next's sorted `Allow`, other methods an empty 405, HEAD runs GET without the body, a panic answers an empty 500. Register every route with it.
  - `reply`: `json(status, &v)`, `json_no_store`, `text`, `empty`, `no_store`, `not_found`, `Unhandled`, `json_body(body)` (`await req.json()`, None where it throws), `read_body` (cut at 210 MB like `proxyClientMaxBodySize`), `body_text`.
  - `paths::search_params(query)` and `paths::param` read a query like `URLSearchParams`; `paths::decode_component`.
  - `ui` serves `ui/` and `/pdfjs/*`; `events` is `GET /api/events`.
- Handlers take axum extractors: `State<Arc<App>>`, `Path<String>` (or `Path<(String, String)>`), `Uri` for the query, `HeaderMap`, and `Body` last. Path params are decoded per segment like Next. Use the same param names on shared prefixes: `{id}` for a space or chat, `{deadline_id}`, `{file_id}`, `{section}`, `{*segment}`, `{n}`, `{file}`.

## Locks

Requests run in parallel, so every read-modify-write of a file takes a lock from `app.locks` (`gs_base::locks`):

- Keys: `LockKey::Space(id)` (a space record, its files and cheat sheets), `Chat(id)` (a lesson or Talk record and its folder), `Graph(scope)` (one graph family, `None` is "No space"), `AppFile(name)` (one file under data/, like `"settings.json"` or `"agent-notes.json"`).
- Take at most one, or several in this order: space, then chat, then graph, then app file. Several of one kind go in id order (a space delete holds each of its lessons). Of two app files, `settings.json` comes first: reading settings takes its lock, so code holding another app file must not read settings unless it took `settings.json` before. Locks are re-entrant on one thread, so a store may take the lock its caller already holds. A read that saves on the side while its caller may hold a later lock uses `try_lock` and leaves the save to a later read when the lock is taken (a space's first color, `SpaceStore::get_space`).
- A turn begins under its lesson's lock (the write-ahead), and an extraction reads its lesson under it, so a check that no turn or extraction runs, made under that lock, holds until the lock is let go. Deleting or moving a lesson checks again under it after waiting out its work (`rewrite_blocker`). A lesson enters a space (created in it or moved to it) under the space's lock, which a space delete holds, so the delete sees every lesson in the space.
- The guard is not `Send`: hold it only in synchronous code. Read, change and write inside the guard; do slow work (PDF, model, network, agent) outside and re-check after taking the lock again, as after any wait.
- A store method that does its own read-modify-write takes the lock itself. A service that reads a record, decides, then writes takes the lock around all of it.

## The server process

- Started with its working directory beside `ui/`, `models/` (`Snowflake/snowflake-arctic-embed-xs`) and `pdfjs-dist/` (`Paths::resources`). pdfium's library also goes there (package pdf decides the file name), unless `LH_PDFIUM_PATH` names the library file: the Mac app keeps it in `Contents/Frameworks`, where the bundler signs it. `scripts/fetch-pdfium.mjs` downloads the pinned library into `.stage/`.
- A debug build (`cargo build`) keeps the godspeed folder in `<data>/godspeed-folder` until the learner picks one, so a dev run never rewrites the real `~/godspeed`. A release build uses `~/godspeed`.
- Env: `PORT` (bind is always 127.0.0.1), `LH_DATA_DIR` (unset: `data/` in the working directory), `HOME`, `TMPDIR`, `TZ`, `LH_DESKTOP_SERVER=1` + `LH_DESKTOP_API_SECRET` in the app, `LH_SHELL=1` when the desktop shell started it, `GODSPEED_CONTRACT_NOW` / `GODSPEED_CONTRACT_CLOCK_FILE` in tests. `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are read where the TS reads them.
- Writes nothing at start-up but a missing data folder, made empty so its lock is held from the start (the shell writes `mcp-endpoint.json`). Data from before spaces were called spaces moves just before the first request that reaches an /api route (not on a 404 or a refused request), as Node moved it when a route first loaded the store modules: `data/classes` to `data/spaces` and a saved `shared/12-class-context.md` to `12-space-context.md` (`Stores::adopt_old_names`); `class.json`, v1 chats and v2 settings are read in their old shape and written in the new one. An advisory lock on the data folder itself keeps a second server off the same data (no lock file); a new server waits up to 3 s for one that is still stopping.
- Stops on SIGTERM or SIGINT, and at the end of stdin: always with `LH_SHELL=1`, otherwise when stdin is a pipe. `gs_base::shutdown::wait()` ends long waits (event streams, `wait_for_work`); open requests get 2 s, and the process exits with 143.
- Log lines go to stderr. stdout belongs to the shell protocol (clippy `print_stdout` is denied).
- **Shell protocol** (`LH_SHELL=1`, crate `gs-shell-rpc`, spelled out in docs/tauri-shell.md section 2): one JSON object per line, `t` naming it. stdout: `ready` once right after the bind, `login_ok`, and `demo` / `svg` requests; stdin: `login`, `demo_done`, `svg_done`. Bad or unknown lines are logged and skipped. `App::shell` holds the `ShellLink`; `get_headless` sends demo runs and SVGs resvg cannot draw through it and waits at most 60 s (`demo check timed out`). Without a link they answer the no-browser error.
- **Login** `GET /api/desktop/login?token=<64 hex>`: a token the shell sent in `login` within the last 60 s (app clock) works once and answers 303 to `/` with `Cache-Control: no-store` and `Set-Cookie: gs_desktop=<secret>; Path=/; HttpOnly; SameSite=Strict`. Anything else gets the access check's 403.
- **Access** (`http/access.rs`): with a secret, every /api path except `/api/mcp`, `/api/mcp/forget`, `/api/mcp/compacting` (bearer token in the route) and `/api/desktop/login` needs cookie `gs_desktop` equal to the secret and exactly `Sec-Fetch-Site: same-origin`; refusals are 403 `{"error":"Desktop API access requires the trusted godspeed window."}`. `LH_DESKTOP_SERVER=1` without a secret refuses them all. Browser mode (neither set) allows everything.
- The app version is package.json's, baked in at build time (`config::VERSION`).

## Checking against the recordings

The contract lab replays recorded HTTP and MCP traffic from the last Node build against a server. It lives outside this repository, with its own README. Build a release server, then run a scenario on it from the lab:

```sh
cargo build --release -p gs-server
CONTRACT_SERVER_CMD="/bin/sh <lab>/contract/lib/rust-server.sh" CONTRACT_PORTS=48060-48069 node <lab>/contract/run.mjs check <scenario>
```

The recordings hold only for a release server: a debug build keeps its own godspeed folder (see above) and answers the spaces-folder checks differently, and it is too slow for the timing in some scenarios. Each scenario gets its own copy of the seed data and its own home, tmp, Claude and Codex folders, and the launcher stops the server afterwards. On a failure the full result is in `out/<scenario>.actual.json`. Never point a server at real data, `~/godspeed`, `~/.claude`, `~/.codex` or a cloud-synced folder.

## Known gaps and decisions

- Range and conditional requests: the recordings show today's server answers both with the full file (200), so the Rust server does too.
- Demo checking (headless.ts) ran JavaScript in Electron's browser service through puppeteer. The Rust server asks the desktop shell instead (the shell protocol above); a server without the shell answers the no-browser error.
- Source marks read Markdown with the `markdown` crate (CommonMark plus math), whose code offsets match mdast-util-from-markdown's, and check a web mark with the `url` crate in place of `URL.canParse`. 
- Characters in Unicode's last 2048 private-use code points (U+10F800 to U+10FFFF) are the lone-surrogate stand-ins and cannot appear as real text.
- A mock's Run examples runs JavaScript with the computer's own `node` (PATH, then Homebrew's folders), since the desktop app has no Node of its own; without one it answers "godspeed couldn't find Node.js on this computer. Install Node.js, or answer in Python.". Python is found as Node finds it.
- Search vectors: if Rust's vectors do not match the stored ones exactly, the tables are rebuilt from saved text.
