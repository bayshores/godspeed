## 5. One chat turn

`handle_chat_input` (`services::turns::chat_handler`) is plain Rust over `App`. Tests run lessons on gs-runtime's `FakeAgent` (`services::app::agents::use_runtime`, the `stand-in` feature).

1. Window posts `{chatId, input}` to `POST /api/chat`. Input is one event: `text`, `answer`, `continue`, `side`, `next` (practice, study or homework), `open` (a homework problem picked by number) or `opener-answer` (`core::messages::input_events`). `dismiss-problem` is the only dismissal: it discards an open problem and never starts a turn.
2. Handler turns input, or queued steers, into record appends.
3. `begin_turn(chatId)` registers turn in `turn_liveness` (in memory). A turn already running gives 409; window waits for it to end and posts same input again, giving up after 30 s.
4. `save_messages` writes input before anything streams (write-ahead).
5. Handler builds the turn's instructions and tools from the record (`lesson_setup`) and runs the turn on the lesson's agent session (`SessionTurn`, see below).
6. The turn's events stream to window as SSE (`ui_stream`): each piece of the reply as it is written, at most every 100 ms.
7. At turn end, `persist_turn` saves reply and `append_turn_usage` logs usage.
8. `trigger_extraction` checks coverage and starts background extraction if enough teacher prose is uncovered (§6).
9. `end_turn` runs last, on every path, so registry never stays locked.

### The agent session

Each lesson runs on its own session of the learner's agent: §5.3, [05.3-the-agent-session.md](05.3-the-agent-session.md).

### Question tools

`probe`, `quiz`, `ask_user_question`, `explain`, `recall` and `write_code`. The server only checks their input, and the call ends the turn. The "question posed" placeholder lives in memory, never saved.

1. Call streams to window; question shows in dock at once, a check like any other question.
2. Learner answers. The window grades multiple choice with `question-grading.ts` and builds answer. A `write_code` answer (`code-question.ts`) is never run or graded by the app; teacher reads it.
3. Window posts it as an `answer` input event.
4. Server saves it as call's tool result and next turn runs.

Skip question sends the same `answer` with `dismissed: true` (`dismissedAnswer`), after stopping a running reply; the teacher moves on without asking it again.

