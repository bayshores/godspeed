## 5. One chat turn

`handle_chat_input` (`services::turns::chat_handler`) is plain Rust over `App`. `AgentBuildOptions` is its test seam (scripted engines).

1. Window posts `{chatId, input}` to `POST /api/chat`. Input is one event: `text`, `answer`, `continue`, `side`, `next` (practice, study or homework), `teach` (homework with an open problem) or `opener-answer` (`core::messages::input_events`). `dismiss` and `dismiss-problem` are dismissals.
2. Handler turns input, or queued steers, into record appends.
3. `begin_turn(chatId)` registers turn in `turn_liveness` (in memory). A turn already running gives 409; window waits for it to end and posts same input again, giving up after 30 s.
4. `save_messages` writes input before anything streams (write-ahead).
5. Handler builds lesson agent from record.
6. Agent's events stream to window as SSE (`ui_stream`).
7. At turn end, `persist_turn` saves reply and `append_turn_usage` logs usage.
8. `trigger_extraction` checks coverage and starts background extraction if enough teacher prose is uncovered (§6).
9. `end_turn` runs last, on every path, so registry never stays locked.

### Question tools

`probe`, `quiz`, `ask_user_question`, `explain`, `recall` and `write_code`. The server only checks their input, and the call ends the turn. The "question posed" placeholder lives in memory, never saved.

1. Call streams to window; question shows in dock.
2. Learner answers. The window grades multiple choice with `question-core` and builds answer. A `write_code` answer (`code-question.ts`) is never run or graded by the app; teacher reads it.
3. Window posts it as an `answer` input event.
4. Server saves it as call's tool result and next turn runs.

A question waiting in the saved record lets a lesson resume mid-question. Options are shuffled with a seed (the tool call id), so server and window show the same order.

### Side questions

The lesson has one writing box at the foot of the teacher column (`LessonBox` in `src/frontend/components/lesson/lesson-box.tsx`; `lessonBox` in `lesson-box-model.ts` decides its buttons). While a question waits, a message from that box is a side question.

- It posts a `side` input event, refused unless a question waits. The server saves it as a user message with `side: true` (`new_side_question`, `core::messages::native_messages`). Pictures and PDFs are stored like any message's.
- Question stays open: `dangling_question_of` looks past side questions and their replies.
- `is_side_turn` marks reply turn. A job result arriving after side question ends it.
- A side turn keeps same tool list, so outside agent gets a small delta. Question tools, `problem` and `conclude` refuse (`side_turn_tools` in `agent::teacher::teacher_agent`). `plot` still draws, with no guess (see Plots).
- A side turn gets no `today-context` note and no job results (`services::turns::chat_handler`).
- A figure or demo finishing while a side question holds open question is written into lesson at once, with no turn (`show_held_artifacts` in `services::jobs`). The question stays open; teacher reads it with answer.
- In model's view question call gets a placeholder result at once, side question follows as a plain user message, and learner's later answer (or skip) arrives where it happened. Earlier model views stay a prefix of later ones.

### Open problems

In study, practice and homework lessons, the open problem fills the teacher column's Your turn area (`OpenProblemPane`, `src/frontend/components/lesson/open-problem-pane.tsx`), with no writing box of its own.

- Learner works in lesson's one box. Each message is a plain `text` input: work on problem or a question about it.
- A message never ends problem (`active_problem_of`). Only teacher's `conclude` or learner's discard does.
- Teacher may conclude one problem and pose the one learner asked for in same turn.
- While a problem is open, its card in the transcript is not drawn (`openProblem` in `ChatActionsContext`). The card appears once the problem closes.

Earlier lessons hold the learner's work as `practice-thinking` markers, which still read back (`projectView` in `src/shared/core/view.ts`, `to_llm_messages`).

### The plan tree

The agent writes a plan tree with `plan_init`: a mermaid-subset graph, parsed with line-numbered errors (`agent::tools::mermaid_plan`) and checked to be a DAG. A later `plan_init` call replaces the tree. Who writes it depends on the lesson:

| Lesson | Who writes the plan tree |
|---|---|
| Older teach lesson | the teacher, with `plan_init` after the probe |
| Study session on space topics | the app, when the lesson starts (§7) |
| Study session with no space topics | the agent, with `plan_init` in its first reply (§7) |

Progress is never written into the tree. Statuses (`current`, `visited`, upcoming) derive from tagged `quiz`, `explain` and `problem` calls in the transcript. The plan row (`src/frontend/components/lesson/plan-row.tsx`, steps from `src/shared/core/plan-step-bar.ts`) and plan blocks (`src/frontend/components/plan-block-model.ts`) draw that. The row names every step; a branching plan also gets a small map there that opens the plan dialog.

Older teach lessons start with a prober: `probe_done` files the assessment and queues a handoff steer; every later turn builds the teacher. Phases (`core::messages::phases`): probe, plan, teach.

### Job tools

