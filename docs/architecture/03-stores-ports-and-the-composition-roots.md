## 3. Stores, ports and the composition roots

One store per kind of data file, never one generic interface. `Stores` (`crates/store`) is built once in `App::new`; it holds settings, prompt overrides, agent notes, agent rules, activity log (agent actions), Tavily key (`search_key`), deadline reminders, vault notes (`vault_notes`, a damaged file is kept aside), jobs, graph ledgers (`GraphStores`, one `GraphStore` per graph folder), chats, spaces, cheat sheets, mocks.

Stores persist and shape-guard; they never merge, dedupe or derive (readers do, in core).

Two traits in `crates/core` let pure code work against storage: `GraphStore` and `ChatListing` (`core::graph::ports`; `core::graph::memory` is an in-memory test version). Every other store is a concrete type.

### How data is written

- Graph evidence: append-only JSONL ledgers. Reads skip corrupt lines; strict shape guards drop invalid lines instead of guessing.
- Chats, spaces, jobs, sources, agent notes, agent rules, activity log, settings: whole-file JSON, read, changed, written back.
- Every write uses atomic writers in `gs_base::fsx` (temp file, then rename).
- Every read-modify-write first takes a lock from `app.locks` (keys `Space`, `Chat`, `Graph`, `AppFile`); order and rules in [rust-server.md](../rust-server.md).
- Job store keeps parsed records in memory while a file's modified time and size are unchanged. `chat_version` on chat store gives a lesson's version likewise, so caches can key on it (graded answers in `services::graph::progress`, waiting-question check in `services::jobs::jobs`).

### The two composition roots

`App` (`crates/services/src/lib.rs`) is the root for storage and state. `App::new` builds the stores and holds `paths`, `events`, `locks`, `stores`, `pdf`, `search`, `agents` (the learner's agent program), one state struct per service area, and the shell link when the shell started the server. Routes and the agent's tools get an `Arc<App>`. `graph_store_for(app, scope)` (`services::graph::graph`) hands out one `GraphStore` per graph folder (§6.1).

`services::turns::chat_handler` is the root for a turn: wires stores, job runner, extraction pipeline and engine into it, and registers the wake pipeline's seams with `set_turn_runner` and `set_job_respawn`.

The agent layer takes dependencies as arguments, so tests inject the hosts production wires:

- `create_job_runner(host)` takes a `JobHost` (`agent::subagents::runner`), and every job takes a `JobAgent` (`agent::subagents::job_agent`), so tests run jobs on a stand-in agent.
- `prober_setup`, `teacher_setup` and the other lesson builders take `AgentBuildOptions`: prompts, tool switches, the learner's rules, optionally a tool registry.

### The engine

The learner's own agent (Claude Code or Codex, `gs_runtime`) is the only model. A lesson's turn runs on the lesson's session ([5.3](05.3-the-agent-session.md), `engine::turn::session_turn`) and a background job on a one-off session ([5.4](05.4-background-jobs.md), `engine::turn::job_session`). No model settings, no API keys; the agent uses its own default model.

Lesson records store the engine's own message shapes (`core::messages::native_messages`), so a turn replays the record directly. `to_llm_messages` turns app markers into model text and gives dangling tool calls an "interrupted" result. `engine::turn::ui_stream` streams the agent's events to the window as SSE; `engine::turn::call_ids` makes tool-call ids unique at that boundary.
