## 10. Events and observability

Logging is one tagged line per event on stderr, for example `[chat <id>]` on turn services, `[extraction <id>]` on the pipeline, `[job <id>]` on runners.

The activity feed shows running work: `services::jobs::observability` feeds `GET /api/activity`, shown in the Activity list, which the Activity key in the teacher panel's head drops over its screen. It lists running jobs, extraction runs, deadline requests, recently failed jobs and per-run usage in tokens, then the teacher's recent changes (changes that read the same, one after another, are one row with a count) and what building the open space's graph took (`GET /api/graph/costs`). `POST /api/activity/abort` takes `{kind: "job" | "extraction" | "turn", id}`.

### 10.1 The events channel

The window learns of server changes by push, not polling, over one app-wide SSE channel, `GET /api/events`.

- Server side: the `Events` bus (`crates/base/src/events.rs`) and `server::http::events`.
- Window side: one EventSource per open window, in `src/frontend/components/server-events.tsx`, mounted around everything in `src/frontend/routes/root.tsx`. It is the only file that creates an EventSource.
- Server sends `: ping` every 25 s and ends stream only when window goes away or server stops.
- An event says only that something changed, plus a key like `chatId`; every consumer then fetches fresh data from normal endpoints.
- On reconnect each consumer refetches once, covering events the gap missed.
- Bus gives every subscriber its own unbounded queue, so a slow reader never blocks an emitter. A gone subscriber is dropped on next emit.

### 10.2 Event kinds

List: `EventKind` in `crates/base/src/events.rs`, mirrored in `src/shared/core/events.ts`.

| Event | Payload | Emitted when |
|---|---|---|
| `turn-started` | `{chatId}` | `begin_turn` succeeds, for every turn. The 409 path is silent |
| `turn-settled` | `{chatId}` | `end_turn` on a live entry, after `persist_turn`, so fetches read saved data |
| `jobs-changed` | `{chatId?}` | every job-store write that changed something |
| `activity-changed` | `{}` | an extraction run changed phase, a deadline request, space check, topic grouping or plugin question started or ended (`agent::extraction::extraction_runs`, `services::spaces::deadline_requests`, `services::spaces::space_checks`, `services::graph::topics`, `services::plugins::ask`) |
| `chats-changed` | `{}` | a lesson was created, renamed, moved to another space or deleted. The lesson list and the progress hook (`use-progress.tsx`) read it |
| `spaces-changed` | `{}` | a space was created, edited, closed or deleted, or its files changed |
| `record-changed` | `{chatId}` | a lesson record changed without a turn: a problem discard, Keep going at a stop, an answer to a question from earlier, a kept sentence's part dropped or brought back, an answer that leaves a sibling question open, or a finished compaction. The `keep-going`, `review` and `kept` routes also emit it during a turn |
| `agent-action` | action | a new line in activity log (`services::app::agent_actions`, saved in `data/agent-actions.json`) |
| `rules-changed` | `{saved?}` | a teaching rule was saved, undone or edited (`services::app::agent_rules`). `saved` carries the rule when the teacher saved it from the panel's chat |
| `mocks-changed` | `{spaceId}` | one of a space's mocks changed, or a request for one started or ended (`services::mocks`). A saved mock answer is silent |
| `files-added` | `{spaceId, files}` | a linked folder scan added files (`services::spaces::folder`). The window shows a notice |
| `files-removed` | `{spaceId, files}` | files a linked folder no longer holds were dropped with their facts (`services::spaces::folder`). The window shows a notice |
| `cheat-sheet-changed` | `{deadlineId}` | a cheat sheet's versions, chat or request changed (`services::cheat_sheets`) |
| `deadline-request-changed` | `{spaceId, deadlineId}` | a deadline request started or ended (`services::spaces::deadline_requests`) |
| `space-checked` | `{run, spaceId, agent, lines, said}` | a space check changed something: `lines` for the learner, `said` the agent's last line or null (`services::spaces::space_checks`) |
| `vault-notes-changed` | `{}` | the notes folder setting changed, or a note godspeed writes there was written, found again, marked removed or began waiting (`services::vault`) |
| `teacher-work` | `{}` | the teacher's round of work (a teacher panel chat's turn) began, gained a step or ended (`services::turns::turn_work`); the window reads it at `GET /api/teacher-work` |
| `lesson-work` | `{chatId}` | a lesson's running turn began, gained a step or a plan, or ended (`services::turns::turn_work`); the lesson's desk reads it at `GET /api/chats/{id}/work` |
| `agent-health` | `{}` | a check of the picked agent began or ended, or its sign-in started, ended or failed (`services::app::agent_health`, `agent_login`); the setup card reads it at `GET /api/agent/health` |
| `agent-update` | `{state, line, command}` | the picked agent's update started, printed a line (`running`), finished (`done`) or failed (`failed`, with its last line); `command` is what it runs (`services::app::agent_update`), which the setup card offers to copy |

### 10.3 Rules for emitters

- Emit after write succeeds, so a fetch triggered by event reads saved data.
- A change that changed nothing (update of a missing id, delete of an absent row) emits nothing.
- Content writers stay silent: `save_messages`, `append_turn_usage`, `append_extraction_usage`, `save_tree`. `save_messages` would fire on every turn save, and list-visible effects already arrive through `turn-started` and `turn-settled`. Tests pin this.
- Reads never emit.

### 10.4 Rules for consumers

- Handlers read refs (`localStreamRef`, `turnInFlightRef`, `statusRef`), never stale render state.
- On `turn-started`, a lesson ignores event when `localStreamRef.current` is held (its own turn just began) or it is already attached. Otherwise it attaches to running turn (`GET /api/chats/{id}/stream`).
- While attached, stream's final event settles turn. A `turn-settled` refetch (`syncFromServer`) would swap in a stale snapshot, so it is skipped. An error status detaches and refetches.
- A record read from the server goes through `useServerResource` (`src/frontend/components/use-server-resource.ts`): it names the events that read it again (with an optional test on the payload), reads again on reconnect, lets the newest read win and keeps the last value when a read fails. Each record has one owner in the window (a provider or one hook); other components read from it. The active space's progress is read once for the window (`ProgressProvider` in the app shell), as its record is (`ActiveSpaceRecordProvider`), so every page that shows them opens with them drawn.
- Bursty events coalesce into one fetch per window with a trailing debounce (`debounceMs`, or `useTrailing` in `src/frontend/lib/use-trailing.ts`): 250 ms for the lesson list and the activity feed, 400 ms for progress.
- Every consumer refetches once when channel opens or reopens.

### 10.5 What still polls

- Coverage block in lesson menu (`CoverageMenuBlock`, `src/frontend/components/extraction-coverage.tsx`) reads every 2 s while open, because events channel only reports extraction phases.
- The 409 retry (`session-core.ts`) polls every 500 ms while another turn runs and gives up after 30 s.
- The notes folder is looked at once a minute by the scanner (`vault::maintain::minute_check`), because files change outside godspeed; the window hears of a change by `vault-notes-changed`.
- Dock clock ticks every second (`use-now.ts`), no network.
- Mount fast paths stay: `initiallyInFlight`, mount-time `needsContinuation` check, and the `lh:chat-renamed` window event for instant same-tab updates.