In the lesson text an answered question is one line on a plate (`AnsweredCard`, `src/frontend/components/answered-card.tsx`): the verdict chip (`ResultChip` on `ResultTag`: Right, Wrong, Didn't know; none on a prediction or an ask), the question cut to one line, what the learner picked or wrote, and a chevron. Under the line a prediction names the right answer when he missed, and a plot guess what the line gives (`guessResultLine`). A click on the line opens the rest: the question whole, its kind ("Quiz, sure 4 of 5"), his written answer or code, and on a quiz the options with the right one marked, its explanation and his thinking. A skipped question is one quiet line, "Skipped:" and the question. The card is drawn where the learner answered, under anything said since the question was asked (`projectView` in `src/shared/core/view.ts`), so the teacher's reply to the answer has it right above; a step's first question, which godspeed asks from `topic_done`'s opener, leaves its lead-in where the step began and draws its card at the `opener-answer` marker. An older saved answer may carry `readingThinking`, thoughts noted while reading; it is not drawn and not sent to the teacher.

A question waiting in the saved record lets a lesson resume mid-question. Options are shuffled with a seed (the tool call id), so server and window show the same order.

### Side questions

The lesson page (the step line, the lesson text, the turn, the writing row and where the page rests) is §5.2, [05.2-the-lesson-page.md](05.2-the-lesson-page.md). The writing row's field and its keys come from `lessonBox` (`lesson-box-model.ts`):

| What waits | The field reads | Keys |
|---|---|---|
| A question with choices | Your reasoning or a question | Ask (teacher's name), Submit answer |
| A question answered in words | An answer or a question | Ask (teacher's name), Submit answer |
| An open problem | Your work or a question | Send |
| Nothing | Your question | Ask (teacher's name) |
| Nothing, while the teacher writes | Tell (teacher's name) what to focus on | Send |
| A "My words" ask at the lesson's end | One or two sentences | Done for today, Skip, Save |

One key is bright, the one Enter presses: Submit answer, or the ask key under choices while nothing is picked, or the ask or Send key when it is the only one and no next key ends the row, or Save once the words can be saved. The field is one line tall and grows with its text to five lines. `sendBox` in `chat.tsx` sends through `sendLine`: the line steers a reply being written (a steer carries no files, so files wait), is a side question while a question waits, or is the next message. The "Give me a hint" and "Explain it simpler" keys send those words the same way. "I don't know" answers the question: `dontKnow: true`, or for `ask_user_question` the words as its answer (`dontKnowRequest`).

- A side question is the field's words sent with its ask key while a question waits. Enter asks only under a question with choices while nothing is picked; with a pick Enter submits and the words are the reasoning.
- It posts a `side` input event, refused unless a question waits. The server saves it as a user message with `side: true` (`new_side_question`, `core::messages::native_messages`). Pictures and PDFs are stored like any message's.
- Question stays open: `dangling_question_of` looks past side questions and their replies.
- `is_side_turn` marks reply turn. A job result arriving after side question ends it.
- A side turn keeps same tool list, so the agent's session keeps its tools. Question tools, `problem` and `conclude` refuse (`ToolHost::refuse`, set in `agent::teacher::teacher_agent`). `plot` still draws, with no guess (see Plots).
- A side turn gets no `today-context` note and no job results (`services::turns::chat_handler`).
- A demo finishing while a side question holds open question is written into lesson at once, with no turn (`show_held_artifacts` in `services::jobs`). The question stays open; teacher reads it with answer.
- In model's view question call gets a placeholder result at once, side question follows as a plain user message, and learner's later answer (or skip) arrives where it happened. Earlier model views stay a prefix of later ones.

### Open problems

In study, practice and homework lessons, the open problem lies on a plate in the turn, over the writing row or pinned over the lesson text (`OpenProblemPane`, `src/frontend/components/lesson/open-problem-pane.tsx`; §5.2), with no field of its own.

- Learner works in the lesson's one field, in the writing row. Each message is a plain `text` input: work on the problem. The field reads "Your work or a question": a question about the problem is the same kind of message. The three "Stuck?" keys send their words as such a message.
- A choice problem carries `options` (2 to 8 labels) and `multiSelect` on its `problem` call (`problem_choice_fields`, `problem_choice_problems`: the pose is refused with fewer, more, an empty label, or `multiSelect` alone; the statement never lists the choices). The open problem shows them as lettered rows under the statement (`ProblemChoiceRows`), the same rows and keys as a quiz (`ChoiceRows`, `useChoiceKeys`). Picks are kept per problem in the lesson draft, like the field's text, and clear on Send. Send is open with a pick or work. The message is `I picked A and C.` (`problemMessage`), then a blank line and the work when there is any. Nothing is graded: the teacher reads the letters like any other work. The transcript card keeps the choices as a lettered list.
- A message never ends problem (`active_problem_of`). Only teacher's `conclude` or learner's discard does.
- Teacher may conclude one problem and pose the one learner asked for in same turn.
- While a problem is open, its card in the transcript is not drawn (`inTurn` in `ChatActionsContext`). The card appears once the problem closes, its statement with no label above it (`ProblemCard`, `src/frontend/components/practice-cards.tsx`).
- The conclusion's card (`ConcludeCard`) heads with the outcome as the answered card's small chip (`ResultTag`: Solved, Solved with hints, Moved on, Surrendered), then the verdict, then the model solution. A problem the teacher moved on from starts with its solution folded behind Show solution.
- Concluding shows the model solution at once, so the teacher never concludes while parts it will still ask remain; it asks them first and concludes after the last (`conclude`'s description, `prompts/practice/00-base.md`, `prompts/study/10-study.md`).

Earlier lessons hold the learner's work as `practice-thinking` markers, which still read back (`projectView` in `src/shared/core/view.ts`, `to_llm_messages`).

### The plan tree

The agent writes a plan tree with `plan_init`: a mermaid-subset graph, parsed with line-numbered errors (`agent::tools::mermaid_plan`) and checked to be a DAG. A later `plan_init` call replaces the tree. Who writes it depends on the lesson:

| Lesson | Who writes the plan tree |
|---|---|
| Older teach lesson | the teacher, with `plan_init` after the probe |
| Study session on space topics | the app, when the lesson starts (§7) |
| Study session with no space topics | the agent, with `plan_init` in its first reply (§7) |

Progress is never written into the tree. Statuses (`current`, `visited`, upcoming) derive from tagged `quiz`, `explain` and `problem` calls in the transcript. The plan row (`src/frontend/components/lesson/plan-row.tsx`, steps from `src/shared/core/plan-step-bar.ts`) and the plan dialog (`src/frontend/components/plan-block.tsx`, layout in `plan-block-model.ts`) draw that. The lesson text holds no copy of the plan: a `plan-block` marker in an old lesson is skipped by the view, the model view and compaction. The row is one folded line, a thin block per step across the page, then the current step's name and the count ("Step 2 of 5", `foldedLine` in `plan-row-model.ts`), that unfolds into every step by name; a branching plan also gets a small map there that opens the plan dialog. Whether it is unfolded is kept for every lesson (`lh:steps-open`); it starts folded. It also unfolds once, without saving, when a plan lesson's plan arrives or its steps change (`planArrived` in `plan-row-model.ts`); a lesson that opens with its plan already there stays as kept.

Older teach lessons start with a prober: `probe_done` files the assessment and queues a handoff steer; every later turn builds the teacher. Phases (`core::messages::phases`): probe, plan, teach.

### Job tools

`research`, `demo` and `pdf` run on the server. Each acks at once so the teacher keeps teaching; the job runs in the background on a session of its own ([5.4](05.4-background-jobs.md), `agent::tools::jobs`, `agent::subagents`) and its result returns through the wake pipeline (§5.1).

### Figures

The teacher draws a figure itself: `visual` takes the finished SVG, in every lesson kind (`agent::tools::visual`; the prober has none). When to draw and the drawing rules are in the tool's description.

| Step | What happens |
|---|---|
| Check | Root `viewBox`, at most 24,000 characters, and only the four color names `var(--ink)`, `var(--soft)`, `var(--accent)`, `var(--paper)` (plus `none`). A figure that breaks a rule, or draws nothing, is refused with every problem listed, and the teacher draws again in the same turn |
| Store | The view box is cut to the drawing plus 16 units of room (`gs_media::svg::drawn_box`), so a figure brings no empty band into the lesson. The root gains a size from that view box (at most 720 wide) and its defaults (ink fill, system font, round line ends). The result's `details.svg` is what the lesson shows |
| Render | The server draws it once, dark on white (`HeadlessApi::render_svg`). A figure that cannot be drawn is refused with the reason |
| Look | The result carries the render as an image, so the agent sees its figure in the tool's answer. A figure never ends the turn: the agent goes on and ends the turn itself. A turn that ends on a drawn figure owes nothing, so the window never asks for a continuation after it (`needsContinuation`) |
| Show | The window swaps the four names for the theme's colors (`figureInksOf`, `themedFigure`) and shows the figure bare under the reply, as an image document; one drawn before the turn's words is drawn under its last words (`projectView`). A figure from an older lesson names none and lies on white |

### Attachments

A learner message carries up to 5 pictures and PDFs: a lesson-box message (side questions included) or an `explain`, `recall` or `ask_user_question` answer (`answer_takes_files`, `core::messages::pending`).

| Rule | Value |
|---|---|
| Pictures | resized to long side max 1568 px, stored inline in message; 20 MB each |
| PDFs | saved in `data/chats/<id>/`, with a short note in message giving path; 30 MB each |
| Code | `core::messages::attachments`, `services::turns::attachments`, `src/frontend/components/lesson/attachment-tray.tsx` (button, tray, paste, drop) |

An answer's files go into the question call's tool result (`new_answer_result`), so the agent gets them like a message's. Files waiting in a lesson's box stay in memory per lesson until sent: leaving the lesson keeps them, a reload drops them, never localStorage.

### Space and date context

A space lesson starts with a `space-context` marker holding the space card (`services::spaces::space_card`). The lesson text does not draw it: the desk reads its files, and so does the model. The card counts the space's files; the lesson's `read_space` lists them only with `files: true`, so a long list stays out of the lesson's record unless the teacher needs a path. A hidden `today-context` marker gives the model today's date, time, time zone and the space's open deadlines. A new one is added before the learner's message when the day or deadlines changed, or compaction cut the last one out of view (`core::spaces::today_note`, `services::app::today_note`).

### Compaction

A lesson whose transcript passes 40,000 tokens (`compaction.thresholdTokens` in `factory_settings`, not a setting) is shortened between turns, so a turn never waits for a summary (`services::turns::compaction`). The threshold measures only what the model sees of the lesson, the summary and the kept messages (`lesson_tokens`), never the system prompt or tool schemas, which no cut can shrink.

1. Server cuts old part at once and writes its own short version without a model (`local_summary`, `core::session::compaction`).
2. After 5 quiet minutes a background job on the learner's agent writes the real summary ([5.4](05.4-background-jobs.md)), replacing the local one.

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
3. Otherwise pipeline waits until no turn runs and no question waits, then fires one wake turn carrying every pending marker through normal turn path. While it waits, a demo is saved into lesson with no turn when a side question holds open question (`open_question_held`): answer then reaches model as a message, so nothing comes between a call and its result. A question open with no side question still holds it for answer.
4. A wake turn getting 409 retries with backoff 500, 1000, 2000, 5000 ms.
5. A wake turn failing to start otherwise leaves markers pending, with no error and no timer; they go out with learner's next turn or after a restart.
6. Delivery is complete only when marker is in saved conversation; seeing it stream is not enough.

Rules:

- A marker already in transcript is never delivered twice; a failed bookkeeping step cannot replay one.
- `register_live_agent` restores pending deliveries from job records before a new agent's first steering poll, so a restart loses nothing.
- Only a computing worker can be aborted. An abort saves its own pending abort notice (`delivery: {kind: "abort"}`).
- Deleting a lesson drops its pending deliveries (`discard_chat_deliveries`). Only a live turn or computing worker blocks deletion.
- Jobs saved by older versions are normalized on read (`normalize_legacy_result`). All this runs on JSON stores and one in-process registry, not a transactional queue.

In the window, a wake turn is adopted like a turn in progress (`turnInFlight`); steers render as artifact cards, never chat bubbles.

Sub-agents check their work before delivering. The demo-builder runs its HTML in the shell's hidden web view. A figure's render (resvg, or the shell's web view for an SVG resvg cannot draw) goes back to the teacher as an image, so the agent must accept images.
