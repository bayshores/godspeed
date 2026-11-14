# The Rust server

`godspeed-server` is the Rust program behind the app. It serves the UI files, the /api routes and the MCP endpoint, and it reads and writes the data files. Read "Rules for every module" before you change it.

Data written by earlier versions, including the Node server that came before, keeps working, and the files the server writes read the same byte for byte.

## Layout

All Rust lives in `crates/`, a Cargo workspace with `Cargo.toml` at the repo root and the toolchain pinned in `rust-toolchain.toml`. A crate uses only crates listed above it in this table, and Cargo refuses a cycle. The desktop shell (`crates/shell`) is in [tauri-shell.md](tauri-shell.md).

| Crate | What it holds |
|---|---|
| `json` (gs-json) | `Json`: JSON with JS key order, JS number text, lone surrogates |
| `base` (gs-base) | JS-compatible text, numbers, dates, regex, sorting, ids, hashes, the app clock, paths, events, locks, atomic writes, shutdown |
| `core` (gs-core) | pure logic: `contracts`, `records`, `messages`, `session`, `graph`, `spaces`, `study`, `preps` |
| `shell-rpc` (gs-shell-rpc) | the line protocol between the server and the desktop shell |
| `store` (gs-store) | every data file, read and written byte for byte the way earlier versions did |
| `media` | image re-encoding, SVG to PNG, PNG fixes |
| `pdf` | pdfium on one thread: text, shape, search, page images |
| `files` | space files to text, linked folder walks, fingerprints |
| `search` | embedding model (ort), MiniSearch BM25+, fusion, index tables |
| `web` | web page to markdown, PDF downloads |
| `transcribe` | recordings to captions with brew's ffmpeg and whisper |
| `engine` | the turn loop and the work bridge to the outside agent |
| `agent` | prompts, lesson tools, file tools, background jobs, extraction |
| `services` | `App` (all server state) and the server's services |
| `server` (gs-server, binary `godspeed-server`) | the HTTP layer, the /api routes, the MCP endpoint |

Every package is named `gs-<crate>`.

## Rules for every module

### Records are `Json`, not structs

Data files and API bodies are `gs_json::Json` (`Null | Bool | Num(f64) | Str | Arr | Obj`). `Obj` keeps JS key order: array-index keys first in ascending order, then insertion order. Unknown fields survive a round trip.

- Index with `v["key"]`. A missing key reads as `Null`.
- Test with `truthy()` and build with `json!({...})`.
- `stringify`, `stringify_pretty(v, "\t")` and `parse` match `JSON.stringify` and `JSON.parse` exactly, number text included (`js_number`).
- Use a typed struct only inside one function, through `to_json` and `from_json`.

### Text is JS text

Rust `String`s may hold lone UTF-16 halves as stand-ins (`gs_json::lone`). JSON output writes them as `\udxxx` like `JSON.stringify`, and UTF-8 output writes U+FFFD.

Where a length or a slice is counted in UTF-16 units like JS (stored offsets, the screens), use `gs_base::text`: `len16`, `slice16`, `index_of16`, `cmp16`, `trim` with JS whitespace, `pad_start`. Never use `s.len()` for a JS `.length`.

### Regexes are JS regexes

Use `gs_base::re::Re::new(pattern, flags)` with the pattern as the screens' JS would write it. It runs on UTF-16 units, so `.` and `\w` behave like V8. Never use the `regex` crate.

### Numbers, dates, ids and sorting

| Need | Use |
|---|---|
| `Math.round`, `toFixed` (JS tie rule), base 36 | `num::math_round`, `num::to_fixed`, `num::base36` |
| ISO text, `Date.parse`, local time (`TZ`) | `time::iso`, `time::parse_date`, `time::local` |
| ids | `ids::uuid`, `ids::timed(prefix)` and friends, one per id shape |
| `localeCompare` | `locale::compare` (ICU, locale from `LC_ALL`, then `LC_MESSAGES`, then `LANG`) |
| `createHash` | `hash::sha256_text` |

### Time goes through the app clock

`clock::now_ms()` is the current time in ms. `clock::sleep(ms)` and `clock::sleep_until(t)` wait. The contract suite moves this clock (`GODSPEED_CONTRACT_NOW`, `GODSPEED_CONTRACT_CLOCK_FILE`), and a real-time timer would miss the jump.

`clippy.toml` refuses `SystemTime::now`, tokio's `sleep`, `sleep_until`, `interval` and `timeout`, `fs::write` and `stdout`. A repeating timer is a loop over `sleep_until(due)` with `due += period`.