`research`, `demo`, `visual` and `pdf` run on the server. Each acks at once so the teacher keeps teaching; the job runs in the background (`agent::tools::jobs`, `agent::subagents`) and its result returns through the wake pipeline (§5.1).

### Attachments

A learner message carries up to 5 pictures and PDFs: a lesson-box message (side questions included) or an `explain`, `recall` or `ask_user_question` answer (`answer_takes_files`, `core::messages::pending`).

| Rule | Value |
|---|---|
| Pictures | resized to long side max 1568 px, stored inline in message; 20 MB each |
| PDFs | saved in `data/chats/<id>/`, with a short note in message giving path; 30 MB each |
| Code | `core::messages::attachments`, `services::turns::attachments`, `src/frontend/components/lesson/attachment-tray.tsx` (button, tray, paste, drop) |

An answer's files go into the question call's tool result (`new_answer_result`), so model and work item get them like a message's. Files waiting in a lesson's box stay in memory per lesson until sent: leaving the lesson keeps them, a reload drops them, never localStorage.

### Space and date context

A space lesson starts with a `space-context` marker holding the space card (`services::spaces::space_card`). A hidden `today-context` marker gives the model today's date, time, time zone and the space's open deadlines. A new one is added before the learner's message when the day or deadlines changed, or compaction cut the last one out of view (`core::spaces::today_note`, `services::app::today_note`).

### Compaction

A lesson past 40,000 tokens (`compaction.thresholdTokens` in `factory_settings`, not a setting) is shortened between turns, so a turn never waits for a summary (`services::turns::compaction`).

1. Server cuts old part at once and writes its own short version without a model (`local_summary`, `core::session::compaction`).
2. After 5 quiet minutes outside agent writes real summary, replacing local one.

Accounting: [compaction-accounting.md](../compaction-accounting.md). Every call runs on the learner's own agent plan, so nothing has a dollar price; the app counts tokens only.

### When something fails

- Extraction failures stay inside extraction. Saving turn must not fail quietly: a failed input write refuses turn before any agent starts, and `persist_turn` fails on a failed reply write.
- Runner reports a settlement failure before `[DONE]` and releases liveness even then.
- If window attaches after a failed turn left registry, server keeps a small in-memory notice (`services::turns::turn_runs`). The next accepted turn, lesson deletion or server exit clears it. Nothing goes into saved transcript.
- Steer reconciliation reads saved record, so a later bookkeeping failure cannot replay saved learner input.
- Window never resends an answer blindly. Submit first checks saved record and whether a turn runs. A stream ending without a final event gets one read-only reattach; a second failure shows error banner.

### 5.1 The wake pipeline

A job's worker finishing and its result reaching the lesson are separate steps (`services::jobs`).

When a job finishes:

1. Runner saves result, worker status (`done` or `error`) and `delivery: {kind: "result", status: "pending"}` in one job-record update. The tool input was already saved at dispatch.
2. It queues a `subagent-steer` custom message with deterministic id `steer_<jobId>`: `content` is text for model, `details` full result for window.
3. Worker is released at once; its row leaves Background agents even if a waiting question holds result back. Dispatch cards say "finished", not "delivered".

Delivery:

1. Per-lesson queue holds one entry per steer id.
2. If a turn streams, markers are steered into live agent at its next turn boundary.
3. Otherwise pipeline waits until no turn runs and no question waits, then fires one wake turn carrying every pending marker through normal turn path. While it waits, a figure or demo is saved into lesson with no turn when a side question holds open question (`open_question_held`): answer then reaches model as a message, so nothing comes between a call and its result. A question open with no side question still holds it for answer.
4. A wake turn getting 409 retries with backoff 500, 1000, 2000, 5000 ms.
5. A wake turn failing to start otherwise leaves markers pending, with no error and no timer; they go out with learner's next turn or after a restart.
6. Delivery is complete only when marker is in saved conversation; seeing it stream is not enough.

Rules:

- A marker already in transcript is never delivered twice; a failed bookkeeping step cannot replay one.
- A record ending in a dismissal waits for learner's next message, which carries markers.
- `register_live_agent` restores pending deliveries from job records before a new agent's first steering poll, so a restart loses nothing.
- Only a computing worker can be aborted. An abort saves its own pending abort notice (`delivery: {kind: "abort"}`).
- Deleting a lesson drops its pending deliveries (`discard_chat_deliveries`). Only a live turn or computing worker blocks deletion.
- Jobs saved by older versions are normalized on read (`normalize_legacy_result`). All this runs on JSON stores and one in-process registry, not a transactional queue.

In the window, a wake turn is adopted like a turn in progress (`turnInFlight`); steers render as artifact cards, never chat bubbles.

Sub-agents check their work before delivering. The demo-builder runs its HTML in the shell's hidden web view. The visual-maker renders each SVG (resvg, or the shell's web view for SVGs resvg cannot draw) and looks at it, so the outside agent must accept images.
