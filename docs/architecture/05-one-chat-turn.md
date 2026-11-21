## 5. One chat turn

`handle_chat_input` (`services::turns::chat_handler`) is plain Rust over `App`. `AgentBuildOptions` is its test seam (scripted engines).

1. Window posts `{chatId, input}` to `POST /api/chat`. Input is one event: `text`, `answer`, `continue`, `side`, `next` (practice, study or homework), `open` (a homework problem picked by number) or `opener-answer` (`core::messages::input_events`). `dismiss-problem` is the only dismissal: it discards an open problem and never starts a turn.
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

1. Call streams to window; question shows in dock at once, a check like any other question.
2. Learner answers. The window grades multiple choice with `question-grading.ts` and builds answer. A `write_code` answer (`code-question.ts`) is never run or graded by the app; teacher reads it.
3. Window posts it as an `answer` input event.
4. Server saves it as call's tool result and next turn runs.

Skip question sends the same `answer` with `dismissed: true` (`dismissedAnswer`), after stopping a running reply; the teacher moves on without asking it again.

In the lesson text an answered question is a card (`AnsweredCard`, `src/frontend/components/answered-card.tsx`): the verdict chip (`ResultChip` on `ResultTag`: Right, Wrong, Didn't know; none on a prediction or an ask), the kind and step, the question, and under it what the learner picked as rows (a quiz or an ask with choices; none on "I don't know"). A quiz's right answer, its explanation and his thinking wait behind Why. An older saved answer may carry `readingThinking`, thoughts noted while reading; it is not drawn and not sent to the teacher.

A question waiting in the saved record lets a lesson resume mid-question. Options are shuffled with a seed (the tool call id), so server and window show the same order.

### Side questions

The lesson is one scrolling page (`LessonScroll` in `src/frontend/components/lesson/lesson-scroll.tsx`): the step line on its own sheet pinned on top, then the lesson text's sheet and, once the lesson has started (the teacher has spoken or a turn runs), the "Your turn" sheet (`TurnSheet` in `turn-sheet.tsx`; `turnDrawn` in `turn-next-model.ts`). Stacked, each sheet is as tall as what it holds; both are reading surfaces with one margin (`.lh-reading`, see the Page layout rules in `docs/ui-rules.md`). With room for both (a container query on the lesson's own room, at least 1280 points; a docked panel (the cheat sheet or the lesson's document) or the teacher's panel takes room away) the two sit side by side across the page's column, which every page shares (`.lh-page`, at most `--lh-page-w` wide inside `--lh-page-side` sides; `.lh-lesson-room` in `globals.css` sizes the pair): "Your turn" is 688 points where there is room and gives way first, down to 560, so the text keeps at least 632 and is never narrower than it. At 688 its foot row is one line; narrower, the way out wraps to the right end of a second line under the Stuck? keys; the text scrolls with the page and "Your turn" holds still under the step line, as tall as the window's room, the text's sheet is at least that tall, and the page ends `--lh-gap` under the sheets (`.lh-turn-fit` and `.lh-text-fit` in `globals.css`; the page's scroller is a size container, so `100cqh` is its height). Its question or problem (`.lh-turn-scroll`) takes the room that is left and scrolls in its own box when it is longer, so the box, Send, the Stuck? keys and the way out rest at the sheet's foot, always in view. Side by side the pair stays for the whole lesson, so the text never jumps to the middle and back between problems; only "Your turn"'s contents change. Before the lesson starts the text is one centered column at a reading measure of 872 points, the lesson page's only width of its own. With less room "Your turn" sits under the text in that column, for the whole lesson too. While "Your turn" is up and the lesson text draws nothing (a lesson that opens with a problem; `messageShows` in `message-row.tsx` says what draws), the text's sheet is left out: "Your turn" sits alone in the middle, at the width it keeps in the pair, and slides to its side when the text's sheet arrives (the learner's first line, or the teacher's first words). The page rests at its end (`restingTop` in `lesson-scroll-model.ts`). Under the text, "Your turn" then ends at the window's end; when it is taller than the window the page rests on the sheet's top, on the part the learner is on when that sits deep in the problem, or on the learner's last message once the teacher writes back while the problem stays open. Beside the text the page always rests at its end. At rest, and not while the teacher writes, the page moves up a few points when the window's top edge would cut a line of text (`wholeLineTop`). It goes there on open, when the teacher asks something new and while the teacher writes; scrolled up, the key in the corner (in the lesson text's side padding when the sheets are side by side) brings the learner back. The turn sheet has one writing box (`LessonBox` in `lesson-box.tsx`; `lessonBox` in `lesson-box-model.ts` decides its size, its keys, the way out at the title row's end (Skip question, Discard problem) and the "Stuck?" keys under it). With nothing waiting the row under the box is "Try asking" (`lessonIdeas`: Draw it, Show a demo, Look it up, Quiz me; a background job switched off in Settings takes its line with it), never both rows; each key sends its words as a typed line would. The box is there in every state and holds still while the rest of the sheet swaps (`TurnSwap` in `turn-swap.tsx`): everything the learner says to the teacher in a lesson is typed in it.

| "Your turn" holds | The box reads | Keys |
|---|---|---|
| A question with choices | Your reasoning or a question | Ask (teacher's name), Submit answer |
| A question answered in words | An answer or a question | Ask (teacher's name), Submit answer |
| An open problem | Your work or a question | Send |
| Nothing waiting, or the teacher writing | Your question | Ask (teacher's name) |

One key is bright, the one Enter presses: Submit answer, or the ask key under choices while nothing is picked, or the ask key when it is the only one and no next key shows above it. The box is one line where its text is optional and three lines where it is the answer or a problem's work; both grow to five lines. `sendBox` in `chat.tsx` sends through `sendLine`, which a line typed in the teacher's terminal on a lesson page goes through too: the line steers a reply being written (a steer carries no files, so files wait), is a side question while a question waits, or is the next message. The "Give me a hint" and "Explain it simpler" keys send those words the same way. "I don't know" answers the question: `dontKnow: true`, or for `ask_user_question` the words as its answer (`dontKnowRequest`).

- A side question is the box's words sent with its ask key while a question waits. Enter asks only under a question with choices while nothing is picked; with a pick Enter submits and the words are the reasoning. A line typed in the teacher's terminal while a question waits is a side question too.
- It posts a `side` input event, refused unless a question waits. The server saves it as a user message with `side: true` (`new_side_question`, `core::messages::native_messages`). Pictures and PDFs are stored like any message's.
- Question stays open: `dangling_question_of` looks past side questions and their replies.
- `is_side_turn` marks reply turn. A job result arriving after side question ends it.
- A side turn keeps same tool list, so outside agent gets a small delta. Question tools, `problem` and `conclude` refuse (`side_turn_tools` in `agent::teacher::teacher_agent`). `plot` still draws, with no guess (see Plots).
- A side turn gets no `today-context` note and no job results (`services::turns::chat_handler`).
- A figure or demo finishing while a side question holds open question is written into lesson at once, with no turn (`show_held_artifacts` in `services::jobs`). The question stays open; teacher reads it with answer.
- In model's view question call gets a placeholder result at once, side question follows as a plain user message, and learner's later answer (or skip) arrives where it happened. Earlier model views stay a prefix of later ones.

### Open problems

In study, practice and homework lessons, the open problem sits in the turn sheet above the box (`OpenProblemPane`, `src/frontend/components/lesson/open-problem-pane.tsx`), with no writing box of its own.

- Learner works in lesson's one box. Each message is a plain `text` input: work on the problem. The box reads "Your work or a question": a question about the problem is the same kind of message. The three "Stuck?" keys send their words as such a message.
- A choice problem carries `options` (2 to 8 labels) and `multiSelect` on its `problem` call (`problem_choice_fields`, `problem_choice_problems`: the pose is refused with fewer, more, an empty label, or `multiSelect` alone; the statement never lists the choices). The open problem shows them as lettered rows under the statement (`ProblemChoiceRows`), the same rows and keys as a quiz (`ChoiceRows`, `useChoiceKeys`). Picks are kept per problem in the lesson draft, like the box text, and clear on Send. Send is open with a pick or work. The message is `I picked A and C.` (`problemMessage`), then a blank line and the work when there is any. Nothing is graded: the teacher reads the letters like any other work. The transcript card keeps the choices as a lettered list.
- A message never ends problem (`active_problem_of`). Only teacher's `conclude` or learner's discard does.
- Teacher may conclude one problem and pose the one learner asked for in same turn.
- While a problem is open, its card in the transcript is not drawn (`openProblem` in `ChatActionsContext`). The card appears once the problem closes, its statement with no label above it (`ProblemCard`, `src/frontend/components/practice-cards.tsx`).
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

Progress is never written into the tree. Statuses (`current`, `visited`, upcoming) derive from tagged `quiz`, `explain` and `problem` calls in the transcript. The plan row (`src/frontend/components/lesson/plan-row.tsx`, steps from `src/shared/core/plan-step-bar.ts`) and the plan dialog (`src/frontend/components/plan-block.tsx`, layout in `plan-block-model.ts`) draw that. The lesson text holds no copy of the plan: a `plan-block` marker in an old lesson is skipped by the view, the model view and compaction. The row is one folded line ("Step 2 of 5", the step's name and a slim bar, `foldedLine` in `plan-row-model.ts`) that unfolds into every step by name; a branching plan also gets a small map there that opens the plan dialog. Whether it is unfolded is kept for every lesson (`lh:steps-open`); it starts folded. It also unfolds once, without saving, when a plan lesson's plan arrives or its steps change (`planArrived` in `plan-row-model.ts`); a lesson that opens with its plan already there stays as kept.

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

A space lesson starts with a `space-context` marker holding the space card (`services::spaces::space_card`). The lesson text does not draw it: the desk reads its files, and so does the model. A hidden `today-context` marker gives the model today's date, time, time zone and the space's open deadlines. A new one is added before the learner's message when the day or deadlines changed, or compaction cut the last one out of view (`core::spaces::today_note`, `services::app::today_note`).

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
- `register_live_agent` restores pending deliveries from job records before a new agent's first steering poll, so a restart loses nothing.
- Only a computing worker can be aborted. An abort saves its own pending abort notice (`delivery: {kind: "abort"}`).
- Deleting a lesson drops its pending deliveries (`discard_chat_deliveries`). Only a live turn or computing worker blocks deletion.
- Jobs saved by older versions are normalized on read (`normalize_legacy_result`). All this runs on JSON stores and one in-process registry, not a transactional queue.

In the window, a wake turn is adopted like a turn in progress (`turnInFlight`); steers render as artifact cards, never chat bubbles.

Sub-agents check their work before delivering. The demo-builder runs its HTML in the shell's hidden web view. The visual-maker renders each SVG (resvg, or the shell's web view for SVGs resvg cannot draw) and looks at it, so the outside agent must accept images.