### Files

- Write only with `fsx::write_atomic`, `fsx::write_text_atomic` or `fsx::write_atomic_pair`. Each writes a temp file `<name>.tmp-<8 hex>` and then renames it, like the `write-file-atomic` package.
- `write_atomic_pair` streams two files that go together and renames them only once both are written.
- Unreadable records go aside with `fsx::set_aside_corrupt`.
- Error texts the learner or the outside agent sees come from `fsx::node_error_message`, which spells libuv's messages as Node did (`ENOENT: no such file or directory, open '<path>'`).
- Directory and file order must not depend on the file system. Sort explicitly.

### No globals

Everything lives in `App` (`crates/services/src/lib.rs`): `paths`, `events`, `locks`, `stores`, `pdf`, `search`, `bridge`, `shell` and one state struct per service package. Routes and MCP tools get `Arc<App>`. State a service keeps lives in a field of its package's state struct, behind a `parking_lot::Mutex`.

### Events, errors and concurrency

- Emit an event with `app.events.emit(EventKind::X, json!({...}))`. The payload is the event minus `type`.
- A function that can fail returns `Result<T, String>`, or a small error enum when callers match on the kind.
- A route returns `Result<Response, Unhandled>`. `?` on any error answers an empty 500.
- A panic in a handler also answers an empty 500 and the server keeps running, but do not rely on it.
- Never hold a lock across `.await`. See [Locks](#locks).

### Tests

Every module gets unit tests. Route and MCP work is checked with the contract scenarios (see [Checking against the recordings](#checking-against-the-recordings)).

Where the output must equal what the original TypeScript produced (formatting, ranking, merging, texts), a golden case replays a recorded output. `crates/<crate>/tests/golden/<name>.json` holds the cases, and a Rust test in `crates/<crate>/tests/` replays them (see `crates/base/tests/golden.rs`). The `.json` files are recordings, not hand-written. Change one only when the behaviour is meant to change.

### Style and done

- Short files with one job, short comments that say why, no history or phase notes in comments, no dead code.
- No `unsafe`. The shell's platform modules are the only exception ([tauri-shell.md](tauri-shell.md#rules)).
- Workspace dependencies are listed in the root `Cargo.toml`. Indent with tabs.
- Done means `npm run rust:check` passes: cargo test, clippy with `-D warnings` (also with the shell's `screens` and `self-test` features) and cargo-machete.
- A dependency a crate does not use is removed, not ignored.

## What every module can use

- `gs_json`: `Json`, `Obj`, `json!`, `parse`, `stringify`, `stringify_pretty`, `js_number`, `quote`, `to_json`, `from_json`, `lone`.
- `gs_base`: `base64`, `clock`, `config` (`Paths`, `GraphFiles`, `resolve`, `VERSION`), `events` (`Events`, `EventKind`, `Event::sse_frame`), `fsx`, `hash`, `ids`, `locale`, `locks`, `num`, `posix`, `re`, `regexp`, `shutdown`, `text`, `time`.
- `gs_core`: `contracts::{chat, space, graph}` (ids, versions, guards, space icons, deadline sort, scope parsing) and the pure logic above them.
- `gs_store`: `Stores::new` with every store's constructor. `AgentSeenStore` implements `gs_core::records::agent_seen::SeenStore`.
- `gs_services`: `App::new(paths, shell)`.

### `gs_server::http`

The desktop access rule is covered by the `access` unit tests and `crates/server/tests/shell.rs`.

- `front` runs before routing. Backslashes, `//` and trailing slashes redirect 308 with the path as body, and `.`, `..` and `%2e` segments resolve. Then the desktop access check runs. A segment that will not decode answers Next's 500 page.
- `route::ApiRoute::new().get(h).post(h).put(h).delete(h).into_route()` builds one route path. Register every route with it. OPTIONS answers 204 with Next's sorted `Allow`, other methods an empty 405, HEAD runs GET without the body, and a panic answers an empty 500.
- `reply`: `json(status, &v)`, `json_no_store`, `text`, `empty`, `no_store`, `not_found`, `Unhandled`, `json_body(body)` (`await req.json()`, None where it throws), `read_body` (cut at 210 MiB like `proxyClientMaxBodySize`), `body_text`.
- `paths::search_params(query)` and `paths::param` read a query like `URLSearchParams`. `paths::decode_component` decodes one segment.
- `ui` serves `ui/` and `/pdfjs/*`. `events` is `GET /api/events`.

Handlers take axum extractors: `State<Arc<App>>`, `Path<String>` (or `Path<(String, String)>`), `Uri` for the query, `HeaderMap`, and `Body` last. Path params are decoded per segment like Next. Use the same param names on shared prefixes: `{id}` for a space or chat, `{deadline_id}`, `{file_id}`, `{section}`, `{*segment}`, `{n}`, `{file}`.

## Locks

Requests run in parallel, so every read-modify-write of a file takes a lock from `app.locks` (`gs_base::locks`).

| Key | Covers |
|---|---|
| `LockKey::Space(id)` | a space record, its files and cheat sheets |
| `LockKey::Chat(id)` | a lesson or Talk record and its folder |
| `LockKey::Graph(scope)` | one graph family; `None` is "No space" |
| `LockKey::AppFile(name)` | one file under data/, like `"settings.json"` or `"agent-notes.json"` |

### Order

- Take at most one lock, or several in this order: space, then chat, then graph, then app file.
- Several of one kind go in id order. A space delete holds each of its lessons.
- Of two app files, `settings.json` comes first. Reading settings takes its lock, so code holding another app file must not read settings unless it took `settings.json` before.
- Locks are re-entrant on one thread, so a store may take the lock its caller already holds.
- A read that saves on the side while its caller may hold a later lock uses `try_lock`. When the lock is taken it leaves the save to a later read (a space's first color, `SpaceStore::get_space`).

### Holding a lock

- The guard is not `Send`. Hold it only in synchronous code.
- Read, change and write inside the guard. Do slow work (PDF, model, network, agent) outside, and check again after taking the lock again, as after any wait.
- A store method that does its own read-modify-write takes the lock itself. A service that reads a record, decides, then writes takes the lock around all of it.

### Lessons and spaces

- A turn begins under its lesson's lock (the write-ahead), and an extraction reads its lesson under it. So a check that no turn or extraction runs, made under that lock, holds until the lock is let go.
- Deleting or moving a lesson checks again under the lock after waiting out its work (`rewrite_blocker`).
- A lesson enters a space (created in it or moved to it) under the space's lock. A space delete holds that lock, so the delete sees every lesson in the space.

## The server process

### Working directory and files

- The server starts with its working directory beside `ui/`, `models/` (`Snowflake/snowflake-arctic-embed-xs`) and `pdfjs-dist/` (`Paths::resources`).
- pdfium's library sits there too (package pdf decides the file name), unless `LH_PDFIUM_PATH` names the library file. The Mac app keeps it in `Contents/Frameworks`, where the bundler signs it.
- `scripts/fetch-pdfium.mjs` downloads the pinned library into `.stage/`.
- A debug build (`cargo build`) keeps the godspeed folder in `<data>/godspeed-folder` until the learner picks one, so a dev run never rewrites the real `~/godspeed`. A release build uses `~/godspeed`.
- The app version is package.json's, baked in at build time (`config::VERSION`).

### Environment

| Variable | Meaning |
|---|---|
| `PORT` | The port. The bind is always 127.0.0.1. Defaults to 3000. |
| `LH_DATA_DIR` | The data folder. Unset, `data/` in the working directory. |
| `HOME`, `TMPDIR`, `TZ` | The home folder, the temp folder and the time zone. |
| `LH_DESKTOP_SERVER`, `LH_DESKTOP_API_SECRET` | `1` and the window's secret, set by the shell. See [Access](#access). |
| `LH_SHELL` | `1` when the desktop shell started the server. Turns on the line protocol. |
| `LH_PDFIUM_PATH` | pdfium's library file, when it is not in the working directory. |
| `LH_SERVER_RESTARTED` | `1` after the shell restarted a crashed server. The welcome screen then shows the "restarted" notice. |
| `GODSPEED_CONTRACT_NOW`, `GODSPEED_CONTRACT_CLOCK_FILE` | The contract suite's clock. |
| `CLAUDE_CONFIG_DIR`, `CODEX_HOME` | Read where the TypeScript read them. |

### Start-up and writes

- At start-up the server writes nothing but a missing data folder, made empty so its lock is held from the start. The shell writes `mcp-endpoint.json`.
- With a shell, the deadline reminder check writes `reminders.json`: 10 seconds after the start, then every 10 minutes.
- Reading `settings.json` can rewrite an old one or set aside one that does not parse.
- Data from before spaces were called spaces moves just before the first request that reaches an /api route (not a 404 or a refused request): `data/classes` to `data/spaces`, and a saved `shared/12-class-context.md` to `12-space-context.md` (`Stores::adopt_old_names`).
- `class.json`, v1 chats and v2 settings are read in their old shape and written in the new one.

### One server per data folder

On Mac and Linux, an advisory lock on the data folder itself keeps a second server off the same data, with no lock file. A new server waits up to 3 s for one that is still stopping. Windows cannot lock a directory, so there the desktop app's single-instance check and old-app check do this job (`crates/server/src/data_lock.rs`).

### Stopping

- The server stops on SIGTERM or SIGINT (Ctrl-C on Windows), and at the end of stdin: always with `LH_SHELL=1`, otherwise when stdin is a pipe.
- `gs_base::shutdown::wait()` ends long waits (event streams, `wait_for_work`).
- Open requests get 2 s, then the process exits with 143.
- Log lines go to stderr. stdout belongs to the shell protocol.

### Shell protocol

With `LH_SHELL=1` the server speaks the line protocol of `gs-shell-rpc`, which [tauri-shell.md](tauri-shell.md#the-line-protocol) spells out. `App::shell` holds the `ShellLink`. `get_headless` sends demo runs and the SVGs resvg cannot draw through it and waits at most 60 s (`demo check timed out`). Without a link they answer the no-browser error.

### Login

`GET /api/desktop/login?token=<64 hex>` lets the desktop window in.

- A token the shell sent in `login` within the last 60 s (app clock) works once.
- It answers 303 to `/` with `Cache-Control: no-store` and `Set-Cookie: gs_desktop=<secret>; Path=/; HttpOnly; SameSite=Strict`.
- Anything else gets the access check's 403.

### Access

`http/access.rs` guards /api when a secret is set.

- Every /api path needs cookie `gs_desktop` equal to the secret and exactly one `Sec-Fetch-Site: same-origin`.
- Exempt: `/api/mcp`, `/api/mcp/forget` and `/api/mcp/compacting` (each checks the bearer token in its route), and `/api/desktop/login`.
- Refusals are 403 `{"error":"Desktop API access requires the trusted godspeed window."}`.
- `LH_DESKTOP_SERVER=1` without a secret refuses them all.
- Browser mode (neither set) allows everything.

Demo iframes in the window send `Sec-Fetch-Site: cross-site`, so their requests are refused even where WebKit attaches the cookie.

## Checking against the recordings

The contract lab replays recorded HTTP and MCP traffic from the last Node build against a server. It lives outside this repository, with its own README.

1. Build a release server: `cargo build --release -p gs-server`.
2. Run a scenario on it from the lab:

```sh
CONTRACT_SERVER_CMD="/bin/sh <lab>/contract/lib/rust-server.sh" CONTRACT_PORTS=48060-48069 node <lab>/contract/run.mjs check <scenario>
```

- The recordings hold only for a release server. A debug build keeps its own godspeed folder, answers the spaces-folder checks differently, and is too slow for the timing in some scenarios.
- Each scenario gets its own copy of the seed data and its own home, tmp, Claude and Codex folders. The launcher stops the server afterwards.
- On a failure the full result is in `out/<scenario>.actual.json`.
- **Never point a server at real data**, `~/godspeed`, `~/.claude`, `~/.codex` or a cloud-synced folder.

## Known gaps and decisions

- The server copies the Node server's recorded behaviour exactly, odd parts included (for example an empty 500 for a `null` JSON body). Fixing those is separate work.
- Range and conditional requests: the recordings show the Node server answers both with the full file (200), so the Rust server does too.
- Source marks read Markdown with the `markdown` crate (CommonMark plus math), whose code offsets match mdast-util-from-markdown's. A web mark is checked with the `url` crate in place of `URL.canParse`.
- Characters in Unicode's last 2048 private-use code points (U+10F800 to U+10FFFF) are the lone-surrogate stand-ins and cannot appear as real text.
- A mock's Run examples runs JavaScript with the computer's own `node` (PATH, then Homebrew's folders), since the desktop app has no Node of its own. Without one it answers "godspeed couldn't find Node.js on this computer. Install Node.js, or answer in Python.". Python is found as Node finds it.
- Search vectors: if Rust's vectors do not match the stored ones exactly, the tables are rebuilt from saved text.
- PDFs read before the switch keep their saved text. Only new PDFs go through the Rust reader.
- ONNX Runtime's KleidiAI kernels stay on. Turning them off (`mlas.disable_kleidiai`) saved about 200 MB but changed the vectors by up to 0.014.
- The loaded search model keeps about 190 MiB after its first use. Dropping it when idle would cost a reload on the next search.
